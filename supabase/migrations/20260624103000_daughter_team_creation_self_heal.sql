create or replace function public.ensure_mother_team_profile(
  _parent_team_id uuid,
  _club_name text default null,
  _city text default null,
  _founded_year integer default null,
  _home_field_address text default null,
  _training_ground_address text default null,
  _contact_email text default null,
  _contact_phone text default null
)
returns public.clubs
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_team_row public.teams;
  parent_profile_row public.team_profiles;
  club_row public.clubs;
  owner_id uuid;
  resolved_name text;
  resolved_team_type text;
  resolved_school_level text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into parent_team_row
  from public.teams
  where id = _parent_team_id
  limit 1;

  if parent_team_row.id is null then
    raise exception 'Parent team not found.';
  end if;

  owner_id := coalesce(parent_team_row.owner_user_id, auth.uid());

  if owner_id <> auth.uid() and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to manage this team.';
  end if;

  resolved_name := coalesce(nullif(trim(_club_name), ''), nullif(trim(parent_team_row.name), ''), 'Team');
  resolved_team_type := coalesce(nullif(parent_team_row.team_type, ''), 'club');
  resolved_school_level := parent_team_row.school_level;

  select *
  into parent_profile_row
  from public.team_profiles
  where team_id = _parent_team_id
     or user_id = owner_id
  order by case when team_id = _parent_team_id then 0 else 1 end
  limit 1;

  if parent_profile_row.id is null then
    insert into public.team_profiles (
      user_id,
      team_id,
      club_name,
      leagues_offered,
      founded_year,
      country,
      city,
      home_stadium,
      training_ground,
      age_groups_offered,
      contact_email,
      contact_phone,
      team_type,
      school_level,
      school_name,
      sport
    )
    values (
      owner_id,
      _parent_team_id,
      resolved_name,
      '{}'::text[],
      _founded_year,
      null,
      _city,
      _home_field_address,
      _training_ground_address,
      '{}'::text[],
      _contact_email,
      _contact_phone,
      resolved_team_type,
      resolved_school_level,
      case when resolved_team_type = 'school' then resolved_name else null end,
      case when resolved_team_type = 'school' then coalesce(parent_team_row.sport, 'Soccer') else null end
    )
    returning *
    into parent_profile_row;
  else
    update public.team_profiles
    set team_id = coalesce(team_id, _parent_team_id),
        club_name = coalesce(nullif(trim(club_name), ''), resolved_name),
        city = coalesce(city, _city),
        founded_year = coalesce(founded_year, _founded_year),
        home_stadium = coalesce(home_stadium, _home_field_address),
        training_ground = coalesce(training_ground, _training_ground_address),
        contact_email = coalesce(contact_email, _contact_email),
        contact_phone = coalesce(contact_phone, _contact_phone),
        team_type = coalesce(nullif(team_type, ''), resolved_team_type),
        school_level = coalesce(school_level, resolved_school_level),
        updated_at = now()
    where id = parent_profile_row.id
    returning *
    into parent_profile_row;
  end if;

  insert into public.clubs (
    owner_user_id,
    team_profile_id,
    primary_team_id,
    name,
    city,
    founded_year,
    home_field_address,
    training_ground_address,
    contact_email,
    contact_phone
  )
  values (
    owner_id,
    parent_profile_row.id,
    _parent_team_id,
    coalesce(nullif(trim(parent_profile_row.club_name), ''), resolved_name),
    coalesce(parent_profile_row.city, _city),
    coalesce(parent_profile_row.founded_year, _founded_year),
    coalesce(parent_profile_row.home_stadium, _home_field_address),
    coalesce(parent_profile_row.training_ground, _training_ground_address),
    coalesce(parent_profile_row.contact_email, _contact_email),
    coalesce(parent_profile_row.contact_phone, _contact_phone)
  )
  on conflict (team_profile_id) do update
  set primary_team_id = excluded.primary_team_id,
      name = excluded.name,
      city = excluded.city,
      founded_year = excluded.founded_year,
      home_field_address = excluded.home_field_address,
      training_ground_address = excluded.training_ground_address,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      updated_at = now()
  returning *
  into club_row;

  update public.team_profiles
  set club_id = club_row.id,
      team_id = _parent_team_id,
      updated_at = now()
  where id = parent_profile_row.id;

  update public.profiles
  set full_name = coalesce(nullif(trim(full_name), ''), resolved_name),
      club_name = coalesce(nullif(trim(club_name), ''), resolved_name),
      team_name = coalesce(nullif(trim(team_name), ''), resolved_name),
      email = coalesce(email, _contact_email),
      updated_at = now()
  where user_id = owner_id;

  return club_row;
