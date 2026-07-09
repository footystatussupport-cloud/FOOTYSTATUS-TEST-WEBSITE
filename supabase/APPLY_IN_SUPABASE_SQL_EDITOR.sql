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

-- Refresh PostgREST schema cache so new functions are found immediately
notify pgrst, 'reload schema';
