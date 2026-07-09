-- =============================================================================
-- FOOTY STATUS — APPLY THIS ONCE IN THE SUPABASE SQL EDITOR
-- =============================================================================
-- Why: these migrations exist in the repo but were never applied to the live
-- database (project mepbsiznlfoslaastqcn). Deploying the website (Netlify/Vercel)
-- does NOT run database migrations, so the functions below are missing from the
-- database. That is what causes:
--   "Could not find the function public.get_referee_verification_queue ... in the schema cache"
--
-- How to run:
--   1. Open Supabase Dashboard -> your project -> SQL Editor -> New query.
--   2. Paste this ENTIRE file.
--   3. Click Run. (It is safe to run more than once — every statement is idempotent.)
--
-- What it installs:
--   * Referee Account Approval workflow (queue, accept/decline, resubmit, the
--     verified-referee gate that controls linking to fixtures).
--   * Recent Next Up Clip changes (3-way moderation: accept/revise/reject, and
--     locking the approved video file after approval).
-- =============================================================================


-- #############################################################################
-- 1) REFEREE VERIFICATION SYSTEM  (from 20260705160000)
-- #############################################################################
-- Referee verification & fixture authorization system.
-- Creating a Referee account only creates an account: every referee starts as
-- Pending Verification and must be approved by the Footy Status Official
-- account before any referee fixture functionality unlocks. Enforcement is
-- done in the database so frontend manipulation cannot bypass it.

-- 1) Verification state lives on the profile row.
alter table public.profiles
  add column if not exists referee_verification_status text,
  add column if not exists referee_verification_note text,
  add column if not exists referee_verification_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists referee_verification_reviewed_at timestamptz,
  add column if not exists referee_verification_submitted_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_referee_verification_status_check;

alter table public.profiles
  add constraint profiles_referee_verification_status_check
  check (
    referee_verification_status is null
    or referee_verification_status in ('pending', 'verified', 'revision_requested', 'rejected')
  );

create or replace function public.is_referee_profile(_profile public.profiles)
returns boolean
language sql
immutable
as $$
  select coalesce(_profile.account_role, '') = 'referee'
    or coalesce(_profile.account_category, '') = 'referee'
    or coalesce(_profile.role::text, '') = 'referee';
$$;

-- 2) Existing referee accounts: no one bypasses verification because their
--    account predates this feature. Everyone without a status becomes pending.
update public.profiles p
set referee_verification_status = 'pending',
    referee_verification_submitted_at = coalesce(p.referee_verification_submitted_at, p.created_at, now())
where public.is_referee_profile(p)
  and p.referee_verification_status is null;

-- 3) New referee accounts automatically start as Pending Verification.
create or replace function public.init_referee_verification_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_referee_profile(new) and new.referee_verification_status is null then
    new.referee_verification_status := 'pending';
    new.referee_verification_submitted_at := coalesce(new.referee_verification_submitted_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists init_referee_verification_status_trigger on public.profiles;
create trigger init_referee_verification_status_trigger
  before insert or update of account_role, account_category, role on public.profiles
  for each row
  execute function public.init_referee_verification_status();

-- 4) Single source of truth for "is this a Footy Status Verified Referee?".
create or replace function public.is_verified_referee(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles p
      where p.user_id = _user_id
        and public.is_referee_profile(p)
        and p.referee_verification_status = 'verified'
    ),
    false
  );
$$;

grant execute on function public.is_verified_referee(uuid) to anon, authenticated;

-- 5) Backend gate: no referee fixture claim can be created or self-managed by
--    an unverified referee, regardless of what the frontend does. Footy Status
--    admins can still manage claims (approvals, cleanups).
create or replace function public.enforce_verified_referee_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_footy_status_admin() then
    return new;
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and auth.uid() = new.referee_user_id) then
    if not public.is_verified_referee(new.referee_user_id) then
      raise exception 'Referee verification required. Only Footy Status Verified Referees may request or manage referee fixtures.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_verified_referee_claim_trigger on public.referee_match_claims;
create trigger enforce_verified_referee_claim_trigger
  before insert or update on public.referee_match_claims
  for each row
  execute function public.enforce_verified_referee_claim();

