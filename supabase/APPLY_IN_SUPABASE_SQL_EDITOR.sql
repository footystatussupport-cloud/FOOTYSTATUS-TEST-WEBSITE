-- =============================================================================
-- FOOTY STATUS — APPLY THIS ONCE IN THE SUPABASE SQL EDITOR
-- =============================================================================
-- Why: these migrations exist in the repo but were never applied to the live
-- database (the project in your app's .env). Deploying the website
-- (Netlify/Vercel) does NOT run database migrations, so these functions are
-- missing from the database, causing errors like:
--   "Could not find the function public.get_referee_verification_queue ... in the schema cache"
-- and broken parent<->player linking.
--
-- How to run: Supabase Dashboard -> your project (the one in VITE_SUPABASE_URL)
-- -> SQL Editor -> New query -> paste this ENTIRE file -> Run.
-- Safe to run more than once (idempotent).
-- =============================================================================

-- #############################################################################
-- 20260705110000_parent_links_any_age_contact_privacy
-- #############################################################################
-- Parents can link to any player account regardless of the player's age, and
-- linked parent contact information on a player profile follows the player's
-- contact privacy setting (everyone / staff_only / private) exactly like the
-- player's own contact information.

-- 1) Remove the ages 6-13 restriction from parent link requests.
create or replace function public.request_parent_player_link(
  _player_user_id uuid,
  _relationship text default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles;
  player_row public.player_profiles;
  active_link_count integer;
  link_id uuid;
begin
  select * into parent_row
  from public.parent_profiles
  where user_id = auth.uid();

  if parent_row.id is null then
    raise exception 'Only parent accounts can request parent-player links';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = _player_user_id;

  if player_row.id is null then
    raise exception 'Player profile not found';
  end if;

  if exists (
    select 1
    from public.parent_player_links ppl
    where ppl.parent_profile_id = parent_row.id
      and ppl.player_profile_id = player_row.id
      and ppl.status in ('pending', 'approved')
  ) then
    raise exception 'This parent connection already exists';
  end if;

  select count(*)
  into active_link_count
  from public.parent_player_links ppl
  where ppl.player_profile_id = player_row.id
    and ppl.status in ('pending', 'approved');

  if active_link_count >= 2 then
    raise exception 'This player already has two parent connection slots in use';
  end if;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    relationship_to_player,
    notes,
    removed_at,
    removed_by_user_id,
    denied_at,
    updated_at
  )
  values (
    parent_row.id,
    player_row.id,
    'pending',
    auth.uid(),
    nullif(trim(coalesce(_relationship, parent_row.relationship_to_player, '')), ''),
    nullif(trim(coalesce(_notes, '')), ''),
    null,
    null,
    null,
    now()
  )
  on conflict (parent_profile_id, player_profile_id) do update set
    status = 'pending',
    requested_by_user_id = auth.uid(),
    relationship_to_player = excluded.relationship_to_player,
    notes = excluded.notes,
    removed_at = null,
    removed_by_user_id = null,
    denied_at = null,
    updated_at = now()
  returning id into link_id;

  perform public.create_notification(
    player_row.user_id,
    auth.uid(),
    'parent_link_requested',
    'Parent connection request',
    coalesce(parent_row.full_name, 'A parent account') || ' requested to be linked as your parent or guardian.',
    'parent_player_link',
    link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', link_id, 'parent_user_id', parent_row.user_id),
    'parent_link_requested:' || link_id
  );

  return link_id;
end;
$$;

-- 2) Remove the age restriction from link reviews.
create or replace function public.review_parent_player_link(
  _link_id uuid,
  _approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  player_row public.player_profiles;
  parent_row public.parent_profiles;
  approved_count integer;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null or link_row.status <> 'pending' then
    raise exception 'Pending parent connection not found';
  end if;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  select * into parent_row
  from public.parent_profiles
  where id = link_row.parent_profile_id;

  if player_row.user_id <> auth.uid()
     and not public.is_footy_status_admin() then
    raise exception 'Only the player or Footy Status admin can review a pending request';
  end if;

  if _approve then
    select count(*) into approved_count
    from public.parent_player_links
    where player_profile_id = player_row.id
      and status = 'approved'
      and id <> _link_id;

    if approved_count >= 2 then
      raise exception 'This player already has two approved parent accounts';
    end if;
  end if;

  update public.parent_player_links
  set status = case when _approve then 'approved' else 'denied' end,
      approved_by_user_id = case when _approve then auth.uid() else null end,
      approved_at = case when _approve then now() else null end,
      denied_at = case when _approve then null else now() end,
      updated_at = now()
  where id = _link_id;

  perform public.create_notification(
    parent_row.user_id,
    player_row.user_id,
    case when _approve then 'parent_link_approved' else 'parent_link_denied' end,
    case when _approve then 'Parent connection approved' else 'Parent connection declined' end,
    case
      when _approve then coalesce(player_row.full_name, 'The player') || ' approved your parent connection.'
      else coalesce(player_row.full_name, 'The player') || ' declined your parent connection request.'
    end,
    'parent_player_link',
    _link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', _link_id, 'player_profile_id', player_row.id),
    'parent_link_reviewed:' || _link_id || ':' || case when _approve then 'approved' else 'denied' end
  );
end;
$$;

-- 3) Notification fan-out follows approved links for players of any age.
create or replace function public.fan_out_child_notification_to_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_link record;
  child_profile public.player_profiles;
begin
  if coalesce((new.metadata ->> 'parent_copy')::boolean, false) then
    return new;
  end if;

  select * into child_profile
  from public.player_profiles
  where user_id = new.user_id;

  if child_profile.id is null then
    return new;
  end if;

  for parent_link in
    select ppl.id as link_id, pp.user_id as parent_user_id
    from public.parent_player_links ppl
    join public.parent_profiles pp on pp.id = ppl.parent_profile_id
    where ppl.player_profile_id = child_profile.id
      and ppl.status = 'approved'
  loop
    perform public.create_notification(
      parent_link.parent_user_id,
      new.actor_user_id,
      'child_' || new.type,
      new.title,
      replace(
        replace(new.body, ' your ', ' your child''s '),
        'You ',
        'Your child '
      ),
      new.entity_type,
      new.entity_id,
      new.team_id,
      new.club_team_id,
      new.clip_id,
      coalesce(new.link_path, '/player/' || child_profile.id),
      coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_copy', true,
          'child_user_id', child_profile.user_id,
          'child_player_profile_id', child_profile.id,
          'source_notification_id', new.id,
          'parent_link_id', parent_link.link_id
        ),
      'parent_copy:' || new.id || ':' || parent_link.parent_user_id,
      child_profile.user_id
    );
  end loop;

  return new;
end;
$$;

