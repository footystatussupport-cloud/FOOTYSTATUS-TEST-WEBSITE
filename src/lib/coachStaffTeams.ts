import { supabase } from "@/integrations/supabase/client";

export const COACHING_ROLE_OPTIONS = [
  "Head Coach",
  "Assistant Coach",
  "Trainer Coach",
  "Goalkeeper Coach",
  "Fitness Coach",
  "Manager",
  "Analyst",
  "Other Coaching Staff",
] as const;

export const CLUB_COACH_REQUEST_ROLE_OPTIONS = [
  "Head Coach",
  "Assistant Coach",
  "Trainer",
  "Other Staff / Coach",
] as const;

export interface CoachClubTeamAssignment {
  club_team_id: string;
  role: string;
  team_name?: string;
  age_group?: string | null;
  league_name?: string | null;
  league_id?: string | null;
}

const ROLE_DISPLAY_LABELS: Record<string, string> = {
  academy_director: "Team Staff",
  head_coach_assistant: "Coach / Trainer",
  head_coach: "Head Coach",
  assistant_coach: "Assistant Coach",
  coaching_staff: "Coaching Staff",
  team_club: "Team / Club",
  school_team: "School Team",
  team_staff: "Team Staff",
  scout: "Scout",
  trainer: "Trainer Coach",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  referee: "Referee",
};

export const formatRoleDisplayLabel = (role?: string | null, fallback: string | null = "Staff") => {
  const normalizedRole = (role || "").trim();
  if (!normalizedRole) return fallback;
  const mappedRole = ROLE_DISPLAY_LABELS[normalizedRole.toLowerCase()];
  if (mappedRole) return mappedRole;
  if (!normalizedRole.includes("_")) return normalizedRole;

  return normalizedRole
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const GENERIC_ROLE_LABELS = new Set([
  "club director / team staff",
  "team staff",
  "coach / trainer",
  "coaches / staff",
  "coach / staff",
  "staff",
]);

export const formatSpecificRoleDisplayLabel = (role?: string | null, fallback: string | null = null) => {
  const formattedRole = formatRoleDisplayLabel(role, null);
  if (!formattedRole) return fallback;
  if (GENERIC_ROLE_LABELS.has(formattedRole.trim().toLowerCase())) return fallback;
  return formattedRole;
};

export const isCoachStaffRole = (role?: string | null) =>
  ["head_coach", "assistant_coach", "coaching_staff", "head_coach_assistant", "scout", "academy_director"].includes(role || "");

export const COACH_ACCOUNT_ROLES = ["coach", "head_coach", "assistant_coach", "coaching_staff", "head_coach_assistant"] as const;

export const isCoachAccountRole = (role?: string | null) => COACH_ACCOUNT_ROLES.includes((role || "") as any);

export const CLUB_STAFF_ROLE_ORDER = [
  "Club Director",
  "Academy Director",
  "Technical Director",
  "Operations Director",
  "Team Manager",
  "Team Administrator",
  "Team Coordinator",
  "Media Staff",
  "Equipment Manager",
  "Other Team Staff",
] as const;

export const getClubStaffRoleSortValue = (role?: string | null) => {
  const normalizedRole = (role || "").trim().toLowerCase();
  const index = CLUB_STAFF_ROLE_ORDER.findIndex((orderedRole) => orderedRole.toLowerCase() === normalizedRole);
  return index === -1 ? CLUB_STAFF_ROLE_ORDER.length : index;
};

export const sortCoachStaffByClubStaffRole = <T extends { staff_role?: string | null; profile?: { coaching_role_type?: string | null; full_name?: string | null } | null }>(
  staff: T[]
) =>
  [...staff].sort((a, b) => {
    const roleDiff =
      getClubStaffRoleSortValue(a.staff_role || a.profile?.coaching_role_type) -
      getClubStaffRoleSortValue(b.staff_role || b.profile?.coaching_role_type);
    if (roleDiff !== 0) return roleDiff;
    return (a.profile?.full_name || "").localeCompare(b.profile?.full_name || "");
  });

export interface CoachStaffProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
  account_category?: string | null;
  account_role: string | null;
  coaching_role_type: string | null;
  teams_currently_coaching: string | null;
  past_coaching_experience: string | null;
  coaching_licenses: string[] | null;
  coaching_accolades: string | null;
  coaching_location: string | null;
  scout_role_title?: string | null;
  scout_organization?: string | null;
  scouting_licenses?: string[] | null;
  scouting_experience?: string | null;
  scouting_regions?: string | null;
  scouting_age_groups?: string[] | null;
  scouting_positions?: string[] | null;
  scouting_accolades?: string | null;
  bio: string | null;
}

