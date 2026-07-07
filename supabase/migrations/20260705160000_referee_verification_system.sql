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
