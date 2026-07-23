-- =============================================================================
-- TEST: Next Up feed launch algorithm (repeat rotation + gender separation).
-- =============================================================================
-- How to run: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Everything happens inside a transaction that is ROLLED BACK at the end, so it
-- creates and destroys only throwaway rows and never touches real data.
--
-- Covers the acceptance list for 20260722150000_next_up_launch_repeat_feed:
--   1  a new boy player sees the newest approved boys' clips first
--   2  a boy player never receives a girls' clip, even once the feed repeats
--   3  a girl player never receives a boys' clip, even once the feed repeats
--   4  a viewer who has watched everything starts receiving those clips again
--   5  newly approved clips come before repeated clips
--   6  repeated clips rotate instead of repeating one fixed order
--   7  no fake / placeholder clips are ever returned
--   8  rejected, unapproved, hidden and inactive-account clips never appear
--   9  zero rows are returned only when nothing eligible exists
--
-- Every check RAISEs 'TEST FAILED ...'; a clean run prints only
-- 'ALL NEXT UP FEED TESTS PASSED'.
-- =============================================================================
begin;

-- The upload-limit and review-workflow triggers exist to police real uploads.
-- The fixtures below write approved clips directly, so both are suspended for
-- the duration of this rolled-back transaction.
alter table public.clips disable trigger enforce_clip_review_workflow_trigger;
alter table public.clips disable trigger validate_next_up_clip_upload_limits_trigger;

do $$
declare
  v_boy_viewer   uuid := gen_random_uuid();
  v_boy_a        uuid := gen_random_uuid();
  v_boy_b        uuid := gen_random_uuid();
  v_girl_viewer  uuid := gen_random_uuid();
  v_girl_a       uuid := gen_random_uuid();
  v_lonely       uuid := gen_random_uuid();
  v_inactive     uuid := gen_random_uuid();

  v_boy_clip_1   uuid;  -- boy A, oldest
  v_boy_clip_2   uuid;  -- boy B
  v_boy_clip_3   uuid;  -- boy A, newest
  v_girl_clip_1  uuid;
  v_pending_clip uuid;
  v_hidden_clip  uuid;
  v_inactive_clip uuid;
  v_fresh_clip   uuid;

  v_all_boy_clips uuid[];
  v_page uuid[];
  v_round_a uuid[];
  v_round_b uuid[];
  v_round_c uuid[];
  v_seen uuid[];
  v_clip uuid;
  v_rounds_differ boolean := false;
  v_guard integer;
