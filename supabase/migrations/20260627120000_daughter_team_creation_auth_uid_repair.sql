create or replace function public.ensure_mother_team_profile(
  _parent_team_id uuid default null,
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
  v_user_id uuid := auth.uid();
  main_profile_row public.profiles;
  parent_team_row public.teams;
  parent_profile_row public.team_profiles;
  club_row public.clubs;
  resolved_name text;
  resolved_team_type text := 'club';
  resolved_school_level text;
  unique_team_name text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into main_profile_row
  from public.profiles
  where user_id = v_user_id
  limit 1;

  raise notice 'daughter_team_repair auth.uid=%, input_parent_team_id=%, account_type=%',
    v_user_id,
    _parent_team_id,
    coalesce(main_profile_row.account_role::text, main_profile_row.account_category::text, main_profile_row.role::text);

  if _parent_team_id is not null then
    select *
    into parent_team_row
    from public.teams
    where id = _parent_team_id
    limit 1;

    if parent_team_row.id is null then
      select *
      into parent_profile_row
      from public.team_profiles
      where id = _parent_team_id
      limit 1;
    end if;

    if parent_team_row.id is null and parent_profile_row.id is null then
      select *
      into club_row
      from public.clubs
      where id = _parent_team_id
         or primary_team_id = _parent_team_id
      limit 1;
    end if;
  end if;

  if parent_profile_row.id is null and parent_team_row.id is not null then
    select *
    into parent_profile_row
    from public.team_profiles
    where team_id = parent_team_row.id
       or user_id = coalesce(parent_team_row.owner_user_id, v_user_id)
    order by case when team_id = parent_team_row.id then 0 else 1 end
    limit 1;
  end if;

  if parent_profile_row.id is null and club_row.team_profile_id is not null then
    select *
    into parent_profile_row
    from public.team_profiles
    where id = club_row.team_profile_id
    limit 1;
  end if;

  if parent_profile_row.id is null then
    select *
    into parent_profile_row
    from public.team_profiles
    where user_id = v_user_id
    limit 1;
  end if;

  if parent_team_row.id is null and parent_profile_row.team_id is not null then
    select *
    into parent_team_row
    from public.teams
    where id = parent_profile_row.team_id
    limit 1;
  end if;

  if parent_team_row.id is null and club_row.primary_team_id is not null then
    select *
    into parent_team_row
    from public.teams
    where id = club_row.primary_team_id
    limit 1;
  end if;

  if parent_team_row.id is null then
    select *
    into parent_team_row
    from public.teams
    where owner_user_id = v_user_id
    order by created_at desc
    limit 1;
  end if;

  if parent_team_row.id is not null
     and coalesce(parent_team_row.owner_user_id, v_user_id) <> v_user_id
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to manage this team.';
  end if;

  if parent_profile_row.id is not null
     and parent_profile_row.user_id <> v_user_id
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to manage this team profile.';
  end if;

  if club_row.id is not null
     and club_row.owner_user_id <> v_user_id
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to manage this club or school profile.';
  end if;

  resolved_name := coalesce(
    nullif(trim(_club_name), ''),
    nullif(trim(parent_profile_row.club_name), ''),
    nullif(trim(parent_team_row.name), ''),
    nullif(trim(main_profile_row.team_name), ''),
    nullif(trim(main_profile_row.club_name), ''),
    nullif(trim(main_profile_row.full_name), ''),
    'My Team'
  );

  resolved_team_type := case
    when coalesce(parent_profile_row.team_type, parent_team_row.team_type, main_profile_row.account_role::text, main_profile_row.account_category::text, main_profile_row.role::text) in ('school', 'school_team')
      then 'school'
    else 'club'
  end;
  resolved_school_level := coalesce(parent_profile_row.school_level, parent_team_row.school_level);

  if parent_team_row.id is null then
    unique_team_name := resolved_name;
    begin
      insert into public.teams (
        name,
        owner_user_id,
        contact_email,
        contact_phone,
        founded_year,
        stadium,
        approval_status,
        team_type,
        school_level,
        school_name,
        sport
      )
      values (
        unique_team_name,
        v_user_id,
        coalesce(_contact_email, main_profile_row.email),
        _contact_phone,
        _founded_year,
        _home_field_address,
        'approved',
        resolved_team_type,
        resolved_school_level,
        case when resolved_team_type = 'school' then resolved_name else null end,
        case when resolved_team_type = 'school' then 'Soccer' else null end
      )
      returning *
      into parent_team_row;
    exception
      when unique_violation then
        unique_team_name := resolved_name || ' ' || left(replace(v_user_id::text, '-', ''), 8);
        insert into public.teams (
          name,
          owner_user_id,
          contact_email,
          contact_phone,
          founded_year,
          stadium,
          approval_status,
          team_type,
          school_level,
          school_name,
          sport
        )
        values (
          unique_team_name,
          v_user_id,
          coalesce(_contact_email, main_profile_row.email),
          _contact_phone,
          _founded_year,
          _home_field_address,
          'approved',
          resolved_team_type,
          resolved_school_level,
          case when resolved_team_type = 'school' then resolved_name else null end,
          case when resolved_team_type = 'school' then 'Soccer' else null end
        )
        returning *
        into parent_team_row;
    end;
  else
    update public.teams
    set owner_user_id = coalesce(owner_user_id, v_user_id),
        name = coalesce(nullif(trim(name), ''), resolved_name),
        contact_email = coalesce(contact_email, _contact_email, main_profile_row.email),
        contact_phone = coalesce(contact_phone, _contact_phone),
        founded_year = coalesce(founded_year, _founded_year),
        stadium = coalesce(stadium, _home_field_address),
        approval_status = coalesce(approval_status, 'approved'),
        team_type = coalesce(nullif(team_type, ''), resolved_team_type),
        school_level = coalesce(school_level, resolved_school_level),
        school_name = coalesce(school_name, case when resolved_team_type = 'school' then resolved_name else null end),
        sport = coalesce(sport, case when resolved_team_type = 'school' then 'Soccer' else null end)
    where id = parent_team_row.id
    returning *
    into parent_team_row;
  end if;

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
      v_user_id,
      parent_team_row.id,
      resolved_name,
      '{}'::text[],
      _founded_year,
      null,
      _city,
      _home_field_address,
      _training_ground_address,
      '{}'::text[],
      coalesce(_contact_email, main_profile_row.email),
      _contact_phone,
      resolved_team_type,
      resolved_school_level,
      case when resolved_team_type = 'school' then resolved_name else null end,
      case when resolved_team_type = 'school' then coalesce(parent_team_row.sport, 'Soccer') else null end
    )
    on conflict (user_id) do update
    set team_id = excluded.team_id,
        club_name = coalesce(nullif(public.team_profiles.club_name, ''), excluded.club_name),
        contact_email = coalesce(public.team_profiles.contact_email, excluded.contact_email),
        contact_phone = coalesce(public.team_profiles.contact_phone, excluded.contact_phone),
        team_type = coalesce(public.team_profiles.team_type, excluded.team_type),
        school_level = coalesce(public.team_profiles.school_level, excluded.school_level),
        school_name = coalesce(public.team_profiles.school_name, excluded.school_name),
        sport = coalesce(public.team_profiles.sport, excluded.sport),
        updated_at = now()
    returning *
    into parent_profile_row;
  else
    update public.team_profiles
    set user_id = coalesce(user_id, v_user_id),
        team_id = parent_team_row.id,
        club_name = coalesce(nullif(trim(club_name), ''), resolved_name),
        city = coalesce(city, _city),
        founded_year = coalesce(founded_year, _founded_year),
        home_stadium = coalesce(home_stadium, _home_field_address),
        training_ground = coalesce(training_ground, _training_ground_address),
        contact_email = coalesce(contact_email, _contact_email, main_profile_row.email),
        contact_phone = coalesce(contact_phone, _contact_phone),
        team_type = coalesce(nullif(team_type, ''), resolved_team_type),
        school_level = coalesce(school_level, resolved_school_level),
        school_name = coalesce(school_name, case when resolved_team_type = 'school' then resolved_name else null end),
        sport = coalesce(sport, case when resolved_team_type = 'school' then coalesce(parent_team_row.sport, 'Soccer') else null end),
        updated_at = now()
    where id = parent_profile_row.id
    returning *
    into parent_profile_row;
  end if;

  select *
  into club_row
  from public.clubs
  where primary_team_id = parent_team_row.id
     or team_profile_id = parent_profile_row.id
     or (owner_user_id = v_user_id and primary_team_id is null)
  order by case when primary_team_id = parent_team_row.id then 0 else 1 end
  limit 1;

  if club_row.id is null then
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
      v_user_id,
      parent_profile_row.id,
      parent_team_row.id,
      coalesce(nullif(trim(parent_profile_row.club_name), ''), resolved_name),
      coalesce(parent_profile_row.city, _city),
      coalesce(parent_profile_row.founded_year, _founded_year),
      coalesce(parent_profile_row.home_stadium, _home_field_address),
      coalesce(parent_profile_row.training_ground, _training_ground_address),
      coalesce(parent_profile_row.contact_email, _contact_email, main_profile_row.email),
      coalesce(parent_profile_row.contact_phone, _contact_phone)
    )
    returning *
    into club_row;
  else
    update public.clubs
    set owner_user_id = v_user_id,
        team_profile_id = parent_profile_row.id,
        primary_team_id = parent_team_row.id,
        name = coalesce(nullif(trim(name), ''), nullif(trim(parent_profile_row.club_name), ''), resolved_name),
        city = coalesce(city, parent_profile_row.city, _city),
        founded_year = coalesce(founded_year, parent_profile_row.founded_year, _founded_year),
        home_field_address = coalesce(home_field_address, parent_profile_row.home_stadium, _home_field_address),
        training_ground_address = coalesce(training_ground_address, parent_profile_row.training_ground, _training_ground_address),
        contact_email = coalesce(contact_email, parent_profile_row.contact_email, _contact_email, main_profile_row.email),
        contact_phone = coalesce(contact_phone, parent_profile_row.contact_phone, _contact_phone),
        updated_at = now()
    where id = club_row.id
    returning *
    into club_row;
  end if;

  update public.team_profiles
  set club_id = club_row.id,
      team_id = parent_team_row.id,
      updated_at = now()
  where id = parent_profile_row.id;

  update public.profiles
  set full_name = coalesce(nullif(trim(full_name), ''), resolved_name),
      club_name = coalesce(nullif(trim(club_name), ''), resolved_name),
      team_name = coalesce(nullif(trim(team_name), ''), resolved_name),
      email = coalesce(email, _contact_email),
      updated_at = now()
  where user_id = v_user_id;

  raise notice 'daughter_team_repair result auth.uid=%, team_profile_id=%, primary_team_id=%, club_id=%',
    v_user_id,
    parent_profile_row.id,
    parent_team_row.id,
    club_row.id;

  return club_row;
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
  v_user_id uuid := auth.uid();
  main_profile_row public.profiles;
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
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  select *
  into main_profile_row
  from public.profiles
  where user_id = v_user_id
  limit 1;

  raise notice 'create_daughter_team start auth.uid=%, account_type=%, input_parent_team_id=%, payload_age=%, payload_league=%, payload_school_level=%, payload_gender=%',
    v_user_id,
    coalesce(main_profile_row.account_role::text, main_profile_row.account_category::text, main_profile_row.role::text),
    _parent_team_id,
    _age_group,
    _league_or_conference,
    _school_level,
    _gender;

  select *
  into club_row
  from public.ensure_mother_team_profile(_parent_team_id)
  limit 1;

  select *
  into parent_team_row
  from public.teams
  where id = club_row.primary_team_id
  limit 1;

  select *
  into parent_profile_row
  from public.team_profiles
  where id = club_row.team_profile_id
     or team_id = club_row.primary_team_id
  order by case when id = club_row.team_profile_id then 0 else 1 end
  limit 1;

  if club_row.id is null or parent_team_row.id is null or parent_profile_row.id is null then
    raise exception 'Main school or club profile could not be prepared for daughter teams';
  end if;

  if club_row.owner_user_id <> v_user_id and not public.is_footy_status_global_admin() then
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
    parent_team_row.id,
    parent_team_row.id,
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
  returning *
  into daughter_team_row;

  update public.team_profiles
  set club_id = club_row.id,
      team_id = parent_team_row.id,
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

  raise notice 'create_daughter_team success auth.uid=%, club_id=%, parent_team_id=%, daughter_team_id=%',
    v_user_id,
    club_row.id,
    parent_team_row.id,
    daughter_team_row.id;

  return daughter_team_row;
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
  v_club public.clubs;
  v_team_profile_id uuid;
  v_team_type text;
  v_school_level text;
  team_item record;
  created_team public.club_teams;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into v_club
  from public.ensure_mother_team_profile(
    null,
    _club_name,
    _city,
    _founded_year,
    _home_field_address,
    _training_ground_address,
    _contact_email,
    _contact_phone
  );

  select id, team_type, school_level
  into v_team_profile_id, v_team_type, v_school_level
  from public.team_profiles
  where id = v_club.team_profile_id
  limit 1;

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

    if team_item.id is not null then
      update public.club_teams
      set parent_team_id = v_club.primary_team_id,
          team_id = v_club.primary_team_id,
          age_group = trim(team_item.age_group),
          league_name = trim(team_item.league_name),
          gender = case lower(trim(coalesce(team_item.gender, '')))
            when 'boys' then 'boy'
            when 'boy' then 'boy'
            when 'girls' then 'girl'
            when 'girl' then 'girl'
            else gender
          end,
          season = nullif(trim(team_item.season), ''),
          level = nullif(trim(team_item.level), ''),
          coach_name = nullif(trim(team_item.coach_name), ''),
          status = coalesce(nullif(trim(team_item.status), ''), 'active'),
          team_type = coalesce(nullif(trim(team_item.team_type), ''), v_team_type, 'club'),
          school_level = coalesce(nullif(trim(team_item.school_level), ''), v_school_level),
          updated_at = now()
      where id = team_item.id
        and club_id = v_club.id;
    else
      begin
        select *
        into created_team
        from public.create_daughter_team(
          v_club.primary_team_id,
          team_item.age_group,
          team_item.league_name,
          coalesce(nullif(trim(team_item.school_level), ''), v_school_level),
          team_item.gender,
          team_item.season,
          team_item.level,
          team_item.coach_name
        );
      exception
        when others then
          if sqlerrm not ilike '%already exists%' then
            raise;
          end if;
      end;
    end if;
  end loop;

  if v_team_profile_id is not null then
    delete from public.team_staff
    where team_profile_id = v_team_profile_id;

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
  end if;

  return v_club.id;
end;
$$;

grant execute on function public.ensure_mother_team_profile(uuid, text, text, integer, text, text, text, text) to authenticated;
grant execute on function public.create_daughter_team(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.save_club_profile(text, text, integer, text, text, text, text, jsonb, jsonb) to authenticated;
