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

  select *
  into parent_team_row
  from public.teams
  where id = _parent_team_id;

  if parent_team_row.id is null then
    raise exception 'Parent team not found';
  end if;

  select *
  into parent_profile_row
  from public.team_profiles
  where team_id = _parent_team_id
  limit 1;

  select *
  into club_row
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

  normalized_gender := initcap(lower(nullif(trim(_gender), '')));

  if normalized_gender not in ('Boys', 'Girls') then
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

    if normalized_school_level not in (
      'varsity',
      'junior_varsity',
      'prep',
      'middle_school'
    ) then
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
      and coalesce(lower(trim(ct.gender)), '') = lower(normalized_gender)
      and coalesce(lower(trim(ct.level)), '') =
          coalesce(lower(trim(normalized_level)), '')
  ) then
    raise exception 'This daughter team already exists';
  end if;

  select id
  into league_id_value
  from public.leagues
  where lower(trim(name)) = lower(trim(_league_or_conference))
  limit 1;

  insert into public.club_teams (
    club_id,
    team_id,
    parent_team_id,
    age_group,
    league_id,
    league_name,
    gender,
    season,
    level,
    coach_name,
    status,
    team_type,
    school_level
  )
  values (
    club_row.id,
    _parent_team_id,
    _parent_team_id,
    normalized_age_group,
    league_id_value,
    trim(_league_or_conference),
    normalized_gender,
    nullif(trim(_season), ''),
    normalized_level,
    nullif(trim(_coach_name), ''),
    'active',
    normalized_team_type,
    normalized_school_level
  )
  returning * into daughter_team_row;

  update public.team_profiles
  set
    age_groups_offered = (
      select array_agg(distinct value order by value)
      from unnest(
        coalesce(age_groups_offered, '{}'::text[]) ||
        array[normalized_age_group]
      ) as value
    ),
    leagues_offered = (
      select array_agg(distinct value order by value)
      from unnest(
        coalesce(leagues_offered, '{}'::text[]) ||
        array[trim(_league_or_conference)]
      ) as value
    ),
    updated_at = now()
  where team_id = _parent_team_id;

  return daughter_team_row;
end;
$$;

revoke all on function public.create_daughter_team(
  uuid, text, text, text, text, text, text, text
) from public;

grant execute on function public.create_daughter_team(
  uuid, text, text, text, text, text, text, text
) to authenticated;
