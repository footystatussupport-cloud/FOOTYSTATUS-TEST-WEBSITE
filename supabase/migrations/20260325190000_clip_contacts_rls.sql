ALTER TABLE public.clips
ADD COLUMN IF NOT EXISTS caption text,
ADD COLUMN IF NOT EXISTS duration integer;

UPDATE public.clips
SET caption = COALESCE(caption, description)
WHERE caption IS NULL
  AND description IS NOT NULL;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role public.account_type;

UPDATE public.profiles p
SET role = ur.role
FROM (
  SELECT DISTINCT ON (user_id) user_id, role
  FROM public.user_roles
  ORDER BY user_id, created_at ASC
) ur
WHERE p.user_id = ur.user_id
  AND p.role IS NULL;

CREATE TABLE IF NOT EXISTS public.user_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_type text NOT NULL,
  value text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_contacts_contact_type_check CHECK (
    contact_type IN (
      'player_email',
      'player_phone',
      'coach_email',
      'coach_phone',
      'instagram',
      'tiktok',
      'youtube',
      'website'
    )
  ),
  CONSTRAINT user_contacts_visibility_check CHECK (visibility IN ('public', 'restricted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_contacts_user_type_unique
ON public.user_contacts(user_id, contact_type);

CREATE INDEX IF NOT EXISTS idx_user_contacts_user_visibility
ON public.user_contacts(user_id, visibility);

ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own or public contacts" ON public.user_contacts;
DROP POLICY IF EXISTS "Users can insert own contacts" ON public.user_contacts;
DROP POLICY IF EXISTS "Users can update own contacts" ON public.user_contacts;
DROP POLICY IF EXISTS "Users can delete own contacts" ON public.user_contacts;

CREATE POLICY "Users can view own or public contacts"
ON public.user_contacts
FOR SELECT
TO public
USING (
  auth.uid() = user_id
  OR visibility = 'public'
  OR public.is_staff_member(auth.uid())
);

CREATE POLICY "Users can insert own contacts"
ON public.user_contacts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contacts"
ON public.user_contacts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own contacts"
ON public.user_contacts
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_contacts_updated_at ON public.user_contacts;
CREATE TRIGGER update_user_contacts_updated_at
BEFORE UPDATE ON public.user_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP VIEW IF EXISTS public.player_profiles_public;
CREATE VIEW public.player_profiles_public
WITH (security_invoker=on) AS
SELECT
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  pp.team,
  pp.position,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  p.bio,
  p.username,
  p.age_birth_year,
  p.team_name,
  p.avatar_url,
  p.is_pro,
  p.role
FROM public.player_profiles pp
LEFT JOIN public.profiles p ON p.user_id = pp.user_id;

CREATE OR REPLACE FUNCTION public.complete_account_setup(_role text, _profile jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role public.account_type := _role::public.account_type;
  v_full_name text := nullif(trim(coalesce(_profile->>'fullName', '')), '');
  v_contact_email text := nullif(lower(trim(coalesce(_profile->>'contactEmail', ''))), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to complete account setup.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET
    full_name = COALESCE(v_full_name, full_name),
    email = COALESCE(v_contact_email, email),
    role = COALESCE(v_role, role),
    team_name = COALESCE(nullif(trim(coalesce(_profile->>'team', '')), ''), team_name),
    club_name = COALESCE(nullif(trim(coalesce(_profile->>'clubName', '')), ''), club_name),
    position = COALESCE(nullif(trim(coalesce(_profile->>'position', '')), ''), position),
    height = COALESCE(nullif(trim(coalesce(_profile->>'height', '')), ''), height),
    weight = COALESCE(nullif(trim(coalesce(_profile->>'weight', '')), ''), weight),
    updated_at = now()
  WHERE user_id = v_user_id;

  IF v_role = 'player' THEN
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
  ELSIF v_role = 'team' THEN
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
  ELSIF v_role IN ('coach', 'scout', 'trainer', 'academy_director') THEN
    INSERT INTO public.staff_profiles (
      user_id, full_name, role, team_organization_name, country, city,
      coaching_level, years_experience, coaching_licenses, age_groups_coached,
      contact_email, contact_phone, previous_teams, notable_achievements
    )
    VALUES (
      v_user_id,
      COALESCE(v_full_name, ''),
      v_role,
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
  ELSIF v_role = 'parent' THEN
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
