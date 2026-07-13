-- Critical data-integrity hardening:
-- The Footy Status Official Admin account must never be edited through normal
-- profile/team/player/staff/parent account edit flows. It is identified by the
-- protected_accounts registry seeded in 20260711120000_protect_official_admin_account.sql.

-- Repair the known bad incident safely before locking the profile against
-- normal edits. Only the protected Official account is touched.
do $$
declare
  v_admin_user_id uuid;
  v_username text := 'footystatusofficial';
begin
  select pa.user_id
    into v_admin_user_id
  from public.protected_accounts pa
  where lower(coalesce(pa.official_email, '')) = 'footystatussupport@gmail.com'
  order by pa.created_at asc
  limit 1;

  if v_admin_user_id is null then
    return;
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(coalesce(p.username, '')) = v_username
      and p.user_id <> v_admin_user_id
  ) then
    v_username := 'footystatusofficialadmin';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(coalesce(p.username, '')) = v_username
      and p.user_id <> v_admin_user_id
  ) then
    v_username := 'footystatusofficial_' || left(replace(v_admin_user_id::text, '-', ''), 8);
  end if;

  -- Emergency repair only: move the username cooldown back first so the
  -- normal username trigger allows this one-time restoration.
  update public.profiles
  set username_last_changed_at = now() - interval '15 days'
  where user_id = v_admin_user_id
    and lower(coalesce(username, '')) in ('', 'baystate2222');

  update public.profiles
  set
    username = case
      when lower(coalesce(username, '')) in ('', 'baystate2222') then v_username
      else username
    end,
    full_name = case
      when nullif(trim(coalesce(full_name, '')), '') is null
        or lower(coalesce(full_name, '')) like '%baystate%'
      then 'Footy Status Official'
      else full_name
    end,
    updated_at = now()
  where user_id = v_admin_user_id;
end;
$$;

-- Remove known stale Baystate rows that are not the protected Official profile.
-- This clears ghost profile/team references without touching the admin account.
do $$
declare
  v_admin_user_id uuid;
begin
  select pa.user_id
    into v_admin_user_id
  from public.protected_accounts pa
  where lower(coalesce(pa.official_email, '')) = 'footystatussupport@gmail.com'
  order by pa.created_at asc
  limit 1;

  delete from public.team_profiles tp
  where (
      lower(coalesce(tp.club_name, '')) = 'baystate'
      or lower(coalesce(tp.club_name, '')) = 'baystate2222'
      or lower(coalesce(tp.school_name, '')) = 'baystate'
      or lower(coalesce(tp.school_name, '')) = 'baystate2222'
    );

  delete from public.teams t
  where (
      lower(coalesce(t.name, '')) = 'baystate'
      or lower(coalesce(t.name, '')) = 'baystate2222'
    );

  delete from public.profiles p
  where p.user_id is distinct from v_admin_user_id
    and (
      lower(coalesce(p.username, '')) = 'baystate2222'
      or lower(coalesce(p.full_name, '')) = 'baystate'
      or lower(coalesce(p.club_name, '')) = 'baystate'
      or lower(coalesce(p.team_name, '')) = 'baystate'
    );
end;
$$;

create or replace function public.assert_admin_edit_target_allowed(
  _target_user_id uuid,
  _context text default 'account'
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if _target_user_id is null then
    raise exception 'No target account was provided.';
  end if;

  if public.is_account_protected(_target_user_id) then
    raise exception
      'The Footy Status Official Admin account is protected and cannot be edited through normal profile screens.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = _target_user_id
  ) then
    raise exception
      'Target account no longer exists. Refresh Explore and open the current profile again.';
  end if;
end;
$$;

grant execute on function public.assert_admin_edit_target_allowed(uuid, text) to authenticated;

create or replace function public.prevent_protected_account_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if TG_OP = 'INSERT' then
    v_user_id := case
      when TG_TABLE_NAME = 'teams' then nullif(to_jsonb(new)->>'owner_user_id', '')::uuid
      else nullif(to_jsonb(new)->>'user_id', '')::uuid
    end;
  else
    v_user_id := case
      when TG_TABLE_NAME = 'teams' then coalesce(nullif(to_jsonb(new)->>'owner_user_id', '')::uuid, nullif(to_jsonb(old)->>'owner_user_id', '')::uuid)
      else coalesce(nullif(to_jsonb(new)->>'user_id', '')::uuid, nullif(to_jsonb(old)->>'user_id', '')::uuid)
    end;
  end if;

  if v_user_id is not null and public.is_account_protected(v_user_id) then
    raise exception
      'The Footy Status Official Admin account is protected and cannot be edited through normal account records.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

