-- Complete account deletion for every account type.
-- Centralizes self-delete, Footy Status Official admin delete, and manual
-- auth.users deletion cleanup into one backend process.

create or replace function public.delete_account_rows_if_column_exists(
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
  if to_regclass('public.' || quote_ident(_table_name)) is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = _table_name
      and c.relkind in ('r', 'p')
  ) then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = _column_name
  ) then
    execute format('delete from public.%I where %I = $1', _table_name, _column_name)
    using _user_id;
  end if;
end;
$$;

create or replace function public.delete_account_rows_if_column_matches_any(
  _table_name text,
  _column_name text,
  _ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(_ids, 1), 0) = 0 then
    return;
  end if;

  if to_regclass('public.' || quote_ident(_table_name)) is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = _table_name
      and c.relkind in ('r', 'p')
  ) then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = _column_name
  ) then
    execute format('delete from public.%I where %I = any($1)', _table_name, _column_name)
    using _ids;
  end if;
end;
$$;

create or replace function public.null_account_column_if_exists(
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
  if to_regclass('public.' || quote_ident(_table_name)) is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = _table_name
      and c.relkind in ('r', 'p')
  ) then
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = _column_name
      and is_nullable = 'YES'
  ) then
    execute format('update public.%I set %I = null where %I = $1', _table_name, _column_name, _column_name)
    using _user_id;
  end if;
end;
$$;

