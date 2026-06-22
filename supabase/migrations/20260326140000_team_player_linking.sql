ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS organization_id uuid,
ADD COLUMN IF NOT EXISTS age_group text,
ADD COLUMN IF NOT EXISTS access_code_hash text,
ADD COLUMN IF NOT EXISTS access_code_last4 text,
ADD COLUMN IF NOT EXISTS access_code_updated_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.team_profiles
ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.players p
SET user_id = pp.user_id
FROM public.player_profiles pp
WHERE lower(trim(pp.full_name)) = lower(trim(p.name))
  AND p.user_id IS NULL;

UPDATE public.teams t
SET owner_user_id = tp.user_id,
    age_group = COALESCE(t.age_group, tp.age_groups_offered[1]),
    approval_status = CASE
      WHEN COALESCE(tp.verified_status, false) THEN 'approved'
      ELSE COALESCE(t.approval_status, 'pending')
    END
FROM public.team_profiles tp
WHERE lower(trim(tp.club_name)) = lower(trim(t.name))
  AND t.owner_user_id IS NULL;

UPDATE public.team_profiles tp
SET team_id = t.id
FROM public.teams t
WHERE lower(trim(tp.club_name)) = lower(trim(t.name))
  AND tp.team_id IS NULL;

INSERT INTO public.teams (
  name,
  league_id,
  owner_user_id,
  age_group,
  contact_email,
  contact_phone,
  founded_year,
  stadium,
  approval_status
)
SELECT
  tp.club_name,
  l.id,
  tp.user_id,
  tp.age_groups_offered[1],
  tp.contact_email,
  tp.contact_phone,
  tp.founded_year,
  tp.home_stadium,
  CASE WHEN COALESCE(tp.verified_status, false) THEN 'approved' ELSE 'pending' END
FROM public.team_profiles tp
LEFT JOIN public.leagues l
  ON l.name = tp.leagues_offered[1]
WHERE tp.team_id IS NULL
ON CONFLICT (name) DO NOTHING;

UPDATE public.team_profiles tp
SET team_id = t.id
FROM public.teams t
WHERE lower(trim(tp.club_name)) = lower(trim(t.name))
  AND tp.team_id IS NULL;

CREATE TABLE IF NOT EXISTS public.player_team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  league_id uuid REFERENCES public.leagues(id) ON DELETE SET NULL,
  age_group text,
  status text NOT NULL DEFAULT 'pending',
  joined_via text NOT NULL,
  approved_at timestamp with time zone,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT player_team_memberships_status_check CHECK (status IN ('pending', 'accepted', 'approved', 'declined', 'rejected', 'revoked')),
  CONSTRAINT player_team_memberships_joined_via_check CHECK (joined_via IN ('invite', 'request', 'admin_add'))
);

CREATE TABLE IF NOT EXISTS public.team_player_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid REFERENCES public.leagues(id) ON DELETE SET NULL,
  age_group text,
  organization_id uuid,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  responded_at timestamp with time zone,
  CONSTRAINT team_player_invites_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'))
);

CREATE TABLE IF NOT EXISTS public.team_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_profile_id uuid NOT NULL REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  player_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id uuid REFERENCES public.leagues(id) ON DELETE SET NULL,
  age_group text,
  access_code_last4 text,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  CONSTRAINT team_join_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_user_id_unique