-- 4) Linked parent contact info on a player profile now follows the player's
--    contact privacy setting, exactly like the player's own contact info.
--    The linked parent can always see their own connection details.
create or replace function public.user_can_view_parent_contacts(_player_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_view_contact_info(_player_user_id)
    or exists (
      select 1
      from public.parent_player_links ppl
      join public.parent_profiles pp on pp.id = ppl.parent_profile_id
      join public.player_profiles pl on pl.id = ppl.player_profile_id
      where pl.user_id = _player_user_id
        and pp.user_id = auth.uid()
        and ppl.status = 'approved'
    );
$$;

comment on function public.user_can_view_parent_contacts(uuid) is
  'Linked parent contact info follows the player''s contact privacy setting (everyone / staff_only / private); the linked parent always sees their own details.';

-- 5) Existing accounts: make sure contact info typed during player/parent
--    signup exists in user_contacts so it can appear in the profile contact
--    section (visibility derived from each account's privacy setting).
insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_email', lower(trim(pp.contact_email)),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.player_profiles pp
left join public.user_settings us on us.user_id = pp.user_id
where pp.user_id is not null and nullif(trim(pp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_phone', trim(pp.contact_phone),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.player_profiles pp
left join public.user_settings us on us.user_id = pp.user_id
where pp.user_id is not null and nullif(trim(pp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select par.user_id, 'player_email', lower(trim(par.contact_email)),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.parent_profiles par
left join public.user_settings us on us.user_id = par.user_id
where par.user_id is not null and nullif(trim(par.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select par.user_id, 'player_phone', trim(par.contact_phone),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.parent_profiles par
left join public.user_settings us on us.user_id = par.user_id
where par.user_id is not null and nullif(trim(par.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

-- #############################################################################
-- 20260705160000_referee_verification_system
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
-- Return-type changes cannot go through create or replace — drop first so this
-- file stays runnable against any prior database state (execute is re-granted
-- below).
drop function if exists public.get_referee_verification_queue();

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
-- 20260707150000_parent_notification_fanout_ages_6_13
-- #############################################################################
-- Parent linking stays open to players of all ages (unchanged).
-- Automatic notification mirroring to linked parents is a safety feature for
-- younger players only: restore the 6-13 age gate on the notification fan-out
-- so a linked parent receives copies of the child's notifications only when the
-- player is between 6 and 13. Players 14+ can still link parents, but their
-- notifications are not mirrored.
--
-- Reuses public.player_is_parent_link_age (returns true for ages 6-13).

create or replace function public.fan_out_child_notification_to_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_link record;
  child_profile public.player_profiles;
begin
  if coalesce((new.metadata ->> 'parent_copy')::boolean, false) then
    return new;
  end if;

  select * into child_profile
  from public.player_profiles
  where user_id = new.user_id;

  -- Only mirror notifications for players aged 6-13.
  if child_profile.id is null
     or not public.player_is_parent_link_age(child_profile.id) then
    return new;
  end if;

  for parent_link in
    select ppl.id as link_id, pp.user_id as parent_user_id
    from public.parent_player_links ppl
    join public.parent_profiles pp on pp.id = ppl.parent_profile_id
    where ppl.player_profile_id = child_profile.id
      and ppl.status = 'approved'
  loop
    perform public.create_notification(
      parent_link.parent_user_id,
      new.actor_user_id,
      'child_' || new.type,
      new.title,
      replace(
        replace(new.body, ' your ', ' your child''s '),
        'You ',
        'Your child '
      ),
      new.entity_type,
      new.entity_id,
      new.team_id,
      new.club_team_id,
      new.clip_id,
      coalesce(new.link_path, '/player/' || child_profile.id),
      coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_copy', true,
          'child_user_id', child_profile.user_id,
          'child_player_profile_id', child_profile.id,
          'source_notification_id', new.id,
          'parent_link_id', parent_link.link_id
        ),
      'parent_copy:' || new.id || ':' || parent_link.parent_user_id,
      child_profile.user_id
    );
  end loop;

  return new;
end;
$$;

-- #############################################################################
-- 20260707160000_get_parent_linked_children_rpc
-- #############################################################################
-- Parent -> child direction of the parent/player link was not displaying under
-- the parent's "Linked Children" section, while the child -> parent direction
-- worked. The link is a single bidirectional parent_player_links row, so the
-- data is stored both ways; the problem is retrieval. The parent-side client
-- query embeds player_profiles, whose restrictive/permissive RLS can hide the
-- child row (and thus the whole result) from the parent account, whereas the
-- child-side query embeds parent_profiles (public read) and works.
--
-- Mirror the working get_player_private_parent_contacts pattern with a
-- SECURITY DEFINER RPC that returns a parent's linked children authoritatively,
-- immune to player_profiles RLS. Only the parent themselves (or an admin) may
-- read their linked children.

-- The live database may already hold a later revision of this function with a
-- different return row type; create or replace cannot change return types, so
-- drop first. (A newer revision further down in this file re-creates the final
-- version and re-grants execute either way.)
drop function if exists public.get_parent_linked_children(uuid);

create or replace function public.get_parent_linked_children(_parent_user_id uuid)
returns table (
  link_id uuid,
  status text,
  relationship_to_player text,
  notes text,
  created_at timestamptz,
  approved_at timestamptz,
  player_profile_id uuid,
  player_user_id uuid,
  player_full_name text,
  player_username text,
  player_team text,
  player_team_name text,
  player_position text,
  player_age_birth_year text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    coalesce(ppl.relationship_to_player, par.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, par.parent_notes) as notes,
    ppl.created_at,
    ppl.approved_at,
    pl.id as player_profile_id,
    pl.user_id as player_user_id,
    coalesce(pl.full_name, prof.full_name) as player_full_name,
    prof.username as player_username,
    pl.team as player_team,
    prof.team_name as player_team_name,
    pl.position as player_position,
    prof.age_birth_year as player_age_birth_year
  from public.parent_player_links ppl
  join public.parent_profiles par on par.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pl.user_id
  where par.user_id = _parent_user_id
    and ppl.status <> 'removed'
    and (
      auth.uid() = _parent_user_id
      or public.is_footy_status_admin()
    )
  order by ppl.created_at desc;
$$;

grant execute on function public.get_parent_linked_children(uuid) to authenticated;

comment on function public.get_parent_linked_children(uuid) is
  'Authoritative list of a parent''s linked children (parent_player_links) with player details, immune to player_profiles RLS. Parent or admin only.';

-- #############################################################################
-- 20260708120000_allow_parent_links_for_all_player_ages
-- #############################################################################
-- Parent linking is available for every player account, regardless of age.
-- Age only controls display/notification behavior:
--   - ages 6-13: parent info appears near the top and notifications mirror to linked parents
--   - ages 14+: parent info appears in the contact section and notifications are not mirrored

alter table public.parent_player_links
  add column if not exists status text not null default 'pending',
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists denied_at timestamptz,
  add column if not exists relationship_to_player text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by_user_id uuid references auth.users(id) on delete set null;

alter table public.parent_player_links
  drop constraint if exists parent_player_links_status_check;

alter table public.parent_player_links
  add constraint parent_player_links_status_check
  check (status in ('pending', 'approved', 'denied', 'removed'));

create index if not exists parent_player_links_active_player_idx
  on public.parent_player_links(player_profile_id, status);

create or replace function public.player_age_from_birth_year(_birth_year text)
returns integer
language sql
stable
as $$
  select case
    when substring(coalesce(_birth_year, '') from '[12][0-9]{3}') is null then null
    else extract(year from current_date)::integer
      - substring(_birth_year from '[12][0-9]{3}')::integer
  end;
$$;

create or replace function public.player_is_parent_link_age(_player_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when pp.date_of_birth is not null then
          extract(year from age(current_date, pp.date_of_birth))::integer between 6 and 13
        else
          public.player_age_from_birth_year(p.age_birth_year) between 6 and 13
      end
      from public.player_profiles pp
      left join public.profiles p on p.user_id = pp.user_id
      where pp.id = _player_profile_id
      limit 1
    ),
    false
  );
$$;

create or replace function public.request_parent_player_link(
  _player_user_id uuid,
  _relationship text default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles;
  player_row public.player_profiles;
  active_link_count integer;
  link_id uuid;
begin
  select * into parent_row
  from public.parent_profiles
  where user_id = auth.uid();

  if parent_row.id is null then
    raise exception 'Only parent accounts can request parent-player links';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = _player_user_id;

  if player_row.id is null then
    raise exception 'Player profile not found';
  end if;

  if exists (
    select 1
    from public.parent_player_links ppl
    where ppl.parent_profile_id = parent_row.id
      and ppl.player_profile_id = player_row.id
      and ppl.status in ('pending', 'approved')
  ) then
    raise exception 'This parent connection already exists';
  end if;

  select count(*)
  into active_link_count
  from public.parent_player_links ppl
  where ppl.player_profile_id = player_row.id
    and ppl.status in ('pending', 'approved');

  if active_link_count >= 2 then
    raise exception 'This player already has two parent connection slots in use';
  end if;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    relationship_to_player,
    notes,
    removed_at,
    removed_by_user_id,
    denied_at,
    updated_at
  )
  values (
    parent_row.id,
    player_row.id,
    'pending',
    auth.uid(),
    nullif(trim(coalesce(_relationship, parent_row.relationship_to_player, '')), ''),
    nullif(trim(coalesce(_notes, '')), ''),
    null,
    null,
    null,
    now()
  )
  on conflict (parent_profile_id, player_profile_id) do update set
    status = 'pending',
    requested_by_user_id = auth.uid(),
    relationship_to_player = excluded.relationship_to_player,
    notes = excluded.notes,
    removed_at = null,
    removed_by_user_id = null,
    denied_at = null,
    updated_at = now()
  returning id into link_id;

  perform public.create_notification(
    player_row.user_id,
    auth.uid(),
    'parent_link_requested',
    'Parent connection request',
    coalesce(parent_row.full_name, 'A parent account') || ' requested to be linked as your parent or guardian.',
    'parent_player_link',
    link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', link_id, 'parent_user_id', parent_row.user_id),
    'parent_link_requested:' || link_id
  );

  return link_id;
end;
$$;

create or replace function public.review_parent_player_link(
  _link_id uuid,
  _approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  player_row public.player_profiles;
  parent_row public.parent_profiles;
  approved_count integer;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null or link_row.status <> 'pending' then
    raise exception 'Pending parent connection not found';
  end if;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  select * into parent_row
  from public.parent_profiles
  where id = link_row.parent_profile_id;

  if player_row.user_id <> auth.uid()
     and not public.is_footy_status_admin() then
    raise exception 'Only the player or Footy Status admin can review a pending request';
  end if;

  if _approve then
    select count(*) into approved_count
    from public.parent_player_links
    where player_profile_id = player_row.id
      and status = 'approved'
      and id <> _link_id;

    if approved_count >= 2 then
      raise exception 'This player already has two approved parent accounts';
    end if;
  end if;

  update public.parent_player_links
  set status = case when _approve then 'approved' else 'denied' end,
      approved_by_user_id = case when _approve then auth.uid() else null end,
      approved_at = case when _approve then now() else null end,
      denied_at = case when _approve then null else now() end,
      updated_at = now()
  where id = _link_id;

  perform public.create_notification(
    parent_row.user_id,
    player_row.user_id,
    case when _approve then 'parent_link_approved' else 'parent_link_denied' end,
    case when _approve then 'Parent connection approved' else 'Parent connection declined' end,
    case
      when _approve then coalesce(player_row.full_name, 'The player') || ' approved your parent connection.'
      else coalesce(player_row.full_name, 'The player') || ' declined your parent connection request.'
    end,
    'parent_player_link',
    _link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', _link_id, 'player_profile_id', player_row.id),
    'parent_link_reviewed:' || _link_id || ':' || case when _approve then 'approved' else 'denied' end
  );
end;
$$;

create or replace function public.fan_out_child_notification_to_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_link record;
  child_profile public.player_profiles;
begin
  if coalesce((new.metadata ->> 'parent_copy')::boolean, false) then
    return new;
  end if;

  select * into child_profile
  from public.player_profiles
  where user_id = new.user_id;

  if child_profile.id is null
     or not public.player_is_parent_link_age(child_profile.id) then
    return new;
  end if;

  for parent_link in
    select ppl.id as link_id, pp.user_id as parent_user_id
    from public.parent_player_links ppl
    join public.parent_profiles pp on pp.id = ppl.parent_profile_id
    where ppl.player_profile_id = child_profile.id
      and ppl.status = 'approved'
  loop
    perform public.create_notification(
      parent_link.parent_user_id,
      new.actor_user_id,
      'child_' || new.type,
      new.title,
      replace(
        replace(new.body, ' your ', ' your child''s '),
        'You ',
        'Your child '
      ),
      new.entity_type,
      new.entity_id,
      new.team_id,
      new.club_team_id,
      new.clip_id,
      coalesce(new.link_path, '/player/' || child_profile.id),
      coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_copy', true,
          'child_user_id', child_profile.user_id,
          'child_player_profile_id', child_profile.id,
          'source_notification_id', new.id,
          'parent_link_id', parent_link.link_id
        ),
      'parent_copy:' || new.id || ':' || parent_link.parent_user_id,
      child_profile.user_id
    );
  end loop;

  return new;
end;
$$;

grant execute on function public.player_age_from_birth_year(text) to authenticated;
grant execute on function public.player_is_parent_link_age(uuid) to authenticated;
grant execute on function public.request_parent_player_link(uuid, text, text) to authenticated;
grant execute on function public.review_parent_player_link(uuid, boolean) to authenticated;

-- #############################################################################
-- 20260708130000_parent_child_mutual_profile_tiles
-- #############################################################################
-- Make parent <-> child linking fully mutual as interactive profile tiles.
--
-- Both directions of the relationship should render a rich profile tile (photo,
-- name, username, account type) that opens the linked account, and stay in sync
-- with each account's live public profile.
--
--  1) Parent side: get_parent_linked_children now also returns the child's live
--     avatar so the "Linked Children" tiles can show the child's profile picture
--     (name / username / age / team were already available).
--
--  2) Player side: a single authoritative RPC returns the player's linked parent
--     accounts as identity tiles (name / username / avatar / account type) plus
--     the parent's contact details. Identity + contact are both gated by
--     public.user_can_view_parent_contacts (the player themselves, an admin, a
--     linked approved parent, or the player's team staff / coaches). The player
--     and admins additionally see still-pending requests so they can approve or
--     deny them from the tile.

-- 1) Add the child's live avatar to the parent-side RPC. -----------------------
-- The function already exists (20260707160000) with a narrower RETURNS TABLE.
-- Postgres cannot change an existing function's return type via CREATE OR
-- REPLACE, so drop it first before recreating with the extra avatar column.
drop function if exists public.get_parent_linked_children(uuid);

create or replace function public.get_parent_linked_children(_parent_user_id uuid)
returns table (
  link_id uuid,
  status text,
  relationship_to_player text,
  notes text,
  created_at timestamptz,
  approved_at timestamptz,
  player_profile_id uuid,
  player_user_id uuid,
  player_full_name text,
  player_username text,
  player_avatar_url text,
  player_team text,
  player_team_name text,
  player_position text,
  player_age_birth_year text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    coalesce(ppl.relationship_to_player, par.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, par.parent_notes) as notes,
    ppl.created_at,
    ppl.approved_at,
    pl.id as player_profile_id,
    pl.user_id as player_user_id,
    coalesce(pl.full_name, prof.full_name) as player_full_name,
    prof.username as player_username,
    coalesce(prof.avatar_url, pl.profile_image_url) as player_avatar_url,
    pl.team as player_team,
    prof.team_name as player_team_name,
    pl.position as player_position,
    prof.age_birth_year as player_age_birth_year
  from public.parent_player_links ppl
  join public.parent_profiles par on par.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pl.user_id
  where par.user_id = _parent_user_id
    and ppl.status <> 'removed'
    and (
      auth.uid() = _parent_user_id
      or public.is_footy_status_admin()
    )
  order by ppl.created_at desc;
$$;

grant execute on function public.get_parent_linked_children(uuid) to authenticated;

comment on function public.get_parent_linked_children(uuid) is
  'Authoritative list of a parent''s linked children (parent_player_links) with the child''s live profile details incl. avatar, immune to player_profiles RLS. Parent or admin only.';

-- 2) Player side: linked parents as identity tiles + gated contact details. ----
-- Return-type changes cannot go through create or replace — drop first so this
-- file stays runnable against any prior database state (execute is re-granted
-- below).
drop function if exists public.get_player_linked_parents(uuid);

create or replace function public.get_player_linked_parents(_player_user_id uuid)
returns table (
  link_id uuid,
  status text,
  parent_user_id uuid,
  parent_full_name text,
  parent_username text,
  parent_avatar_url text,
  relationship_to_player text,
  notes text,
  contact_email text,
  contact_phone text,
  emergency_contact text,
  can_review boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    pp.user_id as parent_user_id,
    coalesce(pp.full_name, prof.full_name) as parent_full_name,
    prof.username as parent_username,
    prof.avatar_url as parent_avatar_url,
    coalesce(ppl.relationship_to_player, pp.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, pp.parent_notes) as notes,
    pp.contact_email,
    pp.contact_phone,
    pp.emergency_contact,
    ((auth.uid() = _player_user_id or public.is_footy_status_admin())
      and ppl.status = 'pending') as can_review
  from public.parent_player_links ppl
  join public.parent_profiles pp on pp.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pp.user_id
  where pl.user_id = _player_user_id
    and public.user_can_view_parent_contacts(_player_user_id)
    and (
      ppl.status = 'approved'
      or (
        (auth.uid() = _player_user_id or public.is_footy_status_admin())
        and ppl.status = 'pending'
      )
    )
  order by
    case ppl.status when 'pending' then 0 else 1 end,
    ppl.created_at desc;
$$;

grant execute on function public.get_player_linked_parents(uuid) to authenticated;

comment on function public.get_player_linked_parents(uuid) is
  'Authoritative list of a player''s linked parent accounts as identity tiles (name / username / avatar) plus contact details. Gated by user_can_view_parent_contacts; the player and admins also see pending requests to review.';

-- #############################################################################
-- 20260709120000_referee_decline_requires_reason
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
-- 20260709130000_lock_approved_clip_video_file
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
-- 20260709140000_next_up_clip_three_way_moderation
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
-- 20260709150000_pro_extend_clip
-- #############################################################################
-- Free -> Pro clip length expansion.
--
-- A Free player's approved clip is capped at 25s. After upgrading to Pro they
-- may extend the SAME approved clip up to the Pro cap (45s) using the SAME
-- original video they first uploaded — never a different file. Because the app
-- only stores the trimmed segment (not the full recording), the player re-picks
-- their original file; the app fingerprints it against what was first uploaded
-- and re-trims a longer section. This is the ONE controlled path allowed to
-- replace an approved clip's video, and only via extend_pro_clip().

-- 1) Fingerprint of the original recording captured at first upload.
alter table public.clips
  add column if not exists original_file_name text,
  add column if not exists original_file_size bigint,
  add column if not exists original_duration_seconds numeric;

-- 2) Approved clips keep their video locked EXCEPT when extend_pro_clip sets a
--    transaction-local flag. This recreates the lock trigger with that bypass.
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

  -- Approved clips: the reviewed video is permanent for normal edits (caption,
  -- title, display). The only exception is the Pro length-extension path, which
  -- sets app.allow_clip_video_replace = 'on' for its own transaction.
  if old.review_status = 'approved'
     and coalesce(current_setting('app.allow_clip_video_replace', true), '') <> 'on' then
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

-- 3) The controlled extension path. Verifies ownership + active Pro + the Pro
--    length cap, then swaps in the re-trimmed longer segment of the SAME
--    original video (the frontend fingerprint-checks the re-picked file first).
create or replace function public.extend_pro_clip(
  _clip_id uuid,
  _video_url text,
  _duration numeric,
  _trim_start numeric,
  _trim_end numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_is_pro boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_clip from public.clips where id = _clip_id;
  if v_clip.id is null then
    raise exception 'Clip not found.';
  end if;
  if v_clip.user_id <> auth.uid() then
    raise exception 'You can only extend your own clip.';
  end if;
  if v_clip.review_status <> 'approved' then
    raise exception 'Only approved clips can be extended.';
  end if;

  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.is_pro = true
        or p.account_tier = 'pro_lifetime'
        or (p.account_tier = 'pro_annual' and (p.pro_expires_at is null or p.pro_expires_at > now()))
      )
  ) into v_is_pro;

  if not v_is_pro then
    raise exception 'Extending a clip length requires an active Footy Status Pro account.';
  end if;

  if nullif(trim(coalesce(_video_url, '')), '') is null then
    raise exception 'Missing the extended video.';
  end if;
  if _duration is null or _duration <= 0 or _duration > 45 then
    raise exception 'Pro clips can be up to 45 seconds.';
  end if;

  -- Allow this transaction's update to replace the approved video.
  perform set_config('app.allow_clip_video_replace', 'on', true);

  update public.clips
  set video_url = _video_url,
      duration = _duration,
      trim_start_seconds = coalesce(_trim_start, 0),
      trim_end_seconds = coalesce(_trim_end, _duration)
  where id = _clip_id;
end;
$$;

revoke all on function public.extend_pro_clip(uuid, text, numeric, numeric, numeric) from public;
grant execute on function public.extend_pro_clip(uuid, text, numeric, numeric, numeric) to authenticated;

-- #############################################################################
-- 20260716130000_team_profile_kit_colors_sync_to_teams
-- #############################################################################
-- Keep the teams-table copy of the kit colors and home field in lockstep with
-- the canonical team_profiles row. team_profiles is what the club's own editor
-- and the Footy Status admin editor both write, while several surfaces
-- (TeamProfile fallback, match creation defaults) still read
-- teams.*_jersey_color / third_kit_color / stadium. Without this sync, an
-- admin edit or an intentional clear on team_profiles left a stale value
-- behind on teams.
--
-- Mirrors the existing sync_team_profile_name_to_profile trigger pattern.

create or replace function public.sync_team_profile_kit_to_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null then
    update public.teams
    set home_jersey_color = new.home_jersey_color,
        away_jersey_color = new.away_jersey_color,
        third_kit_color = new.third_kit_color,
        stadium = new.home_stadium,
        updated_at = now()
    where id = new.team_id
      and (
        coalesce(home_jersey_color, '') is distinct from coalesce(new.home_jersey_color, '')
        or coalesce(away_jersey_color, '') is distinct from coalesce(new.away_jersey_color, '')
        or coalesce(third_kit_color, '') is distinct from coalesce(new.third_kit_color, '')
        or coalesce(stadium, '') is distinct from coalesce(new.home_stadium, '')
      );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_team_profile_kit_to_team_trigger on public.team_profiles;
create trigger sync_team_profile_kit_to_team_trigger
after insert or update of home_jersey_color, away_jersey_color, third_kit_color, home_stadium, team_id on public.team_profiles
for each row
execute function public.sync_team_profile_kit_to_team();

-- ############################################################################
-- 20260720190000_fix_auth_user_deletion_restrict_and_resilient_cleanup
-- ############################################################################
-- =============================================================================
-- Fix "Database error deleting user" — safe, resilient account deletion
-- =============================================================================
-- SYMPTOM
--   Deleting a user from the Supabase Auth dashboard (or any raw
--   `delete from auth.users`) fails with: "Database error deleting user".
--
-- EXACT CAUSE (two independent blockers, both fixed below)
--   1) Foreign keys that reference auth.users(id) with ON DELETE RESTRICT.
--      The only RESTRICT FKs to auth.users in this schema are the moderation
--      audit columns:
--        - public.account_strikes.admin_user_id        (NOT NULL, RESTRICT)
--        - public.temporary_bans.admin_user_id         (NOT NULL, RESTRICT)
--        - public.content_report_actions.admin_user_id (NOT NULL, RESTRICT)
--      If the account being deleted ever issued a strike / ban / report action,
--      one of these RESTRICT rows still points at it, so Postgres refuses to
--      delete the auth.users row. (The 4th RESTRICT FK — protected_accounts.
--      user_id — is the INTENTIONAL Official-Admin protection and is left as-is.)
--   2) The BEFORE DELETE cleanup trigger on auth.users
--      (footy_status_cleanup_app_data_before_auth_user_delete) calls
--      public.delete_account_app_data(old.id) with NO exception handling. If
--      that function raises for ANY reason (a table added later that it does not
--      clean, an unexpected constraint, etc.), the whole auth.users delete
--      aborts — surfaced only as the generic GoTrue "Database error deleting
--      user".
--
-- FIX
--   A) Repoint the three moderation admin_user_id FKs to ON DELETE SET NULL and
--      make the column nullable. A strike / ban / report action is an audit
--      record ABOUT THE SUBJECT user; it must SURVIVE the deletion of the admin
--      who issued it, with the issuing admin simply detached. This both unblocks
--      deletion and preserves moderation history (per the "shared/related record"
--      rule — do not delete the record just because one linked user is removed).
--      The subject columns (account_id) keep ON DELETE CASCADE, so a user's own
--      strikes/bans go away with them.
--   B) Replace the cleanup trigger function with a resilient version: run the
--      existing app-data cleanup best-effort (swallowing any error), then run a
--      dynamic, catalog-driven sweep that clears EVERY remaining single-column
--      FK that references auth.users(id) for the user being deleted — deleting
--      the row when the column is NOT NULL, or setting it NULL when nullable
--      (so shared rows like a match are detached, never destroyed). Each table
--      is isolated so one failure can't block the rest. This makes deletion
--      resilient to any current OR future table.
--
-- WHAT IS PRESERVED
--   * Official-Admin protection: the separate protect_official_admin_auth_delete
--     BEFORE DELETE trigger still raises for the protected account. It fires
--     after this cleanup (alphabetical order: "footy_..." < "protect_..."), and
--     because everything runs in one transaction, its RAISE rolls back the whole
--     delete — the protected account keeps every row. protected_accounts is also
--     explicitly skipped by the sweep.
--   * All existing RLS, tables, and non-deletion behavior are untouched.
--
-- SAFETY
--   Idempotent (safe to run repeatedly). Deletes NO current users. Drops NO
--   tables. Does not disable FK checks or RLS. Only alters the 3 named FKs and
--   the cleanup trigger function.
--
-- ---------------------------------------------------------------------------
-- DIAGNOSTIC SQL (read-only — run any of these first to confirm state; they
-- change nothing). Left as comments so this migration stays non-interactive.
-- ---------------------------------------------------------------------------
-- -- (a) All FKs that reference auth.users(id) and their ON DELETE rule:
-- select con.conname, rel.relname as table_name, att.attname as column_name,
--        case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
--             when 'c' then 'CASCADE' when 'n' then 'SET NULL'
--             when 'd' then 'SET DEFAULT' end as on_delete
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
--  where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
--  order by on_delete desc, table_name;
-- -- (b) Just the blocking ones (RESTRICT / NO ACTION):
-- --     same query, add:  and con.confdeltype in ('r','a')
-- -- (c) BEFORE/AFTER DELETE triggers on auth.users:
-- select tgname, tgenabled, pg_get_triggerdef(oid)
--   from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- -- (d) Orphaned profiles (profiles with no matching auth.users row):
-- select p.user_id from public.profiles p
--   left join auth.users u on u.id = p.user_id where u.id is null;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Repoint the three moderation admin_user_id FKs -> ON DELETE SET NULL.
--    Discovers the EXACT existing constraint name from the catalog (never
--    assumes it), so a non-standard name is handled. Skips a table/column that
--    does not exist, and does nothing if the FK is already SET NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array['account_strikes', 'temporary_bans', 'content_report_actions'];
  v_table  text;
  v_conname text;
  v_deltype "char";
