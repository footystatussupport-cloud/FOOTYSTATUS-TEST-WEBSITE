create or replace function public.submit_coach_club_link_request(
  _team_id uuid,
  _assignments jsonb default '[]'::jsonb,
  _general_club_role boolean default false
)
returns public.coach_staff_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.coach_staff_join_requests;
  assignment jsonb;
  club_team_row public.club_teams;
  normalized_assignments jsonb := '[]'::jsonb;
  requester_role text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select account_role
  into requester_role
  from public.profiles
  where user_id = auth.uid();

  if coalesce(requester_role, '') not in (
    'coach', 'head_coach', 'assistant_coach', 'coaching_staff', 'head_coach_assistant', 'trainer'
  ) then
    raise exception 'Only coach or trainer accounts can submit this request';
  end if;

  if not exists (
    select 1
    from public.teams t
    where t.id = _team_id
      and t.approval_status = 'approved'
  ) then
    raise exception 'Approved mother club not found';
  end if;

  if jsonb_typeof(coalesce(_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Team assignments must be a list';
  end if;

  if not _general_club_role and jsonb_array_length(coalesce(_assignments, '[]'::jsonb)) = 0 then
    raise exception 'Select at least one daughter team or General Coach / Club Staff';
  end if;

  for assignment in
    select value from jsonb_array_elements(coalesce(_assignments, '[]'::jsonb))
  loop
    if coalesce(assignment->>'role', '') not in (
      'Head Coach', 'Assistant Coach', 'Trainer', 'Other Staff / Coach'
    ) then
      raise exception 'Choose a valid role for every daughter team';
    end if;

    select ct.*
    into club_team_row
    from public.club_teams ct
    join public.clubs c on c.id = ct.club_id
    where ct.id = (assignment->>'club_team_id')::uuid
      and c.primary_team_id = _team_id
      and ct.status <> 'archived';

    if club_team_row.id is null then
      raise exception 'A selected daughter team does not belong to this club';
    end if;

    normalized_assignments := normalized_assignments || jsonb_build_array(
      jsonb_build_object(
        'club_team_id', club_team_row.id,
        'role', assignment->>'role',
        'team_name', concat_ws(' - ', club_team_row.age_group, club_team_row.level, club_team_row.league_name),
        'age_group', club_team_row.age_group,
        'league_name', club_team_row.league_name,
        'league_id', club_team_row.league_id
      )
    );
  end loop;

  select r.*
  into request_row
  from public.coach_staff_join_requests r
  where r.team_id = _team_id
    and r.coach_user_id = auth.uid()
    and r.status = 'pending'
  order by r.requested_at desc
  limit 1
  for update;

  if request_row.id is not null then
    update public.coach_staff_join_requests
    set
      club_team_id = null,
      league_id = null,
      age_group = null,
      staff_role = case when _general_club_role then 'General Coach / Club Staff' else 'Coach' end,
      requested_at = now(),
      reviewed_at = null,
      requested_assignments = normalized_assignments,
      general_club_role = _general_club_role,
      request_kind = 'club_multi'
    where id = request_row.id
    returning * into request_row;

    return request_row;
  end if;

  insert into public.coach_staff_join_requests (
    team_id,
    club_team_id,
    coach_user_id,
    staff_role,
    status,
    requested_at,
    requested_assignments,
    general_club_role,
    request_kind
  )
  values (
    _team_id,
    null,
    auth.uid(),
    case when _general_club_role then 'General Coach / Club Staff' else 'Coach' end,
    'pending',
    now(),
    normalized_assignments,
    _general_club_role,
    'club_multi'
  )
  returning * into request_row;

  return request_row;
end;
$$;

create or replace function public.review_coach_staff_join_request(
  _request_id uuid,
  _approve boolean
)
returns public.coach_staff_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.coach_staff_join_requests;
  assignment jsonb;
  target_status text := case when _approve then 'approved' else 'rejected' end;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select *
  into request_row
  from public.coach_staff_join_requests
  where id = _request_id
  for update;

  if request_row.id is null or request_row.status <> 'pending' then
    raise exception 'Request not found or already handled';
  end if;

  if not public.is_team_manager_for(request_row.team_id, auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to review this request';
  end if;

  if _approve then
    if request_row.general_club_role
       or jsonb_array_length(coalesce(request_row.requested_assignments, '[]'::jsonb)) = 0 then
      insert into public.coach_staff_team_memberships (
        team_id,
        club_team_id,
        league_id,
        age_group,
        coach_user_id,
        staff_role,
        status,
        approved_at,
        updated_at
      )
      values (
        request_row.team_id,
        request_row.club_team_id,
        request_row.league_id,
        request_row.age_group,
        request_row.coach_user_id,
        coalesce(nullif(request_row.staff_role, ''), 'Coach'),
        'approved',
        now(),
        now()
      )
      on conflict on constraint coach_staff_memberships_team_subteam_user_key
      do update set
        league_id = excluded.league_id,
        age_group = excluded.age_group,
        staff_role = excluded.staff_role,
        status = 'approved',
        approved_at = now(),
        updated_at = now();
    end if;

    for assignment in
      select value from jsonb_array_elements(coalesce(request_row.requested_assignments, '[]'::jsonb))
    loop
      insert into public.coach_staff_team_memberships (
        team_id,
        club_team_id,
        league_id,
        age_group,
        coach_user_id,
        staff_role,
        status,
        approved_at,
        updated_at
      )
      values (
        request_row.team_id,
        (assignment->>'club_team_id')::uuid,
        nullif(assignment->>'league_id', '')::uuid,
        assignment->>'age_group',
        request_row.coach_user_id,
        assignment->>'role',
        'approved',
        now(),
        now()
      )
      on conflict on constraint coach_staff_memberships_team_subteam_user_key
      do update set
        league_id = excluded.league_id,
        age_group = excluded.age_group,
        staff_role = excluded.staff_role,
        status = 'approved',
        approved_at = now(),
        updated_at = now();
    end loop;
  end if;

  delete from public.coach_staff_join_requests r
  where r.id <> request_row.id
    and r.team_id = request_row.team_id
    and r.club_team_id is not distinct from request_row.club_team_id
    and r.coach_user_id = request_row.coach_user_id
    and r.status = target_status;

  update public.coach_staff_join_requests
  set status = target_status,
      reviewed_at = now()
  where id = request_row.id
  returning * into request_row;

  return request_row;
end;
$$;

create or replace function public.review_coach_club_link_request(
  _request_id uuid,
  _approve boolean
)
returns public.coach_staff_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.coach_staff_join_requests;
begin
  select *
  into result_row
  from public.review_coach_staff_join_request(_request_id, _approve);

  return result_row;
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
      'Coaching request accepted',
      'Your coaching request to ' || coalesce(team_name_value, 'this team') || ' has been accepted.',
      'coach_staff_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/team/' || new.team_id,
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
      'Coaching request declined',
      'Your coaching request to ' || coalesce(team_name_value, 'this team') || ' was declined.',
      'coach_staff_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/team/' || new.team_id,
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
      'coach_staff_join_rejected:' || new.id
    );
  end if;

  return new;
end;
$$;

grant execute on function public.submit_coach_club_link_request(uuid, jsonb, boolean) to authenticated;
grant execute on function public.review_coach_staff_join_request(uuid, boolean) to authenticated;
grant execute on function public.review_coach_club_link_request(uuid, boolean) to authenticated;
