-- =============================================================================
-- Footy Status Official Admin: full invite reach + clear-profile-picture control
-- =============================================================================
-- 1. The official admin can invite any eligible player to any team (mother OR
--    daughter, club OR school) — bypassing the normal owner / club-management
--    checks WITHOUT weakening them for regular accounts.
-- 2. admin_clear_profile_picture(): admin-only reset of an account's avatar back
--    to the default, across every image column, with an audit record.
--
-- Admin identity is the trusted server-side check public.is_footy_status_global_admin()
-- (verified auth.users email), never a client boolean or display field.
-- Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Mother-team invite — admin bypasses the manage/approved checks.
-- ---------------------------------------------------------------------------
create or replace function public.create_team_player_invite(_team_id uuid, _player_profile_id uuid)
returns public.team_player_invites
language plpgsql
security definer
set search_path = public
as $create_team_player_invite$
declare
  team_row public.teams;
  player_row public.player_profiles;
  invite_row public.team_player_invites;
  is_admin boolean := public.is_footy_status_global_admin();
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not is_admin then
    if not public.user_manages_team(_team_id, auth.uid()) or not public.team_is_approved(_team_id) then
      raise exception 'Only approved team accounts can invite players.';
    end if;
  end if;

  select * into team_row from public.teams where id = _team_id;
  select * into player_row from public.player_profiles where id = _player_profile_id;

  if player_row.id is null then
    raise exception 'Player not found.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = player_row.user_id
      and team_id = _team_id
      and club_team_id is null
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already on this team.';
  end if;

  if exists (
    select 1
    from public.team_player_invites
    where team_id = _team_id
      and player_user_id = player_row.user_id
      and club_team_id is null
      and status = 'pending'
  ) then
    raise exception 'This player already has a pending invite from this team.';
  end if;

  insert into public.team_player_invites (
    team_id, player_profile_id, player_user_id, league_id, age_group,
    organization_id, invited_by, status
  )
  values (
    _team_id, _player_profile_id, player_row.user_id, team_row.league_id,
    team_row.age_group, team_row.organization_id, auth.uid(), 'pending'
  )
  returning * into invite_row;

  return invite_row;
end;
$create_team_player_invite$;

-- ---------------------------------------------------------------------------
-- 1b. Daughter/club-team invite — admin bypasses parent-club ownership checks.
-- ---------------------------------------------------------------------------
create or replace function public.create_team_player_invite_for_club_team(
  _team_id uuid,
  _club_team_id uuid,
  _player_profile_id uuid
)
returns public.team_player_invites
language plpgsql
security definer
set search_path = public
as $create_team_player_invite_for_club_team$
declare
  team_row public.teams;
  player_row public.player_profiles;
  club_team_row public.club_teams;
  invite_row public.team_player_invites;
  is_admin boolean := public.is_footy_status_global_admin();
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not is_admin then
    if not public.team_is_approved(_team_id) then
      raise exception 'Only approved team accounts can invite players.';
    end if;

    if not public.user_manages_team(_team_id, auth.uid()) and not public.can_manage_club_team(_club_team_id, auth.uid()) then
      raise exception 'Only the parent club account can invite players to this daughter team.';
    end if;
  end if;

  select * into team_row from public.teams where id = _team_id;
  select * into player_row from public.player_profiles where id = _player_profile_id;

  -- Admins may target any active club/daughter team; regular managers are still
  -- constrained by the ownership check above.
  select * into club_team_row
  from public.club_teams
  where id = _club_team_id
    and (
      is_admin
      or team_id = _team_id
      or club_id in (select id from public.clubs where primary_team_id = _team_id)
    )
    and status = 'active';

  if player_row.id is null then
    raise exception 'Player not found.';
  end if;

  if club_team_row.id is null then
    raise exception 'That club team could not be found.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = player_row.user_id
      and club_team_id = _club_team_id
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already on this team.';
  end if;

  if exists (
    select 1
    from public.team_player_invites
    where club_team_id = _club_team_id
      and player_user_id = player_row.user_id
      and status = 'pending'
  ) then
    raise exception 'This player already has a pending invite from this team.';
  end if;

  insert into public.team_player_invites (
    team_id, club_id, club_team_id, player_profile_id, player_user_id,
    league_id, age_group, organization_id, invited_by, status
  )
  values (
    coalesce(_team_id, club_team_row.team_id),
    club_team_row.club_id,
    club_team_row.id,
    _player_profile_id,
    player_row.user_id,
    coalesce(club_team_row.league_id, team_row.league_id),
    coalesce(club_team_row.age_group, team_row.age_group),
    team_row.organization_id,
    auth.uid(),
    'pending'
  )
  returning * into invite_row;

  return invite_row;
end;
$create_team_player_invite_for_club_team$;

grant execute on function public.create_team_player_invite(uuid, uuid) to authenticated;
grant execute on function public.create_team_player_invite_for_club_team(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Clear profile picture (admin only) — resets avatar to the default.
-- ---------------------------------------------------------------------------

-- Helper: null a per-account image column only if that table/column exists.
create or replace function public.clear_image_col_if_exists(
  _table_name text,
  _column_name text,
  _user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = _table_name and column_name = _column_name
  ) then
    execute format('update public.%I set %I = null where user_id = $1', _table_name, _column_name)
    using _user_id;
  end if;
end;
$$;

revoke all on function public.clear_image_col_if_exists(text, text, uuid) from public, anon, authenticated;

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
  if _target_user_id is null then
    raise exception 'No target account was provided.';
  end if;

  select avatar_url, coalesce(account_role, account_category, role::text)
    into v_prev_avatar, v_account_type
  from public.profiles
  where user_id = _target_user_id;

  -- Null every image column that exists for this account so the default avatar
  -- shows everywhere (profile, Explore, rosters, comments, Next Up, etc.).
  update public.profiles set avatar_url = null, updated_at = now() where user_id = _target_user_id;
  perform public.clear_image_col_if_exists('players', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('player_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('staff_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('parent_profiles', 'profile_image_url', _target_user_id);
  perform public.clear_image_col_if_exists('team_profiles', 'logo_url', _target_user_id);

  -- Best-effort storage cleanup: only if the old file lives in our storage and
  -- is no longer referenced by any account after the clear above.
  if v_prev_avatar is not null and position('/storage/v1/object/' in v_prev_avatar) > 0 then
    begin
      v_bucket := split_part(split_part(v_prev_avatar, '/storage/v1/object/', 2), '/', 2); -- public/<bucket>/...
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
      null; -- storage cleanup is best-effort; never block the reset
    end;
  end if;

  -- Audit trail (no reason required for this action).
  insert into public.admin_audit_log (
    admin_user_id, action, affected_table, affected_id, payload,
    target_account_id, reason, before_data, after_data
  ) values (
    auth.uid(), 'profile_picture_cleared', 'profiles', _target_user_id::text,
    jsonb_build_object('target_account_type', v_account_type),
    _target_user_id, null,
    jsonb_build_object('previous_avatar_url', v_prev_avatar, 'target_account_type', v_account_type),
    jsonb_build_object('avatar_url', null)
  );

  return jsonb_build_object('ok', true, 'previous_avatar_url', v_prev_avatar);
end;
$$;

revoke all on function public.admin_clear_profile_picture(uuid) from public, anon;
grant execute on function public.admin_clear_profile_picture(uuid) to authenticated;
