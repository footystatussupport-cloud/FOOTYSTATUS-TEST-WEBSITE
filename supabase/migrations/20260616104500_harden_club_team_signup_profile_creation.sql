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
  team_item record;
  v_league_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select id, team_id into v_team_profile_id, v_primary_team_id
  from public.team_profiles
  where user_id = v_user_id
  limit 1;

  if v_team_profile_id is null then
    insert into public.team_profiles (
      user_id,
      club_name,
      leagues_offered,
      city,
      founded_year,
      home_stadium,
      training_ground,
      age_groups_offered,
      contact_email,
      contact_phone
    )
    values (
      v_user_id,
      coalesce(_club_name, 'Club'),
      array(
        select distinct x.league_name
        from jsonb_to_recordset(coalesce(_offered_teams, '[]'::jsonb)) as x(league_name text)
        where coalesce(trim(x.league_name), '') <> ''
      ),
      _city,
      _founded_year,
      _home_field_address,
      _training_ground_address,
      array(
        select distinct x.age_group
        from jsonb_to_recordset(coalesce(_offered_teams, '[]'::jsonb)) as x(age_group text)
        where coalesce(trim(x.age_group), '') <> ''
      ),
      _contact_email,
      _contact_phone
    )
    returning id, team_id into v_team_profile_id, v_primary_team_id;
  end if;

  if v_primary_team_id is null then
    insert into public.teams (name, owner_user_id, contact_email, contact_phone, founded_year, stadium, approval_status)
    values (coalesce(_club_name, 'Club'), v_user_id, _contact_email, _contact_phone, _founded_year, _home_field_address, 'approved')
    returning id into v_primary_team_id;

    update public.team_profiles
    set team_id = v_primary_team_id
    where id = v_team_profile_id;
  else
    update public.teams
    set name = coalesce(_club_name, name),
        owner_user_id = v_user_id,
        contact_email = _contact_email,
        contact_phone = _contact_phone,
        founded_year = _founded_year,
        stadium = _home_field_address,
        approval_status = 'approved'
    where id = v_primary_team_id;
  end if;

  insert into public.clubs (owner_user_id, team_profile_id, primary_team_id, name, city, founded_year, home_field_address, training_ground_address, contact_email, contact_phone)
  values (v_user_id, v_team_profile_id, v_primary_team_id, coalesce(_club_name, 'Club'), _city, _founded_year, _home_field_address, _training_ground_address, _contact_email, _contact_phone)
  on conflict (team_profile_id) do update
  set name = excluded.name,
      city = excluded.city,
      founded_year = excluded.founded_year,
      home_field_address = excluded.home_field_address,
      training_ground_address = excluded.training_ground_address,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      primary_team_id = excluded.primary_team_id,
      updated_at = now()
  returning id into v_club_id;

  update public.team_profiles
  set club_id = v_club_id,
      club_name = coalesce(_club_name, club_name),
      city = _city,
      founded_year = _founded_year,
      home_stadium = _home_field_address,
      training_ground = _training_ground_address,
      contact_email = _contact_email,
      contact_phone = _contact_phone,
      updated_at = now()
  where id = v_team_profile_id;

  update public.profiles
  set full_name = coalesce(_club_name, full_name),
      club_name = coalesce(_club_name, club_name),
      email = coalesce(_contact_email, email),
      account_category = 'team_staff',
      account_role = 'team_club',
      role = 'team',
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
      status text
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
      set age_group = trim(team_item.age_group),
          league_id = v_league_id,
          league_name = trim(team_item.league_name),
          gender = nullif(trim(team_item.gender), ''),
          season = nullif(trim(team_item.season), ''),
          level = nullif(trim(team_item.level), ''),
          coach_name = nullif(trim(team_item.coach_name), ''),
          status = coalesce(nullif(trim(team_item.status), ''), 'active'),
          updated_at = now()
      where id = team_item.id
        and club_id = v_club_id;
    else
      insert into public.club_teams (club_id, team_id, age_group, league_id, league_name, gender, season, level, coach_name, status)
      values (
        v_club_id,
        case when not exists (select 1 from public.club_teams where club_id = v_club_id) then v_primary_team_id else null end,
        trim(team_item.age_group),
        v_league_id,
        trim(team_item.league_name),
        nullif(trim(team_item.gender), ''),
        nullif(trim(team_item.season), ''),
        nullif(trim(team_item.level), ''),
        nullif(trim(team_item.coach_name), ''),
        coalesce(nullif(trim(team_item.status), ''), 'active')
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

grant execute on function public.save_club_profile(text, text, integer, text, text, text, text, jsonb, jsonb) to authenticated;

