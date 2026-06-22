update public.teams t
set owner_user_id = coalesce(t.owner_user_id, tp.user_id)
from public.team_profiles tp
where tp.team_id = t.id
  and t.owner_user_id is null
  and tp.user_id is not null;

update public.teams t
set owner_user_id = coalesce(t.owner_user_id, c.owner_user_id)
from public.clubs c
where c.primary_team_id = t.id
  and t.owner_user_id is null
  and c.owner_user_id is not null;

create or replace function public.is_team_manager_for(_team_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = _team_id
      and t.owner_user_id = _user_id
  )
  or exists (
    select 1
    from public.team_profiles tp
    where tp.team_id = _team_id
      and tp.user_id = _user_id
  )
  or exists (
    select 1
    from public.clubs c
    where c.primary_team_id = _team_id
      and c.owner_user_id = _user_id
  );
$$;

drop policy if exists "coach staff requests readable" on public.coach_staff_join_requests;
create policy "coach staff requests readable"
  on public.coach_staff_join_requests for select
  using (
    coach_user_id = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  );

drop policy if exists "coach staff requests update own or team owner" on public.coach_staff_join_requests;
drop policy if exists "coach staff requests manageable" on public.coach_staff_join_requests;
create policy "coach staff requests update own or team manager"
  on public.coach_staff_join_requests for update
  to authenticated
  using (
    coach_user_id = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  )
  with check (
    coach_user_id = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  );

drop policy if exists "coach staff memberships insert by coach or team owner" on public.coach_staff_team_memberships;
drop policy if exists "coach staff memberships manageable" on public.coach_staff_team_memberships;
create policy "coach staff memberships manageable"
  on public.coach_staff_team_memberships for all
  to authenticated
  using (
    coach_user_id = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  )
  with check (
    coach_user_id = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  );

drop policy if exists "coach staff invites readable" on public.coach_staff_team_invites;
create policy "coach staff invites readable"
  on public.coach_staff_team_invites for select
  using (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  );

drop policy if exists "coach staff invites manageable" on public.coach_staff_team_invites;
create policy "coach staff invites manageable"
  on public.coach_staff_team_invites for all
  to authenticated
  using (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  )
  with check (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or public.is_team_manager_for(team_id, auth.uid())
  );

create or replace function public.resolve_team_manager_user_id(_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.owner_user_id from public.teams t where t.id = _team_id),
    (select tp.user_id from public.team_profiles tp where tp.team_id = _team_id limit 1),
    (select c.owner_user_id from public.clubs c where c.primary_team_id = _team_id limit 1)
  );
$$;

create or replace function public.notify_on_coach_staff_join_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  requester_name text;
  staff_label text;
begin
  select public.resolve_team_manager_user_id(new.team_id), t.name, coalesce(l.name, ct.league_name)
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.club_teams ct on ct.id = new.club_team_id
  left join public.leagues l on l.id = coalesce(new.league_id, ct.league_id, t.league_id)
  where t.id = new.team_id;

  if new.status <> 'pending' or owner_user_id is null then
    return new;
  end if;

  requester_name := public.notification_actor_name(new.coach_user_id);
  staff_label := coalesce(nullif(trim(new.staff_role), ''), 'Coach / Staff');

  perform public.create_notification(
    owner_user_id,
    new.coach_user_id,
    'coach_staff_join_requested',
    'New staff request',
    requester_name || ' requested to join ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || ' as ' || staff_label || '.',
    'coach_staff_join_request',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    '/profile',
    jsonb_build_object(
      'request_id', new.id,
      'team_id', new.team_id,
      'club_team_id', new.club_team_id,
      'league_id', new.league_id,
      'age_group', new.age_group,
      'staff_role', new.staff_role
    ),
    'coach_staff_join_requested:' || new.id
  );

  return new;
end;
$$;

create or replace function public.notify_on_coach_staff_join_request_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  requester_name text;
  reviewer_id uuid;
begin
  if old.status = new.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;

  select public.resolve_team_manager_user_id(new.team_id), t.name, coalesce(l.name, ct.league_name)
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.club_teams ct on ct.id = new.club_team_id
  left join public.leagues l on l.id = coalesce(new.league_id, ct.league_id, t.league_id)
  where t.id = new.team_id;

  requester_name := public.notification_actor_name(new.coach_user_id);
  reviewer_id := owner_user_id;

  if new.status = 'approved' then
    perform public.create_notification(
      new.coach_user_id,
      reviewer_id,
      'coach_staff_join_approved',
      'Staff request approved',
      'You were added to ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
      'coach_staff_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/profile',
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
      'coach_staff_join_approved:' || new.id
    );

    if owner_user_id is not null then
      perform public.create_notification(
        owner_user_id,
        new.coach_user_id,
        'coach_staff_joined_team',
        'Staff member added',
        requester_name || ' joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
        'coach_staff_join_request',
        new.id,
        new.team_id,
        new.club_team_id,
        null,
        '/profile',
        jsonb_build_object('request_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
        'coach_staff_joined_team:request:' || new.id
      );
    end if;
  elsif new.status = 'rejected' then
    perform public.create_notification(
      new.coach_user_id,
      reviewer_id,
      'coach_staff_join_rejected',
      'Staff request declined',
      'Your request to join ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || ' was declined.',
      'coach_staff_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/profile',
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
      'coach_staff_join_rejected:' || new.id
    );
  end if;

  return new;
end;
$$;

insert into public.notifications (
  user_id,
  actor_user_id,
  type,
  title,
  body,
  entity_type,
  entity_id,
  team_id,
  club_team_id,
  link_path,
  metadata,
  dedupe_key
)
select
  public.resolve_team_manager_user_id(r.team_id),
  r.coach_user_id,
  'coach_staff_join_requested',
  'New staff request',
  public.notification_actor_name(r.coach_user_id) || ' requested to join ' || public.notification_team_line(t.name, r.age_group, coalesce(l.name, ct.league_name)) || ' as ' || coalesce(nullif(trim(r.staff_role), ''), 'Coach / Staff') || '.',
  'coach_staff_join_request',
  r.id,
  r.team_id,
  r.club_team_id,
  '/profile',
  jsonb_build_object(
    'request_id', r.id,
    'team_id', r.team_id,
    'club_team_id', r.club_team_id,
    'league_id', r.league_id,
    'age_group', r.age_group,
    'staff_role', r.staff_role
  ),
  'coach_staff_join_requested:' || r.id
from public.coach_staff_join_requests r
join public.teams t on t.id = r.team_id
left join public.club_teams ct on ct.id = r.club_team_id
left join public.leagues l on l.id = coalesce(r.league_id, ct.league_id, t.league_id)
where r.status = 'pending'
  and public.resolve_team_manager_user_id(r.team_id) is not null
  and not exists (
    select 1
    from public.notifications n
    where n.dedupe_key = 'coach_staff_join_requested:' || r.id
  );