begin
  -- --- Helper: act as a given user -------------------------------------------
  -- (inline set_config calls below; auth.uid() reads request.jwt.claims)

  -- --- Fixtures --------------------------------------------------------------
  insert into auth.users (id, email, created_at) values
    (v_boy_viewer,  'test-boyviewer-'  || v_boy_viewer  || '@example.test', now()),
    (v_boy_a,       'test-boya-'       || v_boy_a       || '@example.test', now()),
    (v_boy_b,       'test-boyb-'       || v_boy_b       || '@example.test', now()),
    (v_girl_viewer, 'test-girlviewer-' || v_girl_viewer || '@example.test', now()),
    (v_girl_a,      'test-girla-'      || v_girl_a      || '@example.test', now()),
    (v_lonely,      'test-lonely-'     || v_lonely      || '@example.test', now()),
    (v_inactive,    'test-inactive-'   || v_inactive    || '@example.test', now());

  update public.profiles
  set account_role = 'player', account_category = 'player', is_active = true, deleted_at = null
  where user_id in (v_boy_viewer, v_boy_a, v_boy_b, v_girl_viewer, v_girl_a, v_lonely, v_inactive);

  insert into public.player_profiles (user_id, full_name, player_gender) values
    (v_boy_viewer,  'Test Boy Viewer',  'boy'),
    (v_boy_a,       'Test Boy A',       'boy'),
    (v_boy_b,       'Test Boy B',       'boy'),
    (v_girl_viewer, 'Test Girl Viewer', 'girl'),
    (v_girl_a,      'Test Girl A',      'girl'),
    (v_inactive,    'Test Inactive',    'boy')
  on conflict (user_id) do update
  set player_gender = excluded.player_gender, full_name = excluded.full_name;

  -- v_lonely is a boy player with no same-gender clips available to them.
  insert into public.player_profiles (user_id, full_name, player_gender)
  values (v_lonely, 'Test Lonely Boy', 'boy')
  on conflict (user_id) do update set player_gender = 'boy';

  insert into public.clips (user_id, title, video_url, visibility, review_status, reviewed_at, created_at)
  values
    (v_boy_a,  'Boy A older',  'https://cdn.example.test/boy-a-1.mp4', 'public', 'approved', now() - interval '3 days', now() - interval '3 days'),
    (v_boy_b,  'Boy B',        'https://cdn.example.test/boy-b-1.mp4', 'public', 'approved', now() - interval '2 days', now() - interval '2 days'),
    (v_boy_a,  'Boy A newest', 'https://cdn.example.test/boy-a-2.mp4', 'public', 'approved', now() - interval '1 day',  now() - interval '1 day');

  select id into v_boy_clip_1 from public.clips where user_id = v_boy_a and title = 'Boy A older';
  select id into v_boy_clip_2 from public.clips where user_id = v_boy_b and title = 'Boy B';
  select id into v_boy_clip_3 from public.clips where user_id = v_boy_a and title = 'Boy A newest';
  v_all_boy_clips := array[v_boy_clip_1, v_boy_clip_2, v_boy_clip_3];

  insert into public.clips (user_id, title, video_url, visibility, review_status, reviewed_at, created_at)
  values (v_girl_a, 'Girl A', 'https://cdn.example.test/girl-a-1.mp4', 'public', 'approved', now(), now())
  returning id into v_girl_clip_1;

  -- Ineligible content that must never surface.
  insert into public.clips (user_id, title, video_url, visibility, review_status, created_at)
  values (v_boy_b, 'Pending boy clip', 'https://cdn.example.test/pending.mp4', 'public', 'pending_review', now())
  returning id into v_pending_clip;

  insert into public.clips (user_id, title, video_url, visibility, review_status, reviewed_at, created_at)
  values (v_boy_b, 'Hidden boy clip', 'https://cdn.example.test/hidden.mp4', 'inactive', 'approved', now(), now())
  returning id into v_hidden_clip;

  insert into public.clips (user_id, title, video_url, visibility, review_status, reviewed_at, created_at)
  values (v_inactive, 'Inactive account clip', 'https://cdn.example.test/inactive.mp4', 'public', 'approved', now(), now())
  returning id into v_inactive_clip;

  update public.profiles set is_active = false where user_id = v_inactive;

  -- ==========================================================================
  -- (1) Newest approved boys' clip is first for a brand new boy viewer.
  -- (7)/(8) Only real, approved, published clips from active accounts appear.
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_boy_viewer, 'email', 'test-boyviewer@example.test')::text, true);

  select array_agg(x.id order by x.rn) into v_page
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, true)) x;

  if v_page is null or array_length(v_page, 1) = 0 then
    raise exception 'TEST FAILED (1): a new boy player received no clips';
  end if;

  if v_page[1] <> v_boy_clip_3 then
    raise exception 'TEST FAILED (1): newest boys clip was not first (got %)', v_page[1];
  end if;

  if v_page && array[v_pending_clip, v_hidden_clip, v_inactive_clip] then
    raise exception 'TEST FAILED (8): an unapproved / hidden / inactive-account clip was served';
  end if;

  if not (v_page <@ v_all_boy_clips) then
    raise exception 'TEST FAILED (7): the feed returned a clip outside the real approved boys set';
  end if;

  -- ==========================================================================
  -- (2)/(4)/(6) Watch everything, then keep pulling: the same real clips come
  -- back, still boys-only, and not always in the same order.
  -- ==========================================================================
  foreach v_clip in array v_page loop
    perform public.mark_next_up_clip_viewed(v_clip);
  end loop;

  -- Drain whatever is left of the first rotation.
  v_guard := 0;
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 20;

    select array_agg(x.id order by x.rn) into v_page
    from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, false)) x;

    exit when v_page is null;

    foreach v_clip in array v_page loop
      perform public.mark_next_up_clip_viewed(v_clip);
    end loop;

    select array_agg(distinct fi.clip_id) into v_seen
    from public.clip_feed_impressions fi
    where fi.user_id = v_boy_viewer and fi.viewed_at is not null;

    exit when v_seen @> v_all_boy_clips;
  end loop;

  select array_agg(distinct fi.clip_id) into v_seen
  from public.clip_feed_impressions fi
  where fi.user_id = v_boy_viewer and fi.viewed_at is not null;

  if not (v_seen @> v_all_boy_clips) then
    raise exception 'TEST FAILED (4): the viewer never got through every eligible clip';
  end if;

  -- Everything has now been watched. The feed must NOT go empty.
  select array_agg(x.id order by x.rn) into v_round_a
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, false)) x;

  select array_agg(x.id order by x.rn) into v_round_b
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, false)) x;

  select array_agg(x.id order by x.rn) into v_round_c
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, false)) x;

  if v_round_a is null or v_round_b is null or v_round_c is null then
    raise exception 'TEST FAILED (4): the feed went empty after the viewer watched every clip';
  end if;

  if not (v_round_a <@ v_all_boy_clips and v_round_b <@ v_all_boy_clips and v_round_c <@ v_all_boy_clips) then
    raise exception 'TEST FAILED (2): a non-boys clip appeared once the feed began repeating';
  end if;

  if v_girl_clip_1 = any(v_round_a || v_round_b || v_round_c) then
    raise exception 'TEST FAILED (2): a boy player received a girls clip from the repeat rotation';
  end if;

  -- (6) At least one of the repeat rounds must differ in order from another.
  v_rounds_differ := (v_round_a is distinct from v_round_b)
                  or (v_round_b is distinct from v_round_c)
                  or (v_round_a is distinct from v_round_c);
  if not v_rounds_differ then
    raise exception 'TEST FAILED (6): three repeat rounds produced an identical order';
  end if;

  -- ==========================================================================
  -- (5) A clip approved after the viewer caught up outranks the repeats.
  -- ==========================================================================
  insert into public.clips (user_id, title, video_url, visibility, review_status, reviewed_at, created_at)
  values (v_boy_b, 'Freshly approved', 'https://cdn.example.test/fresh.mp4', 'public', 'approved', now(), now())
  returning id into v_fresh_clip;

  select array_agg(x.id order by x.rn) into v_page
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, false)) x;

  if v_page is null or v_page[1] <> v_fresh_clip then
    raise exception 'TEST FAILED (5): a newly approved clip did not come before repeated clips (got %)', v_page[1];
  end if;

  -- ==========================================================================
  -- (3) A girl player never receives boys' clips, including after repeats.
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_girl_viewer, 'email', 'test-girlviewer@example.test')::text, true);

  v_guard := 0;
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 8;

    select array_agg(x.id order by x.rn) into v_page
    from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, v_guard = 1)) x;

    if v_page is null then
      raise exception 'TEST FAILED (3): the girl viewer lost her eligible clip';
    end if;

    if not (v_page <@ array[v_girl_clip_1]) then
      raise exception 'TEST FAILED (3): a girl player received a clip she must not see';
    end if;

    foreach v_clip in array v_page loop
      perform public.mark_next_up_clip_viewed(v_clip);
    end loop;
  end loop;

  -- ==========================================================================
  -- (9) Zero rows only when there is genuinely nothing eligible.
  -- ==========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_lonely, 'email', 'test-lonely@example.test')::text, true);

  -- Temporarily deactivate every other boys account so this viewer has nothing.
  update public.profiles set is_active = false where user_id in (v_boy_a, v_boy_b, v_boy_viewer);

  select array_agg(x.id order by x.rn) into v_page
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, true)) x;

  if v_page is not null then
    raise exception 'TEST FAILED (9): a viewer with no eligible clips still received rows';
  end if;

  update public.profiles set is_active = true where user_id in (v_boy_a, v_boy_b, v_boy_viewer);

  select array_agg(x.id order by x.rn) into v_page
  from (select id, row_number() over () as rn from public.get_next_up_feed(12, null, true)) x;

  if v_page is null then
    raise exception 'TEST FAILED (9): the empty state persisted after clips became available again';
  end if;

  raise notice 'ALL NEXT UP FEED TESTS PASSED';
end;
$$;

alter table public.clips enable trigger validate_next_up_clip_upload_limits_trigger;
alter table public.clips enable trigger enforce_clip_review_workflow_trigger;

rollback;
