alter type public.account_type add value if not exists 'referee';

alter table public.profiles
  drop constraint if exists profiles_account_role_check;

alter table public.profiles
  add constraint profiles_account_role_check
  check (
    account_role is null
    or account_role in (
      'player',
      'team_club',
      'school_team',
      'head_coach_assistant',
      'scout',
      'trainer',
      'academy_director',
      'parent',
      'referee'
    )
  );

alter table public.player_profiles
  add column if not exists jersey_number text,
  add column if not exists player_gender text,
  add column if not exists coach_email text,
  add column if not exists preferred_foot text,
  add column if not exists school_grade text;

create unique index if not exists idx_player_profiles_user_id_unique
  on public.player_profiles(user_id);

create unique index if not exists idx_parent_profiles_user_id_unique
  on public.parent_profiles(user_id);

create unique index if not exists idx_staff_profiles_user_id_unique
  on public.staff_profiles(user_id);

create unique index if not exists idx_team_profiles_user_id_unique
  on public.team_profiles(user_id);

create or replace function public.complete_account_setup(_role text, _profile jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_selected_role text := nullif(trim(_role), '');
  v_legacy_role public.account_type;
  v_account_category text;
  v_account_role text;
  v_full_name text := nullif(trim(coalesce(_profile->>'fullName', _profile->>'clubName', _profile->>'schoolName', '')), '');
  v_contact_email text := nullif(lower(trim(coalesce(_profile->>'contactEmail', _profile->>'email', ''))), '');
  v_team_name text := nullif(trim(coalesce(_profile->>'team', _profile->>'clubName', _profile->>'schoolName', _profile->>'teamOrganizationName', '')), '');
begin
  if v_user_id is null then
    raise exception 'You must be signed in to complete account setup.';
  end if;

  case v_selected_role
    when 'player' then
      v_account_category := 'player';
      v_account_role := 'player';
      v_legacy_role := 'player';
    when 'parent' then
      v_account_category := 'parent';
      v_account_role := 'parent';
      v_legacy_role := 'parent';
    when 'referee' then
      v_account_category := 'referee';
      v_account_role := 'referee';
      v_legacy_role := 'referee';
    when 'team_club' then
      v_account_category := 'team_staff';
      v_account_role := 'team_club';
      v_legacy_role := 'team';
    when 'school_team' then
      v_account_category := 'team_staff';
      v_account_role := 'school_team';
      v_legacy_role := 'team';
    when 'head_coach_assistant' then
      v_account_category := 'team_staff';
      v_account_role := 'head_coach_assistant';
      v_legacy_role := 'coach';
    when 'scout' then
      v_account_category := 'team_staff';
      v_account_role := 'scout';
      v_legacy_role := 'scout';
    when 'trainer' then
      v_account_category := 'team_staff';
      v_account_role := 'trainer';
      v_legacy_role := 'trainer';
    when 'academy_director' then
      v_account_category := 'team_staff';
      v_account_role := 'academy_director';
      v_legacy_role := 'academy_director';
    else
      raise exception 'Unsupported account role: %', coalesce(v_selected_role, 'null');
  end case;

  insert into public.user_roles (user_id, role)
  values (v_user_id, v_legacy_role)
  on conflict (user_id, role) do nothing;

  update public.profiles
  set
    full_name = coalesce(v_full_name, full_name),
    username = coalesce(nullif(trim(coalesce(_profile->>'username', '')), ''), username),
    bio = coalesce(nullif(left(trim(coalesce(_profile->>'bio', '')), 100), ''), bio),
    email = coalesce(v_contact_email, email),
    role = v_legacy_role,
    account_category = v_account_category,
    account_role = v_account_role,
    team_name = coalesce(v_team_name, team_name),
    club_name = coalesce(nullif(trim(coalesce(_profile->>'clubName', _profile->>'schoolName', '')), ''), club_name),
    position = coalesce(nullif(trim(coalesce(_profile->>'position', '')), ''), position),
    height = coalesce(nullif(trim(coalesce(_profile->>'height', '')), ''), height),
    weight = coalesce(nullif(trim(coalesce(_profile->>'weight', '')), ''), weight),
    updated_at = now()
  where user_id = v_user_id;

  if not found then
    insert into public.profiles (
      user_id,
      full_name,
      username,
      bio,
      email,
      role,
      account_category,
      account_role,
      team_name,
      club_name,
      position,
      height,
      weight
    )
    values (
      v_user_id,
      coalesce(v_full_name, ''),
      nullif(trim(coalesce(_profile->>'username', '')), ''),
      nullif(left(trim(coalesce(_profile->>'bio', '')), 100), ''),
      v_contact_email,
      v_legacy_role,
      v_account_category,
      v_account_role,
      v_team_name,
      nullif(trim(coalesce(_profile->>'clubName', _profile->>'schoolName', '')), ''),
      nullif(trim(coalesce(_profile->>'position', '')), ''),
      nullif(trim(coalesce(_profile->>'height', '')), ''),
      nullif(trim(coalesce(_profile->>'weight', '')), '')
    );
  end if;

  if v_account_role = 'player' then
    insert into public.player_profiles (
      user_id,
      full_name,
      date_of_birth,
      position,
      team,
      height,
      weight,
      contact_email,
      contact_phone,
      school_grade,
      preferred_foot,
      coach_email,
      jersey_number,
      player_gender
    )
    values (
      v_user_id,
      coalesce(v_full_name, ''),
      nullif(_profile->>'dateOfBirth', '')::date,
      nullif(trim(coalesce(_profile->>'position', '')), ''),
      nullif(trim(coalesce(_profile->>'team', '')), ''),
      nullif(trim(coalesce(_profile->>'height', '')), ''),
      nullif(trim(coalesce(_profile->>'weight', '')), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      nullif(trim(coalesce(_profile->>'schoolGrade', '')), ''),
      nullif(trim(coalesce(_profile->>'preferredFoot', '')), ''),
      nullif(lower(trim(coalesce(_profile->>'coachEmail', ''))), ''),
      nullif(trim(coalesce(_profile->>'jerseyNumber', '')), ''),
      nullif(trim(coalesce(_profile->>'gender', '')), '')
    )
    on conflict (user_id) do update set
      full_name = excluded.full_name,
      date_of_birth = excluded.date_of_birth,
      position = excluded.position,
      team = excluded.team,
      height = excluded.height,
      weight = excluded.weight,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      school_grade = excluded.school_grade,
      preferred_foot = excluded.preferred_foot,
      coach_email = excluded.coach_email,
      jersey_number = excluded.jersey_number,
      player_gender = excluded.player_gender,
      updated_at = now();
  elsif v_account_category = 'parent' then
    insert into public.parent_profiles (
      user_id,
      full_name,
      relationship_to_player,
      contact_email,
      contact_phone,
      emergency_contact,
      child_full_name,
      child_where_plays,
      child_team,
      child_league,
      child_age_group,
      parent_notes
    )
    values (
      v_user_id,
      coalesce(v_full_name, ''),
      nullif(trim(coalesce(_profile->>'relationshipToPlayer', '')), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      nullif(trim(coalesce(_profile->>'emergencyContact', '')), ''),
      nullif(trim(coalesce(_profile->>'childFullName', '')), ''),
      nullif(trim(coalesce(_profile->>'childWherePlays', '')), ''),
      nullif(trim(coalesce(_profile->>'childTeam', '')), ''),
      nullif(trim(coalesce(_profile->>'childLeague', '')), ''),
      nullif(trim(coalesce(_profile->>'childAgeGroup', '')), ''),
      nullif(trim(coalesce(_profile->>'parentNotes', '')), '')
    )
    on conflict (user_id) do update set
      full_name = excluded.full_name,
      relationship_to_player = excluded.relationship_to_player,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      emergency_contact = excluded.emergency_contact,
      child_full_name = excluded.child_full_name,
      child_where_plays = excluded.child_where_plays,
      child_team = excluded.child_team,
      child_league = excluded.child_league,
      child_age_group = excluded.child_age_group,
      parent_notes = excluded.parent_notes,
      updated_at = now();
  elsif v_account_category = 'team_staff' and v_account_role not in ('team_club', 'school_team') then
    insert into public.staff_profiles (
      user_id,
      full_name,
      role,
      team_organization_name,
      country,
      city,
      coaching_level,
      years_experience,
      coaching_licenses,
      age_groups_coached,
      contact_email,
      contact_phone,
      previous_teams,
      notable_achievements
    )
    values (
      v_user_id,
      coalesce(v_full_name, ''),
      case when v_account_role = 'academy_director' then 'academy_director' when v_account_role = 'scout' then 'scout' else 'coach' end,
      nullif(trim(coalesce(_profile->>'teamOrganizationName', _profile->>'scoutOrganization', '')), ''),
      nullif(trim(coalesce(_profile->>'country', '')), ''),
      nullif(trim(coalesce(_profile->>'city', '')), ''),
      nullif(trim(coalesce(_profile->>'coachingLevel', '')), ''),
      nullif(trim(coalesce(_profile->>'yearsExperience', '')), '')::integer,
      string_to_array(nullif(trim(coalesce(_profile->>'coachingLicenses', _profile->>'scoutingLicenses', '')), ''), ','),
      string_to_array(nullif(trim(coalesce(_profile->>'ageGroupsCoached', _profile->>'scoutingAgeGroups', '')), ''), ','),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      string_to_array(nullif(trim(coalesce(_profile->>'previousTeams', _profile->>'scoutingExperience', '')), ''), ','),
      nullif(trim(coalesce(_profile->>'notableAchievements', _profile->>'scoutingAccolades', '')), '')
    )
    on conflict (user_id) do update set
      full_name = excluded.full_name,
      role = excluded.role,
      team_organization_name = excluded.team_organization_name,
      country = excluded.country,
      city = excluded.city,
      coaching_level = excluded.coaching_level,
      years_experience = excluded.years_experience,
      coaching_licenses = excluded.coaching_licenses,
      age_groups_coached = excluded.age_groups_coached,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      previous_teams = excluded.previous_teams,
      notable_achievements = excluded.notable_achievements,
      updated_at = now();
  end if;
end;
$$;
