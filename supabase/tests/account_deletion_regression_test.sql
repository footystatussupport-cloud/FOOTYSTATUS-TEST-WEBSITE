-- =============================================================================
-- TEST: Atomic Footy Status Admin permanent account deletion
-- =============================================================================
-- Run in Supabase SQL Editor after
-- 20260724180000_fix_atomic_admin_account_deletion.sql.
--
-- All fixtures and deletion calls run inside one transaction that is rolled
-- back. The real Official Admin account is used only as the authenticated
-- caller; it is never modified.
-- =============================================================================
begin;

-- Test clips are inserted directly as already-approved fixtures.
alter table public.clips disable trigger enforce_clip_review_workflow_trigger;
alter table public.clips disable trigger validate_next_up_clip_upload_limits_trigger;

do $$
declare
  v_admin uuid;
  v_team_owner uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_other_coach uuid := gen_random_uuid();
  v_player uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_child uuid := gen_random_uuid();
  v_scout uuid := gen_random_uuid();
  v_referee uuid := gen_random_uuid();

  v_team_profile uuid;
  v_player_profile uuid;
  v_child_player_profile uuid;
  v_parent_profile uuid;
  v_team_one uuid;
  v_team_two uuid;
  v_club uuid;
  v_daughter_one uuid;
  v_daughter_two uuid;
  v_clip uuid;
  v_keep_clip uuid;
  v_result jsonb;
  v_count integer;
  v_fk_delete_type "char";
