-- Full Footy Status Official admin control layer.
-- This migration expands the admin system beyond the emergency player repair:
-- - repairs missing type-specific account rows for all current account types
-- - lets normal admin edits save without a required note
-- - skips unknown/missing fields instead of crashing when old schemas differ
-- - adds centralized field-permission metadata
-- - adds fixture and referee-assignment admin RPCs with audit logging

create table if not exists public.admin_field_permissions (
  id uuid primary key default gen_random_uuid(),
  account_role text not null,
  table_name text not null,
  field_name text not null,
  owner_can_edit boolean not null default true,
  admin_can_edit boolean not null default true,
  locked_after_verification boolean not null default false,
  requires_approval boolean not null default false,
  public_visibility text not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_role, table_name, field_name)
);

alter table public.admin_field_permissions enable row level security;

drop policy if exists "official admin can read field permissions" on public.admin_field_permissions;
create policy "official admin can read field permissions"
on public.admin_field_permissions
for select
to authenticated
using (public.is_footy_status_global_admin());

drop policy if exists "official admin can manage field permissions" on public.admin_field_permissions;
create policy "official admin can manage field permissions"
on public.admin_field_permissions
for all
to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

insert into public.admin_field_permissions(account_role, table_name, field_name, owner_can_edit, admin_can_edit, locked_after_verification, requires_approval, public_visibility)
values
  ('all', 'profiles', 'full_name', true, true, false, false, 'public'),
  ('all', 'profiles', 'username', true, true, false, false, 'public'),
  ('all', 'profiles', 'bio', true, true, false, false, 'public'),
  ('all', 'profiles', 'avatar_url', true, true, false, false, 'public'),
  ('all', 'profiles', 'account_role', false, true, true, true, 'admin_only'),
  ('all', 'profiles', 'account_type', false, true, true, true, 'admin_only'),
  ('all', 'profiles', 'account_category', false, true, true, true, 'admin_only'),
  ('player', 'player_profiles', 'position', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'team', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'height', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'weight', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'school_grade', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'preferred_foot', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'jersey_number', true, true, false, false, 'public'),
  ('player', 'player_profiles', 'player_gender', false, true, true, true, 'admin_only'),
  ('referee', 'profiles', 'referee_certification_level', true, true, false, false, 'public'),
  ('referee', 'profiles', 'referee_license_number', true, true, false, false, 'private'),
  ('referee', 'profiles', 'referee_certifying_organization', true, true, false, false, 'public'),
  ('referee', 'profiles', 'referee_years_experience', true, true, false, false, 'public'),
  ('referee', 'profiles', 'referee_profile_public', true, true, false, false, 'public'),
  ('staff', 'profiles', 'coaching_role_type', true, true, false, false, 'public'),
  ('staff', 'profiles', 'coaching_licenses', true, true, false, false, 'public'),
  ('staff', 'profiles', 'past_coaching_experience', true, true, false, false, 'public'),
  ('staff', 'profiles', 'teams_currently_coaching', true, true, false, false, 'public'),
  ('staff', 'profiles', 'coaching_accolades', true, true, false, false, 'public'),
  ('scout', 'profiles', 'scout_role_title', true, true, false, false, 'public'),
  ('scout', 'profiles', 'scout_organization', true, true, false, false, 'public'),
  ('scout', 'profiles', 'scouting_experience', true, true, false, false, 'public'),
  ('scout', 'profiles', 'scouting_regions', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'club_name', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'logo_url', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'city', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'country', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'contact_email', true, true, false, false, 'public'),
  ('team', 'team_profiles', 'contact_phone', true, true, false, false, 'public'),
  ('parent', 'parent_profiles', 'full_name', true, true, false, false, 'public'),
  ('parent', 'parent_profiles', 'relationship_to_player', true, true, false, false, 'public'),
  ('parent', 'parent_profiles', 'contact_email', true, true, false, false, 'private'),
  ('parent', 'parent_profiles', 'contact_phone', true, true, false, false, 'private')
on conflict (account_role, table_name, field_name) do update
set owner_can_edit = excluded.owner_can_edit,
    admin_can_edit = excluded.admin_can_edit,
    locked_after_verification = excluded.locked_after_verification,
    requires_approval = excluded.requires_approval,
    public_visibility = excluded.public_visibility,
    updated_at = now();