create or replace function public.delete_account_storage_objects(_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from storage.objects
    where owner::text = _target_user_id::text
       or name like _target_user_id::text || '/%'
       or name like '%/' || _target_user_id::text || '/%'
       or name like '%/' || _target_user_id::text || '-%'
       or name like '%/' || _target_user_id::text || '_%';
  exception
    when undefined_table or insufficient_privilege then
      null;
  end;
end;
$$;

create or replace function public.delete_account_app_data(
  _target_user_id uuid,
  _deleted_by_user_id uuid default null,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_profile_ids uuid[] := '{}'::uuid[];
  v_legacy_player_ids uuid[] := '{}'::uuid[];
  v_clip_ids uuid[] := '{}'::uuid[];
  v_parent_profile_ids uuid[] := '{}'::uuid[];
  v_team_profile_ids uuid[] := '{}'::uuid[];
  v_team_ids uuid[] := '{}'::uuid[];
  v_club_ids uuid[] := '{}'::uuid[];
  v_club_team_ids uuid[] := '{}'::uuid[];
begin
  if _target_user_id is null then
    raise exception 'Target account is required.';
  end if;

  perform public.assert_user_can_be_deleted(_target_user_id);

  if to_regclass('public.player_profiles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_player_profile_ids
    from public.player_profiles
    where user_id = _target_user_id;
  end if;

  if to_regclass('public.players') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_legacy_player_ids
    from public.players
    where user_id = _target_user_id;
  end if;

  if to_regclass('public.parent_profiles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_parent_profile_ids
    from public.parent_profiles
    where user_id = _target_user_id;
  end if;

  if to_regclass('public.team_profiles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_team_profile_ids
    from public.team_profiles
    where user_id = _target_user_id;

    select coalesce(array_agg(team_id), '{}'::uuid[])
      into v_team_ids
    from public.team_profiles
    where user_id = _target_user_id
      and team_id is not null;

    select coalesce(array_agg(club_id), '{}'::uuid[])
      into v_club_ids
    from public.team_profiles
    where user_id = _target_user_id
      and club_id is not null;
  end if;

  if to_regclass('public.teams') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_team_ids
    from (
      select unnest(v_team_ids) as id
      union
      select id from public.teams where owner_user_id = _target_user_id
      union
      select id from public.teams where user_id = _target_user_id
    ) ids
    where id is not null;
  end if;

  if to_regclass('public.clubs') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_club_ids
    from (
      select unnest(v_club_ids) as id
      union
      select id from public.clubs where owner_user_id = _target_user_id
    ) ids
    where id is not null;
  end if;

  if to_regclass('public.club_teams') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_club_team_ids
    from public.club_teams
    where owner_user_id = _target_user_id
       or team_profile_id = any(v_team_profile_ids)
       or club_id = any(v_club_ids)
       or team_id = any(v_team_ids);
  end if;

  if to_regclass('public.clips') is not null then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_clip_ids
    from public.clips
    where user_id = _target_user_id
       or player_id = any(v_player_profile_ids)
       or player_id = any(v_legacy_player_ids);
  end if;

  -- Remove clip/feed/report data before clips disappear.
  perform public.delete_account_rows_if_column_matches_any('clip_likes', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_comments', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_views', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_feed_impressions', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_shares', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_exposure_state', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_engagement_exposure_awards', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('content_reports', 'reported_clip_id', v_clip_ids);

  -- Delete interactions, notifications, settings, contacts, cache/search-like rows.
  perform public.delete_account_rows_if_column_exists('user_contacts', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('user_settings', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('blocked_users', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('blocked_users', 'blocked_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('profile_views', 'viewer_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('profile_views', 'profile_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('profile_views', 'viewed_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('notifications', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('notifications', 'actor_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('notifications', 'secondary_user_id', _target_user_id);

  -- Parent/child links and requests.
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'parent_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'requested_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'approved_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'removed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'parent_profile_id', v_parent_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'player_profile_id', v_player_profile_ids);

  -- Player/team links, invites, and requests.
  perform public.delete_account_rows_if_column_exists('player_team_memberships', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('player_team_memberships', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('player_team_memberships', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('player_team_memberships', 'club_team_id', v_club_team_ids);
  perform public.delete_account_rows_if_column_exists('team_player_invites', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_player_invites', 'invited_by', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('team_player_invites', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('team_player_invites', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('team_player_invites', 'club_team_id', v_club_team_ids);
  perform public.delete_account_rows_if_column_exists('team_join_requests', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_join_requests', 'reviewed_by', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('team_join_requests', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('team_join_requests', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('team_join_requests', 'club_team_id', v_club_team_ids);

  -- Coach/staff links, invites, and requests.
  perform public.delete_account_rows_if_column_exists('coach_staff_team_memberships', 'coach_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_team_memberships', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_team_memberships', 'club_team_id', v_club_team_ids);
  perform public.delete_account_rows_if_column_exists('coach_staff_team_invites', 'coach_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_team_invites', 'invited_by', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_team_invites', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_team_invites', 'club_team_id', v_club_team_ids);
  perform public.delete_account_rows_if_column_exists('coach_staff_join_requests', 'coach_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('coach_staff_join_requests', 'reviewed_by', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_join_requests', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('coach_staff_join_requests', 'club_team_id', v_club_team_ids);

  -- Referee/match/report participation. Team/match rows are not deleted unless
  -- owned by the deleted account; user references are removed or nulled.
  perform public.delete_account_rows_if_column_exists('referee_match_claims', 'referee_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('referee_report_uploads', 'uploaded_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('match_comments', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('assist_claims', 'claimant_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('assist_claims', 'claimant_player_profile_id', v_player_profile_ids);
  perform public.null_account_column_if_exists('assist_claims', 'reviewed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('match_events', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('match_events', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('match_events', 'team_id', v_team_ids);
  perform public.null_account_column_if_exists('match_events', 'created_by_user_id', _target_user_id);
  perform public.null_account_column_if_exists('matches', 'referee_user_id', _target_user_id);
  perform public.null_account_column_if_exists('matches', 'created_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('match_film_links', 'submitted_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('match_film_links', 'user_id', _target_user_id);

  -- Club/team posts and media owned by this account/team.
  perform public.delete_account_rows_if_column_exists('club_news_posts', 'author_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'club_id', v_club_ids);

  -- Moderation rows connected to the deleted account.
  perform public.delete_account_rows_if_column_exists('content_reports', 'reporter_account_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('content_reports', 'reported_account_id', _target_user_id);
  perform public.null_account_column_if_exists('content_reports', 'reviewed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('content_report_actions', 'target_account_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('content_report_actions', 'admin_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'account_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'admin_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'removed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('temporary_bans', 'account_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('temporary_bans', 'admin_user_id', _target_user_id);
  perform public.null_account_column_if_exists('account_email_bans', 'account_id', _target_user_id);
  perform public.null_account_column_if_exists('account_email_bans', 'admin_user_id', _target_user_id);

  -- Clip rows themselves.
  perform public.delete_account_rows_if_column_matches_any('clips', 'id', v_clip_ids);
  perform public.delete_account_rows_if_column_exists('clips', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('clips', 'player_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('clips', 'player_id', v_legacy_player_ids);

  -- Player statistics, history, and linked records.
  perform public.delete_account_rows_if_column_matches_any('current_player_statistics', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('player_statistics', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('player_statistics', 'player_id', v_legacy_player_ids);
  perform public.delete_account_rows_if_column_matches_any('club_history', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('club_history', 'player_id', v_legacy_player_ids);
  perform public.delete_account_rows_if_column_matches_any('player_match_minutes', 'player_profile_id', v_player_profile_ids);

  -- Delete owned daughter/mother team structures last so FK cascades can help.
  perform public.delete_account_rows_if_column_matches_any('club_teams', 'id', v_club_team_ids);
  perform public.delete_account_rows_if_column_matches_any('clubs', 'id', v_club_ids);
  perform public.delete_account_rows_if_column_matches_any('teams', 'id', v_team_ids);
  perform public.delete_account_rows_if_column_exists('club_teams', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clubs', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'user_id', _target_user_id);

  -- Core account/profile rows. Removing profiles releases username/search.
  perform public.delete_account_rows_if_column_exists('players', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('player_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('staff_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_staff', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('user_roles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('global_admin_users', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('profiles', 'user_id', _target_user_id);

  perform public.delete_account_storage_objects(_target_user_id);

  return jsonb_build_object(
    'success', true,
    'target_user_id', _target_user_id,
    'deleted_by_user_id', _deleted_by_user_id,
    'player_profiles_removed', coalesce(array_length(v_player_profile_ids, 1), 0),
    'clips_removed', coalesce(array_length(v_clip_ids, 1), 0),
    'teams_removed', coalesce(array_length(v_team_ids, 1), 0),
    'club_teams_removed', coalesce(array_length(v_club_team_ids, 1), 0)
  );
end;
$$;

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

  perform public.assert_user_can_be_deleted(v_user_id);
  perform public.delete_account_app_data(v_user_id, v_user_id, 'self_delete_account');

  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  return true;
end;
$$;

create or replace function public.admin_delete_account(
  _target_user_id uuid,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid := auth.uid();
  v_before jsonb;
  v_result jsonb;
begin
  perform public.admin_assert_official(_reason);

  if _target_user_id is null then
    raise exception 'Target account is required.';
  end if;

  if nullif(trim(coalesce(_reason, '')), '') is null then
    raise exception 'Enter an admin note before deleting an account.';
  end if;

  perform public.assert_user_can_be_deleted(_target_user_id);

  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = _target_user_id limit 1),
    'player_profile', (select to_jsonb(p) from public.player_profiles p where p.user_id = _target_user_id limit 1),
    'staff_profile', (select to_jsonb(p) from public.staff_profiles p where p.user_id = _target_user_id limit 1),
    'parent_profile', (select to_jsonb(p) from public.parent_profiles p where p.user_id = _target_user_id limit 1),
    'team_profile', (select to_jsonb(p) from public.team_profiles p where p.user_id = _target_user_id limit 1)
  ) into v_before;

  perform public.admin_write_audit(
    'account_permanently_deleted',
    'auth.users',
    _target_user_id::text,
    _target_user_id,
    _reason,
    v_before,
    null,
    jsonb_build_object('admin_user_id', v_admin_user_id)
  );

  v_result := public.delete_account_app_data(_target_user_id, v_admin_user_id, _reason);

  delete from auth.identities where user_id = _target_user_id;
  delete from auth.users where id = _target_user_id;

  return v_result || jsonb_build_object('auth_user_deleted', true);
end;
$$;

create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.delete_account_app_data(old.id, null, 'auth_user_deleted_cleanup');
  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

revoke all on function public.delete_account_rows_if_column_exists(text, text, uuid) from public;
revoke all on function public.delete_account_rows_if_column_matches_any(text, text, uuid[]) from public;
revoke all on function public.null_account_column_if_exists(text, text, uuid) from public;
revoke all on function public.delete_account_storage_objects(uuid) from public;
revoke all on function public.delete_account_app_data(uuid, uuid, text) from public;
revoke all on function public.cleanup_app_data_after_auth_user_delete() from public;
revoke all on function public.admin_delete_account(uuid, text) from public;
revoke all on function public.delete_my_account() from public;

grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;
