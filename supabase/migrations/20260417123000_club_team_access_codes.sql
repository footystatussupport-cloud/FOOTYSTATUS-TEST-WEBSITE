alter table public.club_teams
add column if not exists access_code_hash text,
add column if not exists access_code_last4 text,
add column if not exists access_code_value text,
add column if not exists access_code_updated_at timestamp with time zone;

do $club_team_access_code_check$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_teams_access_code_value_check'
  ) then
    alter table public.club_teams
      add constraint club_teams_access_code_value_check
      check (access_code_value is null or access_code_value ~ '^[0-9]{5}$');
  end if;
end
$club_team_access_code_check$;

create unique index if not exists idx_club_teams_access_code_value_unique
on public.club_teams(access_code_value)
where access_code_value is not null;

create unique index if not exists idx_club_teams_access_code_hash_unique
on public.club_teams(access_code_hash)
where access_code_hash is not null;

create or replace function public.update_club_team_access_code(_club_team_id uuid, _access_code text)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $update_club_team_access_code$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\s+', '', 'g');
  club_team_row public.club_teams;
  result_row public.club_teams;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    raise exception 'Access code must be exactly 5 digits.';
  end if;

  select ct.*
  into club_team_row
  from public.club_teams ct
  join public.clubs c on c.id = ct.club_id
  where ct.id = _club_team_id
    and c.owner_user_id = auth.uid();

  if club_team_row.id is null then
    raise exception 'You are not allowed to manage this daughter team.';
  end if;

  if exists (
    select 1
    from public.club_teams ct
    where ct.id <> _club_team_id
      and ct.access_code_value = normalized_code
  ) then
    raise exception 'That access code is already in use. Please choose a different 5-digit code.';
  end if;

  update public.club_teams
  set access_code_value = normalized_code,
      access_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex'),
      access_code_last4 = right(normalized_code, 4),
      access_code_updated_at = now(),
      updated_at = now()
  where id = _club_team_id
  returning * into result_row;

  return result_row;
end;
$update_club_team_access_code$;

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
    raise exception 'You must be signed in to request to join a club team.';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = auth.uid();

  if player_row.id is null then
    raise exception 'Only player accounts can request to join a club team.';
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
      and status in ('accepted', 'approved')
  ) then
    raise exception 'You are already linked to an active team.';
  end if;

  if exists (
    select 1
    from public.team_join_requests
    where player_user_id = auth.uid()
      and club_team_id = _club_team_id
      and status = 'pending'
  ) then
    raise exception 'You already have a pending request for that team.';
  end if;

  insert into public.team_join_requests (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    access_code_last4,
    status
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
    'pending'
  )
  returning * into request_row;

  return request_row;
end;
$create_club_team_join_request$;

grant execute on function public.update_club_team_access_code(uuid, text) to authenticated;
grant execute on function public.create_club_team_join_request(uuid, uuid, text) to authenticated;