create or replace function public.admin_repair_account_records(_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_role text;
  v_category text;
  v_result jsonb := '{}'::jsonb;
  v_staff_role public.account_type;
begin
  perform public.admin_assert_official();

  select to_jsonb(p) into v_profile
  from public.profiles p
  where p.user_id = _target_user_id
  limit 1;

  if v_profile is null then
    raise exception 'Account profile not found for %.', _target_user_id;
  end if;

  v_role := lower(coalesce(v_profile->>'account_role', v_profile->>'account_type', v_profile->>'role', ''));
  v_category := lower(coalesce(v_profile->>'account_category', ''));

  if v_role = 'player' or v_category = 'player' then
    perform public.admin_resolve_player_profile(_target_user_id);
    perform public.admin_resolve_legacy_player(_target_user_id);
    v_result := v_result || jsonb_build_object('player_repaired', true);
  end if;

  if v_role = 'parent' or v_category = 'parent' then
    insert into public.parent_profiles(user_id, full_name, relationship_to_player, contact_email, contact_phone)
    values (
      _target_user_id,
      coalesce(nullif(trim(v_profile->>'full_name'), ''), nullif(trim(v_profile->>'username'), ''), 'Parent / Guardian'),
      nullif(trim(coalesce(v_profile->>'relationship_to_player', '')), ''),
      nullif(trim(coalesce(v_profile->>'email', '')), ''),
      nullif(trim(coalesce(v_profile->>'contact_phone', v_profile->>'phone', '')), '')
    )
    on conflict (user_id) do update
      set full_name = coalesce(nullif(trim(public.parent_profiles.full_name), ''), excluded.full_name),
          updated_at = now();
    v_result := v_result || jsonb_build_object('parent_repaired', true);
  end if;

  if v_role in ('head_coach_assistant', 'coach', 'scout', 'trainer', 'academy_director', 'team_staff')
     or v_category = 'team_staff' then
    v_staff_role := case
      when v_role = 'scout' then 'scout'::public.account_type
      when v_role = 'trainer' then 'trainer'::public.account_type
      when v_role = 'academy_director' then 'academy_director'::public.account_type
      else 'coach'::public.account_type
    end;

    insert into public.staff_profiles(
      user_id,
      full_name,
      role,
      team_organization_name,
      country,
      city,
      contact_email,
      contact_phone,
      notable_achievements,
      profile_image_url
    )
    values (
      _target_user_id,
      coalesce(nullif(trim(v_profile->>'full_name'), ''), nullif(trim(v_profile->>'username'), ''), 'Staff Member'),
      v_staff_role,
      nullif(trim(coalesce(v_profile->>'teams_currently_coaching', v_profile->>'scout_organization', v_profile->>'team_name', v_profile->>'club_name', '')), ''),
      nullif(trim(coalesce(v_profile->>'country', '')), ''),
      nullif(trim(coalesce(v_profile->>'city', v_profile->>'coaching_location', '')), ''),
      nullif(trim(coalesce(v_profile->>'email', '')), ''),
      nullif(trim(coalesce(v_profile->>'contact_phone', v_profile->>'phone', '')), ''),
      nullif(trim(coalesce(v_profile->>'coaching_accolades', v_profile->>'scouting_accolades', '')), ''),
      nullif(trim(coalesce(v_profile->>'avatar_url', v_profile->>'profile_image_url', '')), '')
    )
    on conflict (user_id) do update
      set full_name = coalesce(nullif(trim(public.staff_profiles.full_name), ''), excluded.full_name),
          updated_at = now();
    v_result := v_result || jsonb_build_object('staff_repaired', true);
  end if;

  if v_role in ('team_club', 'school_team') or v_category = 'team' then
    insert into public.team_profiles(user_id, club_name, country, city, contact_email, contact_phone, logo_url)
    values (
      _target_user_id,
      coalesce(nullif(trim(v_profile->>'club_name'), ''), nullif(trim(v_profile->>'team_name'), ''), nullif(trim(v_profile->>'full_name'), ''), 'Team'),
      nullif(trim(coalesce(v_profile->>'country', '')), ''),
      nullif(trim(coalesce(v_profile->>'city', '')), ''),
      nullif(trim(coalesce(v_profile->>'email', '')), ''),
      nullif(trim(coalesce(v_profile->>'contact_phone', v_profile->>'phone', '')), ''),
      nullif(trim(coalesce(v_profile->>'avatar_url', v_profile->>'profile_image_url', '')), '')
    )
    on conflict (user_id) do update
      set club_name = coalesce(nullif(trim(public.team_profiles.club_name), ''), excluded.club_name),
          updated_at = now();
    v_result := v_result || jsonb_build_object('team_repaired', true);
  end if;

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

create or replace function public.admin_patch_match_record(
  _match_id uuid,
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
  v_applied jsonb := '{}'::jsonb;
  v_league_id uuid;
begin
  perform public.admin_assert_official(_reason);

  select to_jsonb(m), m.league_id into v_before, v_league_id
  from public.matches m
  where m.id = _match_id;

  if v_before is null then
    raise exception 'Match not found.';
  end if;

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'matches'
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.matches m set %1$I = r.%1$I from (select * from jsonb_populate_record(null::public.matches, $1)) r where m.id = $2',
      v_key
    ) using _changes, _match_id;
    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  update public.matches
  set updated_at = now()
  where id = _match_id
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'matches' and column_name = 'updated_at'
    );

  select to_jsonb(m), m.league_id into v_after, v_league_id
  from public.matches m
  where m.id = _match_id;

  begin
    perform public.sync_league_records_from_standings(v_league_id);
  exception when others then
    null;
  end;

  perform public.admin_write_audit(
    'fixture_updated',
    'matches',
    _match_id::text,
    null,
    _reason,
    v_before,
    v_after,
    v_applied
  );

  return v_after;
