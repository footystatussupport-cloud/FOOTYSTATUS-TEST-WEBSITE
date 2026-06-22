ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS age_group text,
ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'approved';

ALTER TABLE public.team_staff
ADD COLUMN IF NOT EXISTS personal_email text;

DROP POLICY IF EXISTS "Team owners can insert their own teams" ON public.teams;
CREATE POLICY "Team owners can insert their own teams"
ON public.teams
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Team owners can update their own teams" ON public.teams;
CREATE POLICY "Team owners can update their own teams"
ON public.teams
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

CREATE OR REPLACE FUNCTION public.save_team_account_profile(
  _club_name text,
  _leagues_offered text[],
  _age_groups_offered text[],
  _city text,
  _home_stadium text,
  _training_ground text,
  _contact_email text,
  _contact_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_league_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT id INTO v_league_id
  FROM public.leagues
  WHERE lower(name) = lower(coalesce(_leagues_offered[1], ''))
  LIMIT 1;

  INSERT INTO public.profiles (user_id, full_name, club_name, email, account_category, account_role, role)
  VALUES (v_user_id, _club_name, _club_name, _contact_email, 'team_staff', 'team_club', 'team')
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    club_name = EXCLUDED.club_name,
    email = EXCLUDED.email,
    account_category = 'team_staff',
    account_role = 'team_club',
    role = 'team',
    updated_at = now();

  INSERT INTO public.team_profiles (
    user_id,
    club_name,
    leagues_offered,
    city,
    home_stadium,
    training_ground,
    age_groups_offered,
    contact_email,
    contact_phone
  )
  VALUES (
    v_user_id,
    _club_name,
    _leagues_offered,
    _city,
    _home_stadium,
    _training_ground,
    _age_groups_offered,
    _contact_email,
    _contact_phone
  )
  ON CONFLICT (user_id) DO UPDATE SET
    club_name = EXCLUDED.club_name,
    leagues_offered = EXCLUDED.leagues_offered,
    city = EXCLUDED.city,
    home_stadium = EXCLUDED.home_stadium,
    training_ground = EXCLUDED.training_ground,
    age_groups_offered = EXCLUDED.age_groups_offered,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    updated_at = now();

  SELECT id INTO v_team_id
  FROM public.teams
  WHERE owner_user_id = v_user_id
  LIMIT 1;

  IF v_team_id IS NULL THEN
    INSERT INTO public.teams (
      name,
      league_id,
      owner_user_id,
      age_group,
      contact_email,
      contact_phone,
      stadium,
      approval_status
    )
    VALUES (
      _club_name,
      v_league_id,
      v_user_id,
      _age_groups_offered[1],
      _contact_email,
      _contact_phone,
      _home_stadium,
      'approved'
    )
    RETURNING id INTO v_team_id;
  ELSE
    UPDATE public.teams
    SET
      name = _club_name,
      league_id = v_league_id,
      age_group = _age_groups_offered[1],
      contact_email = _contact_email,
      contact_phone = _contact_phone,
      stadium = _home_stadium,
      owner_user_id = v_user_id,
      approval_status = 'approved'
    WHERE id = v_team_id;
  END IF;

  UPDATE public.team_profiles
  SET team_id = v_team_id,
      updated_at = now()
  WHERE user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_staff_account_profile(
  _role text,
  _full_name text,
  _team_organization_name text,
  _city text,
  _coaching_level text,
  _years_experience integer,
  _coaching_licenses text[],
  _age_groups_coached text[],
  _contact_email text,
  _contact_phone text,
  _previous_teams text[],
  _notable_achievements text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role public.account_type := _role::public.account_type;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  INSERT INTO public.profiles (user_id, full_name, email, account_category, account_role, role)
  VALUES (
    v_user_id,
    _full_name,
    _contact_email,
    'team_staff',
    CASE
      WHEN _role = 'coach' THEN 'head_coach_assistant'
      ELSE _role
    END,
    v_role
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    account_category = 'team_staff',
    account_role = CASE
      WHEN _role = 'coach' THEN 'head_coach_assistant'
      ELSE _role
    END,
    role = v_role,
    updated_at = now();

  INSERT INTO public.staff_profiles (
    user_id,
    full_name,
    role,
    team_organization_name,
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
  VALUES (
    v_user_id,
    _full_name,
    v_role,
    _team_organization_name,
    _city,
    nullif(_coaching_level, '')::public.coaching_level,
    _years_experience,
    _coaching_licenses,
    _age_groups_coached,
    _contact_email,
    _contact_phone,
    _previous_teams,
    _notable_achievements
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    team_organization_name = EXCLUDED.team_organization_name,
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
END;
$$;
