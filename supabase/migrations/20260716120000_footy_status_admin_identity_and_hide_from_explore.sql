-- =============================================================================
-- Footy Status Admin: correct account identity + hide from public Explore
-- =============================================================================
-- Two problems this fixes:
--   1. The official admin account was classified as a Club Team
--      (profiles.account_role / account_category = 'team_club'), and that value
--      is FROZEN by the protection trigger (20260711120000). It must read as the
--      internal admin role instead.
--   2. Because it was a team_club account it owned a public `teams` row, so it
--      showed up on the Explore page for ordinary users.
--
-- Source of truth for "who is an admin" is the permission registry
-- (public.global_admin_users, role = 'footy_status_admin') plus the protected
-- account registry — never the name / username / email string on its own.
--
-- Safe to run more than once (idempotent).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Source-of-truth helper: the set of Footy Status admin auth user ids.
--    SECURITY DEFINER so ordinary clients (who cannot read global_admin_users
--    directly) can still ask "which ids must Explore exclude?". It only ever
--    returns opaque UUIDs, never any profile data.
-- -----------------------------------------------------------------------------
create or replace function public.footy_status_admin_user_ids()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select gau.user_id from public.global_admin_users gau
  union
  select pa.user_id from public.protected_accounts pa;
$$;

revoke all on function public.footy_status_admin_user_ids() from public;
grant execute on function public.footy_status_admin_user_ids() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Shared reclassification routine.
--    Marks a user's profile as the internal admin role and removes it from
--    every public/discoverable surface. Runs as SECURITY DEFINER so it works
--    from the future-admin trigger regardless of the caller's RLS.
--    NOTE: this does NOT touch the freeze trigger or protected snapshot — that
--    is handled once, below, for the already-protected official account.
-- -----------------------------------------------------------------------------
create or replace function public.footy_status_hide_admin_from_public(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if _user_id is null then
    return;
  end if;

  -- Deactivate any public team the admin owns so the Explore teams query
  -- (which filters `is_active <> false` and approved status) skips it. Covers
  -- both direct ownership and the team_profiles link.
  if to_regclass('public.teams') is not null then
    update public.teams t
      set is_active = false
      where t.is_active is distinct from false
        and (
          t.owner_user_id = _user_id
          or (to_regclass('public.team_profiles') is not null
              and t.id in (select tp.team_id from public.team_profiles tp where tp.user_id = _user_id))
        );
  end if;

  -- `clubs.owner_user_id` is not guaranteed to exist in every schema revision,
  -- so guard against a missing column rather than failing the whole routine.
  if to_regclass('public.clubs') is not null then
    begin
      update public.clubs c
        set is_active = false
        where c.is_active is distinct from false
          and c.owner_user_id = _user_id;
    exception
      when undefined_column then null;
    end;
  end if;
end;
$$;

revoke all on function public.footy_status_hide_admin_from_public(uuid) from public;

-- -----------------------------------------------------------------------------
-- 3. One-time fix for the already-protected official admin account.
--    Its role is frozen to the snapshot in protected_accounts, so we update the
--    snapshot AND the profile together, with the two protective triggers
--    temporarily disabled. `ALTER TABLE ... DISABLE TRIGGER` only needs table
--    ownership (which the migration role has) — no superuser required.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
  -- (table, trigger) pairs that must be suspended to touch the protected
  -- account's rows. Two protection layers guard it:
  --   * 20260711120000 froze the profile role + locked the registry;
  --   * 20260712110000 blocks ALL mutations of the protected profile/team rows
  --     (prevent_protected_<table>_mutation).
  v_pairs constant text[][] := array[
    array['public.profiles',          'protect_official_admin_profile_role'],
    array['public.profiles',          'prevent_protected_profiles_mutation'],
    array['public.profiles',          'sync_profile_account_type_fields_trigger'],
    array['public.protected_accounts','protect_registry_no_update'],
    array['public.teams',             'prevent_protected_teams_mutation']
  ];
  v_pair text[];
begin
  select coalesce(array_agg(distinct s.user_id), '{}') into v_ids
  from (
    select user_id from public.global_admin_users
    union
    select user_id from public.protected_accounts
  ) s;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise notice 'No Footy Status admin account present yet; nothing to reclassify.';
    return;
  end if;

  -- Disable whichever protection triggers actually exist.
  foreach v_pair slice 1 in array v_pairs loop
    if to_regclass(v_pair[1]) is not null
       and exists (
         select 1 from pg_trigger
         where tgname = v_pair[2] and tgrelid = v_pair[1]::regclass
       ) then
      execute format('alter table %s disable trigger %I', v_pair[1], v_pair[2]);
    end if;
  end loop;

  -- Move the frozen snapshot to the internal admin role first so the profile
  -- update below is consistent with the (re-enabled) freeze. 'footy_status_official'
  -- is the canonical internal admin role (what normalize_signup_account_role maps
  -- 'official'/'admin' to) with account_category 'official'; both are already
  -- permitted by the profiles_account_*_check constraints (see 20260627161000),
  -- and the app labels this account "Footy Status Admin". The account-type sync
  -- trigger is suspended above so these exact values are written verbatim.
  update public.protected_accounts
    set protected_role = 'footy_status_official',
        protected_account_category = 'official'
    where user_id = any(v_ids);

  update public.profiles
    set account_role = 'footy_status_official',
        account_type = 'footy_status_official',
        account_category = 'official',
        updated_at = now()
    where user_id = any(v_ids)
      and (coalesce(account_role, '') is distinct from 'footy_status_official'
           or coalesce(account_category, '') is distinct from 'official');

  -- Remove every admin from the public Explore surface (teams trigger is
  -- suspended above so the protected team can be deactivated).
  perform public.footy_status_hide_admin_from_public(uid)
  from unnest(v_ids) as uid;

  -- Restore every protection trigger we suspended (same existence check).
  foreach v_pair slice 1 in array v_pairs loop
    if to_regclass(v_pair[1]) is not null
       and exists (
         select 1 from pg_trigger
         where tgname = v_pair[2] and tgrelid = v_pair[1]::regclass
       ) then
      execute format('alter table %s enable trigger %I', v_pair[1], v_pair[2]);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Future admins: whenever an account is granted the admin role, classify it
--    correctly and strip it from public Explore automatically. Future admins
--    are not in protected_accounts, so no freeze trigger applies to them.
-- -----------------------------------------------------------------------------
create or replace function public.tg_footy_status_admin_reclassify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- Future admins are not protected, so the account-type sync trigger runs
  -- normally: 'footy_status_official' passes through unchanged and yields
  -- account_category 'official'.
  update public.profiles
    set account_role = 'footy_status_official',
        account_category = 'official',
        updated_at = now()
    where user_id = new.user_id
      and (coalesce(account_role, '') is distinct from 'footy_status_official'
           or coalesce(account_category, '') is distinct from 'official');

  perform public.footy_status_hide_admin_from_public(new.user_id);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.global_admin_users') is not null then
    drop trigger if exists footy_status_admin_reclassify_after_insert on public.global_admin_users;
    create trigger footy_status_admin_reclassify_after_insert
      after insert on public.global_admin_users
      for each row execute function public.tg_footy_status_admin_reclassify();
  end if;
end $$;