-- 6) Admin review actions: Verify / Request Revision / Reject.
create or replace function public.review_referee_verification(
  _referee_user_id uuid,
  _action text,
  _note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referee_profile public.profiles;
  clean_note text := nullif(trim(coalesce(_note, '')), '');
begin
  if not public.is_footy_status_admin() then
    raise exception 'Only the Footy Status Official account can review referee verifications.';
  end if;

  if _action not in ('verify', 'request_revision', 'reject') then
    raise exception 'Invalid verification action.';
  end if;

  select * into referee_profile
  from public.profiles
  where user_id = _referee_user_id;

  if referee_profile.id is null or not public.is_referee_profile(referee_profile) then
    raise exception 'Referee account not found.';
  end if;

  if _action = 'request_revision' and clean_note is null then
    raise exception 'Add a note telling the referee what needs to be corrected.';
  end if;

  update public.profiles
  set referee_verification_status = case _action
        when 'verify' then 'verified'
        when 'request_revision' then 'revision_requested'
        else 'rejected'
      end,
      referee_verification_note = case when _action = 'verify' then null else clean_note end,
      referee_verification_reviewed_by = auth.uid(),
      referee_verification_reviewed_at = now(),
      updated_at = now()
  where user_id = _referee_user_id;

  perform public.create_notification(
    _referee_user_id,
    auth.uid(),
    case _action
      when 'verify' then 'referee_verification_approved'
      when 'request_revision' then 'referee_verification_revision'
      else 'referee_verification_denied'
    end,
    case _action
      when 'verify' then 'Referee verification approved'
      when 'request_revision' then 'Referee verification needs revisions'
      else 'Referee verification denied'
    end,
    case _action
      when 'verify' then 'Your referee account has been verified by Footy Status. Referee fixture features are now unlocked.'
      when 'request_revision' then coalesce('Your referee verification requires revisions: ' || clean_note, 'Your referee verification requires revisions. Please review the administrator''s note.')
      else coalesce('Your referee verification request has been denied. ' || clean_note, 'Your referee verification request has been denied.')
    end,
    'referee_verification',
    referee_profile.id,
    null,
    null,
    null,
    '/referee',
    jsonb_build_object('action', _action, 'note', clean_note),
    'referee_verification:' || _referee_user_id || ':' || _action || ':' || extract(epoch from now())::bigint
  );
end;
$$;

grant execute on function public.review_referee_verification(uuid, text, text) to authenticated;

-- 7) Referees can upload a replacement certification without creating a new
--    account; the application automatically returns to the pending queue.
create or replace function public.resubmit_referee_certification(_proof_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referee_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if nullif(trim(coalesce(_proof_path, '')), '') is null then
    raise exception 'Upload your referee certification first.';
  end if;

  select * into referee_profile
  from public.profiles
  where user_id = auth.uid();

  if referee_profile.id is null or not public.is_referee_profile(referee_profile) then
    raise exception 'Only referee accounts can submit referee certification.';
  end if;

  update public.profiles
  set referee_certification_proof_url = _proof_path,
      referee_verification_status = 'pending',
      referee_verification_note = null,
      referee_verification_submitted_at = now(),
      updated_at = now()
  where user_id = auth.uid();
end;
$$;

grant execute on function public.resubmit_referee_certification(text) to authenticated;

-- 8) Admin queue: every application waiting for review, no manual searching.
create or replace function public.get_referee_verification_queue()
returns table (
  user_id uuid,
  avatar_url text,
  full_name text,
  username text,
  email text,
  phone text,
  location text,
  certification_level text,
  license_number text,
  certifying_organization text,
  years_experience integer,
  main_experience text,
  assistant_experience text,
  leagues_tournaments text,
  availability text,
  accolades text,
  bio text,
  certification_proof_url text,
  verification_status text,
  verification_note text,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_footy_status_admin() then
    raise exception 'Only the Footy Status Official account can view referee verifications.';
  end if;

  return query
  select
    p.user_id,
    p.avatar_url,
    p.full_name,
    p.username,
    p.email,
    (
      select uc.value
      from public.user_contacts uc
      where uc.user_id = p.user_id
        and uc.contact_type in ('player_phone', 'coach_phone')
      order by uc.contact_type
      limit 1
    ) as phone,
    p.coaching_location as location,
    p.referee_certification_level,
    p.referee_license_number,
    p.referee_certifying_organization,
    p.referee_years_experience,
    p.referee_main_experience,
    p.referee_assistant_experience,
    p.referee_leagues_tournaments,
    p.referee_availability,
    p.referee_accolades,
    p.bio,
    p.referee_certification_proof_url,
    p.referee_verification_status,
    p.referee_verification_note,
    p.referee_verification_submitted_at
  from public.profiles p
  where public.is_referee_profile(p)
    and coalesce(p.referee_verification_status, 'pending') in ('pending', 'revision_requested')
  order by
    case coalesce(p.referee_verification_status, 'pending') when 'pending' then 0 else 1 end,
    p.referee_verification_submitted_at asc nulls last;
end;
$$;

grant execute on function public.get_referee_verification_queue() to authenticated;

comment on function public.is_verified_referee(uuid) is
  'True only when the referee account has been verified by the Footy Status Official account.';


-- #############################################################################
-- 2) DECLINE REQUIRES A REASON  (from 20260709120000)
-- #############################################################################
-- Referee account approval is a two-decision workflow for the Footy Status
-- Official: Accept (verify) or Decline. A decline must always carry a written
-- reason so the referee is told exactly what to fix before resubmitting.
--
-- The review function already required a note for 'request_revision'; extend the
-- same requirement to 'reject' (the action behind the Decline button) so the
-- rule is enforced server-side, not just in the UI.

