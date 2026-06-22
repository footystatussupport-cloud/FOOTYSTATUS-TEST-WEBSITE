create or replace function public.sync_club_team_membership(
  _player_profile_id uuid,
  _player_user_id uuid,
  _team_id uuid,
  _club_id uuid,
  _club_team_id uuid,
  _league_id uuid,
  _age_group text,
  _status text,
  _joined_via text,
  _approved_by uuid
)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $sync_club_team_membership$
declare
  membership_row public.player_team_memberships;
  team_name_value text;
  league_name_value text;
begin
  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = _player_user_id
    and status in ('accepted', 'approved')
    and (
      team_id <> _team_id
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      club_id = _club_id,
      club_team_id = _club_team_id,
      league_id = _league_id,
      age_group = _age_group,
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if not found then
    insert into public.player_team_memberships (
      player_profile_id,
      player_user_id,
      team_id,
      club_id,
      club_team_id,
      league_id,
      age_group,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    values (
      _player_profile_id,
      _player_user_id,
      _team_id,
      _club_id,
      _club_team_id,
      _league_id,
      _age_group,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  select t.name, l.name
  into team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
  where t.id = _team_id;

  update public.player_profiles
  set team = team_name_value,
      updated_at = now()
  where id = _player_profile_id;

  update public.profiles
  set team_name = team_name_value,
      updated_at = now()
  where user_id = _player_user_id;

  update public.players
  set team_id = _team_id,
      club = coalesce(team_name_value, club),
      league = league_name_value
  where user_id = _player_user_id;

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = _player_user_id
    and team_id = _team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  return membership_row;
end;
$sync_club_team_membership$;

create or replace function public.respond_team_player_invite(_invite_id uuid, _accept boolean)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $respond_team_player_invite$
declare
  invite_row public.team_player_invites;
  membership_row public.player_team_memberships;
begin
  select * into invite_row
  from public.team_player_invites
  where id = _invite_id;

  if invite_row.id is null then
    raise exception 'Invite not found.';
  end if;

  if auth.uid() is null or invite_row.player_user_id <> auth.uid() then
    raise exception 'You can only respond to your own invites.';
  end if;

  if invite_row.status <> 'pending' then
    raise exception 'This invite has already been handled.';
  end if;

  update public.team_player_invites
  set status = case when _accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = _invite_id;

  if _accept then
    if invite_row.club_team_id is not null then
      membership_row := public.sync_club_team_membership(
        invite_row.player_profile_id,
        invite_row.player_user_id,
        invite_row.team_id,
        invite_row.club_id,
        invite_row.club_team_id,
        invite_row.league_id,
        invite_row.age_group,
        'accepted',
        'invite',
        auth.uid()
      );
    else
      membership_row := public.sync_team_membership(
        invite_row.player_profile_id,
        invite_row.player_user_id,
        invite_row.team_id,
        invite_row.league_id,
        invite_row.age_group,
        'accepted',
        'invite',
        auth.uid()
      );
    end if;
    return membership_row;
  end if;

  return null;
end;
$respond_team_player_invite$;

create or replace function public.review_team_join_request(_request_id uuid, _approve boolean)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $review_team_join_request$
declare
  request_row public.team_join_requests;
  membership_row public.player_team_memberships;
begin
  select * into request_row
  from public.team_join_requests
  where id = _request_id;

  if request_row.id is null then
    raise exception 'Join request not found.';
  end if;

  if auth.uid() is null or not public.user_manages_team(request_row.team_id, auth.uid()) or not public.team_is_approved(request_row.team_id) then
    raise exception 'Only approved team accounts can review join requests.';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This join request has already been handled.';
  end if;

  update public.team_join_requests
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = _request_id
  returning * into request_row;

  if _approve then
    if request_row.club_team_id is not null then
      membership_row := public.sync_club_team_membership(
        request_row.player_profile_id,
        request_row.player_user_id,
        request_row.team_id,
        request_row.club_id,
        request_row.club_team_id,
        request_row.league_id,
        request_row.age_group,
        'approved',
        'request',
        auth.uid()
      );
    else
      membership_row := public.sync_team_membership(
        request_row.player_profile_id,
        request_row.player_user_id,
        request_row.team_id,
        request_row.league_id,
        request_row.age_group,
        'approved',
        'request',
        auth.uid()
      );
    end if;
    return membership_row;
  end if;

  return null;
end;
$review_team_join_request$;

drop view if exists public.player_profiles_public;
create view public.player_profiles_public
with (security_invoker=on) as
select
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  coalesce(atm.team_name, pp.team) as team,
  pp.position,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  p.bio,
  p.username,
  p.age_birth_year,
  coalesce(atm.team_name, p.team_name) as team_name,
  p.avatar_url,
  p.is_pro,
  p.role
from public.player_profiles pp
left join public.profiles p on p.user_id = pp.user_id
left join (
  select distinct on (m.player_user_id)
    m.player_user_id,
    t.name as team_name
  from public.player_team_memberships m
  join public.teams t on t.id = m.team_id
  where m.status in ('accepted', 'approved')
  order by m.player_user_id, m.approved_at desc nulls last, m.updated_at desc, m.created_at desc
) atm on atm.player_user_id = pp.user_id;

grant execute on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.respond_team_player_invite(uuid, boolean) to authenticated;
grant execute on function public.review_team_join_request(uuid, boolean) to authenticated;
