-- =============================================================================
-- Team -> Coach/Staff invitations: notifications + reliable two-way acceptance
-- =============================================================================
-- PROBLEM 1 (no notification)
--   coach_staff_join_requests (coach -> team) has notification triggers, but
--   coach_staff_team_invites (team -> coach) had NONE, so an invited coach was
--   never told. Fixed by an AFTER INSERT trigger that notifies the invited user
--   with the same create_notification system used by player invites.
--
-- ACCEPTANCE (problems 2/3/5)
--   Acceptance was a client-side upsert with no team-side notification. Replaced
--   by respond_coach_staff_invite(): a SECURITY DEFINER RPC that, from the
--   INVITE's authoritative fields (team, daughter team, league, age group,
--   role), creates/activates the ONE canonical coach_staff_team_memberships row
--   on accept (so the coach's profile and the team's staff list both read the
--   same record), marks the invite handled, and notifies the team. Decline marks
--   the invite declined and creates no relationship. The person's account_role
--   still drives the Coaching Staff vs Team Staff section (unchanged), so the
--   correct type is used automatically.
--
-- DUPLICATES (problem 6)
--   The membership upsert is keyed (team_id, club_team_id, coach_user_id), so
--   accepting never creates a second active link; the notify trigger skips if an
--   active link already exists.
--
-- Reuses the existing notifications architecture. Safe to run more than once.
-- =============================================================================