end;
$$;

create or replace function public.save_club_profile(
  _club_name text,
  _city text,
  _founded_year integer,
  _home_field_address text,
  _training_ground_address text,
  _contact_email text,
  _contact_phone text,
  _offered_teams jsonb,
  _staff jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_profile_id uuid;
  v_primary_team_id uuid;
  v_club_id uuid;
  v_team_type text;
  v_school_level text;
  team_item record;
  v_league_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select id, team_id, team_type, school_level
  into v_team_profile_id, v_primary_team_id, v_team_type, v_school_level
  from public.team_profiles
  where user_id = v_user_id
  limit 1;

  if v_primary_team_id is null then
    insert into public.teams (
      name,
      owner_user_id,
      contact_email,
      contact_phone,
      founded_year,
      stadium,
      approval_status,
      team_type,
      school_level
    )
    values (
      coalesce(nullif(trim(_club_name), ''), 'Team'),
      v_user_id,
      _contact_email,
      _contact_phone,
      _founded_year,
      _home_field_address,
      'approved',
      coalesce(v_team_type, 'club'),
      v_school_level
    )
    returning id into v_primary_team_id;
  else
    update public.teams
    set name = coalesce(nullif(trim(_club_name), ''), name),
        owner_user_id = v_user_id,
        contact_email = _contact_email,
        contact_phone = _contact_phone,
        founded_year = _founded_year,
        stadium = _home_field_address,
        approval_status = 'approved',
        team_type = coalesce(v_team_type, team_type),
        school_level = coalesce(v_school_level, school_level)
    where id = v_primary_team_id;
  end if;

  if v_team_profile_id is null then
    insert into public.team_profiles (
      user_id,
      team_id,
      club_name,
      leagues_offered,
      founded_year,
      city,
      home_stadium,
      training_ground,
      age_groups_offered,
      contact_email,
      contact_phone,
      team_type,
      school_level
    )
    values (
      v_user_id,
      v_primary_team_id,
      coalesce(nullif(trim(_club_name), ''), 'Team'),
      '{}'::text[],
      _founded_year,
      _city,
      _home_field_address,
      _training_ground_address,
      '{}'::text[],
      _contact_email,
      _contact_phone,
      coalesce(v_team_type, 'club'),
      v_school_level
    )
    returning id, team_type, school_level
    into v_team_profile_id, v_team_type, v_school_level;
  else
    update public.team_profiles
    set team_id = v_primary_team_id,
        club_name = coalesce(nullif(trim(_club_name), ''), club_name),
        city = _city,
        founded_year = _founded_year,
        home_stadium = _home_field_address,
        training_ground = _training_ground_address,
        contact_email = _contact_email,
        contact_phone = _contact_phone,
        updated_at = now()
    where id = v_team_profile_id;
  end if;

  select id
  into v_club_id
  from public.ensure_mother_team_profile(
    v_primary_team_id,
    _club_name,
    _city,
    _founded_year,
    _home_field_address,
    _training_ground_address,
    _contact_email,
    _contact_phone
  );

  update public.profiles
  set full_name = coalesce(nullif(trim(_club_name), ''), full_name),
      club_name = coalesce(nullif(trim(_club_name), ''), club_name),
      team_name = coalesce(nullif(trim(_club_name), ''), team_name),
      email = coalesce(_contact_email, email),
      updated_at = now()
  where user_id = v_user_id;

  for team_item in
    select *
    from jsonb_to_recordset(coalesce(_offered_teams, '[]'::jsonb)) as t(
      id uuid,
      age_group text,
      league_name text,
      gender text,
      season text,
      level text,
      coach_name text,
      status text,
      team_type text,
      school_level text
    )
  loop
    if coalesce(trim(team_item.age_group), '') = '' or coalesce(trim(team_item.league_name), '') = '' then
      continue;
    end if;

    select id into v_league_id
    from public.leagues
    where lower(name) = lower(trim(team_item.league_name))
    limit 1;

    if team_item.id is not null then
      update public.club_teams
      set team_id = v_primary_team_id,
          parent_team_id = v_primary_team_id,
          age_group = trim(team_item.age_group),
          league_id = v_league_id,
          league_name = trim(team_item.league_name),
          gender = nullif(trim(team_item.gender), ''),
          season = nullif(trim(team_item.season), ''),
          level = nullif(trim(team_item.level), ''),
          coach_name = nullif(trim(team_item.coach_name), ''),
          status = coalesce(nullif(trim(team_item.status), ''), 'active'),
          team_type = coalesce(nullif(trim(team_item.team_type), ''), v_team_type, 'club'),
          school_level = coalesce(nullif(trim(team_item.school_level), ''), v_school_level),
          updated_at = now()
      where id = team_item.id
        and club_id = v_club_id;
    else
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
        v_club_id,
        v_primary_team_id,
        v_primary_team_id,
        trim(team_item.age_group),
        v_league_id,
        trim(team_item.league_name),
        nullif(trim(team_item.gender), ''),
        nullif(trim(team_item.season), ''),
        nullif(trim(team_item.level), ''),
        nullif(trim(team_item.coach_name), ''),
        coalesce(nullif(trim(team_item.status), ''), 'active'),
        coalesce(nullif(trim(team_item.team_type), ''), v_team_type, 'club'),
        coalesce(nullif(trim(team_item.school_level), ''), v_school_level)
      )
      on conflict do nothing;
    end if;
  end loop;

  delete from public.team_staff where team_profile_id = v_team_profile_id;
  insert into public.team_staff (team_profile_id, staff_name, staff_role, personal_email)
  select
    v_team_profile_id,
    coalesce(nullif(trim(x.staff_name), ''), 'Staff Member'),
    coalesce(nullif(trim(x.staff_role), ''), 'Staff'),
    nullif(lower(trim(x.personal_email)), '')
  from jsonb_to_recordset(coalesce(_staff, '[]'::jsonb)) as x(
    staff_name text,
    staff_role text,
    personal_email text
  )
  where coalesce(trim(x.staff_name), '') <> ''
     or coalesce(trim(x.staff_role), '') <> ''
     or coalesce(trim(x.personal_email), '') <> '';

  return v_club_id;
end;
$$;

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

  if not public.is_team_manager_for(_parent_team_id, auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to add a daughter team';
  end if;

  select * into club_row
  from public.ensure_mother_team_profile(_parent_team_id, parent_team_row.name)
  limit 1;

  select * into parent_profile_row
  from public.team_profiles
  where team_id = _parent_team_id
  limit 1;

  if club_row.id is null or parent_profile_row.id is null then
    raise exception 'Main school or club profile could not be prepared for daughter teams';
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
  set club_id = club_row.id,
      age_groups_offered = (
        select array_agg(distinct value order by value)
        from unnest(coalesce(age_groups_offered, '{}'::text[]) || array[normalized_age_group]) value
      ),
      leagues_offered = (
        select array_agg(distinct value order by value)
        from unnest(coalesce(leagues_offered, '{}'::text[]) || array[trim(_league_or_conference)]) value
      ),
      updated_at = now()
  where id = parent_profile_row.id;

  return daughter_team_row;
end;
$$;

grant execute on function public.ensure_mother_team_profile(uuid, text, text, integer, text, text, text, text) to authenticated;
grant execute on function public.save_club_profile(text, text, integer, text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.create_daughter_team(uuid, text, text, text, text, text, text, text) to authenticated;
