create or replace function public.is_incomplete_signup_profile(_profile public.profiles)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    _profile.account_category is null
    or _profile.account_type is null
    or _profile.account_role is null
    or (
      coalesce(_profile.account_role, _profile.account_type, _profile.role::text) = 'player'
      and not exists (select 1 from public.player_profiles pp where pp.user_id = _profile.user_id)
    )
    or (
      coalesce(_profile.account_role, _profile.account_type, _profile.role::text) = 'parent'
      and not exists (select 1 from public.parent_profiles par where par.user_id = _profile.user_id)
    )
    or (
      coalesce(_profile.account_category, '') = 'team_staff'
      and coalesce(_profile.account_role, _profile.account_type, _profile.role::text) not in ('team_club', 'school_team')
      and not exists (select 1 from public.staff_profiles sp where sp.user_id = _profile.user_id)
    )
    or (
      coalesce(_profile.account_role, _profile.account_type, _profile.role::text) in ('team_club', 'school_team', 'team')
      and not exists (select 1 from public.team_profiles tp where tp.user_id = _profile.user_id)
    )
    or (
      coalesce(_profile.account_role, _profile.account_type, _profile.role::text) = 'referee'
      and (
        _profile.referee_certification_level is null
        or _profile.referee_certifying_organization is null
        or _profile.referee_years_experience is null
      )
    );
$$;

