alter table public.club_teams
  add column if not exists access_code_hash text,
  add column if not exists access_code_last4 text,
  add column if not exists access_code_value text,
  add column if not exists access_code_updated_at timestamp with time zone;

drop index if exists public.idx_club_teams_access_code_value_unique;
create unique index if not exists idx_club_teams_access_code_value_unique
  on public.club_teams(access_code_value)
  where access_code_value is not null;

drop index if exists public.idx_club_teams_access_code_hash_unique;
create unique index if not exists idx_club_teams_access_code_hash_unique
  on public.club_teams(access_code_hash)
  where access_code_hash is not null;

alter table public.player_team_memberships
  drop constraint if exists player_team_memberships_joined_via_check;

alter table public.player_team_memberships
  add constraint player_team_memberships_joined_via_check
  check (joined_via in ('invite', 'request', 'admin_add', 'code_join'));

create or replace function public.update_club_team_access_code(_club_team_id uuid, _access_code text)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\D+', '', 'g');
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
  where ct.id = _club_team_id
    and ct.status <> 'archived';

  if club_team_row.id is null then
    raise exception 'Daughter team not found.';
  end if;

  if not public.is_team_manager_for(coalesce(club_team_row.parent_team_id, club_team_row.team_id), auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You are not allowed to manage this daughter team.';
  end if;

  if exists (
    select 1
    from public.club_teams ct
    where ct.id <> _club_team_id
      and ct.status <> 'archived'
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
$$;

create or replace function public.join_club_team_with_access_code(_access_code text)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\D+', '', 'g');
  player_row public.player_profiles;
  club_team_row public.club_teams;
  club_row public.clubs;
  team_row public.teams;
  request_row public.team_join_requests;
  membership_row public.player_team_memberships;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  select *
  into player_row
  from public.player_profiles
  where user_id = auth.uid()
  limit 1;

  if player_row.id is null then
    raise exception 'Only player accounts can join teams with an access code.';
  end if;

  select ct.*
  into club_team_row
  from public.club_teams ct
  where ct.status = 'active'
    and (
      ct.access_code_value = normalized_code
      or ct.access_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    )
  order by ct.access_code_updated_at desc nulls last, ct.created_at desc
  limit 1;

  if club_team_row.id is null then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  select *
  into club_row
  from public.clubs
  where id = club_team_row.club_id
  limit 1;

  select *
  into team_row
  from public.teams
  where id = coalesce(club_team_row.parent_team_id, club_team_row.team_id)
  limit 1;

  if team_row.id is null or coalesce(team_row.approval_status, 'approved') <> 'approved' then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  perform public.assert_player_matches_daughter_team(club_team_row.id, player_row.id, auth.uid());

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = auth.uid()
    and team_id = team_row.id
    and club_team_id = club_team_row.id
    and status in ('accepted', 'approved')
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  if membership_row.id is not null then
    return membership_row;
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

  membership_row := public.sync_club_team_membership(
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
    and club_team_id = club_team_row.id
    and status = 'pending';

  update public.team_player_invites
  set status = 'revoked',
      responded_at = now()
  where player_user_id = auth.uid()
    and status = 'pending'
    and not (team_id = team_row.id and club_team_id = club_team_row.id);

  return membership_row;
exception
  when others then
    if sqlerrm ilike '%not eligible%' or sqlerrm ilike '%not eligible for this daughter team%' then
      raise exception 'You are not eligible to join this team.';
    end if;
    raise;
end;
$$;

create or replace function public.request_join_club_team(_club_team_id uuid)
returns public.team_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row public.player_profiles;
  club_team_row public.club_teams;
  club_row public.clubs;
  team_row public.teams;
  request_row public.team_join_requests;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into player_row
  from public.player_profiles
  where user_id = auth.uid()
  limit 1;

  if player_row.id is null then
    raise exception 'Only player accounts can request to join a team.';
  end if;

  select *
  into club_team_row
  from public.club_teams
  where id = _club_team_id
    and status = 'active'
  limit 1;

  if club_team_row.id is null then
    raise exception 'Daughter team not found.';
  end if;

  select *
  into club_row
  from public.clubs
  where id = club_team_row.club_id
  limit 1;

  select *
  into team_row
  from public.teams
  where id = coalesce(club_team_row.parent_team_id, club_team_row.team_id)
  limit 1;

  if team_row.id is null or coalesce(team_row.approval_status, 'approved') <> 'approved' then
    raise exception 'This team is not currently approved.';
  end if;

  perform public.assert_player_matches_daughter_team(club_team_row.id, player_row.id, auth.uid());

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = auth.uid()
      and team_id = team_row.id
      and club_team_id = club_team_row.id
      and status in ('accepted', 'approved')
  ) then
    raise exception 'You are already on this team.';
  end if;

  if exists (
    select 1
    from public.team_join_requests
    where player_user_id = auth.uid()
      and club_team_id = club_team_row.id
      and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this team.';
  end if;

  insert into public.team_join_requests (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
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
    'pending'
  )
  returning * into request_row;

  return request_row;
exception
  when others then
    if sqlerrm ilike '%not eligible%' or sqlerrm ilike '%not eligible for this daughter team%' then
      raise exception 'You are not eligible to join this team.';
    end if;
    raise;
end;
$$;

grant execute on function public.update_club_team_access_code(uuid, text) to authenticated;
grant execute on function public.join_club_team_with_access_code(text) to authenticated;
grant execute on function public.request_join_club_team(uuid) to authenticated;