begin
  foreach v_table in array v_tables loop
    -- Skip if the table or the admin_user_id column is not present.
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'admin_user_id'
    ) then
      continue;
    end if;

    -- Find the FK on (v_table.admin_user_id) that references auth.users.
    select con.conname, con.confdeltype
      into v_conname, v_deltype
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and ns.nspname = 'public'
      and rel.relname = v_table
      and att.attname = 'admin_user_id'
      and array_length(con.conkey, 1) = 1
    limit 1;

    -- Make the column nullable so SET NULL is legal (idempotent).
    execute format('alter table public.%I alter column admin_user_id drop not null', v_table);

    -- Only rebuild the FK when it is not already SET NULL ('n').
    if v_conname is not null and v_deltype is distinct from 'n' then
      execute format('alter table public.%I drop constraint %I', v_table, v_conname);
    end if;

    if not exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
        and ns.nspname = 'public'
        and rel.relname = v_table
        and att.attname = 'admin_user_id'
        and con.confdeltype = 'n'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (admin_user_id) references auth.users(id) on delete set null',
        v_table, v_table || '_admin_user_id_fkey'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- B. Resilient cleanup: dynamic catalog-driven sweep of every direct
--    auth.users reference for the user being deleted.
-- ---------------------------------------------------------------------------
create or replace function public.footy_purge_direct_auth_user_refs(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  r record;
begin
  if _user_id is null then
    return;
  end if;

  for r in
    select
      ns.nspname     as schema_name,
      rel.relname    as table_name,
      att.attname    as column_name,
      att.attnotnull as not_null
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace ns  on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid
                          and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1        -- single-column FKs only
      and rel.relkind = 'r'                       -- ordinary tables
      and ns.nspname in ('public', 'storage')     -- never touch the auth schema
      -- Keep the Official-Admin protection FK intact (on delete restrict).
      and not (ns.nspname = 'public' and rel.relname = 'protected_accounts')
  loop
    begin
      if r.not_null then
        execute format('delete from %I.%I where %I = $1', r.schema_name, r.table_name, r.column_name)
        using _user_id;
      else
        execute format('update %I.%I set %I = null where %I = $1', r.schema_name, r.table_name, r.column_name, r.column_name)
        using _user_id;
      end if;
    exception when others then
      -- Never let a single table block the whole deletion.
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.footy_purge_direct_auth_user_refs(uuid) from public;
grant execute on function public.footy_purge_direct_auth_user_refs(uuid) to authenticated;

-- Replace the fragile cleanup trigger function. Best-effort call to the
-- existing app-data cleanup (only if it exists, and swallowing any error),
-- then the guaranteed sweep. Never references the protection functions, so it
-- is fully self-contained; the separate protect_official_admin_auth_delete
-- trigger still hard-blocks (and rolls back) deletion of the protected admin.
create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.delete_account_app_data(uuid, uuid, text)') is not null then
    begin
      perform public.delete_account_app_data(old.id, null, 'auth_user_deleted_cleanup');
    exception when others then
      -- A missing/edge table must not make the account undeletable; the sweep
      -- below plus foreign-key cascades still remove or detach the user's data.
      null;
    end;
  end if;

  perform public.footy_purge_direct_auth_user_refs(old.id);

  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

-- =============================================================================
-- ROLLBACK (only if ever needed — not recommended; RESTRICT re-introduces the
-- deletion bug). Run manually:
--   alter table public.account_strikes        drop constraint account_strikes_admin_user_id_fkey;
--   alter table public.account_strikes        add  constraint account_strikes_admin_user_id_fkey
--     foreign key (admin_user_id) references auth.users(id) on delete restrict;
--   -- (repeat for temporary_bans, content_report_actions)
--   -- Restore the previous cleanup body from
--   -- 20260713230000_complete_account_deletion_all_types.sql if desired.
-- =============================================================================

-- ############################################################################
-- 20260720200000_real_pro_purchase_verification
-- ############################################################################
-- =============================================================================
-- Real Footy Status Pro purchases — remove the free-Pro bypass, add verified
-- store-purchase granting, and lock subscription columns server-side.
-- =============================================================================
-- WHAT THIS FIXES
--   * Removes public.upgrade_to_pro(uuid, text): a self-serve RPC that granted
--     Pro with NO payment (the server side of the "free Pro" bypass).
--   * Closes the direct-write hole: profiles RLS lets a player update their own
--     row, so a player could set account_tier/is_pro themselves. A new guard
--     trigger rejects ANY unauthorized escalation of the subscription columns;
--     only the verified-purchase RPC and the admin tool (which set an in-txn
--     authorization flag) may raise a tier. De-escalation to Free is always
--     allowed (expiry downgrades, the player-only backstop, admin).
--   * Adds monthly/yearly to the account_tier CHECK (annual/lifetime kept for
--     existing members; never sold by the new flow).
--   * Adds the subscription metadata the backend must own (platform, dates,
--     transaction ids, renewal + verification status).
--   * Adds public.apply_verified_pro_purchase(...): the ONLY grant path. It is
--     callable only by the service_role (used by the verify-pro-purchase Edge
--     Function AFTER it verifies the receipt with Apple/Google). Player-only,
--     idempotent by original transaction id, never downgrades a longer entitlement.
--
-- Safe to run repeatedly (idempotent). Grants Pro to nobody by itself.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove the free-Pro bypass RPC entirely.
-- ---------------------------------------------------------------------------
drop function if exists public.upgrade_to_pro(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. Extend the account_tier CHECK to include the new monthly/yearly tiers.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_account_tier_check;
alter table public.profiles
  add constraint profiles_account_tier_check
  check (account_tier in ('free', 'pro_monthly', 'pro_yearly', 'pro_annual', 'pro_lifetime'))
  not valid;
alter table public.profiles validate constraint profiles_account_tier_check;

-- ---------------------------------------------------------------------------
-- 3. Subscription metadata owned by the backend (single source of truth).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists pro_platform text,                 -- 'apple' | 'google'
  add column if not exists pro_purchase_date timestamptz,
  add column if not exists pro_renewal_status text,           -- 'auto_renew_on' | 'auto_renew_off' | 'cancelled' | 'expired'
  add column if not exists pro_original_transaction_id text,
  add column if not exists pro_current_transaction_id text,
  add column if not exists pro_verification_status text;       -- 'verified' | 'failed' | 'pending'

create unique index if not exists idx_profiles_pro_original_txn
  on public.profiles(pro_original_transaction_id)
  where pro_original_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Guard trigger: block unauthorized escalation of the subscription columns.
--    Only pathways that set app.pro_change_authorized = 'on' (the grant RPC and
--    the admin tool below) may raise a tier / extend expiry. Everything else —
--    a direct client update, a stray patch — has its subscription fields
--    reverted to the stored values. Losing Pro (-> free) is always permitted.
-- ---------------------------------------------------------------------------
create or replace function public.tg_guard_subscription_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorized boolean := coalesce(current_setting('app.pro_change_authorized', true), '') = 'on';
  v_escalates boolean;
begin
  if v_authorized then
    return new;  -- verified purchase / admin action
  end if;

  v_escalates :=
       (coalesce(new.is_pro, false) is true and coalesce(old.is_pro, false) is not true)
    or (new.account_tier is distinct from old.account_tier and coalesce(new.account_tier, 'free') <> 'free')
    or (
         new.pro_expires_at is distinct from old.pro_expires_at
         and new.pro_expires_at is not null
         and (old.pro_expires_at is null or new.pro_expires_at > old.pro_expires_at)
       );

  if v_escalates then
    -- Keep the stored subscription state; ignore the attempted upgrade.
    new.account_tier              := old.account_tier;
    new.is_pro                    := old.is_pro;
    new.pro_expires_at            := old.pro_expires_at;
    new.pro_started_at            := old.pro_started_at;
    new.pro_platform              := old.pro_platform;
    new.pro_purchase_date         := old.pro_purchase_date;
    new.pro_renewal_status        := old.pro_renewal_status;
    new.pro_original_transaction_id := old.pro_original_transaction_id;
    new.pro_current_transaction_id  := old.pro_current_transaction_id;
    new.pro_verification_status     := old.pro_verification_status;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_subscription_columns on public.profiles;
create trigger guard_subscription_columns
  before update on public.profiles
  for each row execute function public.tg_guard_subscription_columns();

-- ---------------------------------------------------------------------------
-- 5. The ONLY grant path: apply a verified store purchase. Called by the
--    verify-pro-purchase Edge Function with the service_role key, AFTER the
--    receipt has been verified with Apple / Google.
--      _plan: 'monthly' | 'yearly'
--    Player-only, idempotent by original transaction id, never shortens a
--    longer existing entitlement (so a stale restore can't downgrade).
-- ---------------------------------------------------------------------------
create or replace function public.apply_verified_pro_purchase(
  _user_id                  uuid,
  _plan                     text,
  _platform                 text,
  _expires_at               timestamptz,
  _original_transaction_id  text,
  _current_transaction_id   text default null,
  _renewal_status           text default 'auto_renew_on'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_expires timestamptz;
  v_existing_expires timestamptz;
begin
  if _user_id is null then
    raise exception 'A target account is required.';
  end if;

  -- Player-only product — refuse every other account type.
  if not public.account_is_pro_eligible(_user_id) then
    raise exception 'Footy Status Pro is only available for player accounts.';
  end if;

  v_tier := case _plan
    when 'monthly' then 'pro_monthly'
    when 'yearly'  then 'pro_yearly'
    else null
  end;
  if v_tier is null then
    raise exception 'Unknown Pro plan: %', _plan;
  end if;

  if _plan in ('monthly', 'yearly') and _expires_at is null then
    raise exception 'A subscription expiry is required for the % plan.', _plan;
  end if;

  -- Never shorten an existing, longer entitlement (idempotent restore safety).
  select pro_expires_at into v_existing_expires
  from public.profiles where user_id = _user_id;
  v_expires := greatest(_expires_at, coalesce(v_existing_expires, _expires_at));

  -- Authorize the subscription-column change for this transaction only.
  perform set_config('app.pro_change_authorized', 'on', true);

  update public.profiles
  set account_tier                = v_tier,
      is_pro                      = true,
      pro_started_at              = coalesce(pro_started_at, now()),
      pro_expires_at              = v_expires,
      pro_platform                = _platform,
      pro_purchase_date           = now(),
      pro_renewal_status          = coalesce(_renewal_status, 'auto_renew_on'),
      pro_original_transaction_id = coalesce(_original_transaction_id, pro_original_transaction_id),
      pro_current_transaction_id  = coalesce(_current_transaction_id, _original_transaction_id, pro_current_transaction_id),
      pro_verification_status     = 'verified',
      updated_at                  = now()
  where user_id = _user_id;

  -- Bring back any clips that were hidden while on Free, if the helper exists.
  if to_regprocedure('public.restore_pro_clips(uuid)') is not null then
    begin
      perform public.restore_pro_clips(_user_id);
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', _user_id,
    'tier', v_tier,
    'expires_at', v_expires
  );
end;
$$;

-- The grant path is service-role only — never reachable from the client.
revoke all on function public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Expiry sweep -> Free. Any time-limited tier past its expiry returns to
--    Free (lifetime excluded). Sets the authorization flag so the guard allows
--    the (de-escalating) write. Intended to be run on a schedule.
-- ---------------------------------------------------------------------------
create or replace function public.expire_lapsed_pro_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  perform set_config('app.pro_change_authorized', 'on', true);

  with lapsed as (
    update public.profiles
    set account_tier = 'free',
        is_pro = false,
        pro_renewal_status = 'expired',
        pro_verification_status = 'expired',
        updated_at = now()
    where account_tier in ('pro_monthly', 'pro_yearly', 'pro_annual')
      and pro_expires_at is not null
      and pro_expires_at < now()
    returning 1
  )
  select count(*) into v_count from lapsed;

  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_pro_accounts() from public, anon, authenticated;
grant execute on function public.expire_lapsed_pro_accounts() to service_role;

-- =============================================================================
-- ROLLBACK (manual, if ever needed):
--   drop trigger if exists guard_subscription_columns on public.profiles;
--   drop function if exists public.tg_guard_subscription_columns();
--   drop function if exists public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text);
--   drop function if exists public.expire_lapsed_pro_accounts();
--   -- (Recreating upgrade_to_pro would restore the free-Pro bypass — do not.)
-- =============================================================================


-- ############################################################################
-- 20260722150000_next_up_launch_repeat_feed
-- ############################################################################
-- =============================================================================
-- Next Up feed: launch-window algorithm (real clips only, endless via repeats)
-- =============================================================================
-- Problem this fixes
-- ------------------
-- get_next_up_feed excluded every clip that already had a clip_feed_impressions
-- row, and that row is written the moment a clip is *recommended* (not watched).
-- With a small launch catalogue the eligible set drained to zero after one pass
-- and the RPC returned no rows forever, so every viewer got stuck on the
-- "No New Next Up Clips" empty state even though approved clips existed.
--
-- New behaviour
-- -------------
-- Viewing history is now recorded WITHOUT removing a clip from eligibility.
-- The feed runs in "rounds": within a round every eligible clip is served once,
-- and when the round is exhausted a new round starts and the same real clips
-- are served again in a fresh, shuffled rotation. No duplicate clip rows are
-- created and no mock/placeholder content is ever introduced.
--
-- Ranking inside a round:
--   tier 0  never served to this viewer  (includes newly approved clips)
--   tier 1  served before but never watched
--   tier 2  already watched -> the repeat rotation
-- tiers 0/1 order newest-approved first; tier 2 is a weighted shuffle that
-- differs every round. Within each tier clips are round-robined by owner so one
-- clip or one player never appears back-to-back while other clips exist.
--
-- Gender/visibility rules are unchanged and are re-applied on every single row
-- returned (see the final SELECT), including when clips repeat.
-- =============================================================================


-- 1) Viewing history: keep it, but stop using it as an exclusion list. ---------

alter table public.clip_feed_impressions
  add column if not exists last_served_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists serve_count integer not null default 0,
  add column if not exists view_count integer not null default 0;

update public.clip_feed_impressions
set last_served_at = coalesce(last_served_at, viewed_at, recommended_at),
    last_viewed_at = coalesce(last_viewed_at, viewed_at),
    serve_count = greatest(serve_count, 1),
    view_count = case
      when view_count > 0 then view_count
      when viewed_at is not null then 1
      else 0
    end
where last_served_at is null
   or (viewed_at is not null and last_viewed_at is null);

create index if not exists idx_clip_feed_impressions_user_served
  on public.clip_feed_impressions(user_id, last_served_at);


-- 2) Per-viewer round state. --------------------------------------------------