create or replace function public.release_incomplete_signup_username(_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text;
  released_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  normalized_username := public.normalize_username(_username);

  if normalized_username = '' then
    return false;
  end if;

  update public.profiles p
  set
    username = public.generate_unique_username('incomplete_' || left(p.user_id::text, 8), p.user_id),
    username_last_changed_at = null
  where lower(p.username) = lower(normalized_username)
    and p.user_id is distinct from auth.uid()
    and public.is_incomplete_signup_profile(p);

  get diagnostics released_count = row_count;
  return released_count > 0;
end;
$$;

grant execute on function public.release_incomplete_signup_username(text) to authenticated;

create or replace function public.finish_account_onboarding(_role text, _profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_selected_role text := public.normalize_signup_account_role(_role, _profile->>'staffType');
  v_account_category text;
  v_legacy_role public.account_type;
  v_username text := public.normalize_username(_profile->>'username');
  v_full_name text := nullif(trim(coalesce(_profile->>'fullName', _profile->>'clubName', _profile->>'schoolName', '')), '');
  v_email text := nullif(lower(trim(coalesce(_profile->>'contactEmail', _profile->>'email', ''))), '');
  v_team_name text := nullif(trim(coalesce(_profile->>'team', _profile->>'clubName', _profile->>'schoolName', _profile->>'teamOrganizationName', '')), '');
  v_existing public.profiles;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to create your account.';
  end if;

  if v_selected_role is null then
    raise exception 'Account type is required.';
  end if;

  if not public.is_valid_username(v_username) then
    raise exception 'Username is invalid.';
  end if;

  v_account_category := public.account_category_for_role(v_selected_role);
  v_legacy_role := public.legacy_role_for_account_role(v_selected_role);

  select *
  into v_existing
  from public.profiles p
  where lower(p.username) = lower(v_username)
    and p.user_id is distinct from v_user_id
  limit 1;

  if found then
    if public.is_incomplete_signup_profile(v_existing) then
      update public.profiles p
      set
        username = public.generate_unique_username('incomplete_' || left(p.user_id::text, 8), p.user_id),
        username_last_changed_at = null
      where p.id = v_existing.id;
    else
      raise exception 'Username already taken. Please choose another.';
    end if;
  end if;

  insert into public.user_roles (user_id, role)
  values (v_user_id, v_legacy_role)
  on conflict (user_id, role) do nothing;

  insert into public.profiles (
    user_id,
    full_name,
    username,
    bio,
    email,
    role,
    account_category,
    account_type,
    account_role,
    team_name,
    club_name,
    position,
    height,
    weight,
    coaching_role_type,
    teams_currently_coaching,
    past_coaching_experience,
    coaching_licenses,
    coaching_accolades,
    coaching_location,
    scout_role_title,
    scout_organization,
    scouting_licenses,
    scouting_experience,
    scouting_regions,
    scouting_age_groups,
    scouting_positions,
    scouting_accolades,
    referee_certification_level,
    referee_license_number,
    referee_certifying_organization,
    referee_years_experience,
    referee_main_experience,
    referee_assistant_experience,
    referee_leagues_tournaments,
    referee_availability,
    referee_certification_proof_url,
    referee_accolades,
    referee_profile_public
  )
  values (
    v_user_id,
    coalesce(v_full_name, ''),
    v_username,
    nullif(left(trim(coalesce(_profile->>'bio', '')), 100), ''),
    v_email,
    v_legacy_role,
    v_account_category,
    v_selected_role,
    v_selected_role,
    v_team_name,
    nullif(trim(coalesce(_profile->>'clubName', _profile->>'schoolName', '')), ''),
    nullif(trim(coalesce(_profile->>'position', '')), ''),
    nullif(trim(coalesce(_profile->>'height', '')), ''),
    nullif(trim(coalesce(_profile->>'weight', '')), ''),
    nullif(trim(coalesce(_profile->>'coachingRoleType', '')), ''),
    nullif(trim(coalesce(_profile->>'teamOrganizationName', _profile->>'scoutOrganization', '')), ''),
    nullif(trim(coalesce(_profile->>'previousTeams', _profile->>'scoutingExperience', '')), ''),
    string_to_array(nullif(trim(coalesce(_profile->>'coachingLicenses', _profile->>'scoutingLicenses', '')), ''), ','),
    nullif(trim(coalesce(_profile->>'notableAchievements', _profile->>'scoutingAccolades', '')), ''),
    nullif(trim(coalesce(_profile->>'city', '')), ''),
    case when v_selected_role = 'scout' then nullif(trim(coalesce(_profile->>'scoutRoleTitle', '')), '') else null end,
    case when v_selected_role = 'scout' then nullif(trim(coalesce(_profile->>'scoutOrganization', '')), '') else null end,
    case when v_selected_role = 'scout' then string_to_array(nullif(trim(coalesce(_profile->>'scoutingLicenses', '')), ''), ',') else null end,
    case when v_selected_role = 'scout' then nullif(trim(coalesce(_profile->>'scoutingExperience', '')), '') else null end,
    case when v_selected_role = 'scout' then nullif(trim(coalesce(_profile->>'scoutingRegions', '')), '') else null end,
    case when v_selected_role = 'scout' then string_to_array(nullif(trim(coalesce(_profile->>'scoutingAgeGroups', '')), ''), ',') else null end,
    case when v_selected_role = 'scout' then string_to_array(nullif(trim(coalesce(_profile->>'scoutingPositions', '')), ''), ',') else null end,
    case when v_selected_role = 'scout' then nullif(trim(coalesce(_profile->>'scoutingAccolades', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeCertificationLevel', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeLicenseNumber', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeCertifyingOrganization', '')), '') else null end,
    case when v_selected_role = 'referee' and nullif(trim(coalesce(_profile->>'refereeYearsExperience', '')), '') is not null then (_profile->>'refereeYearsExperience')::integer else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeMainExperience', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeAssistantExperience', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeLeaguesTournaments', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeAvailability', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeCertificationProofUrl', '')), '') else null end,
    case when v_selected_role = 'referee' then nullif(trim(coalesce(_profile->>'refereeAccolades', '')), '') else null end,
    case when v_selected_role = 'referee' then coalesce((_profile->>'refereeProfilePublic')::boolean, false) else null end
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    username = excluded.username,
    bio = excluded.bio,
    email = excluded.email,
    role = excluded.role,
    account_category = excluded.account_category,
    account_type = excluded.account_type,
    account_role = excluded.account_role,
    team_name = excluded.team_name,
    club_name = excluded.club_name,
    position = excluded.position,
    height = excluded.height,
    weight = excluded.weight,
    coaching_role_type = excluded.coaching_role_type,
    teams_currently_coaching = excluded.teams_currently_coaching,
    past_coaching_experience = excluded.past_coaching_experience,
    coaching_licenses = excluded.coaching_licenses,
    coaching_accolades = excluded.coaching_accolades,
    coaching_location = excluded.coaching_location,
    scout_role_title = excluded.scout_role_title,
    scout_organization = excluded.scout_organization,
    scouting_licenses = excluded.scouting_licenses,
    scouting_experience = excluded.scouting_experience,
    scouting_regions = excluded.scouting_regions,
    scouting_age_groups = excluded.scouting_age_groups,
    scouting_positions = excluded.scouting_positions,
    scouting_accolades = excluded.scouting_accolades,
    referee_certification_level = excluded.referee_certification_level,
    referee_license_number = excluded.referee_license_number,
    referee_certifying_organization = excluded.referee_certifying_organization,
    referee_years_experience = excluded.referee_years_experience,
    referee_main_experience = excluded.referee_main_experience,
    referee_assistant_experience = excluded.referee_assistant_experience,
    referee_leagues_tournaments = excluded.referee_leagues_tournaments,
    referee_availability = excluded.referee_availability,
    referee_certification_proof_url = excluded.referee_certification_proof_url,
    referee_accolades = excluded.referee_accolades,
    referee_profile_public = excluded.referee_profile_public,
    updated_at = now();

  if v_selected_role = 'player' then
    insert into public.player_profiles (
      user_id, full_name, date_of_birth, position, team, height, weight,
      contact_email, contact_phone, school_grade, preferred_foot, coach_email,
      jersey_number, player_gender
    )
    values (
      v_user_id, coalesce(v_full_name, ''), nullif(_profile->>'dateOfBirth', '')::date,
      nullif(trim(coalesce(_profile->>'position', '')), ''), nullif(trim(coalesce(_profile->>'team', '')), ''),
      nullif(trim(coalesce(_profile->>'height', '')), ''), nullif(trim(coalesce(_profile->>'weight', '')), ''),
      v_email, nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
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
  elsif v_selected_role = 'parent' then
    insert into public.parent_profiles (
      user_id, full_name, relationship_to_player, contact_email, contact_phone,
      emergency_contact, child_full_name, child_where_plays, child_team,
      child_league, child_age_group, parent_notes
    )
    values (
      v_user_id, coalesce(v_full_name, ''),
      nullif(trim(coalesce(_profile->>'relationshipToPlayer', '')), ''),
      v_email, nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
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
  elsif v_account_category = 'team_staff' and v_selected_role not in ('team_club', 'school_team') then
    insert into public.staff_profiles (
      user_id, full_name, role, team_organization_name, country, city,
      coaching_level, years_experience, coaching_licenses, age_groups_coached,
      contact_email, contact_phone, previous_teams, notable_achievements
    )
    values (
      v_user_id, coalesce(v_full_name, ''),
      case when v_selected_role = 'academy_director' then 'academy_director' when v_selected_role = 'scout' then 'scout' else 'coach' end,
      nullif(trim(coalesce(_profile->>'teamOrganizationName', _profile->>'scoutOrganization', '')), ''),
      nullif(trim(coalesce(_profile->>'country', '')), ''),
      nullif(trim(coalesce(_profile->>'city', '')), ''),
      nullif(trim(coalesce(_profile->>'coachingLevel', '')), ''),
      nullif(trim(coalesce(_profile->>'yearsExperience', '')), '')::integer,
      string_to_array(nullif(trim(coalesce(_profile->>'coachingLicenses', _profile->>'scoutingLicenses', '')), ''), ','),
      string_to_array(nullif(trim(coalesce(_profile->>'ageGroupsCoached', _profile->>'scoutingAgeGroups', '')), ''), ','),
      v_email, nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
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
  elsif v_selected_role in ('team_club', 'school_team') then
    insert into public.team_profiles (
      user_id, club_name, leagues_offered, founded_year, city, country,
      home_stadium, training_ground, home_jersey_color, away_jersey_color,
      third_kit_color, age_groups_offered, contact_email, contact_phone,
      team_type, school_level, school_name, team_mascot, sport,
      league_conference, school_website, head_coach_name, head_coach_email,
      head_coach_phone, team_colors, social_links
    )
    values (
      v_user_id,
      nullif(trim(coalesce(_profile->>'clubName', _profile->>'schoolName', '')), ''),
      array[]::text[],
      nullif(trim(coalesce(_profile->>'foundedYear', '')), '')::integer,
      nullif(trim(coalesce(_profile->>'city', '')), ''),
      nullif(trim(coalesce(_profile->>'country', '')), ''),
      nullif(trim(coalesce(_profile->>'homeFieldAddress', '')), ''),
      nullif(trim(coalesce(_profile->>'trainingGroundAddress', '')), ''),
      nullif(trim(coalesce(_profile->>'homeJerseyColor', '')), ''),
      nullif(trim(coalesce(_profile->>'awayJerseyColor', '')), ''),
      nullif(trim(coalesce(_profile->>'thirdKitColor', '')), ''),
      array[]::text[],
      v_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      case when v_selected_role = 'school_team' then 'school' else 'club' end,
      nullif(trim(coalesce(_profile->>'schoolLevel', '')), ''),
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'schoolName', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'teamMascot', '')), '') else null end,
      case when v_selected_role = 'school_team' then coalesce(nullif(trim(_profile->>'sport'), ''), 'Soccer') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'leagueConference', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'schoolWebsite', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'headCoachName', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'headCoachEmail', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'headCoachPhone', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'teamColors', '')), '') else null end,
      case when v_selected_role = 'school_team' then nullif(trim(coalesce(_profile->>'socialLinks', '')), '') else null end
    )
    on conflict (user_id) do update set
      club_name = excluded.club_name,
      founded_year = excluded.founded_year,
      city = excluded.city,
      country = excluded.country,
      home_stadium = excluded.home_stadium,
      training_ground = excluded.training_ground,
      home_jersey_color = excluded.home_jersey_color,
      away_jersey_color = excluded.away_jersey_color,
      third_kit_color = excluded.third_kit_color,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      team_type = excluded.team_type,
      school_level = excluded.school_level,
      school_name = excluded.school_name,
      team_mascot = excluded.team_mascot,
      sport = excluded.sport,
      league_conference = excluded.league_conference,
      school_website = excluded.school_website,
      head_coach_name = excluded.head_coach_name,
      head_coach_email = excluded.head_coach_email,
      head_coach_phone = excluded.head_coach_phone,
      team_colors = excluded.team_colors,
      social_links = excluded.social_links,
      updated_at = now();
  end if;

  return jsonb_build_object('user_id', v_user_id, 'account_role', v_selected_role, 'username', v_username);
end;
$$;

grant execute on function public.finish_account_onboarding(text, jsonb) to authenticated;
