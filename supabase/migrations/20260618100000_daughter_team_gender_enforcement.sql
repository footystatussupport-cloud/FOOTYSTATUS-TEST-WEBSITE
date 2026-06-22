-- Store daughter-team gender with the same values used by player accounts.
update public.club_teams
set gender = case lower(trim(gender))
  when 'boys' then 'boy'
  when 'boy' then 'boy'
  when 'girls' then 'girl'
  when 'girl' then 'girl'
  else null
end
where gender is not null;

alter table public.club_teams
  drop constraint if exists club_teams_gender_check;

alter table public.club_teams
  add constraint club_teams_gender_check
  check (gender is null or gender in ('boy', 'girl'));

create index if not exists idx_club_teams_gender
  on public.club_teams(gender);

create or replace function public.normalize_daughter_team_gender()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.gender := case lower(trim(coalesce(new.gender, '')))
    when 'boys' then 'boy'
    when 'boy' then 'boy'
    when 'girls' then 'girl'
    when 'girl' then 'girl'
    else null
  end;

  if tg_op = 'INSERT' and new.gender is null then
    raise exception 'Choose Boys or Girls';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_daughter_team_gender_trigger
on public.club_teams;

create trigger normalize_daughter_team_gender_trigger
before insert or update of gender
on public.club_teams
for each row
execute function public.normalize_daughter_team_gender();

