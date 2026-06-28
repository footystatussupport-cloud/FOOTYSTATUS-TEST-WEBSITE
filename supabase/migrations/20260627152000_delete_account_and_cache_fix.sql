-- Delete Account support.
-- This RPC is called by the Settings page after the user confirms deletion.
-- It removes app-owned data first, then deletes the authenticated Supabase auth account.

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

revoke all on function public.delete_account_rows_if_column_exists(text, text, uuid) from public;
grant execute on function public.delete_my_account() to authenticated;
