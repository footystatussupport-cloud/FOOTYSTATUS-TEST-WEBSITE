import { callGlobalAdminAction } from "@/lib/superAdmin";

export const globalAdminUpdateProfile = (payload: {
  user_id: string;
  full_name?: string;
  bio?: string;
  avatar_url?: string;
  club_name?: string;
}) => callGlobalAdminAction("update_profile", payload);

export const globalAdminDeactivateAccount = (userId: string) =>
  callGlobalAdminAction("deactivate_account", { user_id: userId });

export const globalAdminLinkPlayerToTeam = (payload: {
  player_user_id?: string;
  player_profile_id?: string;
  team_id: string;
  club_team_id?: string;
  league_id?: string;
  age_group?: string;
}) => callGlobalAdminAction("link_player_to_team", payload);

export const globalAdminRemovePlayerFromTeam = (membershipId: string) =>
  callGlobalAdminAction("remove_player_from_team", { membership_id: membershipId });

export const globalAdminLinkCoachToTeam = (payload: {
  coach_user_id: string;
  team_id: string;
  club_team_id?: string;
  staff_role?: string;
}) => callGlobalAdminAction("link_coach_to_team", payload);

export const globalAdminRemoveCoachFromTeam = (membershipId: string) =>
  callGlobalAdminAction("remove_coach_from_team", { membership_id: membershipId });

export const globalAdminLinkTeamToLeague = (teamId: string, leagueId: string) =>
  callGlobalAdminAction("link_team_to_league", { team_id: teamId, league_id: leagueId });

export const globalAdminRemoveTeamFromLeague = (teamId: string, leagueId: string) =>
  callGlobalAdminAction("remove_team_from_league", { team_id: teamId, league_id: leagueId });

export const globalAdminSoftDeleteRecord = (table: "teams" | "clubs" | "leagues", id: string) =>
  callGlobalAdminAction("soft_delete_record", { table, id });

export const globalAdminDeleteClubCascade = (clubId: string, reason?: string) =>
  callGlobalAdminAction("delete_club_cascade", { club_id: clubId, reason: reason || null });