create or replace function public.create_daughter_team(
  _parent_team_id uuid,
  _age_group text,
  _league_or_conference text,
  _school_level text default null,
  _gender text default null,
  _season text default null,
  _level text default null,
  _coach_name text default null
)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_team_row public.teams;
  parent_profile_row public.team_profiles;
  club_row public.clubs;
  league_id_value uuid;
  daughter_team_row public.club_teams;
  normalized_team_type text;
  normalized_school_level text;
  normalized_level text;
  normalized_age_group text;
  normalized_gender text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into parent_team_row
  from public.teams
  where id = _parent_team_id;

  if parent_team_row.id is null then
    raise exception 'Parent team not found';
  end if;

  select * into parent_profile_row
  from public.team_profiles
  where team_id = _parent_team_id
  limit 1;

  select * into club_row
  from public.clubs
  where primary_team_id = _parent_team_id
  limit 1;

  if club_row.id is null then
    raise exception 'Club or school profile not found';
  end if;

  if not public.is_team_manager_for(_parent_team_id, auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to add a daughter team';
  end if;

  if coalesce(trim(_league_or_conference), '') = '' then
    raise exception 'League or conference is required';
  end if;

  normalized_gender := case lower(trim(coalesce(_gender, '')))
    when 'boys' then 'boy'
    when 'boy' then 'boy'
    when 'girls' then 'girl'
    when 'girl' then 'girl'
    else null
  end;

  if normalized_gender is null then
    raise exception 'Choose Boys or Girls';
  end if;

  normalized_team_type := case
    when parent_team_row.team_type = 'school'
      or parent_profile_row.team_type = 'school'
      then 'school'
    else 'club'
  end;

  if normalized_team_type = 'school' then
    normalized_school_level := nullif(trim(_school_level), '');
    if normalized_school_level not in ('varsity', 'junior_varsity', 'prep', 'middle_school') then
      raise exception 'Choose a valid school team level';
    end if;
    normalized_level := case normalized_school_level
      when 'varsity' then 'High School Varsity'
      when 'junior_varsity' then 'Junior Varsity'
      when 'prep' then 'Prep Team'
      when 'middle_school' then 'Middle School Team'
    end;
    normalized_age_group := normalized_level;
  else
    normalized_school_level := null;
    normalized_level := nullif(trim(_level), '');
    normalized_age_group := nullif(trim(_age_group), '');
    if normalized_age_group is null then
      raise exception 'Age group is required';
    end if;
  end if;

  if exists (
    select 1
    from public.club_teams ct
    where ct.club_id = club_row.id
      and ct.status <> 'archived'
      and lower(trim(ct.age_group)) = lower(normalized_age_group)
      and lower(trim(ct.league_name)) = lower(trim(_league_or_conference))
      and ct.gender = normalized_gender
      and coalesce(lower(trim(ct.level)), '') = coalesce(lower(trim(normalized_level)), '')
  ) then
    raise exception 'This daughter team already exists';
  end if;

  select id into league_id_value
  from public.leagues
  where lower(trim(name)) = lower(trim(_league_or_conference))
  limit 1;

  insert into public.club_teams (
    club_id, team_id, parent_team_id, age_group, league_id, league_name,
    gender, season, level, coach_name, status, team_type, school_level
  )
  values (
    club_row.id, _parent_team_id, _parent_team_id, normalized_age_group,
    league_id_value, trim(_league_or_conference), normalized_gender,
    nullif(trim(_season), ''), normalized_level, nullif(trim(_coach_name), ''),
    'active', normalized_team_type, normalized_school_level
  )
  returning * into daughter_team_row;

  update public.team_profiles
  set age_groups_offered = (
        select array_agg(distinct value order by value)
        from unnest(coalesce(age_groups_offered, '{}'::text[]) || array[normalized_age_group]) value
      ),
      leagues_offered = (
        select array_agg(distinct value order by value)
        from unnest(coalesce(leagues_offered, '{}'::text[]) || array[trim(_league_or_conference)]) value
      ),
      updated_at = now()
  where team_id = _parent_team_id;

  return daughter_team_row;
end;
$$;

create or replace function public.player_gender_for_profile(_player_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pp.player_gender
  from public.player_profiles pp
  where pp.id = _player_profile_id
  limit 1;
$$;

create or replace function public.assert_player_matches_daughter_team(
  _club_team_id uuid,
  _player_profile_id uuid,
  _player_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  team_gender text;
  player_gender_value text;
begin
  if _club_team_id is null then
    return;
  end if;

  select ct.gender
  into team_gender
  from public.club_teams ct
  where ct.id = _club_team_id
    and ct.status <> 'archived';

  if team_gender is null then
    raise exception 'This daughter team must be categorized before it can be managed';
  end if;

  select pp.player_gender
  into player_gender_value
  from public.player_profiles pp
  where pp.id = _player_profile_id
     or (_player_user_id is not null and pp.user_id = _player_user_id)
  order by case when pp.id = _player_profile_id then 0 else 1 end
  limit 1;

  if player_gender_value is null then
    raise exception 'The player must complete their account before joining this team';
  end if;

  if player_gender_value <> team_gender then
    raise exception 'This player is not eligible for this daughter team';
  end if;
end;
$$;

create or replace function public.enforce_daughter_team_player_gender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_player_matches_daughter_team(
    new.club_team_id,
    new.player_profile_id,
    new.player_user_id
  );
  return new;
end;
$$;

drop trigger if exists enforce_membership_daughter_team_gender
on public.player_team_memberships;

create trigger enforce_membership_daughter_team_gender
before insert or update of club_team_id, player_profile_id, player_user_id
on public.player_team_memberships
for each row
when (new.club_team_id is not null)
execute function public.enforce_daughter_team_player_gender();

drop trigger if exists enforce_invite_daughter_team_gender
on public.team_player_invites;

create trigger enforce_invite_daughter_team_gender
before insert or update of club_team_id, player_profile_id, player_user_id
on public.team_player_invites
for each row
when (new.club_team_id is not null)
execute function public.enforce_daughter_team_player_gender();

drop trigger if exists enforce_join_request_daughter_team_gender
on public.team_join_requests;

create trigger enforce_join_request_daughter_team_gender
before insert or update of club_team_id, player_profile_id, player_user_id
on public.team_join_requests
for each row
when (new.club_team_id is not null)
execute function public.enforce_daughter_team_player_gender();

create or replace function public.set_daughter_team_gender(
  _club_team_id uuid,
  _gender text
)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  daughter_team public.club_teams;
  normalized_gender text;
begin
  normalized_gender := case lower(trim(coalesce(_gender, '')))
    when 'boys' then 'boy'
    when 'boy' then 'boy'
    when 'girls' then 'girl'
    when 'girl' then 'girl'
    else null
  end;

  if normalized_gender is null then
    raise exception 'Choose Boys or Girls';
  end if;

  select ct.*
  into daughter_team
  from public.club_teams ct
  where ct.id = _club_team_id;

  if daughter_team.id is null then
    raise exception 'Daughter team not found';
  end if;

  if not public.is_team_manager_for(
    coalesce(daughter_team.parent_team_id, daughter_team.team_id),
    auth.uid()
  ) and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to categorize this daughter team';
  end if;

  if exists (
    select 1
    from public.player_team_memberships m
    join public.player_profiles pp
      on pp.id = m.player_profile_id
      or pp.user_id = m.player_user_id
    where m.club_team_id = _club_team_id
      and m.status in ('accepted', 'approved')
      and pp.player_gender is distinct from normalized_gender
  ) then
    raise exception 'Remove ineligible roster members before changing this team category';
  end if;

  update public.club_teams
  set gender = normalized_gender,
      updated_at = now()
  where id = _club_team_id
  returning * into daughter_team;

  return daughter_team;
end;
$$;

grant execute on function public.player_gender_for_profile(uuid) to authenticated;
grant execute on function public.assert_player_matches_daughter_team(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_daughter_team_gender(uuid, text) to authenticated;