create or replace function public.notify_on_coach_staff_invite_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_name_value text;
  league_name_value text;
  inviter_name text;
  invited_role text;
  staff_kind text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  -- Don't notify for an invite to someone already actively on the staff.
  if exists (
    select 1 from public.coach_staff_team_memberships m
    where m.team_id = new.team_id
      and m.coach_user_id = new.coach_user_id
      and coalesce(m.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(new.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and m.status in ('accepted', 'approved')
  ) then
    return new;
  end if;

  select t.name, coalesce(l.name, ct.league_name)
  into team_name_value, league_name_value
  from public.teams t
  left join public.club_teams ct on ct.id = new.club_team_id
  left join public.leagues l on l.id = coalesce(new.league_id, ct.league_id, t.league_id)
  where t.id = new.team_id;

  inviter_name := public.notification_actor_name(new.invited_by);

  -- Team Staff vs Coaching Staff wording follows the invited account's real type
  -- (academy_director / team_staff => team staff; everyone else => coaching staff).
  select coalesce(p.account_role, p.account_type, p.role::text)
  into invited_role
  from public.profiles p
  where p.user_id = new.coach_user_id
  limit 1;

  staff_kind := case
    when invited_role in ('academy_director', 'team_staff') then 'team staff'
    else 'coaching staff'
  end;

  perform public.create_notification(
    new.coach_user_id,
    new.invited_by,
    'coach_staff_invited',
    'Team Invitation',
    coalesce(nullif(team_name_value, ''), 'A team')
      || ' invited you to join their ' || staff_kind
      || case
           when league_name_value is not null or new.age_group is not null
           then ' (' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || ')'
           else ''
         end || '.',
    'coach_staff_invite',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    '/profile',
    jsonb_build_object(
      'invite_id', new.id,
      'team_id', new.team_id,
      'club_team_id', new.club_team_id,
      'league_id', new.league_id,
      'age_group', new.age_group,
      'staff_role', new.staff_role
    ),
    'coach_staff_invited:' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_coach_staff_invite_insert on public.coach_staff_team_invites;
create trigger notify_coach_staff_invite_insert
after insert on public.coach_staff_team_invites
for each row execute function public.notify_on_coach_staff_invite_insert();

-- Backfill: notify for any invite that is still pending right now (mirrors the
-- trigger logic inline; create_notification's dedupe_key makes it safe to rerun).
do $$
declare
  invite_row record;
  team_name_value text;
  league_name_value text;
  invited_role text;
  staff_kind text;
begin
  for invite_row in
    select * from public.coach_staff_team_invites where status = 'pending'
  loop
    begin
      if exists (
        select 1 from public.coach_staff_team_memberships m
        where m.team_id = invite_row.team_id
          and m.coach_user_id = invite_row.coach_user_id
          and coalesce(m.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(invite_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and m.status in ('accepted', 'approved')
      ) then
        continue;
      end if;

      select t.name, coalesce(l.name, ct.league_name)
      into team_name_value, league_name_value
      from public.teams t
      left join public.club_teams ct on ct.id = invite_row.club_team_id
      left join public.leagues l on l.id = coalesce(invite_row.league_id, ct.league_id, t.league_id)
      where t.id = invite_row.team_id;

      select coalesce(p.account_role, p.account_type, p.role::text)
      into invited_role
      from public.profiles p
      where p.user_id = invite_row.coach_user_id
      limit 1;

      staff_kind := case
        when invited_role in ('academy_director', 'team_staff') then 'team staff'
        else 'coaching staff'
      end;

      perform public.create_notification(
        invite_row.coach_user_id,
        invite_row.invited_by,
        'coach_staff_invited',
        'Team Invitation',
        coalesce(nullif(team_name_value, ''), 'A team')
          || ' invited you to join their ' || staff_kind || '.',
        'coach_staff_invite',
        invite_row.id,
        invite_row.team_id,
        invite_row.club_team_id,
        null,
        '/profile',
        jsonb_build_object(
          'invite_id', invite_row.id,
          'team_id', invite_row.team_id,
          'club_team_id', invite_row.club_team_id,
          'league_id', invite_row.league_id,
          'age_group', invite_row.age_group,
          'staff_role', invite_row.staff_role
        ),
        'coach_staff_invited:' || invite_row.id
      );
    exception when others then
      null; -- best effort; never block the migration
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Reliable two-way accept / decline.
-- -----------------------------------------------------------------------------
create or replace function public.respond_coach_staff_invite(
  _invite_id uuid,
  _accept boolean
)
returns public.coach_staff_team_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.coach_staff_team_invites;
  membership_row public.coach_staff_team_memberships;
  team_owner uuid;
  team_name_value text;
  league_name_value text;
  coach_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into invite_row
  from public.coach_staff_team_invites
  where id = _invite_id;

  if invite_row.id is null then
    raise exception 'Invite not found.';
  end if;

  -- Only the invited person may respond.
  if invite_row.coach_user_id <> auth.uid() then
    raise exception 'You can only respond to your own invites.';
  end if;

  if invite_row.status <> 'pending' then
    -- Already handled: return the existing membership (if accepted) safely.
    select * into membership_row
    from public.coach_staff_team_memberships
    where team_id = invite_row.team_id
      and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(invite_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coach_user_id = invite_row.coach_user_id
    order by updated_at desc nulls last
    limit 1;
    return membership_row;
  end if;

  select t.owner_user_id, t.name, coalesce(l.name, ct.league_name)
  into team_owner, team_name_value, league_name_value
  from public.teams t
  left join public.club_teams ct on ct.id = invite_row.club_team_id
  left join public.leagues l on l.id = coalesce(invite_row.league_id, ct.league_id, t.league_id)
  where t.id = invite_row.team_id;

  if not _accept then
    update public.coach_staff_team_invites
    set status = 'declined', reviewed_at = now()
    where id = _invite_id;

    if team_owner is not null then
      coach_name := public.notification_actor_name(invite_row.coach_user_id);
      perform public.create_notification(
        team_owner,
        invite_row.coach_user_id,
        'coach_staff_invite_declined',
        'Invitation declined',
        coach_name || ' declined your staff invitation.',
        'coach_staff_invite',
        invite_row.id,
        invite_row.team_id,
        invite_row.club_team_id,
        null,
        '/team/' || invite_row.team_id,
        jsonb_build_object('invite_id', invite_row.id, 'team_id', invite_row.team_id),
        'coach_staff_invite_declined:' || invite_row.id
      );
    end if;

    return null;
  end if;

  -- ACCEPT: create / reactivate the single canonical relationship from the
  -- invite's authoritative fields (preserves the daughter-team assignment).
  insert into public.coach_staff_team_memberships (
    team_id, club_team_id, league_id, age_group, coach_user_id, staff_role,
    status, approved_at, updated_at
  )
  values (
    invite_row.team_id, invite_row.club_team_id, invite_row.league_id,
    invite_row.age_group, invite_row.coach_user_id, invite_row.staff_role,
    'accepted', now(), now()
  )
  on conflict (team_id, club_team_id, coach_user_id) do update
  set league_id = excluded.league_id,
      age_group = excluded.age_group,
      staff_role = coalesce(excluded.staff_role, public.coach_staff_team_memberships.staff_role),
      status = 'accepted',
      approved_at = now(),
      updated_at = now()
  returning * into membership_row;

  update public.coach_staff_team_invites
  set status = 'accepted', reviewed_at = now()
  where id = _invite_id;

  if team_owner is not null then
    coach_name := public.notification_actor_name(invite_row.coach_user_id);
    perform public.create_notification(
      team_owner,
      invite_row.coach_user_id,
      'coach_staff_joined_team',
      'Staff member added',
      coach_name || ' joined ' || public.notification_team_line(team_name_value, invite_row.age_group, league_name_value) || '.',
      'coach_staff_invite',
      invite_row.id,
      invite_row.team_id,
      invite_row.club_team_id,
      null,
      '/team/' || invite_row.team_id,
      jsonb_build_object('invite_id', invite_row.id, 'team_id', invite_row.team_id, 'club_team_id', invite_row.club_team_id),
      'coach_staff_joined_team:invite:' || invite_row.id
    );
  end if;

  return membership_row;
end;
$$;

revoke all on function public.respond_coach_staff_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_coach_staff_invite(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