create table if not exists public.next_up_feed_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  round_started_at timestamptz not null default now(),
  round_number integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.next_up_feed_state enable row level security;

drop policy if exists "Users view own next up feed state" on public.next_up_feed_state;
create policy "Users view own next up feed state"
on public.next_up_feed_state for select to authenticated
using (auth.uid() = user_id);

-- Only the SECURITY DEFINER feed functions write this table.
revoke all on public.next_up_feed_state from anon, authenticated;
grant select on public.next_up_feed_state to authenticated;


-- 3) Eligibility, in one place. -----------------------------------------------
-- Every rule a clip must satisfy to be shown to _viewer_user_id. Used by the
-- feed for both the "remaining this round" check and the actual page, so the
-- two can never drift apart.
--
-- NOT granted to client roles: it is called only from inside the SECURITY
-- DEFINER feed function, which already scopes _viewer_user_id to auth.uid().

create or replace function public.next_up_eligible_clips(
  _viewer_user_id uuid,
  _gender_preference text default null
)
returns table (
  clip_id uuid,
  owner_user_id uuid,
  approved_at timestamptz,
  exposure_weight numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(c.user_id, pp.user_id),
    coalesce(c.reviewed_at, c.created_at),
    (
      1.0 + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
    ) * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end
  from public.clips c
  -- Resolve exactly one player profile per clip, preferring the direct
  -- player_id link, so the gender filter can never latch onto the wrong row.
  join lateral (
    select pp_any.*
    from public.player_profiles pp_any
    where (c.player_id is not null and pp_any.id = c.player_id)
       or (c.user_id is not null and pp_any.user_id = c.user_id)
    order by case when pp_any.id = c.player_id then 0 else 1 end, pp_any.id
    limit 1
  ) pp on true
  join public.profiles owner_profile
    on owner_profile.user_id = coalesce(c.user_id, pp.user_id)
  left join public.clip_exposure_state es on es.clip_id = c.id
  where
    -- Approved, real, still-published content only.
    c.review_status = 'approved'
    and c.visibility in ('public', 'restricted')
    and nullif(trim(coalesce(c.video_url, '')), '') is not null
    -- Restricted clips stay staff-only.
    and (
      c.visibility = 'public'
      or public.is_staff_member(_viewer_user_id)
      or exists (
        select 1
        from public.profiles vp
        where vp.user_id = _viewer_user_id
          and coalesce(vp.account_role, vp.account_type, vp.role::text) in (
            'team_club', 'head_coach_assistant', 'coach', 'scout', 'trainer',
            'academy_director', 'team_staff', 'school_team'
          )
      )
    )
    -- Active, non-deleted owner account.
    and coalesce(owner_profile.is_active, true)
    and owner_profile.deleted_at is null
    -- Never show the viewer their own clips in the discovery feed.
    and coalesce(c.user_id, pp.user_id) is distinct from _viewer_user_id
    -- Gender separation + every other account visibility rule.
    and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
    -- Optional scouting-only boys/girls narrowing.
    and (_gender_preference is null or pp.player_gender = _gender_preference)
$$;

revoke all on function public.next_up_eligible_clips(uuid, text) from public;
revoke all on function public.next_up_eligible_clips(uuid, text) from anon, authenticated;


-- 4) The feed. ----------------------------------------------------------------

