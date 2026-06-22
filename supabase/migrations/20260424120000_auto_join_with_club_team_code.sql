create or replace function public.create_club_team_join_request(
  _team_id uuid,
  _club_team_id uuid,
  _access_code text
)
returns public.team_join_requests
language plpgsql
security definer
set search_path = public
as $create_club_team_join_request$
declare
  player_row public.player_profiles;
  team_row public.teams;
  club_row public.clubs;
  club_team_row public.club_teams;
  request_row public.team_join_requests;
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\s+', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to join a club team.';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = auth.uid();

  if player_row.id is null then
    raise exception 'Only player accounts can join a club team.';
  end if;

  select * into team_row
  from public.teams
  where id = _team_id
    and approval_status = 'approved';

  if team_row.id is null then
    raise exception 'That club is not currently approved.';
  end if;

  select * into club_row
  from public.clubs
  where primary_team_id = _team_id;

  if club_row.id is null then
    raise exception 'This club has no offered teams yet.';
  end if;

  select * into club_team_row
  from public.club_teams
  where id = _club_team_id
    and club_id = club_row.id
    and status = 'active';

  if club_team_row.id is null then
    raise exception 'Please select a valid team combination.';
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    raise exception 'Access code must be exactly 5 digits.';
  end if;

  if club_team_row.access_code_hash is null then
    raise exception 'This team does not have an access code yet.';
  end if;

  if club_team_row.access_code_hash <> encode(extensions.digest(normalized_code, 'sha256'), 'hex') then
    raise exception 'Invalid team access code.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = auth.uid()
      and team_id = _team_id
      and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
      and status in ('accepted', 'approved')
  ) then
    raise exception 'You are already on this team.';
  end if;

  update public.team_join_requests
  set status = 'revoked',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where player_user_id = auth.uid()
    and status = 'pending';

  insert into public.team_join_requests (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    access_code_last4,
    status,
    reviewed_by,
    reviewed_at
  )
  values (
    team_row.id,
    club_row.id,
    club_team_row.id,
    player_row.id,
    auth.uid(),
    club_team_row.league_id,
    club_team_row.age_group,
    right(normalized_code, 4),
    'approved',
    auth.uid(),
    now()
  )
  returning * into request_row;

  perform public.sync_club_team_membership(
    player_row.id,
    auth.uid(),
    team_row.id,
    club_row.id,
    club_team_row.id,
    club_team_row.league_id,
    club_team_row.age_group,
    'approved',
    'code_join',
    auth.uid()
  );

  update public.team_player_invites
  set status = 'accepted',
      responded_at = now()
  where player_user_id = auth.uid()
    and team_id = team_row.id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
    and status = 'pending';

  update public.team_player_invites
  set status = 'revoked',
      responded_at = now()
  where player_user_id = auth.uid()
    and status = 'pending'
    and not (
      team_id = team_row.id
      and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
    );

  return request_row;
end;
$create_club_team_join_request$;

grant execute on function public.create_club_team_join_request(uuid, uuid, text) to authenticated;