ON public.players(user_id)
WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_player_team_membership_unique
ON public.player_team_memberships(player_user_id)
WHERE status IN ('accepted', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_team_invite_unique
ON public.team_player_invites(team_id, player_user_id)
WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_team_join_request_unique
ON public.team_join_requests(team_id, player_user_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_player_team_memberships_team_status
ON public.player_team_memberships(team_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_player_invites_player_status
ON public.team_player_invites(player_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_join_requests_team_status
ON public.team_join_requests(team_id, status, requested_at DESC);

ALTER TABLE public.player_team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_player_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_join_requests ENABLE ROW LEVEL SECURITY;

INSERT INTO public.player_team_memberships (
  player_profile_id,
  player_user_id,
  team_id,
  league_id,
  age_group,
  status,
  joined_via,
  approved_at,
  approved_by
)
SELECT
  pp.id,
  pp.user_id,
  p.team_id,
  t.league_id,
  t.age_group,
  'approved',
  'admin_add',
  now(),
  t.owner_user_id
FROM public.players p
JOIN public.player_profiles pp ON pp.user_id = p.user_id
JOIN public.teams t ON t.id = p.team_id
LEFT JOIN public.player_team_memberships m
  ON m.player_user_id = pp.user_id
 AND m.team_id = p.team_id
WHERE p.team_id IS NOT NULL
  AND p.user_id IS NOT NULL
  AND m.id IS NULL;

CREATE OR REPLACE FUNCTION public.user_manages_team(_team_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = _team_id
      AND t.owner_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.team_is_approved(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = _team_id
      AND t.approval_status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.sync_team_membership(
  _player_profile_id uuid,
  _player_user_id uuid,
  _team_id uuid,
  _league_id uuid,
  _age_group text,
  _status text,
  _joined_via text,
  _approved_by uuid
)
RETURNS public.player_team_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_row public.player_team_memberships;
  team_name_value text;
  league_name_value text;
BEGIN
  UPDATE public.player_team_memberships
  SET status = 'revoked',
      updated_at = now()
  WHERE player_user_id = _player_user_id
    AND status IN ('accepted', 'approved')
    AND team_id <> _team_id;

  UPDATE public.player_team_memberships
  SET player_profile_id = _player_profile_id,
      league_id = _league_id,
      age_group = _age_group,
      status = _status,
      joined_via = _joined_via,
      approved_at = CASE WHEN _status IN ('accepted', 'approved') THEN now() ELSE player_team_memberships.approved_at END,
      approved_by = CASE WHEN _status IN ('accepted', 'approved') THEN _approved_by ELSE player_team_memberships.approved_by END,
      updated_at = now()
  WHERE public.player_team_memberships.player_user_id = _player_user_id
    AND public.player_team_memberships.team_id = _team_id;

  IF NOT FOUND THEN
    INSERT INTO public.player_team_memberships (
      player_profile_id,
      player_user_id,
      team_id,
      league_id,
      age_group,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    VALUES (
      _player_profile_id,
      _player_user_id,
      _team_id,
      _league_id,
      _age_group,
      _status,
      _joined_via,
      CASE WHEN _status IN ('accepted', 'approved') THEN now() ELSE NULL END,
      CASE WHEN _status IN ('accepted', 'approved') THEN _approved_by ELSE NULL END
    );
  END IF;

  SELECT t.name, l.name
  INTO team_name_value, league_name_value
  FROM public.teams t
  LEFT JOIN public.leagues l ON l.id = COALESCE(_league_id, t.league_id)
  WHERE t.id = _team_id;

  UPDATE public.player_profiles
  SET team = team_name_value,
      updated_at = now()
  WHERE id = _player_profile_id;

  UPDATE public.profiles
  SET team_name = team_name_value,
      updated_at = now()
  WHERE user_id = _player_user_id;

  UPDATE public.players
  SET team_id = _team_id,
      club = COALESCE(team_name_value, club),
      league = COALESCE(league_name_value, league)
  WHERE user_id = _player_user_id;

  SELECT *
  INTO membership_row
  FROM public.player_team_memberships
  WHERE player_user_id = _player_user_id
    AND team_id = _team_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN membership_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_team_access_code(_team_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_code text := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_manages_team(_team_id, auth.uid()) OR NOT public.team_is_approved(_team_id) THEN
    RAISE EXCEPTION 'You are not allowed to manage this team access code.';
  END IF;

  UPDATE public.teams
  SET access_code_hash = encode(digest(raw_code, 'sha256'), 'hex'),
      access_code_last4 = right(raw_code, 4),
      access_code_updated_at = now()
  WHERE id = _team_id;

  RETURN raw_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_player_invite(_team_id uuid, _player_profile_id uuid)
RETURNS public.team_player_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  team_row public.teams;
  player_row public.player_profiles;
  invite_row public.team_player_invites;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_manages_team(_team_id, auth.uid()) OR NOT public.team_is_approved(_team_id) THEN
    RAISE EXCEPTION 'Only approved team accounts can invite players.';
  END IF;

  SELECT * INTO team_row FROM public.teams WHERE id = _team_id;
  SELECT * INTO player_row FROM public.player_profiles WHERE id = _player_profile_id;

  IF player_row.id IS NULL THEN
    RAISE EXCEPTION 'Player not found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.player_team_memberships
    WHERE player_user_id = player_row.user_id
      AND status IN ('accepted', 'approved')
  ) THEN
    RAISE EXCEPTION 'This player is already linked to an active team.';
  END IF;

  INSERT INTO public.team_player_invites (
    team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    organization_id,
    invited_by,
    status
  )
  VALUES (
    _team_id,
    _player_profile_id,
    player_row.user_id,
    team_row.league_id,
    team_row.age_group,
    team_row.organization_id,
    auth.uid(),
    'pending'
  )
  RETURNING * INTO invite_row;

  RETURN invite_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_team_player_invite(_invite_id uuid, _accept boolean)
RETURNS public.player_team_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_row public.team_player_invites;
  membership_row public.player_team_memberships;
BEGIN
  SELECT * INTO invite_row
  FROM public.team_player_invites
  WHERE id = _invite_id;

  IF invite_row.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found.';
  END IF;

  IF auth.uid() IS NULL OR invite_row.player_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only respond to your own invites.';
  END IF;

  IF invite_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This invite has already been handled.';
  END IF;

  UPDATE public.team_player_invites
  SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = _invite_id;

  IF _accept THEN
    membership_row := public.sync_team_membership(
      invite_row.player_profile_id,
      invite_row.player_user_id,
      invite_row.team_id,
      invite_row.league_id,
      invite_row.age_group,
      'accepted',
      'invite',
      auth.uid()
    );
    RETURN membership_row;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_join_request(_access_code text)
RETURNS public.team_join_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  player_row public.player_profiles;
  team_row public.teams;
  normalized_code text := upper(trim(_access_code));
  request_row public.team_join_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request to join a team.';
  END IF;

  SELECT * INTO player_row
  FROM public.player_profiles
  WHERE user_id = auth.uid();

  IF player_row.id IS NULL THEN
    RAISE EXCEPTION 'Only player accounts can request to join a team.';
  END IF;

  SELECT * INTO team_row
  FROM public.teams
  WHERE access_code_hash = encode(digest(normalized_code, 'sha256'), 'hex')
    AND approval_status = 'approved';

  IF team_row.id IS NULL THEN
    RAISE EXCEPTION 'Invalid team access code.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.player_team_memberships
    WHERE player_user_id = auth.uid()
      AND status IN ('accepted', 'approved')
  ) THEN
    RAISE EXCEPTION 'You are already linked to an active team.';
  END IF;

  INSERT INTO public.team_join_requests (
    team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    access_code_last4,
    status
  )
  VALUES (
    team_row.id,
    player_row.id,
    auth.uid(),
    team_row.league_id,
    team_row.age_group,
    right(normalized_code, 4),
    'pending'
  )
  RETURNING * INTO request_row;

  RETURN request_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_team_join_request(_request_id uuid, _approve boolean)
RETURNS public.player_team_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.team_join_requests;
  membership_row public.player_team_memberships;
BEGIN
  SELECT * INTO request_row
  FROM public.team_join_requests
  WHERE id = _request_id;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'Join request not found.';
  END IF;

  IF auth.uid() IS NULL OR NOT public.user_manages_team(request_row.team_id, auth.uid()) OR NOT public.team_is_approved(request_row.team_id) THEN
    RAISE EXCEPTION 'Only approved team accounts can review join requests.';
  END IF;

  IF request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This join request has already been handled.';
  END IF;

  UPDATE public.team_join_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id;

  IF _approve THEN
    membership_row := public.sync_team_membership(
      request_row.player_profile_id,
      request_row.player_user_id,
      request_row.team_id,
      request_row.league_id,
      request_row.age_group,
      'approved',
      'request',
      auth.uid()
    );
    RETURN membership_row;
  END IF;

  RETURN NULL;
END;
$$;

DROP POLICY IF EXISTS "Player-team memberships are public" ON public.player_team_memberships;
DROP POLICY IF EXISTS "Invites visible to team managers and invited player" ON public.team_player_invites;
DROP POLICY IF EXISTS "Team managers can create invites" ON public.team_player_invites;
DROP POLICY IF EXISTS "Join requests visible to requester and team managers" ON public.team_join_requests;
DROP POLICY IF EXISTS "Players can create join requests" ON public.team_join_requests;

CREATE POLICY "Player-team memberships are public"
ON public.player_team_memberships
FOR SELECT
TO public
USING (status IN ('accepted', 'approved'));

CREATE POLICY "Invites visible to team managers and invited player"
ON public.team_player_invites
FOR SELECT
TO authenticated
USING (
  player_user_id = auth.uid()
  OR public.user_manages_team(team_id, auth.uid())
);

CREATE POLICY "Join requests visible to requester and team managers"
ON public.team_join_requests
FOR SELECT
TO authenticated
USING (
  player_user_id = auth.uid()
  OR public.user_manages_team(team_id, auth.uid())
);

DROP VIEW IF EXISTS public.player_profiles_public;
CREATE VIEW public.player_profiles_public
WITH (security_invoker=on) AS
SELECT
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  COALESCE(atm.team_name, pp.team) AS team,
  pp.position,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  p.bio,
  p.username,
  p.age_birth_year,
  COALESCE(atm.team_name, p.team_name) AS team_name,
  p.avatar_url,
  p.is_pro,
  p.role
FROM public.player_profiles pp
LEFT JOIN public.profiles p ON p.user_id = pp.user_id
LEFT JOIN (
  SELECT
    m.player_user_id,
    t.name AS team_name
  FROM public.player_team_memberships m
  JOIN public.teams t ON t.id = m.team_id
  WHERE m.status IN ('accepted', 'approved')
) atm ON atm.player_user_id = pp.user_id;

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
  v_team_id uuid;
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