drop function if exists public.get_next_up_feed(integer, text);
drop function if exists public.get_next_up_feed(integer);

create or replace function public.get_next_up_feed(
  _limit integer default 12,
  _gender_preference text default null,
  _restart boolean default false
)
returns setof public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(_limit, 12), 30));
  v_viewer_role text;
  v_effective_gender text := null;
  v_round_started_at timestamptz;
  v_has_remaining boolean := false;
  v_has_any boolean := false;
begin
  if v_user_id is null then
    raise exception 'Log in or sign up to watch Next Up Clips.';
  end if;

  -- The boys/girls selector is a scouting convenience for accounts that are
  -- already permitted to see both. Player accounts never reach this branch, so
  -- they can never widen their own access with it.
  select coalesce(p.account_role, p.account_type, p.role::text)
  into v_viewer_role
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if v_viewer_role in (
    'scout', 'team_staff', 'head_coach_assistant', 'coach', 'trainer',
    'academy_director', 'team_club', 'school_team'
  ) then
    v_effective_gender := case
      when lower(coalesce(_gender_preference, 'both')) in ('boy', 'boys', 'male') then 'boy'
      when lower(coalesce(_gender_preference, 'both')) in ('girl', 'girls', 'female') then 'girl'
      else null
    end;
  end if;

  insert into public.next_up_feed_state (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select s.round_started_at into v_round_started_at
  from public.next_up_feed_state s
  where s.user_id = v_user_id;

  -- Pull-to-refresh / first load: start a fresh round so the newest approved
  -- clips are at the top again instead of resuming mid-rotation.
  if coalesce(_restart, false) then
    v_round_started_at := now();
    update public.next_up_feed_state
    set round_started_at = v_round_started_at,
        round_number = round_number + 1,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  -- Existence probes rather than counts: these stop at the first matching row,
  -- so the feed never scans the whole clip catalogue to decide what to do.
  select exists (
    select 1
    from public.next_up_eligible_clips(v_user_id, v_effective_gender) e
    left join public.clip_feed_impressions fi
      on fi.user_id = v_user_id and fi.clip_id = e.clip_id
    where fi.clip_id is null
       or fi.last_served_at is null
       or fi.last_served_at < v_round_started_at
  )
  into v_has_remaining;

  if not v_has_remaining then
    select exists (
      select 1 from public.next_up_eligible_clips(v_user_id, v_effective_gender)
    )
    into v_has_any;

    -- Genuinely nothing this viewer is allowed to see -> real empty state.
    -- This is the ONLY path that returns zero rows.
    if not v_has_any then
      return;
    end if;

    -- Round exhausted: the viewer has watched everything available, so open a
    -- new round and replay the same real clips in a different order.
    v_round_started_at := now();
    update public.next_up_feed_state
    set round_started_at = v_round_started_at,
        round_number = round_number + 1,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  return query
  with candidates as (
    select
      e.clip_id,
      e.owner_user_id,
      e.approved_at,
      e.exposure_weight,
      case
        when fi.clip_id is null then 0        -- never served (new / newly approved)
        when fi.viewed_at is null then 1      -- served but not watched yet
        else 2                                -- watched -> repeat rotation
      end as tier
    from public.next_up_eligible_clips(v_user_id, v_effective_gender) e
    left join public.clip_feed_impressions fi
      on fi.user_id = v_user_id and fi.clip_id = e.clip_id
    where fi.clip_id is null
       or fi.last_served_at is null
       or fi.last_served_at < v_round_started_at
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by c.tier
        order by
          -- Unwatched: newest approved first.
          case when c.tier < 2 then c.approved_at end desc nulls last,
          -- Repeats: weighted shuffle, re-drawn every round.
          case
            when c.tier = 2
            then (-ln(greatest(random(), 0.000001)) / greatest(c.exposure_weight, 0.1))
          end asc nulls last,
          c.clip_id
      ) as tier_rank
    from candidates c
  ),
  spread as (
    -- Round-robin by owner so the same player never stacks back-to-back while
    -- another eligible player is available.
    select
      r.*,
      row_number() over (
        partition by r.tier, r.owner_user_id
        order by r.tier_rank
      ) as owner_round
    from ranked r
  ),
  page as (
    select
      s.clip_id,
      row_number() over (order by s.tier, s.owner_round, s.tier_rank) as feed_position
    from spread s
    order by s.tier, s.owner_round, s.tier_rank
    limit v_limit
  ),
  served as (
    insert into public.clip_feed_impressions (
      user_id, clip_id, recommended_at, last_served_at, serve_count
    )
    select v_user_id, p.clip_id, now(), now(), 1
    from page p
    on conflict (user_id, clip_id) do update
    set last_served_at = now(),
        serve_count = public.clip_feed_impressions.serve_count + 1
    returning clip_id
  )
  -- Final permission revalidation: every row handed back is re-checked against
  -- approval, publication state and the viewer's gender/visibility rules, so a
  -- repeated clip can never escape the restrictions a fresh clip obeys.
  select c.*
  from page p
  join served sv on sv.clip_id = p.clip_id
  join public.clips c on c.id = p.clip_id
  where c.review_status = 'approved'
    and c.visibility in ('public', 'restricted')
    and public.can_view_account_content(
      coalesce(
        c.user_id,
        (
          select pp.user_id
          from public.player_profiles pp
          where pp.id = c.player_id
          limit 1
        )
      )
    )
  order by p.feed_position;
