ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_category text,
ADD COLUMN IF NOT EXISTS account_role text;

UPDATE public.profiles
SET account_category = CASE
    WHEN role = 'player' THEN 'player'
    WHEN role = 'parent' THEN 'parent'
    ELSE 'team_staff'
  END,
  account_role = CASE
    WHEN role = 'team' THEN 'team_club'
    WHEN role = 'coach' THEN 'head_coach_assistant'
    WHEN role IS NOT NULL THEN role::text
    ELSE account_role
  END
WHERE account_category IS NULL
   OR account_role IS NULL;

ALTER TABLE public.profiles
ALTER COLUMN account_category SET DEFAULT 'player',
ALTER COLUMN account_role SET DEFAULT 'player';

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_account_category_check,
DROP CONSTRAINT IF EXISTS profiles_account_role_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_account_category_check
CHECK (account_category IN ('player', 'team_staff', 'parent')),
ADD CONSTRAINT profiles_account_role_check
CHECK (account_role IN ('player', 'team_club', 'head_coach_assistant', 'scout', 'trainer', 'academy_director', 'parent'));

CREATE OR REPLACE FUNCTION public.complete_account_setup(_role text, _profile jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_selected_role text := nullif(trim(_role), '');
  v_legacy_role public.account_type;
  v_account_category text;
  v_account_role text;
  v_full_name text := nullif(trim(coalesce(_profile->>'fullName', '')), '');
  v_contact_email text := nullif(lower(trim(coalesce(_profile->>'contactEmail', ''))), '');
  v_team_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to complete account setup.';
  END IF;

  CASE v_selected_role
    WHEN 'player' THEN
      v_account_category := 'player';
      v_account_role := 'player';
      v_legacy_role := 'player';
    WHEN 'team_club' THEN
      v_account_category := 'team_staff';
      v_account_role := 'team_club';
      v_legacy_role := 'team';
    WHEN 'head_coach_assistant' THEN
      v_account_category := 'team_staff';
      v_account_role := 'head_coach_assistant';
      v_legacy_role := 'coach';
    WHEN 'scout' THEN
      v_account_category := 'team_staff';
      v_account_role := 'scout';
      v_legacy_role := 'scout';
    WHEN 'trainer' THEN
      v_account_category := 'team_staff';
      v_account_role := 'trainer';
      v_legacy_role := 'trainer';
    WHEN 'academy_director' THEN
      v_account_category := 'team_staff';
      v_account_role := 'academy_director';
      v_legacy_role := 'academy_director';
    WHEN 'parent' THEN
      v_account_category := 'parent';
      v_account_role := 'parent';
      v_legacy_role := 'parent';
    ELSE
      RAISE EXCEPTION 'Unsupported account role: %', coalesce(v_selected_role, 'null');
  END CASE;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, v_legacy_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET
    full_name = COALESCE(v_full_name, full_name),
    email = COALESCE(v_contact_email, email),
    role = v_legacy_role,
    account_category = v_account_category,
    account_role = v_account_role,
    team_name = COALESCE(nullif(trim(coalesce(_profile->>'team', '')), ''), team_name),
    club_name = COALESCE(nullif(trim(coalesce(_profile->>'clubName', '')), ''), club_name),
    position = COALESCE(nullif(trim(coalesce(_profile->>'position', '')), ''), position),
    height = COALESCE(nullif(trim(coalesce(_profile->>'height', '')), ''), height),
    weight = COALESCE(nullif(trim(coalesce(_profile->>'weight', '')), ''), weight),
    updated_at = now()
  WHERE user_id = v_user_id;

  IF v_account_role = 'player' THEN
    INSERT INTO public.player_profiles (
      user_id, full_name, date_of_birth, position, team, height, weight,
      contact_email, contact_phone, school_grade, preferred_foot, coach_email
    )
    VALUES (
      v_user_id,
      COALESCE(v_full_name, ''),
      nullif(_profile->>'dateOfBirth', '')::date,
      nullif(trim(coalesce(_profile->>'position', '')), ''),
      nullif(trim(coalesce(_profile->>'team', '')), ''),
      nullif(trim(coalesce(_profile->>'height', '')), ''),
      nullif(trim(coalesce(_profile->>'weight', '')), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      nullif(trim(coalesce(_profile->>'schoolGrade', '')), ''),
      nullif(trim(coalesce(_profile->>'preferredFoot', '')), ''),
      nullif(lower(trim(coalesce(_profile->>'coachEmail', ''))), '')
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      date_of_birth = EXCLUDED.date_of_birth,
      position = EXCLUDED.position,
      team = EXCLUDED.team,
      height = EXCLUDED.height,
      weight = EXCLUDED.weight,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      school_grade = EXCLUDED.school_grade,
      preferred_foot = EXCLUDED.preferred_foot,
      coach_email = EXCLUDED.coach_email,
      updated_at = now();

    INSERT INTO public.players (
      user_id, name, club, league, position, height, weight, contact_email, contact_phone, profile_image_url
    )
    VALUES (
      v_user_id,
      COALESCE(v_full_name, ''),
      COALESCE(nullif(trim(coalesce(_profile->>'team', '')), ''), ''),
      '',
      nullif(trim(coalesce(_profile->>'position', '')), ''),
      nullif(trim(coalesce(_profile->>'height', '')), ''),
      nullif(trim(coalesce(_profile->>'weight', '')), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      null
    )
    ON CONFLICT (user_id) DO UPDATE SET
      name = EXCLUDED.name,
      club = EXCLUDED.club,
      position = EXCLUDED.position,
      height = EXCLUDED.height,
      weight = EXCLUDED.weight,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone;
  ELSIF v_account_role = 'team_club' THEN
    INSERT INTO public.team_profiles (
      user_id, club_name, leagues_offered, founded_year, country, city,
      home_stadium, training_ground, age_groups_offered, contact_email, contact_phone
    )
    VALUES (
      v_user_id,
      COALESCE(nullif(trim(coalesce(_profile->>'clubName', '')), ''), ''),
      CASE WHEN nullif(trim(coalesce(_profile->>'leaguesOffered', '')), '') IS NULL THEN NULL ELSE string_to_array(_profile->>'leaguesOffered', ',') END,
      nullif(_profile->>'foundedYear', '')::integer,
      nullif(trim(coalesce(_profile->>'country', '')), ''),
      nullif(trim(coalesce(_profile->>'city', '')), ''),
      nullif(trim(coalesce(_profile->>'homeStadium', '')), ''),
      nullif(trim(coalesce(_profile->>'trainingGround', '')), ''),
      CASE WHEN nullif(trim(coalesce(_profile->>'ageGroupsOffered', '')), '') IS NULL THEN NULL ELSE string_to_array(_profile->>'ageGroupsOffered', ',') END,
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), '')
    )
    ON CONFLICT (user_id) DO UPDATE SET
      club_name = EXCLUDED.club_name,
      leagues_offered = EXCLUDED.leagues_offered,
      founded_year = EXCLUDED.founded_year,
      country = EXCLUDED.country,
      city = EXCLUDED.city,
      home_stadium = EXCLUDED.home_stadium,
      training_ground = EXCLUDED.training_ground,
      age_groups_offered = EXCLUDED.age_groups_offered,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      updated_at = now();

    INSERT INTO public.teams (
      name, league_id, owner_user_id, age_group, contact_email, contact_phone, founded_year, stadium, approval_status
    )
    VALUES (
      COALESCE(nullif(trim(coalesce(_profile->>'clubName', '')), ''), ''),
      (
        SELECT id
        FROM public.leagues
        WHERE name = nullif(trim(split_part(coalesce(_profile->>'leaguesOffered', ''), ',', 1)), '')
        LIMIT 1
      ),
      v_user_id,
      nullif(trim(split_part(coalesce(_profile->>'ageGroupsOffered', ''), ',', 1)), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      nullif(_profile->>'foundedYear', '')::integer,
      nullif(trim(coalesce(_profile->>'homeStadium', '')), ''),
      'pending'
    )
    ON CONFLICT (name) DO UPDATE SET
      owner_user_id = EXCLUDED.owner_user_id,
      age_group = COALESCE(EXCLUDED.age_group, public.teams.age_group),
      contact_email = COALESCE(EXCLUDED.contact_email, public.teams.contact_email),
      contact_phone = COALESCE(EXCLUDED.contact_phone, public.teams.contact_phone),
      founded_year = COALESCE(EXCLUDED.founded_year, public.teams.founded_year),
      stadium = COALESCE(EXCLUDED.stadium, public.teams.stadium)
    RETURNING id INTO v_team_id;

    IF v_team_id IS NULL THEN
      SELECT id INTO v_team_id
      FROM public.teams
      WHERE name = COALESCE(nullif(trim(coalesce(_profile->>'clubName', '')), ''), '')
      LIMIT 1;
    END IF;

    UPDATE public.team_profiles
    SET team_id = v_team_id,
        updated_at = now()
    WHERE user_id = v_user_id;
  ELSIF v_account_category = 'team_staff' THEN
    INSERT INTO public.staff_profiles (
      user_id, full_name, role, team_organization_name, country, city,
      coaching_level, years_experience, coaching_licenses, age_groups_coached,
      contact_email, contact_phone, previous_teams, notable_achievements
    )
    VALUES (
      v_user_id,
      COALESCE(v_full_name, ''),
      v_legacy_role,
      nullif(trim(coalesce(_profile->>'teamOrganizationName', '')), ''),
      nullif(trim(coalesce(_profile->>'country', '')), ''),
      nullif(trim(coalesce(_profile->>'city', '')), ''),
      nullif(_profile->>'coachingLevel', '')::public.coaching_level,
      nullif(_profile->>'yearsExperience', '')::integer,
      CASE WHEN nullif(trim(coalesce(_profile->>'coachingLicenses', '')), '') IS NULL THEN NULL ELSE string_to_array(_profile->>'coachingLicenses', ',') END,
      CASE WHEN nullif(trim(coalesce(_profile->>'ageGroupsCoached', '')), '') IS NULL THEN NULL ELSE string_to_array(_profile->>'ageGroupsCoached', ',') END,
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), ''),
      CASE WHEN nullif(trim(coalesce(_profile->>'previousTeams', '')), '') IS NULL THEN NULL ELSE string_to_array(_profile->>'previousTeams', ',') END,
      nullif(trim(coalesce(_profile->>'notableAchievements', '')), '')
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      team_organization_name = EXCLUDED.team_organization_name,
      country = EXCLUDED.country,
      city = EXCLUDED.city,
      coaching_level = EXCLUDED.coaching_level,
      years_experience = EXCLUDED.years_experience,
      coaching_licenses = EXCLUDED.coaching_licenses,
      age_groups_coached = EXCLUDED.age_groups_coached,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      previous_teams = EXCLUDED.previous_teams,
      notable_achievements = EXCLUDED.notable_achievements,
      updated_at = now();
  ELSIF v_account_role = 'parent' THEN
    INSERT INTO public.parent_profiles (user_id, full_name, relationship_to_player, contact_email, contact_phone)
    VALUES (
      v_user_id,
      COALESCE(v_full_name, ''),
      nullif(trim(coalesce(_profile->>'relationshipToPlayer', '')), ''),
      v_contact_email,
      nullif(trim(coalesce(_profile->>'contactPhone', '')), '')
    )
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      relationship_to_player = EXCLUDED.relationship_to_player,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      updated_at = now();
  END IF;
END;
$$;