end;
$$;

create or replace function public.admin_assign_match_referee(
  _match_id uuid,
  _referee_user_id uuid,
  _referee_type text default 'main_referee',
  _show_name_publicly boolean default true,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.referee_match_claims;
  v_before jsonb;
  v_after jsonb;
begin
  perform public.admin_assert_official(_reason);

  select to_jsonb(m) into v_before from public.matches m where m.id = _match_id;
  if v_before is null then
    raise exception 'Match not found.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = _referee_user_id
      and lower(coalesce(p.account_role, p.account_type, p.role::text, '')) = 'referee'
  ) then
    raise exception 'The selected account is not a referee account.';
  end if;

  update public.matches
  set referee_user_id = _referee_user_id
  where id = _match_id;

  insert into public.referee_match_claims(
    match_id,
    referee_user_id,
    referee_type,
    show_name_publicly,
    status,
    reviewed_by,
    reviewed_at
  )
  values (
    _match_id,
    _referee_user_id,
    coalesce(nullif(trim(_referee_type), ''), 'main_referee'),
    coalesce(_show_name_publicly, true),
    'approved',
    auth.uid(),
    now()
  )
  on conflict (match_id, referee_user_id) do update
    set referee_type = excluded.referee_type,
        show_name_publicly = excluded.show_name_publicly,
        status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
  returning * into v_claim;

  select to_jsonb(m) into v_after from public.matches m where m.id = _match_id;

  perform public.admin_write_audit(
    'referee_assigned_to_fixture',
    'referee_match_claims',
    v_claim.id::text,
    _referee_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object('match_id', _match_id, 'referee_type', v_claim.referee_type)
  );

  return to_jsonb(v_claim);
end;
$$;

create or replace function public.admin_remove_match_referee(
  _match_id uuid,
  _referee_user_id uuid default null,
  _claim_id uuid default null,
  _reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted jsonb;
begin
  perform public.admin_assert_official(_reason);

  select jsonb_agg(to_jsonb(c)) into v_deleted
  from public.referee_match_claims c
  where c.match_id = _match_id
    and (_claim_id is null or c.id = _claim_id)
    and (_referee_user_id is null or c.referee_user_id = _referee_user_id);

  delete from public.referee_match_claims c
  where c.match_id = _match_id
    and (_claim_id is null or c.id = _claim_id)
    and (_referee_user_id is null or c.referee_user_id = _referee_user_id);

  update public.matches
  set referee_user_id = null
  where id = _match_id
    and (_referee_user_id is null or referee_user_id = _referee_user_id);

  perform public.admin_write_audit(
    'referee_removed_from_fixture',
    'referee_match_claims',
    coalesce(_claim_id::text, _match_id::text),
    _referee_user_id,
    _reason,
    v_deleted,
    null,
    jsonb_build_object('match_id', _match_id)
  );

  return true;
end;
$$;

revoke all on function public.admin_repair_account_records(uuid) from public;
revoke all on function public.admin_patch_match_record(uuid, jsonb, text) from public;
revoke all on function public.admin_assign_match_referee(uuid, uuid, text, boolean, text) from public;
revoke all on function public.admin_remove_match_referee(uuid, uuid, uuid, text) from public;

grant execute on function public.admin_repair_account_records(uuid) to authenticated;
grant execute on function public.admin_patch_match_record(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_assign_match_referee(uuid, uuid, text, boolean, text) to authenticated;
grant execute on function public.admin_remove_match_referee(uuid, uuid, uuid, text) to authenticated;