end;
$$;

revoke all on function public.get_next_up_feed(integer, text, boolean) from public;
revoke execute on function public.get_next_up_feed(integer, text, boolean) from anon;
grant execute on function public.get_next_up_feed(integer, text, boolean) to authenticated;


-- 5) Watch history: record the view, never drop the clip from eligibility. -----

create or replace function public.mark_next_up_clip_viewed(_clip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.clip_feed_impressions (
    user_id, clip_id, viewed_at, last_viewed_at, last_served_at, serve_count, view_count
  )
  values (auth.uid(), _clip_id, now(), now(), now(), 1, 1)
  on conflict (user_id, clip_id) do update
  set viewed_at = coalesce(public.clip_feed_impressions.viewed_at, now()),
      last_viewed_at = now(),
      view_count = public.clip_feed_impressions.view_count + 1;
end;
$$;

grant execute on function public.mark_next_up_clip_viewed(uuid) to authenticated;


-- 6) Invalidate a viewer's round when their own access rules change. ----------
-- Eligibility is recomputed from scratch on every call, so a permission change
-- is enforced immediately. Restarting the round on top of that guarantees the
-- viewer's next page is rebuilt from the top rather than resuming a rotation
-- that was planned under the old permissions.

create or replace function public.reset_next_up_feed_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.next_up_feed_state
  where user_id = coalesce(new.user_id, old.user_id);
  return null;
end;
$$;

drop trigger if exists reset_next_up_feed_round_on_gender_change on public.player_profiles;
create trigger reset_next_up_feed_round_on_gender_change
after update of player_gender on public.player_profiles
for each row
when (new.player_gender is distinct from old.player_gender)
execute function public.reset_next_up_feed_round();

drop trigger if exists reset_next_up_feed_round_on_account_change on public.profiles;
create trigger reset_next_up_feed_round_on_account_change
after update on public.profiles
for each row
when (
  new.account_role is distinct from old.account_role
  or new.account_type is distinct from old.account_type
  or new.role is distinct from old.role
  or new.is_active is distinct from old.is_active
  or new.next_up_gender_preference is distinct from old.next_up_gender_preference
)
execute function public.reset_next_up_feed_round();