export interface CoachStaffTeamLink {
  id: string;
  team_id: string;
  club_team_id?: string | null;
  league_id?: string | null;
  age_group?: string | null;
  coach_user_id: string;
  staff_role: string | null;
  status: string;
  team_name: string;
  team_logo_url: string | null;
  club_team_name?: string | null;
}

export const fetchCoachStaffProfiles = async (query?: string) => {
  let request = (supabase as any)
    .from("profiles")
    .select("user_id, full_name, avatar_url, username, account_role, coaching_role_type, teams_currently_coaching, past_coaching_experience, coaching_licenses, coaching_accolades, coaching_location, scout_role_title, scout_organization, scouting_licenses, scouting_experience, scouting_regions, scouting_age_groups, scouting_positions, scouting_accolades, bio")
    .eq("account_category", "team_staff")
    .neq("account_role", "team_club")
    .neq("account_role", "school_team")
    .limit(20);

  const trimmed = query?.trim();
  if (trimmed) {
    const usernameQuery = trimmed.replace(/^@/, "");
    request = request.or(`full_name.ilike.%${trimmed}%,username.ilike.%${usernameQuery}%,coaching_role_type.ilike.%${trimmed}%,teams_currently_coaching.ilike.%${trimmed}%,scout_organization.ilike.%${trimmed}%`);
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data || []) as CoachStaffProfile[];
};

export const fetchCoachProfiles = async (query?: string) => {
  let request = (supabase as any)
    .from("profiles")
    .select("user_id, full_name, avatar_url, username, account_role, account_category, coaching_role_type, teams_currently_coaching, past_coaching_experience, coaching_licenses, coaching_accolades, coaching_location, bio")
    .in("account_role", COACH_ACCOUNT_ROLES as unknown as string[])
    .limit(20);

  const trimmed = query?.trim();
  if (trimmed) {
    const usernameQuery = trimmed.replace(/^@/, "");
    request = request.or(`full_name.ilike.%${trimmed}%,username.ilike.%${usernameQuery}%,coaching_role_type.ilike.%${trimmed}%`);
  }

  const { data, error } = await request;
  if (error) throw error;
  return (data || []) as CoachStaffProfile[];
};

export const fetchCoachStaffTeamLinksForUser = async (userId: string) => {
  const { data, error } = await (supabase as any)
    .from("coach_staff_team_memberships")
    .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, teams(name, logo_url)")
    .eq("coach_user_id", userId)
    .in("status", ["approved", "accepted"]);

  if (error) throw error;

  const clubTeamIds = [...new Set(((data || []) as any[]).map((link) => link.club_team_id).filter(Boolean))];
  const { data: clubTeams } = clubTeamIds.length
    ? await (supabase as any)
        .from("club_teams")
        .select("id, age_group, league_name, level")
        .in("id", clubTeamIds)
    : { data: [] };
  const clubTeamsById = new Map((clubTeams || []).map((team: any) => [team.id, team]));

  return ((data || []) as any[]).map((link) => ({
    id: link.id,
    team_id: link.team_id,
    club_team_id: link.club_team_id || null,
    league_id: link.league_id || null,
    age_group: link.age_group || null,
    coach_user_id: link.coach_user_id,
    staff_role: link.staff_role,
    status: link.status,
    team_name: link.teams?.name || "Team",
    team_logo_url: link.teams?.logo_url || null,
    club_team_name: link.club_team_id
      ? [
          clubTeamsById.get(link.club_team_id)?.age_group,
          clubTeamsById.get(link.club_team_id)?.level,
          clubTeamsById.get(link.club_team_id)?.league_name,
        ]
          .filter(Boolean)
          .join(" - ")
      : null,
  })) as CoachStaffTeamLink[];
};