create or replace function public.review_referee_verification(
  _referee_user_id uuid,
  _action text,
  _note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referee_profile public.profiles;
  clean_note text := nullif(trim(coalesce(_note, '')), '');
begin
  if not public.is_footy_status_admin() then
    raise exception 'Only the Footy Status Official account can review referee verifications.';
  end if;

  if _action not in ('verify', 'request_revision', 'reject') then
    raise exception 'Invalid verification action.';
  end if;

  select * into referee_profile
  from public.profiles
  where user_id = _referee_user_id;

  if referee_profile.id is null or not public.is_referee_profile(referee_profile) then
    raise exception 'Referee account not found.';
  end if;

  if _action in ('request_revision', 'reject') and clean_note is null then
    raise exception 'Add a note explaining what the referee needs to correct before they can be approved.';
  end if;

  update public.profiles
  set referee_verification_status = case _action
        when 'verify' then 'verified'
        when 'request_revision' then 'revision_requested'
        else 'rejected'
      end,
      referee_verification_note = case when _action = 'verify' then null else clean_note end,
      referee_verification_reviewed_by = auth.uid(),
      referee_verification_reviewed_at = now(),
      updated_at = now()
  where user_id = _referee_user_id;

  perform public.create_notification(
    _referee_user_id,
    auth.uid(),
    case _action
      when 'verify' then 'referee_verification_approved'
      when 'request_revision' then 'referee_verification_revision'
      else 'referee_verification_denied'
    end,
    case _action
      when 'verify' then 'Referee verification approved'
      when 'request_revision' then 'Referee verification needs revisions'
      else 'Referee verification declined'
    end,
    case _action
      when 'verify' then 'Your referee account has been verified by Footy Status. Referee fixture features are now unlocked.'
      when 'request_revision' then coalesce('Your referee verification requires revisions: ' || clean_note, 'Your referee verification requires revisions. Please review the administrator''s note.')
      else coalesce('Your referee application was declined: ' || clean_note, 'Your referee application was declined.')
    end,
    'referee_verification',
    referee_profile.id,
    null,
    null,
    null,
    '/referee',
    jsonb_build_object('action', _action, 'note', clean_note),
    'referee_verification:' || _referee_user_id || ':' || _action || ':' || extract(epoch from now())::bigint
  );
end;
$$;

grant execute on function public.review_referee_verification(uuid, text, text) to authenticated;


-- #############################################################################
-- 3) LOCK APPROVED CLIP VIDEO FILE  (from 20260709130000)
-- #############################################################################
-- Post-approval Next Up clip editing: once a clip is approved, the reviewed
-- video file is locked. Players may still edit display-only settings (fit mode)
-- and the caption (which stays subject to the existing profanity trigger), but
-- they can never replace the approved video/thumbnail or otherwise swap the
-- media to circumvent moderation. Caption/display edits do NOT trigger another
-- review. Enforced in the database so the frontend cannot bypass it.
--
-- This recreates enforce_clip_review_workflow with one added rule: for non-admin
-- updates to an already-approved clip, video_url and thumbnail_url are forced
-- back to their approved values. Every other rule is preserved verbatim,
-- including the needs_revision -> pending_review resubmission flow.

