alter table public.coach_staff_join_requests
  add column if not exists requested_assignments jsonb not null default '[]'::jsonb,
  add column if not exists general_club_role boolean not null default false,
  add column if not exists request_kind text not null default 'legacy';

alter table public.coach_staff_join_requests
  drop constraint if exists coach_staff_join_requests_requested_assignments_check;

alter table public.coach_staff_join_requests
  add constraint coach_staff_join_requests_requested_assignments_check
  check (jsonb_typeof(requested_assignments) = 'array');

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

  if exists (
    select 1
    from public.coach_staff_join_requests r
    where r.team_id = _team_id
      and r.coach_user_id = auth.uid()
      and r.status = 'pending'
  ) then
    raise exception 'You already have a pending request with this club';
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
  request_row public.coach_staff_join_requests;
  assignment jsonb;
begin
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
    insert into public.coach_staff_team_memberships (
      team_id, club_team_id, coach_user_id, staff_role, status, approved_at, updated_at
    )
    values (
      request_row.team_id,
      null,
      request_row.coach_user_id,
      case when request_row.general_club_role then 'General Coach / Club Staff' else 'Coach' end,
      'approved',
      now(),
      now()
    )
    on conflict on constraint coach_staff_memberships_team_subteam_user_key
    do update set
      staff_role = excluded.staff_role,
      status = 'approved',
      approved_at = now(),
      updated_at = now();

    for assignment in
      select value from jsonb_array_elements(request_row.requested_assignments)
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

  update public.coach_staff_join_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_at = now()
  where id = request_row.id
  returning * into request_row;

  return request_row;
end;
$$;

create or replace function public.remove_coach_from_club(
  _team_id uuid,
  _coach_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() <> _coach_user_id
     and not public.is_team_manager_for(_team_id, auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to remove this club connection';
  end if;

  update public.coach_staff_team_memberships
  set status = case when auth.uid() = _coach_user_id then 'left' else 'removed' end,
      updated_at = now()
  where team_id = _team_id
    and coach_user_id = _coach_user_id
    and status in ('pending', 'approved', 'accepted');

  update public.coach_staff_join_requests
  set status = 'cancelled',
      reviewed_at = now()
  where team_id = _team_id
    and coach_user_id = _coach_user_id
    and status = 'pending';

  update public.coach_staff_team_invites
  set status = 'cancelled',
      reviewed_at = now()
  where team_id = _team_id
    and coach_user_id = _coach_user_id
    and status = 'pending';
end;
$$;

grant execute on function public.submit_coach_club_link_request(uuid, jsonb, boolean) to authenticated;
grant execute on function public.review_coach_club_link_request(uuid, boolean) to authenticated;
grant execute on function public.remove_coach_from_club(uuid, uuid) to authenticated;