begin
  select id
  into v_admin
  from auth.users
  where lower(coalesce(email, '')) = 'footystatussupport@gmail.com'
  limit 1;

  if v_admin is null then
    raise exception 'TEST SETUP FAILED: Footy Status Official Admin Auth user not found';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_admin,
      'email', 'footystatussupport@gmail.com'
    )::text,
    true
  );

  insert into auth.users (id, email, created_at)
  values
    (v_team_owner, 'delete-team-' || v_team_owner || '@example.test', now()),
    (v_coach, 'delete-coach-' || v_coach || '@example.test', now()),
    (v_staff, 'delete-staff-' || v_staff || '@example.test', now()),
    (v_other_coach, 'keep-coach-' || v_other_coach || '@example.test', now()),
    (v_player, 'delete-player-' || v_player || '@example.test', now()),
    (v_other_user, 'keep-user-' || v_other_user || '@example.test', now()),
    (v_parent, 'delete-parent-' || v_parent || '@example.test', now()),
    (v_child, 'keep-child-' || v_child || '@example.test', now()),
    (v_scout, 'delete-scout-' || v_scout || '@example.test', now()),
    (v_referee, 'delete-referee-' || v_referee || '@example.test', now());

  update public.profiles
  set account_role = case
        when user_id = v_team_owner then 'team_club'
        when user_id in (v_coach, v_other_coach) then 'coach'
        when user_id = v_staff then 'team_staff'
        when user_id = v_parent then 'parent'
        when user_id = v_scout then 'scout'
        when user_id = v_referee then 'referee'
        else 'player'
      end,
      account_category = case
        when user_id = v_team_owner then 'team_club'
        when user_id in (v_coach, v_other_coach) then 'coach'
        when user_id = v_staff then 'team_staff'
        when user_id = v_parent then 'parent'
        when user_id = v_scout then 'scout'
        when user_id = v_referee then 'referee'
        else 'player'
      end,
      is_active = true,
      deleted_at = null
  where user_id in (
    v_team_owner, v_coach, v_staff, v_other_coach, v_player, v_other_user,
    v_parent, v_child, v_scout, v_referee
  );

  insert into public.teams (name, owner_user_id, approval_status)
  values
    ('Delete test owned team ' || v_team_owner, v_team_owner, 'approved'),
    ('Delete test unrelated team ' || v_other_user, v_other_user, 'approved');

  select id into v_team_one
  from public.teams
  where owner_user_id = v_team_owner
  order by created_at desc
  limit 1;

  select id into v_team_two
  from public.teams
  where owner_user_id = v_other_user
  order by created_at desc
  limit 1;

  insert into public.team_profiles (user_id, club_name, team_id)
  values (v_team_owner, 'Delete Test Club', v_team_one)
  returning id into v_team_profile;

  insert into public.clubs (
    owner_user_id,
    team_profile_id,
    primary_team_id,
    name
  )
  values (
    v_team_owner,
    v_team_profile,
    v_team_one,
    'Delete Test Club'
  )
  returning id into v_club;

  update public.team_profiles
  set club_id = v_club
  where id = v_team_profile;

  insert into public.club_teams (
    club_id,
    team_id,
    age_group,
    league_name,
    gender,
    status
  )
  values (
    v_club,
    v_team_one,
    'U15',
    'Deletion Test League',
    'boy',
    'active'
  )
  returning id into v_daughter_one;

  insert into public.club_teams (
    club_id,
    team_id,
    age_group,
    league_name,
    gender,
    status
  )
  values (
    v_club,
    v_team_one,
    'U16',
    'Deletion Test League',
    'boy',
    'active'
  )
  returning id into v_daughter_two;

  insert into public.coach_staff_team_memberships (
    team_id,
    club_team_id,
    coach_user_id,
    staff_role,
    status
  )
  values
    (v_team_one, null, v_coach, 'Head Coach', 'approved'),
    (v_team_one, v_daughter_one, v_coach, 'Head Coach', 'approved'),
    (v_team_one, v_daughter_two, v_coach, 'Head Coach', 'approved'),
    (v_team_one, v_daughter_one, v_staff, 'Team Staff', 'approved'),
    (v_team_one, v_daughter_one, v_other_coach, 'Assistant Coach', 'approved');

  -- ==========================================================================
  -- Existing error regression:
  -- Deleting a daughter team must CASCADE its exact membership. It must not SET
  -- club_team_id to NULL and collide with the existing mother-team row.
  -- ==========================================================================
  select con.confdeltype
  into v_fk_delete_type
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  join pg_attribute att
    on att.attrelid = con.conrelid
   and att.attnum = con.conkey[1]
  where con.contype = 'f'
    and ns.nspname = 'public'
    and rel.relname = 'coach_staff_team_memberships'
    and att.attname = 'club_team_id'
    and con.confrelid = 'public.club_teams'::regclass
  limit 1;

  if v_fk_delete_type is distinct from 'c' then
    raise exception 'TEST FAILED (existing error): membership club_team_id FK is not ON DELETE CASCADE';
  end if;

  delete from public.club_teams where id = v_daughter_two;

  select count(*) into v_count
  from public.coach_staff_team_memberships
  where coach_user_id = v_coach;

  if v_count <> 2 then
    raise exception 'TEST FAILED (existing error): expected mother + one daughter membership, got %', v_count;
  end if;

  -- ==========================================================================
  -- Test 1: coach linked to a mother and daughter team.
  -- ==========================================================================
  select public.admin_delete_account(v_coach, 'Regression test coach deletion')
  into v_result;

  if not coalesce((v_result->>'auth_user_deleted')::boolean, false)
     or not coalesce((v_result->>'cleanup_atomic')::boolean, false) then
    raise exception 'TEST FAILED (coach): RPC did not confirm atomic Auth deletion';
  end if;

  if exists (select 1 from auth.users where id = v_coach)
     or exists (select 1 from public.profiles where user_id = v_coach)
     or exists (
       select 1 from public.coach_staff_team_memberships
       where coach_user_id = v_coach
     ) then
    raise exception 'TEST FAILED (coach): coach/Auth/profile/memberships remain';
  end if;

  if not exists (select 1 from public.teams where id = v_team_one)
     or not exists (select 1 from auth.users where id = v_other_coach)
     or not exists (
       select 1 from public.coach_staff_team_memberships
       where coach_user_id = v_other_coach
     ) then
    raise exception 'TEST FAILED (coach): unrelated team or coach was deleted';
  end if;

  -- ==========================================================================
  -- Test 1b: Team Staff linked to a daughter team.
  -- ==========================================================================
  insert into public.staff_profiles (user_id, full_name, role)
  values (v_staff, 'Delete Test Team Staff', 'team_staff');

  perform public.admin_delete_account(v_staff, 'Regression test Team Staff deletion');

  if exists (select 1 from auth.users where id = v_staff)
     or exists (select 1 from public.profiles where user_id = v_staff)
     or exists (select 1 from public.staff_profiles where user_id = v_staff)
     or exists (
       select 1 from public.coach_staff_team_memberships
       where coach_user_id = v_staff
     ) then
    raise exception 'TEST FAILED (Team Staff): account/profile/membership remains';
  end if;

  if not exists (select 1 from public.teams where id = v_team_one) then
    raise exception 'TEST FAILED (Team Staff): linked team was deleted';
  end if;

  -- ==========================================================================
  -- Tests 2 and 3: player with clips and memberships on multiple teams.
  -- ==========================================================================
  insert into public.player_profiles (user_id, full_name, player_gender)
  values (v_player, 'Delete Test Player', 'boy')
  returning id into v_player_profile;

  insert into public.player_team_memberships (
    player_profile_id,
    player_user_id,
    team_id,
    status,
    joined_via,
    approved_at
  )
  values
    (v_player_profile, v_player, v_team_one, 'approved', 'admin_add', now()),
    (v_player_profile, v_player, v_team_two, 'approved', 'admin_add', now());

  insert into public.clips (
    user_id,
    title,
    video_url,
    visibility,
    review_status,
    reviewed_at
  )
  values (
    v_player,
    'Delete test clip',
    'https://cdn.example.test/delete-test.mp4',
    'public',
    'approved',
    now()
  )
  returning id into v_clip;

  insert into public.clips (
    user_id,
    title,
    video_url,
    visibility,
    review_status,
    reviewed_at
  )
  values (
    v_other_user,
    'Keep test clip',
    'https://cdn.example.test/keep-test.mp4',
    'public',
    'approved',
    now()
  )
  returning id into v_keep_clip;

  insert into public.clip_likes (clip_id, user_id)
  values
    (v_clip, v_other_user),
    (v_keep_clip, v_player);

  insert into public.clip_comments (clip_id, user_id, user_name, content)
  values
    (v_clip, v_other_user, 'Keep User', 'Delete with owned clip'),
    (v_keep_clip, v_player, 'Delete Player', 'Delete outgoing comment');

  insert into public.notifications (
    user_id,
    actor_user_id,
    type,
    title,
    body,
    metadata
  )
  values (
    v_player,
    v_other_user,
    'account_deletion_regression',
    'Delete test notification',
    'This notification must be removed with the player.',
    '{}'::jsonb
  );

  perform public.admin_delete_account(v_player, 'Regression test player deletion');

  if exists (select 1 from auth.users where id = v_player)
     or exists (select 1 from public.profiles where user_id = v_player)
     or exists (select 1 from public.player_profiles where user_id = v_player)
     or exists (select 1 from public.player_team_memberships where player_user_id = v_player)
     or exists (select 1 from public.clips where id = v_clip)
     or exists (select 1 from public.clip_likes where clip_id = v_clip)
     or exists (select 1 from public.clip_comments where clip_id = v_clip)
     or exists (select 1 from public.clip_likes where user_id = v_player)
     or exists (select 1 from public.clip_comments where user_id = v_player)
     or exists (select 1 from public.notifications where user_id = v_player) then
    raise exception 'TEST FAILED (player): owned profile/content/relationships remain';
  end if;

  if not exists (select 1 from public.teams where id in (v_team_one, v_team_two))
     or not exists (select 1 from auth.users where id = v_other_user)
     or not exists (select 1 from public.clips where id = v_keep_clip) then
    raise exception 'TEST FAILED (player): teams, unrelated account, or unrelated clip were deleted';
  end if;

  -- ==========================================================================
  -- Test 5: parent, scout, and referee profile/Auth removal.
  -- ==========================================================================
  insert into public.parent_profiles (user_id, full_name)
  values (v_parent, 'Delete Test Parent')
  returning id into v_parent_profile;

  insert into public.player_profiles (user_id, full_name, player_gender)
  values (v_child, 'Keep Test Child', 'girl')
  returning id into v_child_player_profile;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    approved_by_user_id,
    approved_at,
    relationship_to_player
  )
  values (
    v_parent_profile,
    v_child_player_profile,
    'approved',
    v_parent,
    v_admin,
    now(),
    'Parent / Guardian'
  );

  insert into public.staff_profiles (user_id, full_name, role)
  values (v_scout, 'Delete Test Scout', 'scout');

  perform public.admin_delete_account(v_parent, 'Regression test parent deletion');
  perform public.admin_delete_account(v_scout, 'Regression test scout deletion');
  perform public.admin_delete_account(v_referee, 'Regression test referee deletion');

  if exists (
    select 1
    from auth.users
    where id in (v_parent, v_scout, v_referee)
  ) or exists (
    select 1
    from public.profiles
    where user_id in (v_parent, v_scout, v_referee)
  ) or exists (
    select 1 from public.parent_profiles where user_id = v_parent
  ) or exists (
    select 1 from public.staff_profiles where user_id = v_scout
  ) or exists (
    select 1 from public.parent_player_links where parent_profile_id = v_parent_profile
  ) then
    raise exception 'TEST FAILED (parent/scout/referee): account data remains';
  end if;

  if not exists (select 1 from auth.users where id = v_child)
     or not exists (select 1 from public.player_profiles where id = v_child_player_profile) then
    raise exception 'TEST FAILED (parent): linked child account was deleted';
  end if;

  -- ==========================================================================
  -- Test 4: team account. Coaches remain; team-specific links do not.
  -- ==========================================================================
  perform public.admin_delete_account(v_team_owner, 'Regression test team deletion');

  if exists (select 1 from auth.users where id = v_team_owner)
     or exists (select 1 from public.profiles where user_id = v_team_owner)
     or exists (select 1 from public.team_profiles where user_id = v_team_owner)
     or exists (select 1 from public.teams where id = v_team_one)
     or exists (select 1 from public.clubs where id = v_club)
     or exists (select 1 from public.club_teams where club_id = v_club)
     or exists (
       select 1 from public.coach_staff_team_memberships
       where team_id = v_team_one
     ) then
    raise exception 'TEST FAILED (team): owned team/profile/relationships remain';
  end if;

  if not exists (select 1 from auth.users where id = v_other_coach)
     or not exists (select 1 from auth.users where id = v_other_user)
     or not exists (select 1 from public.teams where id = v_team_two) then
    raise exception 'TEST FAILED (team): unrelated accounts or team were deleted';
  end if;

  raise notice 'ALL ACCOUNT-DELETION REGRESSION TESTS PASSED';
end $$;

alter table public.clips enable trigger validate_next_up_clip_upload_limits_trigger;
alter table public.clips enable trigger enforce_clip_review_workflow_trigger;

rollback;
