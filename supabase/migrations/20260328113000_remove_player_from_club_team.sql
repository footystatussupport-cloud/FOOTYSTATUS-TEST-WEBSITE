CREATE OR REPLACE FUNCTION public.remove_player_from_club_team(_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_row public.player_team_memberships;
  has_other_active_membership boolean;
  team_name_value text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;

  SELECT *
  INTO membership_row
  FROM public.player_team_memberships
  WHERE id = _membership_id;

  IF membership_row.id IS NULL THEN
    RAISE EXCEPTION 'Player membership not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.id = membership_row.team_id
      AND t.owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the team/club account can remove players from this team.';
  END IF;

  UPDATE public.player_team_memberships
  SET status = 'revoked',
      updated_at = now()
  WHERE player_user_id = membership_row.player_user_id
    AND team_id = membership_row.team_id
    AND COALESCE(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND status IN ('pending', 'accepted', 'approved');

  UPDATE public.team_join_requests
  SET status = 'revoked',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE player_user_id = membership_row.player_user_id
    AND team_id = membership_row.team_id
    AND COALESCE(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND status IN ('pending', 'approved');

  UPDATE public.team_player_invites
  SET status = 'revoked',
      responded_at = now()
  WHERE player_user_id = membership_row.player_user_id
    AND team_id = membership_row.team_id
    AND COALESCE(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND status = 'pending';

  SELECT EXISTS (
    SELECT 1
    FROM public.player_team_memberships
    WHERE player_user_id = membership_row.player_user_id
      AND status IN ('accepted', 'approved')
  )
  INTO has_other_active_membership;

  IF NOT has_other_active_membership THEN
    SELECT name INTO team_name_value
    FROM public.teams
    WHERE id = membership_row.team_id;

    UPDATE public.profiles
    SET team_name = NULL,
        updated_at = now()
    WHERE user_id = membership_row.player_user_id;

    UPDATE public.player_profiles
    SET team = NULL,
        updated_at = now()
    WHERE user_id = membership_row.player_user_id;

    UPDATE public.players
    SET team_id = NULL,
        club = CASE WHEN team_name_value IS NOT NULL AND club = team_name_value THEN NULL ELSE club END
    WHERE user_id = membership_row.player_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_player_from_club_team(uuid) TO authenticated;
