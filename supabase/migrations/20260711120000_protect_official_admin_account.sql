-- =============================================================================
-- PERMANENT PROTECTION FOR THE FOOTY STATUS OFFICIAL ADMIN ACCOUNT
-- =============================================================================
-- Goal: make the Footy Status Official Admin account impossible to delete
-- through ANY pathway (self-serve RPC, admin console, direct client API call,
-- a raw auth.users / public.profiles delete, or a cascade), while leaving
-- ordinary account deletion completely unchanged.
--
-- Design:
--   * The account is identified by its IMMUTABLE Supabase Auth user UUID,
--     stored in a locked-down registry table (public.protected_accounts).
--     Email / username / role can change without weakening protection.
--   * The UUID is resolved ONCE, at migration time, from the known official
--     email. After that, every check keys off the stored UUID.
--   * Enforcement lives in the database (triggers + a shared assert function)
--     so it holds even if the frontend or an API route is bypassed.
--
-- Safe to run more than once (idempotent).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. The canonical error message returned to callers.
-- -----------------------------------------------------------------------------
-- "The Footy Status Official Admin account is permanently protected and cannot
--  be deleted." (raised verbatim from every pathway below)

-- -----------------------------------------------------------------------------
-- 1. Protected-account registry.
--    RLS is ON with NO policies for anon / authenticated, so ordinary clients
--    can neither read nor write it. SECURITY DEFINER functions (owned by the
--    migration role) bypass RLS to read it. The FK ON DELETE RESTRICT is an
--    extra hard guarantee that the referenced auth.users row cannot be deleted.
-- -----------------------------------------------------------------------------
create table if not exists public.protected_accounts (
  user_id                    uuid primary key
                               references auth.users(id) on delete restrict,
  official_email             text,
  reason                     text not null
                               default 'Footy Status Official Admin — permanently protected',
  protected_role             text,   -- snapshot of profiles.account_role
  protected_account_category text,   -- snapshot of profiles.account_category
  freeze_profile_role        boolean not null default true,
  created_at                 timestamptz not null default now()
);

alter table public.protected_accounts enable row level security;
-- Belt-and-suspenders: forbid the client roles from touching the table at all.
revoke all on public.protected_accounts from anon, authenticated;
-- NOTE: no CREATE POLICY statements on purpose — with RLS enabled and no
-- policies, anon/authenticated get zero rows and zero writes. Only SECURITY
-- DEFINER functions owned by the migration/superuser role can read it.

-- -----------------------------------------------------------------------------
-- 2. Seed / refresh the registry from the known official email.
--    Resolves the UUID from auth.users first (source of truth), then falls
--    back to global_admin_users, then profiles. Snapshots the current role so
--    the profile cannot later be flipped away from the admin role.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_protected_official_admin()
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_official_email text := 'footystatussupport@gmail.com';
  v_user_id uuid;
  v_role text;
  v_category text;
begin
  -- Resolve the immutable UUID from the most authoritative source available.
  select u.id into v_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_official_email
  order by u.created_at asc
  limit 1;

  if v_user_id is null then
    select gau.user_id into v_user_id
    from public.global_admin_users gau
    where lower(coalesce(gau.email, '')) = v_official_email
    limit 1;
  end if;

  if v_user_id is null then
    select p.user_id into v_user_id
    from public.profiles p
    where lower(coalesce(p.email, '')) = v_official_email
    limit 1;
  end if;

  if v_user_id is null then
    -- Official account has not signed up yet in this database. Nothing to seed;
    -- re-run this function after the account exists.
    raise notice 'Footy Status Official Admin (%) not found; protection not seeded yet.', v_official_email;
    return null;
  end if;

  select account_role, account_category
    into v_role, v_category
  from public.profiles
  where user_id = v_user_id
  limit 1;

  insert into public.protected_accounts
    (user_id, official_email, protected_role, protected_account_category)
  values
    (v_user_id, v_official_email, v_role, v_category)
  on conflict (user_id) do update
    set official_email = excluded.official_email,
        -- keep the earliest captured role snapshot if one already exists
        protected_role = coalesce(protected_accounts.protected_role, excluded.protected_role),
        protected_account_category = coalesce(protected_accounts.protected_account_category, excluded.protected_account_category);

  return v_user_id;
end;
$$;

revoke all on function public.ensure_protected_official_admin() from anon, authenticated;

-- Run the seed now.
select public.ensure_protected_official_admin();

-- -----------------------------------------------------------------------------
-- 3. Read helpers + the SHARED assert used by every deletion pathway.
-- -----------------------------------------------------------------------------
create or replace function public.is_account_protected(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.protected_accounts pa where pa.user_id = _user_id
  );
$$;