do $$
declare
  v_table text;
  v_column text;
begin
  for v_table, v_column in
    select *
    from (values
      ('profiles', 'user_id'),
      ('player_profiles', 'user_id'),
      ('players', 'user_id'),
      ('staff_profiles', 'user_id'),
      ('parent_profiles', 'user_id'),
      ('team_profiles', 'user_id'),
      ('teams', 'owner_user_id')
    ) as protected_targets(table_name, column_name)
  loop
    if to_regclass('public.' || v_table) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_table
           and column_name = v_column
       ) then
      execute format('drop trigger if exists prevent_protected_%I_mutation on public.%I', v_table, v_table);
      execute format(
        'create trigger prevent_protected_%1$I_mutation
         before insert or update on public.%1$I
         for each row execute function public.prevent_protected_account_profile_mutation()',
        v_table
      );
    end if;
  end loop;
end;
$$;

-- Re-wrap the inline admin read/write functions so a stale/wrong target id
-- cannot repair or edit the protected admin account.
create or replace function public.admin_get_account_bundle(_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.admin_assert_official();
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_get_account_bundle');
  perform public.admin_repair_account_records(_target_user_id);

  select jsonb_build_object(
    'profile', (select to_jsonb(x) from public.profiles x where x.user_id = _target_user_id limit 1),
    'player_profile', (select to_jsonb(x) from public.player_profiles x where x.user_id = _target_user_id limit 1),
    'legacy_player', (select to_jsonb(x) from public.players x where x.user_id = _target_user_id order by x.created_at asc limit 1),
    'staff_profile', (select to_jsonb(x) from public.staff_profiles x where x.user_id = _target_user_id limit 1),
    'parent_profile', (select to_jsonb(x) from public.parent_profiles x where x.user_id = _target_user_id limit 1),
    'team_profile', (select to_jsonb(x) from public.team_profiles x where x.user_id = _target_user_id limit 1),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x) order by x.contact_type) from public.user_contacts x where x.user_id = _target_user_id), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.clips x
      left join public.player_profiles pp on pp.id = x.player_id
      left join public.players pl on pl.id = x.player_id
      where coalesce(x.user_id, pp.user_id, pl.user_id) = _target_user_id), '[]'::jsonb),
    'statistics', coalesce((select jsonb_agg(to_jsonb(s) order by s.season desc)
      from public.player_statistics s join public.players pl on pl.id = s.player_id
      where pl.user_id = _target_user_id), '[]'::jsonb),
    'player_team_links', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('team_name', t.name, 'daughter_team_name', concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, ''))))
      from public.player_team_memberships m
      left join public.teams t on t.id = m.team_id
      left join public.club_teams ct on ct.id = m.club_team_id
      where m.player_user_id = _target_user_id), '[]'::jsonb),
    'coach_team_links', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('team_name', t.name, 'daughter_team_name', concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, ''))))
      from public.coach_staff_team_memberships m
      left join public.teams t on t.id = m.team_id
      left join public.club_teams ct on ct.id = m.club_team_id
      where m.coach_user_id = _target_user_id), '[]'::jsonb),
    'parent_links', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'parent_user_id', par.user_id, 'player_user_id', pla.user_id,
        'parent_name', p1.full_name, 'player_name', p2.full_name))
      from public.parent_player_links l
      join public.parent_profiles par on par.id = l.parent_profile_id
      join public.player_profiles pla on pla.id = l.player_profile_id
      left join public.profiles p1 on p1.user_id = par.user_id
      left join public.profiles p2 on p2.user_id = pla.user_id
      where par.user_id = _target_user_id or pla.user_id = _target_user_id), '[]'::jsonb),
    'field_permissions', coalesce((select jsonb_agg(to_jsonb(fp) order by fp.table_name, fp.field_name) from public.admin_field_permissions fp), '[]'::jsonb),
    'strikes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.account_strikes x where x.account_id = _target_user_id), '[]'::jsonb),
    'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.temporary_bans x where x.account_id = _target_user_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
      (select * from public.admin_audit_log where target_account_id = _target_user_id order by created_at desc limit 50) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_patch_account_record(
  _target_user_id uuid,
  _table_name text,
  _changes jsonb,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_allowed_tables text[] := array['profiles','player_profiles','staff_profiles','parent_profiles','team_profiles'];
  v_applied jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_patch_account_record');
  perform public.admin_repair_account_records(_target_user_id);

  if not (_table_name = any(v_allowed_tables)) then
    raise exception 'That account record cannot be edited here.';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_before using _target_user_id;

  if v_before is null then
    raise exception 'Account record not found for table %. The account could not be repaired automatically.', _table_name;
  end if;

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','user_id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = _table_name
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.%1$I t set %2$I = r.%2$I from (select * from jsonb_populate_record(null::public.%1$I, $1)) r where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;
    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  if _table_name = 'player_profiles' then
    perform public.admin_resolve_legacy_player(_target_user_id);
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_after using _target_user_id;

  perform public.admin_write_audit(
    'account_record_updated',
    _table_name,
    coalesce(v_after->>'id', _target_user_id::text),
    _target_user_id,
    _reason,
    v_before,
    v_after,
    v_applied
  );

  return v_after;
end;
$$;

create or replace function public.admin_set_contact(
  _target_user_id uuid,
  _contact_type text,
  _value text,
  _visibility text default 'public',
  _reason text default null
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
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_set_contact');

  select to_jsonb(x) into v_before
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  insert into public.user_contacts(user_id, contact_type, value, visibility)
  values (_target_user_id, _contact_type, coalesce(_value, ''), coalesce(_visibility, 'public'))
  on conflict (user_id, contact_type) do update
  set value = excluded.value,
      visibility = excluded.visibility,
      updated_at = now();

  select to_jsonb(x) into v_after
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  perform public.admin_write_audit(
    'private_contact_updated',
    'user_contacts',
    coalesce(v_after->>'id', _target_user_id::text || ':' || _contact_type),
    _target_user_id,
    _reason,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

-- Block clear-avatar on protected or deleted/missing targets.
create or replace function public.admin_clear_profile_picture(_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_avatar text;
  v_account_type text;
  v_bucket text;
  v_path text;
  v_still_referenced boolean := false;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can clear profile pictures.';
  end if;
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_clear_profile_picture');

  select avatar_url, coalesce(account_role, account_category, role::text)
    into v_prev_avatar, v_account_type
  from public.profiles
  where user_id = _target_user_id;

  update public.profiles set avatar_url = null, updated_at = now() where user_id = _target_user_id;
  perform public.clear_image_col_if_exists('players', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('player_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('staff_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('parent_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('team_profiles', 'logo_url', _target_user_id);

  if v_prev_avatar is not null and position('/storage/v1/object/' in v_prev_avatar) > 0 then
    begin
      v_bucket := split_part(split_part(v_prev_avatar, '/storage/v1/object/', 2), '/', 2);
      v_path := regexp_replace(v_prev_avatar, '^.*/storage/v1/object/(public/)?[^/]+/', '');

      select exists (
        select 1 from public.profiles where avatar_url = v_prev_avatar
        union all
        select 1 from public.team_profiles where logo_url = v_prev_avatar
      ) into v_still_referenced;

      if not v_still_referenced and v_bucket is not null and v_path is not null and v_path <> '' then
        delete from storage.objects where bucket_id = v_bucket and name = v_path;
      end if;
    exception when others then
      null;
    end;
  end if;

  insert into public.admin_audit_log (
    admin_user_id, action, affected_table, affected_id, payload,
    target_account_id, reason, before_data, after_data
  ) values (
    auth.uid(), 'profile_picture_cleared', 'profiles', _target_user_id::text,
    jsonb_build_object('target_account_type', v_account_type),
    _target_user_id, null,
    jsonb_build_object('avatar_url', v_prev_avatar),
    jsonb_build_object('avatar_url', null)
  );

  return jsonb_build_object('success', true, 'target_user_id', _target_user_id);
end;
$$;

revoke all on function public.assert_admin_edit_target_allowed(uuid, text) from public, anon;
grant execute on function public.assert_admin_edit_target_allowed(uuid, text) to authenticated;
revoke all on function public.admin_get_account_bundle(uuid) from public;
revoke all on function public.admin_patch_account_record(uuid, text, jsonb, text) from public;
revoke all on function public.admin_set_contact(uuid, text, text, text, text) from public;
revoke all on function public.admin_clear_profile_picture(uuid) from public, anon;
grant execute on function public.admin_get_account_bundle(uuid) to authenticated;
grant execute on function public.admin_patch_account_record(uuid, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_contact(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_clear_profile_picture(uuid) to authenticated;