-- ############################################################################
-- 20260706110000_update_daughter_team_details
-- ############################################################################
-- Per-team daughter update RPC. This migration exists in the repo but was
-- never included in a deploy bundle, so the live database is missing the
-- function. That is why editing a daughter team from the Mother Team profile
-- fails with "Could not find the function public.update_daughter_team_details
-- ... in the schema cache" and the UI shows "Could not save team".
--
-- Each school/club daughter team (Varsity, Junior Varsity, Prep, Middle
-- School, ...) is managed as its own entity. This RPC updates exactly one
-- team and nothing else: not the school account, not any sibling team. Only
-- the owning school/club account or a Footy Status admin may call it.
-- club_teams is the single source of truth for daughter-team display fields
-- (daughter teams share the mother team's teams row), so updating this one
-- row propagates everywhere the daughter team is shown.

create or replace function public.update_daughter_team_details(
  _club_team_id uuid,
  _age_group text default null,
  _league_name text default null,
  _gender text default null,
  _season text default null,
  _level text default null,
  _coach_name text default null,
  _head_coach_user_id uuid default null,
  _school_level text default null
)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  team_row public.club_teams;
  club_row public.clubs;
  normalized_gender text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select * into team_row
  from public.club_teams
  where id = _club_team_id;

  if team_row.id is null then
    raise exception 'Team not found.';
  end if;

  select * into club_row
  from public.clubs
  where id = team_row.club_id;

  if not (club_row.owner_user_id = v_user_id or public.is_footy_status_admin()) then
    raise exception 'Only the school or club account can edit this team.';
  end if;

  normalized_gender := case lower(trim(coalesce(_gender, '')))
    when 'boy' then 'boy'
    when 'boys' then 'boy'
    when 'girl' then 'girl'
    when 'girls' then 'girl'
    else null
  end;

  update public.club_teams
  set age_group = coalesce(nullif(trim(_age_group), ''), age_group),
      league_name = coalesce(nullif(trim(_league_name), ''), league_name),
      gender = coalesce(normalized_gender, gender),
      season = nullif(trim(coalesce(_season, '')), ''),
      level = nullif(trim(coalesce(_level, '')), ''),
      coach_name = nullif(trim(coalesce(_coach_name, '')), ''),
      head_coach_user_id = _head_coach_user_id,
      school_level = coalesce(nullif(trim(_school_level), ''), school_level),
      updated_at = now()
  where id = _club_team_id
  returning * into team_row;

  return team_row;
end;
$$;

grant execute on function public.update_daughter_team_details(uuid, text, text, text, text, text, text, uuid, text) to authenticated;

comment on function public.update_daughter_team_details(uuid, text, text, text, text, text, text, uuid, text) is
  'Updates a single daughter team; never touches the parent school/club account or sibling teams.';

-- ############################################################################
-- 20260627190000_public_text_profanity_filter  +  20260709180000_club_news_profanity
-- ############################################################################
-- The centralized profanity function public.contains_profanity(text) was never
-- included in a deploy bundle, so it is missing from the live database. The
-- club-news enforcement trigger (which DID get deployed) calls it, so every
-- attempt to publish a Club Team news post fails at insert time with
-- "function public.contains_profanity(text) does not exist" and the UI shows
-- "Could not save post" -- even for completely clean content. Deploying the
-- profanity functions (and re-asserting the triggers idempotently) fixes it
-- without weakening or bypassing validation.

create or replace function public.profanity_normalized_text(_text text)
returns text
language plpgsql
immutable
as $$
declare
  value text := lower(coalesce(_text, ''));
begin
  value := replace(value, '0', 'o');
  value := replace(value, '1', 'i');
  value := replace(value, '!', 'i');
  value := replace(value, '|', 'i');
  value := replace(value, '3', 'e');
  value := replace(value, '4', 'a');
  value := replace(value, '@', 'a');
  value := replace(value, '5', 's');
  value := replace(value, '$', 's');
  value := replace(value, '7', 't');
  value := replace(value, '+', 't');
  value := replace(value, '8', 'b');
  return value;
end;
$$;

create or replace function public.profanity_compact_text(_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.profanity_normalized_text(coalesce(_text, '')), '[^a-z]+', '', 'g');
$$;

create or replace function public.profanity_squeezed_text(_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(public.profanity_compact_text(coalesce(_text, '')), '([a-z])\1+', '\1', 'g');
$$;

create or replace function public.contains_profanity(_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text := public.profanity_normalized_text(_text);
  compact text := public.profanity_compact_text(_text);
  squeezed text := public.profanity_squeezed_text(_text);
  term text;
  compact_terms text[] := array[
    'fuck',
    'fucker',
    'fucking',
    'motherfucker',
    'shit',
    'shitty',
    'bitch',
    'bitches',
    'cunt',
    'pussy',
    'asshole',
    'bastard',
    'douche',
    'douchebag',
    'nigger',
    'nigga',
    'faggot',
    'retard',
    'slut',
    'whore'
  ];
begin
  if coalesce(_text, '') = '' then
    return false;
  end if;

  foreach term in array compact_terms loop
    if normalized ~* ('(^|[^a-z])' || term || '([^a-z]|$)') then
      return true;
    end if;

    if compact like '%' || term || '%' then
      return true;
    end if;

    if squeezed like '%' || regexp_replace(term, '([a-z])\1+', '\1', 'g') || '%' then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.enforce_match_comment_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.body) then
    raise exception 'Your comment contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_match_comment_profanity_trigger on public.match_comments;
create trigger enforce_match_comment_profanity_trigger
before insert or update of body on public.match_comments
for each row execute function public.enforce_match_comment_profanity();

create or replace function public.enforce_clip_comment_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.content) then
    raise exception 'Your comment contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_comment_profanity_trigger on public.clip_comments;
create trigger enforce_clip_comment_profanity_trigger
before insert or update of content on public.clip_comments
for each row execute function public.enforce_clip_comment_profanity();

create or replace function public.enforce_clip_public_text_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.title)
     or public.contains_profanity(new.caption)
     or public.contains_profanity(new.description) then
    raise exception 'Your post contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_public_text_profanity_trigger on public.clips;
create trigger enforce_clip_public_text_profanity_trigger
before insert or update of title, caption, description on public.clips
for each row execute function public.enforce_clip_public_text_profanity();

grant execute on function public.contains_profanity(text) to authenticated;

-- Club/team news enforcement (title + body), re-asserted idempotently so the
-- trigger and its dependency are guaranteed to exist together.
create or replace function public.enforce_club_news_profanity()
returns trigger
language plpgsql
as $$
begin
  if public.contains_profanity(new.title)
     or public.contains_profanity(new.body) then
    raise exception 'Your post contains inappropriate language. Please edit it and try again.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_club_news_profanity_trigger on public.club_news_posts;
create trigger enforce_club_news_profanity_trigger
before insert or update of title, body on public.club_news_posts
for each row execute function public.enforce_club_news_profanity();

-- Refresh PostgREST schema cache so new functions are found immediately
notify pgrst, 'reload schema';

-- ############################################################################
-- 20260711120000 + 20260713230000 + 20260714130000 + 20260720190000
-- COMPLETE ACCOUNT DELETION CHAIN (self-delete RPC + full cleanup + protection)
-- ############################################################################
-- The frontend calls public.delete_my_account(); that function and its
-- dependencies were never bundled, so deletion failed with a missing-function
-- error surfaced as the generic "Account could not be deleted". This section
-- deploys the whole chain, idempotently.

-- 1. Protected-account registry + the shared "can this user be deleted?" guard.
--    (Only the Footy Status Official Admin is ever in this registry; every
--    ordinary account passes the guard unchanged.)
-- ---------------------------------------------------------------------------
create table if not exists public.protected_accounts (
  user_id                    uuid primary key
                               references auth.users(id) on delete restrict,
  official_email             text,
  reason                     text not null
                               default 'Footy Status Official Admin — permanently protected',
  protected_role             text,
  protected_account_category text,
  freeze_profile_role        boolean not null default true,
  created_at                 timestamptz not null default now()
);

alter table public.protected_accounts enable row level security;
revoke all on public.protected_accounts from anon, authenticated;

create or replace function public.ensure_protected_official_admin()
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_official_email text := 'footystatussupport@gmail.com';
  v_user_id uuid;
  v_role text;
  v_category text;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_official_email
  order by u.created_at asc
  limit 1;

  if v_user_id is null and to_regclass('public.global_admin_users') is not null then
    select gau.user_id into v_user_id
    from public.global_admin_users gau
    where lower(coalesce(gau.email, '')) = v_official_email
    limit 1;
  end if;

  if v_user_id is null then
    select p.user_id into v_user_id
    from public.profiles p
    where lower(coalesce(p.email, '')) = v_official_email
    limit 1;
  end if;

  if v_user_id is null then
    raise notice 'Footy Status Official Admin (%) not found; protection not seeded yet.', v_official_email;
    return null;
  end if;

  select account_role, account_category
    into v_role, v_category
  from public.profiles
  where user_id = v_user_id
  limit 1;

  insert into public.protected_accounts
    (user_id, official_email, protected_role, protected_account_category)
  values
    (v_user_id, v_official_email, v_role, v_category)
  on conflict (user_id) do nothing;

  return v_user_id;
end;
$$;

revoke all on function public.ensure_protected_official_admin() from anon, authenticated;
select public.ensure_protected_official_admin();

create or replace function public.is_account_protected(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.protected_accounts pa where pa.user_id = _user_id
  );
$$;

