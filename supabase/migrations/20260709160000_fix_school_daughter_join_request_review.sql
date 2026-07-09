-- School/club daughter-team join requests must be reviewed through the exact
-- pending team_join_requests row shown in the mother team's pending list.
-- Older rows can have team_id values that do not perfectly match the current
-- mother-team relationship, so resolve ownership from club_team_id first.

create or replace function public.get_club_pending_join_requests(_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  club_id uuid,
  club_team_id uuid,
  player_profile_id uuid,
  player_user_id uuid,
  age_group text,
  league_id uuid,
  access_code_last4 text,
  requested_at timestamptz,
  player_name text,
  player_username text,
  player_avatar_url text,
  player_position text,
  club_team_age_group text,
  club_team_league_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with managed_daughter_teams as (
    select ct.id
    from public.club_teams ct
    left join public.clubs c on c.id = ct.club_id
    where coalesce(ct.status, 'active') <> 'archived'
      and (
        coalesce(ct.parent_team_id, c.primary_team_id, ct.team_id) = _team_id
        or ct.team_id = _team_id
        or c.primary_team_id = _team_id
        or public.can_manage_club_team(ct.id, auth.uid())
      )
  )
  select
    r.id,
    r.team_id,
    r.club_id,
    r.club_team_id,
    r.player_profile_id,
    r.player_user_id,
    r.age_group,
    r.league_id,
    r.access_code_last4,
    r.requested_at,
    coalesce(pp.full_name, prof.full_name, 'Unknown Player') as player_name,
    coalesce(pp.username, prof.username) as player_username,
    coalesce(pp.profile_image_url, prof.avatar_url) as player_avatar_url,
    pp.position as player_position,
    ct.age_group as club_team_age_group,
    ct.league_name as club_team_league_name
  from public.team_join_requests r
  left join public.player_profiles pp on pp.id = r.player_profile_id
  left join public.profiles prof on prof.user_id = r.player_user_id
  left join public.club_teams ct on ct.id = r.club_team_id
  where r.status = 'pending'
    and (
      public.user_manages_team(_team_id, auth.uid())
      or public.is_footy_status_global_admin()
      or public.can_manage_club_team(r.club_team_id, auth.uid())
    )
    and (
      r.team_id = _team_id
      or r.club_team_id in (select id from managed_daughter_teams)
      or public.can_manage_club_team(r.club_team_id, auth.uid())
    )
  order by r.requested_at desc;
$$;

create or replace function public.review_team_join_request(_request_id uuid, _approve boolean)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $review_team_join_request$
declare
  request_row public.team_join_requests;
  membership_row public.player_team_memberships;
  club_team_row public.club_teams;
  club_row public.clubs;
  resolved_team_id uuid;
  resolved_club_id uuid;
  resolved_league_id uuid;
  resolved_age_group text;
begin
  select * into request_row
  from public.team_join_requests
  where id = _request_id;

  if request_row.id is null then
    raise exception 'Join request not found.';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This join request has already been handled.';
  end if;

  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if request_row.club_team_id is not null then
    select * into club_team_row
    from public.club_teams
    where id = request_row.club_team_id;

    if club_team_row.id is null then
      raise exception 'Daughter team not found for this join request.';
    end if;

    select * into club_row
    from public.clubs
    where id = coalesce(request_row.club_id, club_team_row.club_id);

    resolved_team_id := coalesce(
      club_team_row.parent_team_id,
      club_row.primary_team_id,
      club_team_row.team_id,
      request_row.team_id
    );
    resolved_club_id := coalesce(request_row.club_id, club_team_row.club_id, club_row.id);
    resolved_league_id := coalesce(request_row.league_id, club_team_row.league_id);
    resolved_age_group := coalesce(request_row.age_group, club_team_row.age_group);

    if resolved_team_id is null then
      raise exception 'Mother team not found for this join request.';
    end if;

    if not (
      public.user_manages_team(resolved_team_id, auth.uid())
      or public.user_manages_team(request_row.team_id, auth.uid())
      or public.can_manage_club_team(request_row.club_team_id, auth.uid())
      or public.is_footy_status_global_admin()
    ) then
      raise exception 'Only the mother team account can review this join request.';
    end if;

    if not public.team_is_approved(resolved_team_id)
       and not public.is_footy_status_global_admin() then
      raise exception 'Only approved team accounts can review join requests.';
    end if;

    update public.team_join_requests
    set status = case when _approve then 'approved' else 'rejected' end,
        team_id = resolved_team_id,
        club_id = resolved_club_id,
        league_id = resolved_league_id,
        age_group = resolved_age_group,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = _request_id
    returning * into request_row;

    if _approve then
      membership_row := public.sync_club_team_membership(
        request_row.player_profile_id,
        request_row.player_user_id,
        resolved_team_id,
        resolved_club_id,
        request_row.club_team_id,
        resolved_league_id,
        resolved_age_group,
        'approved',
        'request',
        auth.uid()
      );
      return membership_row;
    end if;

    return null;
  end if;

  resolved_team_id := request_row.team_id;
  resolved_league_id := request_row.league_id;
  resolved_age_group := request_row.age_group;

  if resolved_team_id is null then
    raise exception 'Team not found for this join request.';
  end if;

  if not (
    public.user_manages_team(resolved_team_id, auth.uid())
    or public.is_footy_status_global_admin()
  ) then
    raise exception 'Only approved team accounts can review join requests.';
  end if;

  if not public.team_is_approved(resolved_team_id)
     and not public.is_footy_status_global_admin() then
    raise exception 'Only approved team accounts can review join requests.';
  end if;

  update public.team_join_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = _request_id
  returning * into request_row;

  if _approve then
    membership_row := public.sync_team_membership(
      request_row.player_profile_id,
      request_row.player_user_id,
      resolved_team_id,
      resolved_league_id,
      resolved_age_group,
      'approved',
      'request',
      auth.uid()
    );
    return membership_row;
  end if;

  return null;
end;
$review_team_join_request$;

grant execute on function public.get_club_pending_join_requests(uuid) to authenticated;
grant execute on function public.review_team_join_request(uuid, boolean) to authenticated;

comment on function public.review_team_join_request(uuid, boolean) is
  'Reviews player join requests for mother teams and daughter teams. Resolves school/club daughter-team ownership from club_team_id before approving/rejecting so pending UI rows and notification actions target the same request.';