create or replace function public.enforce_clip_review_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
    return new;
  end if;

  if public.is_footy_status_global_admin() then
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     or new.revision_note is distinct from old.revision_note
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by then
    new.review_status := old.review_status;
    new.revision_note := old.revision_note;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;

  -- Approved clips: the video that Footy Status reviewed is permanent. A player
  -- can change display settings and the caption, but never the media file.
  -- Caption/display edits keep the clip approved (no re-review).
  if old.review_status = 'approved' then
    new.video_url := old.video_url;
    new.thumbnail_url := old.thumbnail_url;
  end if;

  if old.review_status = 'needs_revision'
     and (
       new.video_url is distinct from old.video_url
       or new.title is distinct from old.title
       or new.caption is distinct from old.caption
       or new.description is distinct from old.description
     ) then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_review_workflow_trigger on public.clips;
create trigger enforce_clip_review_workflow_trigger
before insert or update on public.clips
for each row execute function public.enforce_clip_review_workflow();


-- #############################################################################
-- 4) THREE-WAY NEXT UP CLIP MODERATION  (from 20260709140000)
-- #############################################################################
-- Complete Next Up Clip moderation workflow with three actions:
--   Accept  -> approve + publish + notify (clip goes live everywhere)
--   Revise  -> keep unpublished, send a custom message; the player edits and
--              resubmits, which returns the clip to the pending queue
--   Reject  -> permanently remove the clip from the platform and send a custom
--              rejection message
--
-- Two changes:
--   1) get_pending_clip_reviews only lists clips that are actually awaiting a
--      decision (pending_review). A revised clip leaves the queue until the
--      player resubmits (the enforce_clip_review_workflow trigger flips it back
--      to pending_review on resubmission). It also returns the player's profile
--      id so the reviewer can open the full player profile.
--   2) review_next_up_clip accepts approve / revise / reject. Reject deletes the
--      clip after sending the rejection notification (created with a null
--      clip_id so the message survives the deletion), so the clip disappears
--      everywhere in the app.

-- 1) Queue: only pending submissions, plus the player's profile id. ------------
drop function if exists public.get_pending_clip_reviews();

create or replace function public.get_pending_clip_reviews()
returns table (
  clip_id uuid,
  player_user_id uuid,
  player_profile_id uuid,
  player_name text,
  player_username text,
  player_gender text,
  account_role text,
  title text,
  caption text,
  video_url text,
  thumbnail_url text,
  uploaded_at timestamptz,
  review_status text,
  revision_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();

  return query
  select
    c.id,
    coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id),
    coalesce(pp_by_user.id, pp_by_id.id),
    coalesce(p.full_name, pp_by_user.full_name, pp_by_id.full_name, pl.name, 'Player'),
    p.username,
    coalesce(pp_by_user.player_gender, pp_by_id.player_gender, pl.player_gender),
    coalesce(p.account_role, p.account_type, p.role::text, 'player'),
    c.title,
    coalesce(c.caption, c.description),
    c.video_url,
    c.thumbnail_url,
    c.created_at,
    c.review_status,
    c.revision_note
  from public.clips c
  left join public.player_profiles pp_by_user
    on pp_by_user.user_id = c.user_id
  left join public.player_profiles pp_by_id
    on pp_by_id.id = c.player_id
  left join public.players pl
    on pl.id = c.player_id
  left join public.profiles p
    on p.user_id = coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id)
  where c.review_status = 'pending_review'
  order by coalesce(c.submitted_for_review_at, c.created_at) asc;
end;
$$;

revoke all on function public.get_pending_clip_reviews() from public;
grant execute on function public.get_pending_clip_reviews() to authenticated;