create or replace function public.assert_user_can_be_deleted(_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if _user_id is not null and public.is_account_protected(_user_id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.current_user_deletion_protected()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select public.is_account_protected(auth.uid());
$$;

grant execute on function public.is_account_protected(uuid) to authenticated;
grant execute on function public.assert_user_can_be_deleted(uuid) to authenticated;
grant execute on function public.current_user_deletion_protected() to authenticated;

-- Protection triggers (last line of defense for the official admin only).
create or replace function public.tg_protect_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if public.is_account_protected(old.id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_official_admin_auth_delete on auth.users;
create trigger protect_official_admin_auth_delete
  before delete on auth.users
  for each row execute function public.tg_protect_auth_user_deletion();

create or replace function public.tg_protect_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if public.is_account_protected(old.user_id) then
    raise exception
      'The Footy Status Official Admin account is permanently protected and cannot be deleted.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_official_admin_profile_delete on public.profiles;
create trigger protect_official_admin_profile_delete
  before delete on public.profiles
  for each row execute function public.tg_protect_profile_deletion();

create or replace function public.tg_protect_registry_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  raise exception
    'The Footy Status Official Admin protection registry is locked and cannot be modified or removed.'
    using errcode = 'check_violation';
  return null;
end;
$$;

drop trigger if exists protect_registry_no_update on public.protected_accounts;
create trigger protect_registry_no_update
  before update on public.protected_accounts
  for each row execute function public.tg_protect_registry_rows();

drop trigger if exists protect_registry_no_delete on public.protected_accounts;
create trigger protect_registry_no_delete
  before delete on public.protected_accounts
  for each row execute function public.tg_protect_registry_rows();

-- ---------------------------------------------------------------------------
-- 2. Generic, schema-safe row/storage cleanup helpers.
-- ---------------------------------------------------------------------------
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

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = _table_name and column_name = _column_name
  ) then
    execute format('delete from public.%I where %I = $1', _table_name, _column_name) using _user_id;
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
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = _table_name and column_name = _column_name
  ) then
    execute format('delete from public.%I where %I = any($1)', _table_name, _column_name) using _ids;
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
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = _table_name
      and column_name = _column_name and is_nullable = 'YES'
  ) then
    execute format('update public.%I set %I = null where %I = $1', _table_name, _column_name, _column_name) using _user_id;
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

-- ---------------------------------------------------------------------------
-- 3. Dynamic sweep of every direct auth.users(id) reference (belt and braces
--    for tables the explicit cleanup below might not enumerate).
-- ---------------------------------------------------------------------------
create or replace function public.footy_purge_direct_auth_user_refs(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  r record;
begin
  if _user_id is null then
    return;
  end if;

  for r in
    select ns.nspname as schema_name, rel.relname as table_name,
           att.attname as column_name, att.attnotnull as not_null
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace ns  on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1
      and rel.relkind = 'r'
      and ns.nspname in ('public', 'storage')
      and not (ns.nspname = 'public' and rel.relname = 'protected_accounts')
  loop
    begin
      if r.not_null then
        execute format('delete from %I.%I where %I = $1', r.schema_name, r.table_name, r.column_name) using _user_id;
      else
        execute format('update %I.%I set %I = null where %I = $1', r.schema_name, r.table_name, r.column_name, r.column_name) using _user_id;
      end if;
    exception when others then
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.footy_purge_direct_auth_user_refs(uuid) from public;
grant execute on function public.footy_purge_direct_auth_user_refs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The comprehensive, ordered app-data cleanup for any account type.
--    Deletes owned content (clips + all clip-derived rows, posts, stats,
--    owned teams/clubs) and removes/detaches every link; NEVER destroys a
--    shared team/match owned by someone else (those are only detached).
-- ---------------------------------------------------------------------------
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
    select coalesce(array_agg(id), '{}'::uuid[]) into v_player_profile_ids
    from public.player_profiles where user_id = _target_user_id;
  end if;

  if to_regclass('public.players') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_legacy_player_ids
    from public.players where user_id = _target_user_id;
  end if;

  if to_regclass('public.parent_profiles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_parent_profile_ids
    from public.parent_profiles where user_id = _target_user_id;
  end if;

  if to_regclass('public.team_profiles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_team_profile_ids
    from public.team_profiles where user_id = _target_user_id;
    select coalesce(array_agg(team_id), '{}'::uuid[]) into v_team_ids
    from public.team_profiles where user_id = _target_user_id and team_id is not null;
    select coalesce(array_agg(club_id), '{}'::uuid[]) into v_club_ids
    from public.team_profiles where user_id = _target_user_id and club_id is not null;
  end if;

  if to_regclass('public.teams') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_team_ids
    from (
      select unnest(v_team_ids) as id
      union select id from public.teams where owner_user_id = _target_user_id
      union select id from public.teams where user_id = _target_user_id
    ) ids where id is not null;
  end if;

  if to_regclass('public.clubs') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_club_ids
    from (
      select unnest(v_club_ids) as id
      union select id from public.clubs where owner_user_id = _target_user_id
    ) ids where id is not null;
  end if;

  if to_regclass('public.club_teams') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_club_team_ids
    from public.club_teams
    where owner_user_id = _target_user_id
       or team_profile_id = any(v_team_profile_ids)
       or club_id = any(v_club_ids)
       or team_id = any(v_team_ids);
  end if;

  if to_regclass('public.clips') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_clip_ids
    from public.clips
    where user_id = _target_user_id
       or player_id = any(v_player_profile_ids)
       or player_id = any(v_legacy_player_ids);
  end if;

  -- Clip-derived rows first so a clip's likes/comments/views/feed/exposure/
  -- reports are gone and the clip can never resurface in the Next Up feed.
  perform public.delete_account_rows_if_column_matches_any('clip_likes', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_comments', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_views', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_feed_impressions', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_shares', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_exposure_state', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('clip_engagement_exposure_awards', 'clip_id', v_clip_ids);
  perform public.delete_account_rows_if_column_matches_any('content_reports', 'reported_clip_id', v_clip_ids);

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

  perform public.delete_account_rows_if_column_exists('parent_player_links', 'parent_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'player_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'requested_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'approved_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_player_links', 'removed_by_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'parent_profile_id', v_parent_profile_ids);
  perform public.delete_account_rows_if_column_matches_any('parent_player_links', 'player_profile_id', v_player_profile_ids);

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

  perform public.delete_account_rows_if_column_exists('club_news_posts', 'author_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'team_id', v_team_ids);
  perform public.delete_account_rows_if_column_matches_any('club_news_posts', 'club_id', v_club_ids);

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

  -- Clip rows themselves (storage files removed at the end).
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

  -- Owned team structures only (never a team belonging to another account).
  perform public.delete_account_rows_if_column_matches_any('club_teams', 'id', v_club_team_ids);
  perform public.delete_account_rows_if_column_matches_any('clubs', 'id', v_club_ids);
  perform public.delete_account_rows_if_column_matches_any('teams', 'id', v_team_ids);
  perform public.delete_account_rows_if_column_exists('club_teams', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('clubs', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'owner_user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('teams', 'user_id', _target_user_id);

  -- Core profile rows last (releases username/search/Explore visibility).
  perform public.delete_account_rows_if_column_exists('players', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('player_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('staff_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('parent_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_staff', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('team_profiles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('user_roles', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('global_admin_users', 'user_id', _target_user_id);
  perform public.delete_account_rows_if_column_exists('profiles', 'user_id', _target_user_id);

  -- Delete the actual video/thumbnail/media files from storage.
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

-- ---------------------------------------------------------------------------
-- 5. Resilient auth.users BEFORE DELETE cleanup trigger (best-effort app-data
--    cleanup + guaranteed sweep). The separate protect_official_admin trigger
--    still hard-blocks the protected account.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.delete_account_app_data(uuid, uuid, text)') is not null then
    begin
      perform public.delete_account_app_data(old.id, null, 'auth_user_deleted_cleanup');
    exception when others then
      null;
    end;
  end if;

  perform public.footy_purge_direct_auth_user_refs(old.id);
  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

-- ---------------------------------------------------------------------------
-- 6. Repoint the three moderation admin_user_id FKs to ON DELETE SET NULL so an
--    admin who ever issued a strike/ban/report action can still be deleted
--    (the audit record survives, detached). Discovers the real constraint name.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array['account_strikes', 'temporary_bans', 'content_report_actions'];
  v_table  text;
  v_conname text;
  v_deltype "char";
begin
  foreach v_table in array v_tables loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'admin_user_id'
    ) then
      continue;
    end if;

    select con.conname, con.confdeltype into v_conname, v_deltype
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
      and ns.nspname = 'public' and rel.relname = v_table
      and att.attname = 'admin_user_id' and array_length(con.conkey, 1) = 1
    limit 1;

    execute format('alter table public.%I alter column admin_user_id drop not null', v_table);

    if v_conname is not null and v_deltype is distinct from 'n' then
      execute format('alter table public.%I drop constraint %I', v_table, v_conname);
    end if;

    if not exists (
      select 1 from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
        and ns.nspname = 'public' and rel.relname = v_table
        and att.attname = 'admin_user_id' and con.confdeltype = 'n'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (admin_user_id) references auth.users(id) on delete set null',
        v_table, v_table || '_admin_user_id_fkey'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The user-facing deletion RPCs. Self-delete verifies the caller is deleting
--    their own account (auth.uid()); the auth-user delete triggers the cleanup
--    above; the whole call is one transaction, so any critical failure rolls
--    back and the account is never left half-deleted.
-- ---------------------------------------------------------------------------
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

  begin
    perform public.delete_account_app_data(v_user_id, v_user_id, 'self_delete_account');
  exception when others then
    null;
  end;
  perform public.footy_purge_direct_auth_user_refs(v_user_id);

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

  begin
    v_result := public.delete_account_app_data(_target_user_id, v_admin_user_id, _reason);
  exception when others then
    v_result := jsonb_build_object('success', true, 'target_user_id', _target_user_id, 'app_data_cleanup', 'partial');
  end;
  perform public.footy_purge_direct_auth_user_refs(_target_user_id);

  delete from auth.identities where user_id = _target_user_id;
  delete from auth.users where id = _target_user_id;

  return v_result || jsonb_build_object('auth_user_deleted', true);
end;
$$;

revoke all on function public.delete_account_rows_if_column_exists(text, text, uuid) from public;
revoke all on function public.delete_account_rows_if_column_matches_any(text, text, uuid[]) from public;
revoke all on function public.null_account_column_if_exists(text, text, uuid) from public;
revoke all on function public.delete_account_storage_objects(uuid) from public;
revoke all on function public.delete_account_app_data(uuid, uuid, text) from public;
revoke all on function public.delete_my_account() from public;
revoke all on function public.admin_delete_account(uuid, text) from public;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

-- Refresh PostgREST so delete_my_account is callable immediately.
notify pgrst, 'reload schema';
