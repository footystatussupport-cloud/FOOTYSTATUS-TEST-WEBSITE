CREATE OR REPLACE FUNCTION public.create_team_join_request_for_team(_team_id uuid, _access_code text)
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
  WHERE id = _team_id
    AND approval_status = 'approved';

  IF team_row.id IS NULL THEN
    RAISE EXCEPTION 'That team is not currently approved.';
  END IF;

  IF team_row.access_code_hash IS NULL OR team_row.access_code_hash <> encode(digest(normalized_code, 'sha256'), 'hex') THEN
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

CREATE OR REPLACE FUNCTION public.revoke_team_join_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row public.team_join_requests;
BEGIN
  SELECT * INTO request_row
  FROM public.team_join_requests
  WHERE id = _request_id;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION 'Join request not found.';
  END IF;

  IF auth.uid() IS NULL OR request_row.player_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only cancel your own join request.';
  END IF;

  IF request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending join requests can be cancelled.';
  END IF;

  UPDATE public.team_join_requests
  SET status = 'revoked',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _request_id;
END;
$$;