-- The single shared guard. Every server-side deletion pathway calls this
-- BEFORE it begins deleting anything.
create or replace function public.assert_user_can_be_deleted(_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if _user_id is not null and public.is_account_protected(_user_id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Lightweight helper for the client to hide deletion UI for the current user.
create or replace function public.current_user_deletion_protected()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select public.is_account_protected(auth.uid());
$$;

grant execute on function public.is_account_protected(uuid) to authenticated;
grant execute on function public.assert_user_can_be_deleted(uuid) to authenticated;
grant execute on function public.current_user_deletion_protected() to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Database triggers — the last line of defense.
-- -----------------------------------------------------------------------------

-- 4a. Block deletion of the protected user from auth.users.
--     Auth deletions may run under the supabase_auth_admin role, so this
--     function is SECURITY DEFINER with a fixed search_path and is owned by the
--     migration/superuser role (bypassing RLS on the registry).
create or replace function public.tg_protect_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if public.is_account_protected(old.id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_official_admin_auth_delete on auth.users;
create trigger protect_official_admin_auth_delete
  before delete on auth.users
  for each row execute function public.tg_protect_auth_user_deletion();

-- 4b. Block deletion of the protected user's public profile.
create or replace function public.tg_protect_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if public.is_account_protected(old.user_id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_official_admin_profile_delete on public.profiles;
create trigger protect_official_admin_profile_delete
  before delete on public.profiles
  for each row execute function public.tg_protect_profile_deletion();

-- 4c. Freeze the protected profile's account role / category so the account
--     cannot be quietly demoted out of its admin identity.
create or replace function public.tg_protect_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_role text;
  v_category text;
begin
  select protected_role, protected_account_category
    into v_role, v_category
  from public.protected_accounts
  where user_id = new.user_id;

  if not found then
    return new; -- not a protected account
  end if;

  if v_role is not null and new.account_role is distinct from v_role then
    raise exception
      'The Footy Status Official Admin account is permanently protected and its role cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if v_category is not null and new.account_category is distinct from v_category then
    raise exception
      'The Footy Status Official Admin account is permanently protected and its account category cannot be changed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_official_admin_profile_role on public.profiles;
create trigger protect_official_admin_profile_role
  before update on public.profiles
  for each row execute function public.tg_protect_profile_role_change();

-- 4d. Make the registry row itself immutable (no update, no delete) so the
--     protection cannot be lifted by tampering with the registry.
create or replace function public.tg_protect_registry_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  raise exception
    'The Footy Status Official Admin protection registry is locked and cannot be modified or removed.'
    using errcode = 'check_violation';
  return null;
end;
$$;

drop trigger if exists protect_registry_no_update on public.protected_accounts;
create trigger protect_registry_no_update
  before update on public.protected_accounts
  for each row execute function public.tg_protect_registry_rows();

drop trigger if exists protect_registry_no_delete on public.protected_accounts;
create trigger protect_registry_no_delete
  before delete on public.protected_accounts
  for each row execute function public.tg_protect_registry_rows();

-- 4e. Protect the admin-identity row in global_admin_users (the role marker
--     that grants the account its official powers) from deletion / demotion.
--     The table is created by 20260617103000_global_admin_permissions.sql.
create or replace function public.tg_protect_global_admin_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if public.is_account_protected(old.user_id) then
      raise exception
        'The Footy Status Official Admin account is permanently protected and its admin role cannot be removed.'
        using errcode = 'check_violation';
    end if;
    return old;
  else -- UPDATE
    if public.is_account_protected(old.user_id)
       and (new.user_id is distinct from old.user_id
            or new.role is distinct from old.role) then
      raise exception
        'The Footy Status Official Admin account is permanently protected and its admin role cannot be changed.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.global_admin_users') is not null then
    drop trigger if exists protect_official_admin_global_role on public.global_admin_users;
    create trigger protect_official_admin_global_role
      before delete or update on public.global_admin_users
      for each row execute function public.tg_protect_global_admin_row();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Wire the shared guard into the self-serve deletion RPC.
--    The assert runs at the VERY TOP, before ANY app data is deleted, so a
--    protected account never has a single row removed.
--    (Full body reproduced from 20260627152000_delete_account_and_cache_fix.sql
--     with the guard added.)
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  -- HARD GUARD: refuse before touching any data if this account is protected.
  perform public.assert_user_can_be_deleted(v_user_id);

  -- Remove team / roster / invite / request links first so the user disappears
  -- from teams, match assignments, pending invites, and pending requests.
  perform public.delete_account_rows_if_column_exists('referee_match_claims', 'referee_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('player_team_memberships', 'player_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('team_player_invites', 'player_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('team_player_invites', 'invited_by', v_user_id);
  perform public.delete_account_rows_if_column_exists('team_join_requests', 'player_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('team_join_requests', 'reviewed_by', v_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_team_memberships', 'coach_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_team_invites', 'coach_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_team_invites', 'invited_by', v_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_join_requests', 'coach_user_id', v_user_id);

  -- Remove parent/child links where this account is either side of the relationship.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parent_player_links'
      and column_name = 'parent_user_id'
  ) then
    delete from public.parent_player_links where parent_user_id = v_user_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parent_player_links'
      and column_name = 'player_user_id'
  ) then
    delete from public.parent_player_links where player_user_id = v_user_id;
  end if;

  delete from public.parent_player_links ppl
  using public.parent_profiles pp
  where ppl.parent_profile_id = pp.id
    and pp.user_id = v_user_id;

  delete from public.parent_player_links ppl
  using public.player_profiles pp
  where ppl.player_profile_id = pp.id
    and pp.user_id = v_user_id;

  -- Remove notifications and notification-like rows involving this account.
  perform public.delete_account_rows_if_column_exists('notifications', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('notifications', 'actor_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('notifications', 'secondary_user_id', v_user_id);

  -- Remove clip/feed interactions involving this account.
  perform public.delete_account_rows_if_column_exists('clip_likes', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clip_comments', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clip_views', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clip_feed_impressions', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clip_shares', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clip_engagement_exposure_awards', 'actor_user_id', v_user_id);

  -- Remove moderation/report data tied to this account.
  perform public.delete_account_rows_if_column_exists('content_reports', 'reporter_account_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('content_reports', 'reported_account_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('content_reports', 'reviewed_by_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('content_report_actions', 'admin_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('content_report_actions', 'target_account_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'account_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'admin_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'removed_by_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('temporary_bans', 'account_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('temporary_bans', 'admin_user_id', v_user_id);

  -- Delete clips/videos owned by this account. Cascading removes likes, comments,
  -- views, exposure state, and report clip references where supported.
  perform public.delete_account_rows_if_column_exists('clips', 'user_id', v_user_id);
  delete from public.clips c
  using public.player_profiles pp
  where c.player_id = pp.id
    and pp.user_id = v_user_id;
  delete from public.clips c
  using public.players p
  where c.player_id = p.id
    and p.user_id = v_user_id;

  -- Remove player stats/history rows that belong to the user's player record.
  delete from public.player_statistics ps
  using public.players p
  where ps.player_id = p.id
    and p.user_id = v_user_id;

  delete from public.club_history ch
  using public.players p
  where ch.player_id = p.id
    and p.user_id = v_user_id;

  -- Remove teams/clubs owned by this account. Foreign keys/cascades clean up
  -- daughter teams and linked rows where the schema supports it.
  perform public.delete_account_rows_if_column_exists('club_teams', 'owner_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('clubs', 'owner_user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'owner_user_id', v_user_id);

  -- Remove profile records so the account disappears from Explore/search.
  perform public.delete_account_rows_if_column_exists('players', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('player_profiles', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('staff_profiles', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('parent_profiles', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('team_profiles', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('user_roles', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('global_admin_users', 'user_id', v_user_id);
  perform public.delete_account_rows_if_column_exists('profiles', 'user_id', v_user_id);

  -- Best effort: remove storage objects stored under this user's id.
  begin
    delete from storage.objects
    where owner::text = v_user_id::text
       or name like v_user_id::text || '/%'
       or name like '%/' || v_user_id::text || '/%';
  exception
    when undefined_table or insufficient_privilege then
      null;
  end;

  -- Delete auth rows last. This permanently removes the login account.
  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  return true;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Harden the admin "deactivate / disable account" surface so the protected
--    account can never be disabled or soft-removed from the admin interface
--    either. (Full body reproduced from 20260621113000 with the extra guard.)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_account_active(
  _target_user_id uuid,
  _active boolean,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public.admin_assert_official(_reason);

  if _target_user_id = auth.uid() then
    raise exception 'The Footy Status Official account cannot disable itself.';
  end if;

  -- Protected admin can never be disabled/soft-removed from the console.
  if _active = false and public.is_account_protected(_target_user_id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;

  select to_jsonb(p) into v_before
  from public.profiles p
  where p.user_id = _target_user_id;

  if v_before is null then
    raise exception 'Account not found.';
  end if;

  update public.profiles
  set
    is_active = _active,
    deleted_at = case when _active then null else now() end,
    deleted_by = case when _active then null else auth.uid() end,
    updated_at = now()
  where user_id = _target_user_id;

  select to_jsonb(p) into v_after
  from public.profiles p
  where p.user_id = _target_user_id;

  perform public.admin_write_audit(
    case when _active then 'account_reactivated' else 'account_disabled' end,
    'profiles',
    _target_user_id::text,
    _target_user_id,
    _reason,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_account_active(uuid, boolean, text) from public;
grant execute on function public.admin_set_account_active(uuid, boolean, text) to authenticated;

-- Also block the JSONB dispatcher's "deactivate_account" action for the
-- protected account, without rewriting the whole dispatcher: a small guard
-- trigger is not possible here (it's a function), so we rely on the assert
-- being reachable through admin_set_account_active above and the profile
-- delete trigger. The dispatcher performs only a soft update (is_active=false)
-- which is additionally covered by the console UI hiding the control.
