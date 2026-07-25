-- =============================================================================
-- Atomic permanent account deletion for every Footy Status account type
-- =============================================================================
--
-- ROOT CAUSE OF coach_staff_memberships_team_subteam_user_key
-- ---------------------------------------------------------------------------
-- coach_staff_team_memberships.club_team_id was created ON DELETE SET NULL,
-- while coach_staff_memberships_team_subteam_user_key is:
--
--   UNIQUE NULLS NOT DISTINCT (team_id, club_team_id, coach_user_id)
--
-- A coach may correctly have one mother-team row (club_team_id IS NULL) and
-- one row per daughter team. Deleting a daughter team used to SET NULL on its
-- membership. That attempted to turn the daughter membership into another
-- mother-team membership and collided with the existing mother row. The same
-- unsafe FK behavior existed on coach/staff invites and join requests.
--
-- These are daughter-team-specific relationship rows. Removing a daughter
-- team must remove those rows, not silently promote them to the mother team.
-- Rebuild the relationship FKs as ON DELETE CASCADE. Player relationships use
-- the same semantics and are included so a deleted daughter team cannot leave
-- a player, invite, or request falsely linked to the mother team.
--
-- ACCOUNT DELETION
-- ---------------------------------------------------------------------------
-- Previous versions swallowed delete_account_app_data errors, continued to
-- delete auth.users, and then invoked the same cleanup a second time from the
-- auth.users trigger. That could report success after partial cleanup and made
-- trigger side effects difficult to reason about.
--
-- The replacement flow is one database transaction:
--   1. authorize and protect the Official account
--   2. snapshot the audit record
--   3. strictly remove application data and owned storage records
--   4. sweep remaining direct auth.users references
--   5. delete Auth identities and auth.users
--   6. verify that exactly one Auth user was removed
--
-- Any failure raises and rolls the entire transaction back. A transaction-local
-- deletion marker prevents the auth.users trigger from running the expensive
-- application cleanup twice; raw Auth-dashboard deletes still receive the full
-- cleanup.
-- =============================================================================

-- Daughter-team relationship rows cease to exist with their daughter team.
do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array[
    'coach_staff_team_memberships',
    'coach_staff_team_invites',
    'coach_staff_join_requests',
    'player_team_memberships',
    'team_player_invites',
    'team_join_requests'
  ]
  loop
    if to_regclass('public.' || quote_ident(v_table)) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_table
           and column_name = 'club_team_id'
       ) then
      continue;
    end if;

    -- Drop every single-column FK from this table's club_team_id to
    -- public.club_teams(id), regardless of its historical generated name.
    for v_constraint in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = con.conkey[1]
      where con.contype = 'f'
        and ns.nspname = 'public'
        and rel.relname = v_table
        and att.attname = 'club_team_id'
        and array_length(con.conkey, 1) = 1
        and con.confrelid = 'public.club_teams'::regclass
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        v_table,
        v_constraint
      );
    end loop;

    execute format(
      'alter table public.%I add constraint %I foreign key (club_team_id) references public.club_teams(id) on delete cascade',
      v_table,
      v_table || '_club_team_id_fkey'
    );
  end loop;
end $$;

