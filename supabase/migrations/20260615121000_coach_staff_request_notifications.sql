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
  select t.owner_user_id, t.name, coalesce(l.name, ct.league_name)
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
    '/team/' || new.team_id,
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

  select t.owner_user_id, t.name, coalesce(l.name, ct.league_name)
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
        '/team/' || new.team_id,
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

drop trigger if exists notify_coach_staff_join_request_insert on public.coach_staff_join_requests;
create trigger notify_coach_staff_join_request_insert
after insert on public.coach_staff_join_requests
for each row execute function public.notify_on_coach_staff_join_request_insert();

drop trigger if exists notify_coach_staff_join_request_update on public.coach_staff_join_requests;
create trigger notify_coach_staff_join_request_update
after update on public.coach_staff_join_requests
for each row execute function public.notify_on_coach_staff_join_request_update();

do $$
declare
  request_row record;
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  requester_name text;
  staff_label text;
begin
  for request_row in
    select *
    from public.coach_staff_join_requests
    where status = 'pending'
  loop
    select t.owner_user_id, t.name, coalesce(l.name, ct.league_name)
    into owner_user_id, team_name_value, league_name_value
    from public.teams t
    left join public.club_teams ct on ct.id = request_row.club_team_id
    left join public.leagues l on l.id = coalesce(request_row.league_id, ct.league_id, t.league_id)
    where t.id = request_row.team_id;

    if owner_user_id is not null then
      requester_name := public.notification_actor_name(request_row.coach_user_id);
      staff_label := coalesce(nullif(trim(request_row.staff_role), ''), 'Coach / Staff');

      perform public.create_notification(
        owner_user_id,
        request_row.coach_user_id,
        'coach_staff_join_requested',
        'New staff request',
        requester_name || ' requested to join ' || public.notification_team_line(team_name_value, request_row.age_group, league_name_value) || ' as ' || staff_label || '.',
        'coach_staff_join_request',
        request_row.id,
        request_row.team_id,
        request_row.club_team_id,
        null,
        '/team/' || request_row.team_id,
        jsonb_build_object(
          'request_id', request_row.id,
          'team_id', request_row.team_id,
          'club_team_id', request_row.club_team_id,
          'league_id', request_row.league_id,
          'age_group', request_row.age_group,
          'staff_role', request_row.staff_role
        ),
        'coach_staff_join_requested:' || request_row.id
      );
    end if;
  end loop;
end $$;