-- 2) Three-way review action. --------------------------------------------------
create or replace function public.review_next_up_clip(
  _clip_id uuid,
  _decision text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_owner_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_note text := trim(coalesce(_note, ''));
begin
  perform public.admin_assert_official(
    case
      when _decision = 'approve' then 'Next Up Clip approved'
      else coalesce(nullif(v_note, ''), 'Next Up Clip moderation')
    end
  );

  if _decision not in ('approve', 'revise', 'reject') then
    raise exception 'Choose Accept, Revise, or Reject.';
  end if;

  if _decision = 'revise' and length(v_note) < 3 then
    raise exception 'Write a revision note explaining what the player should change.';
  end if;

  if _decision = 'reject' and length(v_note) < 3 then
    raise exception 'Write a reason explaining why the clip was rejected.';
  end if;

  select * into v_clip
  from public.clips
  where id = _clip_id
  for update;

  if v_clip.id is null then
    raise exception 'Clip not found.';
  end if;

  v_before := to_jsonb(v_clip);

  v_owner_id := coalesce(
    v_clip.user_id,
    (select pp.user_id from public.player_profiles pp where pp.id = v_clip.player_id limit 1),
    (select pl.user_id from public.players pl where pl.id = v_clip.player_id limit 1)
  );

  if _decision = 'reject' then
    -- Notify first with a null clip_id so the rejection message survives the
    -- clip deletion, then permanently remove the clip from the platform.
    if v_owner_id is not null then
      perform public.create_notification(
        _user_id := v_owner_id,
        _actor_user_id := auth.uid(),
        _type := 'clip_rejected',
        _title := 'Next Up Clip rejected',
        _body := 'Your Next Up Clip was rejected and will not be posted: ' || v_note,
        _entity_type := 'clip',
        _entity_id := null,
        _clip_id := null,
        _link_path := '/profile',
        _metadata := jsonb_build_object('clip_id', _clip_id, 'review_status', 'rejected', 'rejection_note', v_note),
        _dedupe_key := 'clip_review:' || _clip_id::text || ':reject:' || extract(epoch from now())::bigint::text
      );
    end if;

    delete from public.clips where id = _clip_id;

    perform public.admin_write_audit(
      'next_up_clip_rejected',
      'clips',
      _clip_id::text,
      v_owner_id,
      v_note,
      v_before,
      'null'::jsonb,
      jsonb_build_object('clip_id', _clip_id, 'decision', 'reject', 'admin_note', v_note)
    );

    return jsonb_build_object('clip_id', _clip_id, 'decision', 'reject', 'deleted', true);
  end if;

  update public.clips
  set review_status = case when _decision = 'approve' then 'approved' else 'needs_revision' end,
      revision_note = case when _decision = 'revise' then v_note else null end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = _clip_id;

  select to_jsonb(c) into v_after from public.clips c where c.id = _clip_id;

  if v_owner_id is not null then
    perform public.create_notification(
      _user_id := v_owner_id,
      _actor_user_id := auth.uid(),
      _type := case when _decision = 'approve' then 'clip_approved' else 'clip_needs_revision' end,
      _title := case when _decision = 'approve' then 'Next Up Clip authorized' else 'Next Up Clip needs revision' end,
      _body := case
        when _decision = 'approve' then 'Your Next Up Clip was authorized and is now live.'
        else 'Your Next Up Clip was not posted yet. Footy Status requested a revision: ' || v_note
      end,
      _entity_type := 'clip',
      _entity_id := _clip_id,
      _clip_id := _clip_id,
      _link_path := '/profile',
      _metadata := jsonb_build_object('clip_id', _clip_id, 'review_status', case when _decision = 'approve' then 'approved' else 'needs_revision' end, 'revision_note', v_note),
      _dedupe_key := 'clip_review:' || _clip_id::text || ':' || extract(epoch from now())::bigint::text
    );
  end if;

  perform public.admin_write_audit(
    case when _decision = 'approve' then 'next_up_clip_approved' else 'next_up_clip_needs_revision' end,
    'clips',
    _clip_id::text,
    v_owner_id,
    case when _decision = 'approve' then 'Next Up Clip approved' else v_note end,
    v_before,
    v_after,
    jsonb_build_object('clip_id', _clip_id, 'decision', _decision, 'admin_note', _note)
  );

  return v_after;
end;
$$;

revoke all on function public.review_next_up_clip(uuid, text, text) from public;
grant execute on function public.review_next_up_clip(uuid, text, text) to authenticated;


-- #############################################################################
-- 5) REFRESH THE POSTGREST SCHEMA CACHE so the new functions are found immediately
-- #############################################################################
notify pgrst, 'reload schema';
