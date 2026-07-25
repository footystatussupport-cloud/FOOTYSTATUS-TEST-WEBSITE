-- =============================================================================
-- TEST: Footy Status Official admin plan change actually applies (and preserves
--       content), i.e. the guard trigger permits an AUTHORIZED escalation.
-- =============================================================================
-- Regression for the bug where changing a Player Free -> Yearly / One-Time
-- reported success but never changed the account, because the guard trigger
-- tg_guard_subscription_columns reverted the escalation when
-- app.pro_change_authorized was not set. admin_set_pro_status now sets that flag.
--
-- How to run: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Runs inside a transaction that is ROLLED BACK at the end, so it only creates
-- and destroys throwaway rows. A clean run prints 'ALL ADMIN PRO OVERRIDE TESTS
-- PASSED'; any check RAISEs 'TEST FAILED ...'.
--
-- Note: this exercises the guard/authorization MECHANISM that admin_set_pro_status
-- relies on (it does not call admin_set_pro_status directly, since that requires
-- an authenticated Official session unavailable in the SQL editor).
-- =============================================================================
begin;

do $$
declare
  v_player_id uuid := gen_random_uuid();
  v_tier text;
  v_is_pro boolean;
  v_active_clips int;
  v_inactive_clips int;
begin
  -- --- Fixture: one throwaway player (trigger auto-creates the profiles row) --
  insert into auth.users (id, email, created_at)
    values (v_player_id, 'test-pro-' || v_player_id || '@example.test', now());
  update public.profiles set account_role = 'player', account_category = 'player'
    where user_id = v_player_id;

  -- Five clips so a downgrade must keep exactly the earliest 3 active.
  insert into public.clips (id, user_id, video_url, visibility, created_at)
    values
      (gen_random_uuid(), v_player_id, 'https://x/1.mp4', 'public', now() - interval '5 day'),
      (gen_random_uuid(), v_player_id, 'https://x/2.mp4', 'public', now() - interval '4 day'),
      (gen_random_uuid(), v_player_id, 'https://x/3.mp4', 'public', now() - interval '3 day'),
      (gen_random_uuid(), v_player_id, 'https://x/4.mp4', 'public', now() - interval '2 day'),
      (gen_random_uuid(), v_player_id, 'https://x/5.mp4', 'public', now() - interval '1 day');

  -- ==========================================================================
  -- (1) The bug reproduction: an UN-authorized escalation is silently reverted.
  --     This is exactly what admin_set_pro_status did before the fix.
  -- ==========================================================================
  update public.profiles
    set account_tier = 'pro_annual', is_pro = true, pro_expires_at = now() + interval '1 year'
    where user_id = v_player_id;
  select account_tier, is_pro into v_tier, v_is_pro
    from public.profiles where user_id = v_player_id;
  if v_tier <> 'free' or v_is_pro is true then
    raise exception 'TEST FAILED (1): guard should have reverted an unauthorized escalation (got tier=%, is_pro=%)', v_tier, v_is_pro;
  end if;

  -- ==========================================================================
  -- (2) The fix: with app.pro_change_authorized = 'on' the escalation sticks.
  -- ==========================================================================
  perform set_config('app.pro_change_authorized', 'on', true);
  update public.profiles
    set account_tier = 'pro_annual', is_pro = true, pro_expires_at = now() + interval '1 year'
    where user_id = v_player_id;
  select account_tier, is_pro into v_tier, v_is_pro
    from public.profiles where user_id = v_player_id;
  if v_tier <> 'pro_annual' or v_is_pro is not true then
    raise exception 'TEST FAILED (2): authorized upgrade did not persist (got tier=%, is_pro=%)', v_tier, v_is_pro;
  end if;

  -- Upgrading restores any hidden clips.
  perform public.restore_pro_clips(v_player_id);
  select count(*) filter (where visibility <> 'inactive'),
         count(*) filter (where visibility = 'inactive')
    into v_active_clips, v_inactive_clips
    from public.clips where user_id = v_player_id;
  if v_active_clips <> 5 or v_inactive_clips <> 0 then
    raise exception 'TEST FAILED (2): Pro should have all 5 clips active (active=%, inactive=%)', v_active_clips, v_inactive_clips;
  end if;

  -- ==========================================================================
  -- (3) Lifetime never expires.
  -- ==========================================================================
  perform set_config('app.pro_change_authorized', 'on', true);
  update public.profiles
    set account_tier = 'pro_lifetime', is_pro = true, pro_expires_at = null
    where user_id = v_player_id;
  if public.is_active_pro('pro_lifetime', null) is not true then
    raise exception 'TEST FAILED (3): lifetime should always be active Pro';
  end if;

  -- ==========================================================================
  -- (4) Downgrade to Free is ALWAYS allowed (de-escalation), keeps the earliest
  --     3 clips active, hides the rest, and deletes NO clips.
  -- ==========================================================================
  update public.profiles
    set account_tier = 'free', is_pro = false, pro_expires_at = null
    where user_id = v_player_id;
  select account_tier, is_pro into v_tier, v_is_pro
    from public.profiles where user_id = v_player_id;
  if v_tier <> 'free' or v_is_pro is true then
    raise exception 'TEST FAILED (4): downgrade to Free did not apply (tier=%, is_pro=%)', v_tier, v_is_pro;
  end if;

  perform public.apply_free_clip_visibility(v_player_id);
  select count(*) filter (where visibility <> 'inactive'),
         count(*) filter (where visibility = 'inactive')
    into v_active_clips, v_inactive_clips
    from public.clips where user_id = v_player_id;
  if v_active_clips <> 3 then
    raise exception 'TEST FAILED (4): Free should keep exactly 3 active clips (got %)', v_active_clips;
  end if;
  if v_inactive_clips <> 2 then
    raise exception 'TEST FAILED (4): the extra 2 clips should be inactive, not deleted (got % inactive)', v_inactive_clips;
  end if;
  if (select count(*) from public.clips where user_id = v_player_id) <> 5 then
    raise exception 'TEST FAILED (4): downgrade must NOT delete any clips';
  end if;

  -- ==========================================================================
  -- (5) Re-upgrade restores the previously hidden clips without re-uploading.
  -- ==========================================================================
  perform set_config('app.pro_change_authorized', 'on', true);
  update public.profiles
    set account_tier = 'pro_annual', is_pro = true, pro_expires_at = now() + interval '1 year'
    where user_id = v_player_id;
  perform public.restore_pro_clips(v_player_id);
  select count(*) filter (where visibility <> 'inactive')
    into v_active_clips from public.clips where user_id = v_player_id;
  if v_active_clips <> 5 then
    raise exception 'TEST FAILED (5): re-upgrade should reactivate all 5 clips (got %)', v_active_clips;
  end if;

  raise notice 'ALL ADMIN PRO OVERRIDE TESTS PASSED';
end $$;

rollback;