export const fetchCoachStaffForTeam = async (teamId: string) => {
  const { data, error } = await (supabase as any)
    .from("coach_staff_team_memberships")
    .select("id, team_id, club_team_id, coach_user_id, staff_role, status, profiles!coach_staff_team_memberships_coach_user_id_fkey(user_id, full_name, avatar_url, username, account_role, coaching_role_type, bio)")
    .eq("team_id", teamId)
    .in("status", ["approved", "accepted"]);

  if (error) {
    const fallback = await (supabase as any)
      .from("coach_staff_team_memberships")
      .select("id, team_id, club_team_id, coach_user_id, staff_role, status")
      .eq("team_id", teamId)
      .in("status", ["approved", "accepted"]);
    if (fallback.error) throw fallback.error;

    const userIds = [...new Set(((fallback.data || []) as any[]).map((row) => row.coach_user_id))];
    const { data: profiles } = userIds.length
      ? await (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, account_role, coaching_role_type, bio")
          .in("user_id", userIds)
      : { data: [] };
    const profilesByUserId = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
    const rows = ((fallback.data || []) as any[]).map((row) => ({ ...row, profile: profilesByUserId.get(row.coach_user_id) || null }));
    return [...rows.reduce((byCoach, row) => {
      const current = byCoach.get(row.coach_user_id);
      if (!current || (current.club_team_id && !row.club_team_id)) byCoach.set(row.coach_user_id, row);
      return byCoach;
    }, new Map<string, any>()).values()];
  }

  const rows = ((data || []) as any[]).map((row) => ({ ...row, profile: row.profiles || null }));
  return [...rows.reduce((byCoach, row) => {
    const current = byCoach.get(row.coach_user_id);
    if (!current || (current.club_team_id && !row.club_team_id)) byCoach.set(row.coach_user_id, row);
    return byCoach;
  }, new Map<string, any>()).values()];
};

export const fetchCoachStaffForClubTeam = async (teamId: string, clubTeamId: string) => {
  const { data, error } = await (supabase as any)
    .from("coach_staff_team_memberships")
    .select("id, team_id, club_team_id, coach_user_id, staff_role, status, profiles!coach_staff_team_memberships_coach_user_id_fkey(user_id, full_name, avatar_url, username, coaching_role_type, bio)")
    .eq("team_id", teamId)
    .eq("club_team_id", clubTeamId)
    .in("status", ["approved", "accepted"]);

  if (error) {
    const fallback = await (supabase as any)
      .from("coach_staff_team_memberships")
      .select("id, team_id, club_team_id, coach_user_id, staff_role, status")
      .eq("team_id", teamId)
      .eq("club_team_id", clubTeamId)
      .in("status", ["approved", "accepted"]);
    if (fallback.error) throw fallback.error;

    const userIds = [...new Set(((fallback.data || []) as any[]).map((row) => row.coach_user_id))];
    const { data: profiles } = userIds.length
      ? await (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, coaching_role_type, bio")
          .in("user_id", userIds)
      : { data: [] };
    const profilesByUserId = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
    return ((fallback.data || []) as any[]).map((row) => ({ ...row, profile: profilesByUserId.get(row.coach_user_id) || null }));
  }

  return ((data || []) as any[]).map((row) => ({ ...row, profile: row.profiles || null }));
};

export const fetchMotherTeamCoachStaffOptions = async (teamId: string) => {
  const { data, error } = await (supabase as any)
    .from("coach_staff_team_memberships")
    .select("id, team_id, club_team_id, coach_user_id, staff_role, status, profiles!coach_staff_team_memberships_coach_user_id_fkey(user_id, full_name, avatar_url, username, coaching_role_type, bio)")
    .eq("team_id", teamId)
    .is("club_team_id", null)
    .in("status", ["approved", "accepted"]);

  if (error) {
    const fallback = await (supabase as any)
      .from("coach_staff_team_memberships")
      .select("id, team_id, club_team_id, coach_user_id, staff_role, status")
      .eq("team_id", teamId)
      .is("club_team_id", null)
      .in("status", ["approved", "accepted"]);
    if (fallback.error) throw fallback.error;

    const userIds = [...new Set(((fallback.data || []) as any[]).map((row) => row.coach_user_id))];
    const { data: profiles } = userIds.length
      ? await (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, coaching_role_type, bio")
          .in("user_id", userIds)
      : { data: [] };
    const profilesByUserId = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
    return ((fallback.data || []) as any[]).map((row) => ({ ...row, profile: profilesByUserId.get(row.coach_user_id) || null }));
  }

  return ((data || []) as any[]).map((row) => ({ ...row, profile: row.profiles || null }));
};

export const requestCoachStaffTeamLink = async (
  teamId: string,
  coachUserId: string,
  staffRole?: string | null,
  teamContext?: { club_team_id?: string | null; league_id?: string | null; age_group?: string | null }
) =>
  (supabase as any).from("coach_staff_join_requests").insert({
    team_id: teamId,
    club_team_id: teamContext?.club_team_id || null,
    league_id: teamContext?.league_id || null,
    age_group: teamContext?.age_group || null,
    coach_user_id: coachUserId,
    staff_role: staffRole || null,
    status: "pending",
    requested_at: new Date().toISOString(),
  });

export const requestCoachClubLink = async (
  teamId: string,
  assignments: CoachClubTeamAssignment[],
  generalClubRole: boolean
) =>
  (supabase as any).rpc("submit_coach_club_link_request", {
    _team_id: teamId,
    _assignments: assignments,
    _general_club_role: generalClubRole,
  });

export const inviteCoachStaffToTeam = async (
  teamId: string,
  coachUserId: string,
  invitedBy: string,
  staffRole?: string | null,
  teamContext?: { club_team_id?: string | null; league_id?: string | null; age_group?: string | null }
) =>
  (supabase as any).from("coach_staff_team_invites").upsert(
    {
      team_id: teamId,
      club_team_id: teamContext?.club_team_id || null,
      league_id: teamContext?.league_id || null,
      age_group: teamContext?.age_group || null,
      coach_user_id: coachUserId,
      invited_by: invitedBy,
      staff_role: staffRole || null,
      status: "pending",
    },
    { onConflict: "team_id,club_team_id,coach_user_id,status" }
  );

export const assignCoachStaffToClubTeam = async (
  teamId: string,
  clubTeamId: string,
  coachUserId: string,
  staffRole?: string | null,
  teamContext?: { league_id?: string | null; age_group?: string | null }
) =>
  (supabase as any).from("coach_staff_team_memberships").upsert(
    {
      team_id: teamId,
      club_team_id: clubTeamId,
      league_id: teamContext?.league_id || null,
      age_group: teamContext?.age_group || null,
      coach_user_id: coachUserId,
      staff_role: staffRole || null,
      status: "approved",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,club_team_id,coach_user_id" }
  );

export const acceptCoachStaffInvite = async (invite: { id: string; team_id: string; coach_user_id: string; staff_role?: string | null }) => {
  const membership = await (supabase as any).from("coach_staff_team_memberships").upsert(
    {
      team_id: invite.team_id,
      club_team_id: (invite as any).club_team_id || null,
      league_id: (invite as any).league_id || null,
      age_group: (invite as any).age_group || null,
      coach_user_id: invite.coach_user_id,
      staff_role: invite.staff_role || null,
      status: "accepted",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,club_team_id,coach_user_id" }
  );
  if (membership.error) return membership;
  return (supabase as any)
    .from("coach_staff_team_invites")
    .update({ status: "accepted", reviewed_at: new Date().toISOString() })
    .eq("id", invite.id);
};

export const reviewCoachStaffJoinRequest = async (request: { id: string; team_id: string; coach_user_id: string; staff_role?: string | null; club_team_id?: string | null; league_id?: string | null; age_group?: string | null }, approve: boolean) => {
  if ((request as any).request_kind === "club_multi") {
    return (supabase as any).rpc("review_coach_club_link_request", {
      _request_id: request.id,
      _approve: approve,
    });
  }

  if (approve) {
    const membership = await (supabase as any).from("coach_staff_team_memberships").upsert(
      {
        team_id: request.team_id,
        club_team_id: request.club_team_id || null,
        league_id: request.league_id || null,
        age_group: request.age_group || null,
        coach_user_id: request.coach_user_id,
        staff_role: request.staff_role || null,
        status: "approved",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id,club_team_id,coach_user_id" }
    );
    if (membership.error) return membership;
  }

  return (supabase as any)
    .from("coach_staff_join_requests")
    .update({ status: approve ? "approved" : "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", request.id);
};

export const unlinkCoachStaffFromTeam = async (membershipId: string) =>
  (supabase as any)
    .from("coach_staff_team_memberships")
    .update({ status: "left", updated_at: new Date().toISOString() })
    .eq("id", membershipId);

export const unlinkCoachStaffFromClub = async (teamId: string, coachUserId: string) =>
  (supabase as any).rpc("remove_coach_from_club", {
    _team_id: teamId,
    _coach_user_id: coachUserId,
  });