-- Storage ownership/path cleanup is part of the transaction. Do not suppress a
-- permission or trigger failure and then claim that the account was deleted.
create or replace function public.delete_account_storage_objects(
  _target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if _target_user_id is null or to_regclass('storage.objects') is null then
    return;
  end if;

  delete from storage.objects
  where owner::text = _target_user_id::text
     or name like _target_user_id::text || '/%'
     or name like '%/' || _target_user_id::text || '/%'
     or name like '%/' || _target_user_id::text || '-%'
     or name like '%/' || _target_user_id::text || '_%';
end;
$$;

revoke all on function public.delete_account_storage_objects(uuid) from public, anon, authenticated;

-- The catalog sweep is an internal privileged primitive. Earlier migrations
-- accidentally exposed it to all authenticated users even though it accepts an
-- arbitrary user id.
revoke all on function public.footy_purge_direct_auth_user_refs(uuid)
  from public, anon, authenticated;

-- Replace the old cleanup body, which referenced nonexistent teams.user_id,
-- club_teams.owner_user_id, and club_teams.team_profile_id columns. Those
-- statements were parsed only when the function ran, so every purge could fail
-- before reaching the relationship cleanup and the previous exception handlers
-- silently converted that failure into partial success.
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

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_player_profile_ids
  from public.player_profiles
  where user_id = _target_user_id;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_legacy_player_ids
  from public.players
  where user_id = _target_user_id;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_parent_profile_ids
  from public.parent_profiles
  where user_id = _target_user_id;

  select
    coalesce(array_agg(id), '{}'::uuid[]),
    coalesce(array_agg(team_id) filter (where team_id is not null), '{}'::uuid[]),
    coalesce(array_agg(club_id) filter (where club_id is not null), '{}'::uuid[])
  into v_team_profile_ids, v_team_ids, v_club_ids
  from public.team_profiles
  where user_id = _target_user_id;

  -- teams has owner_user_id; it deliberately has no parallel user_id column.
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_team_ids
  from (
    select unnest(v_team_ids) as id
    union
    select id
    from public.teams
    where owner_user_id = _target_user_id
  ) owned_teams
  where id is not null;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_club_ids
  from (
    select unnest(v_club_ids) as id
    union
    select id
    from public.clubs
    where owner_user_id = _target_user_id
  ) owned_clubs
  where id is not null;

  -- club_teams is owned through club_id/team_id. It deliberately has no
  -- owner_user_id or team_profile_id columns.
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_club_team_ids
  from public.club_teams
  where club_id = any(v_club_ids)
     or team_id = any(v_team_ids);

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_clip_ids
  from public.clips
  where user_id = _target_user_id
     or player_id = any(v_player_profile_ids)
     or player_id = any(v_legacy_player_ids);

  -- Owned clip relationships/content first.
  perform public.delete_account_rows_if_column_matches_any('clip_likes', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_comments', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_views', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_feed_impressions', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_shares', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_exposure_state', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_engagement_exposure_awards', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('content_reports', 'reported_clip_id', v_clip_ids);

  -- User interactions, preferences, notifications, likes/comments, and cache-
  -- like rows that can otherwise keep the account visible.
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
  perform public.delete_account_rows_if_column_exists('clip_likes', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clip_comments', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clip_views', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clip_feed_impressions', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clip_shares', 'user_id', _target_user_id);

  -- Parent/child links and requests.
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'parent_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'requested_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'approved_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'removed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'parent_profile_id', v_parent_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'player_profile_id', v_player_profile_ids);

  -- Player/team links, invites, and requests. Team-owned rows are removed only
  -- for teams belonging to the deleted team account.
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

  -- Coach/staff links, invites, and requests. These are deleted, never
  -- reinserted/upserted, during account deletion.
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

  -- Referee, match, report, and submission participation.
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

  -- Team/club-authored content.
  perform public.delete_account_rows_if_column_exists('club_news_posts', 'author_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'club_id', v_club_ids);

  -- Moderation relationships about the deleted target are removed; references
  -- to the deleted account as a reviewer/admin are detached when nullable.
  perform public.delete_account_rows_if_column_exists('content_reports', 'reporter_account_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('content_reports', 'reported_account_id', _target_user_id);
  perform public.null_account_column_if_exists('content_reports', 'reviewed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('content_report_actions', 'target_account_id', _target_user_id);
  perform public.null_account_column_if_exists('content_report_actions', 'admin_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('account_strikes', 'account_id', _target_user_id);
  perform public.null_account_column_if_exists('account_strikes', 'admin_user_id', _target_user_id);
  perform public.null_account_column_if_exists('account_strikes', 'removed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('temporary_bans', 'account_id', _target_user_id);
  perform public.null_account_column_if_exists('temporary_bans', 'admin_user_id', _target_user_id);
  perform public.null_account_column_if_exists('account_email_bans', 'account_id', _target_user_id);
  perform public.null_account_column_if_exists('account_email_bans', 'admin_user_id', _target_user_id);

  -- Owned clips and player statistics/history.
  perform public.delete_account_rows_if_column_matches_any('clips', 'id', v_clip_ids);
  perform public.delete_account_rows_if_column_exists('clips', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('clips', 'player_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('clips', 'player_id', v_legacy_player_ids);
  perform public.delete_account_rows_if_column_matches_any('current_player_statistics', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('player_statistics', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('player_statistics', 'player_id', v_legacy_player_ids);
  perform public.delete_account_rows_if_column_matches_any('club_history', 'player_profile_id', v_player_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('club_history', 'player_id', v_legacy_player_ids);
  perform public.delete_account_rows_if_column_matches_any('player_match_minutes', 'player_profile_id', v_player_profile_ids);

  -- Owned team structures. Relationship rows above are already gone; CASCADE
  -- FKs provide the final team-specific cleanup without touching coaches or
  -- players themselves.
  perform public.delete_account_rows_if_column_matches_any('club_teams', 'id', v_club_team_ids);
  perform public.delete_account_rows_if_column_matches_any('clubs', 'id', v_club_ids);
  perform public.delete_account_rows_if_column_matches_any('teams', 'id', v_team_ids);
  perform public.delete_account_rows_if_column_exists('clubs', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'owner_user_id', _target_user_id);

  -- Core account/profile rows last so Explore/search cannot retain the account.
  perform public.delete_account_rows_if_column_exists('players', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('player_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('staff_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_profiles', 'user_id', _target_user_id);
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

revoke all on function public.delete_account_app_data(uuid, uuid, text)
  from public, anon, authenticated;

-- Raw auth.users deletion (Dashboard/service role) still performs the complete
-- purge. App-facing RPCs set the transaction-local marker after doing the purge
-- themselves, so the trigger only performs the final direct-reference sweep.
create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_explicit_target text :=
    current_setting('footy_status.deleting_user_id', true);
begin
  if v_explicit_target is distinct from old.id::text then
    perform public.delete_account_app_data(
      old.id,
      null,
      'auth_user_deleted_cleanup'
    );
  end if;

  perform public.footy_purge_direct_auth_user_refs(old.id);
  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete
  on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer := 0;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  perform public.assert_user_can_be_deleted(v_user_id);
  perform set_config(
    'footy_status.deleting_user_id',
    v_user_id::text,
    true
  );

  -- Strict: any cleanup failure aborts and rolls back the whole RPC.
  perform public.delete_account_app_data(
    v_user_id,
    v_user_id,
    'self_delete_account'
  );
  perform public.footy_purge_direct_auth_user_refs(v_user_id);

  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
  get diagnostics v_deleted = row_count;

  if v_deleted <> 1 then
    raise exception 'Account deletion failed: Auth user was not removed.';
  end if;

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
  v_deleted integer := 0;
begin
  perform public.admin_assert_official(_reason);

  if _target_user_id is null then
    raise exception 'Target account is required.';
  end if;

  if nullif(trim(coalesce(_reason, '')), '') is null then
    raise exception 'Enter an admin note before deleting an account.';
  end if;

  perform public.assert_user_can_be_deleted(_target_user_id);

  if not exists (
    select 1 from auth.users where id = _target_user_id
  ) then
    raise exception 'Account deletion failed: Auth user was not found.';
  end if;

  select jsonb_build_object(
    'profile', (
      select to_jsonb(p)
      from public.profiles p
      where p.user_id = _target_user_id
      limit 1
    ),
    'player_profile', (
      select to_jsonb(p)
      from public.player_profiles p
      where p.user_id = _target_user_id
      limit 1
    ),
    'staff_profile', (
      select to_jsonb(p)
      from public.staff_profiles p
      where p.user_id = _target_user_id
      limit 1
    ),
    'parent_profile', (
      select to_jsonb(p)
      from public.parent_profiles p
      where p.user_id = _target_user_id
      limit 1
    ),
    'team_profile', (
      select to_jsonb(p)
      from public.team_profiles p
      where p.user_id = _target_user_id
      limit 1
    )
  )
  into v_before;

  -- The audit write is in the same transaction and rolls back if any cleanup
  -- or Auth deletion step fails.
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

  perform set_config(
    'footy_status.deleting_user_id',
    _target_user_id::text,
    true
  );

  -- Strict: never downgrade a cleanup exception to "partial success."
  v_result := public.delete_account_app_data(
    _target_user_id,
    v_admin_user_id,
    _reason
  );
  perform public.footy_purge_direct_auth_user_refs(_target_user_id);

  delete from auth.identities where user_id = _target_user_id;
  delete from auth.users where id = _target_user_id;
  get diagnostics v_deleted = row_count;

  if v_deleted <> 1 then
    raise exception 'Account deletion failed: Auth user was not removed.';
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'success', true,
    'target_user_id', _target_user_id,
    'auth_user_deleted', true,
    'cleanup_atomic', true
  );
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

notify pgrst, 'reload schema';
