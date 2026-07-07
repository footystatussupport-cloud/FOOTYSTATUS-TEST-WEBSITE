-- Head coach selection for club / daughter teams links a real Coach account
-- (stored by account ID) instead of relying only on typed text. Manual text
-- remains supported for coaches who do not have an account yet.

alter table public.club_teams
  add column if not exists head_coach_user_id uuid references auth.users(id) on delete set null;

create index if not exists club_teams_head_coach_user_id_idx
  on public.club_teams (head_coach_user_id);

-- save_club_profile now persists the linked coach account for both updated
-- and newly created daughter teams. The jsonb payload gains head_coach_user_id;
-- the function signature is unchanged.
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
      head_coach_user_id uuid,
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
          head_coach_user_id = team_item.head_coach_user_id,
          status = coalesce(nullif(trim(team_item.status), ''), 'active'),
          team_type = coalesce(nullif(trim(team_item.team_type), ''), v_team_type, 'club'),
          school_level = coalesce(nullif(trim(team_item.school_level), ''), v_school_level),
          updated_at = now()
      where id = team_item.id
        and club_id = v_club.id;
    else
      created_team := null;
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

      if created_team.id is not null and team_item.head_coach_user_id is not null then
        update public.club_teams
        set head_coach_user_id = team_item.head_coach_user_id,
            updated_at = now()
        where id = created_team.id;
      end if;
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

grant execute on function public.save_club_profile(text, text, integer, text, text, text, text, jsonb, jsonb) to authenticated;
