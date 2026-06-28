create or replace function public.filter_existing_team_columns(_payload jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'teams'
      and a.attname = item.key
      and a.attnum > 0
      and not a.attisdropped
  );
$$;

create or replace function public.insert_team_from_valid_payload(_payload jsonb)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  filtered_payload jsonb := public.filter_existing_team_columns(_payload);
  ignored_columns text[];
  insert_columns text;
  insert_values text;
  team_row public.teams;
begin
  select coalesce(array_agg(item.key order by item.key), '{}'::text[])
  into ignored_columns
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where not (filtered_payload ? item.key);

  raise notice 'teams insert payload before filtering: %', _payload;
  raise notice 'teams insert payload after filtering: %, ignored columns: %', filtered_payload, ignored_columns;

  select
    string_agg(quote_ident(a.attname), ', ' order by a.attnum),
    string_agg(
      case
        when t.typname = 'jsonb' then format('($1 -> %L)', a.attname)
        else format('($1 ->> %L)::%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
      end,
      ', ' order by a.attnum
    )
  into insert_columns, insert_values
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'teams'
    and a.attnum > 0
    and not a.attisdropped
    and filtered_payload ? a.attname
    and filtered_payload -> a.attname <> 'null'::jsonb;

  if insert_columns is null then
    raise exception 'No valid teams columns were provided.';
  end if;

  execute format('insert into public.teams (%s) values (%s) returning *', insert_columns, insert_values)
  using filtered_payload
  into team_row;

  return team_row;
end;
$$;

create or replace function public.update_team_from_valid_payload(_team_id uuid, _payload jsonb)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  filtered_payload jsonb := public.filter_existing_team_columns(_payload);
  ignored_columns text[];
  update_assignments text;
  team_row public.teams;
begin
  select coalesce(array_agg(item.key order by item.key), '{}'::text[])
  into ignored_columns
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where not (filtered_payload ? item.key);

  raise notice 'teams update payload before filtering: %', _payload;
  raise notice 'teams update payload after filtering: %, ignored columns: %', filtered_payload, ignored_columns;

  select string_agg(
    format(
      '%I = %s',
      a.attname,
      case
        when t.typname = 'jsonb' then format('($1 -> %L)', a.attname)
        else format('($1 ->> %L)::%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
      end
    ),
    ', ' order by a.attnum
  )
  into update_assignments
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'teams'
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'id'
    and a.attname <> 'created_at'
    and filtered_payload ? a.attname
    and filtered_payload -> a.attname <> 'null'::jsonb;

  if update_assignments is null then
    select *
    into team_row
    from public.teams
    where id = _team_id;

    return team_row;
  end if;

  execute format('update public.teams set %s where id = $2 returning *', update_assignments)
  using filtered_payload, _team_id
  into team_row;

  return team_row;
end;
$$;

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
  team_payload jsonb;
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
    team_payload := jsonb_build_object(
      'name', unique_team_name,
      'owner_user_id', v_user_id,
      'contact_email', coalesce(_contact_email, main_profile_row.email),
      'contact_phone', _contact_phone,
      'founded_year', _founded_year,
      'stadium', _home_field_address,
      'approval_status', 'approved',
      'team_type', resolved_team_type,
      'school_level', resolved_school_level,
      'school_name', case when resolved_team_type = 'school' then resolved_name else null end,
      'sport', case when resolved_team_type = 'school' then 'Soccer' else null end
    );

    begin
      select *
      into parent_team_row
      from public.insert_team_from_valid_payload(team_payload);
    exception
      when unique_violation then
        unique_team_name := resolved_name || ' ' || left(replace(v_user_id::text, '-', ''), 8);
        team_payload := jsonb_set(team_payload, '{name}', to_jsonb(unique_team_name));
        select *
        into parent_team_row
        from public.insert_team_from_valid_payload(team_payload);
    end;
  else
    team_payload := jsonb_build_object(
      'owner_user_id', coalesce(parent_team_row.owner_user_id, v_user_id),
      'name', coalesce(nullif(trim(parent_team_row.name), ''), resolved_name),
      'contact_email', coalesce(parent_team_row.contact_email, _contact_email, main_profile_row.email),
      'contact_phone', coalesce(parent_team_row.contact_phone, _contact_phone),
      'founded_year', coalesce(parent_team_row.founded_year, _founded_year),
      'stadium', coalesce(parent_team_row.stadium, _home_field_address),
      'approval_status', coalesce(parent_team_row.approval_status, 'approved'),
      'team_type', coalesce(nullif(parent_team_row.team_type, ''), resolved_team_type),
      'school_level', coalesce(parent_team_row.school_level, resolved_school_level),
      'school_name', case when resolved_team_type = 'school' then coalesce(parent_team_row.school_name, resolved_name) else null end,
      'sport', case when resolved_team_type = 'school' then coalesce(parent_team_row.sport, 'Soccer') else null end
    );

    select *
    into parent_team_row
    from public.update_team_from_valid_payload(parent_team_row.id, team_payload);
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

grant execute on function public.filter_existing_team_columns(jsonb) to authenticated;
grant execute on function public.insert_team_from_valid_payload(jsonb) to authenticated;
grant execute on function public.update_team_from_valid_payload(uuid, jsonb) to authenticated;
grant execute on function public.ensure_mother_team_profile(uuid, text, text, integer, text, text, text, text) to authenticated;
