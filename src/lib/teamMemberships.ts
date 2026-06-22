import { supabase } from "@/integrations/supabase/client";
import { getIsPro } from "@/lib/subscriptions";

const normalizeTeamLabel = (value?: string | null) =>
  (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const leagueAlreadyContainsAgeGroup = (leagueName?: string | null, ageGroup?: string | null) => {
  const normalizedLeague = normalizeTeamLabel(leagueName);
  const normalizedAgeGroup = normalizeTeamLabel(ageGroup);

  if (!normalizedLeague || !normalizedAgeGroup) return false;
  return normalizedLeague.includes(normalizedAgeGroup);
};

const matchesTeamLabel = (candidate?: string | null, teamName?: string | null) => {
  const normalizedCandidate = normalizeTeamLabel(candidate);
  const normalizedTeamName = normalizeTeamLabel(teamName);

  if (!normalizedCandidate || !normalizedTeamName) return false;

  return (
    normalizedCandidate === normalizedTeamName ||
    normalizedCandidate.includes(normalizedTeamName) ||
    normalizedTeamName.includes(normalizedCandidate)
  );
};

export interface ActiveMembership {
  id: string;
  team_id: string;
  club_team_id: string | null;
  league_id: string | null;
  age_group: string | null;
  jersey_number: string | null;
  status: string;
  player_user_id: string;
  team: {
    id: string;
    name: string;
    age_group: string | null;
    approval_status: string;
    league_id: string | null;
  } | null;
  league: {
    id: string;
    name: string;
    age_group: string | null;
  } | null;
}
export interface LiveStandingSummary {
  league_id: string;
  team_id: string;
  club_team_id: string | null;
  team_name: string;
  position: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
}


export interface TeamRosterPlayer {
  membership_id: string;
  player_profile_id: string;
  player_user_id: string;
  age_group: string | null;
  status: string;
  created_at: string;
  player_name: string;
  player_position: string | null;
  player_jersey_number: string | null;
  player_avatar_url: string | null;
  player_username: string | null;
  team_name: string;
  league_name: string | null;
  is_pro?: boolean;
}

export const formatTeamLeagueLine = (teamName?: string | null, ageGroup?: string | null, leagueName?: string | null) =>
  [
    teamName,
    leagueAlreadyContainsAgeGroup(leagueName, ageGroup) ? null : ageGroup,
    leagueName,
  ]
    .filter(Boolean)
    .join(" • ");

export const getMembershipTeamDestination = (membership?: Pick<ActiveMembership, "club_team_id" | "team"> | null) => {
  if (!membership) return null;
  if (membership.club_team_id) return `/club-team/${membership.club_team_id}`;
  if (membership.team?.id) return `/team/${membership.team.id}`;
  return null;
};

const hydrateMembership = async (membership: any) => {
  const [{ data: team }, { data: clubTeam }] = await Promise.all([
    (supabase as any)
      .from("teams")
      .select("id, name, age_group, approval_status, league_id")
      .eq("id", membership.team_id)
      .maybeSingle(),
    membership.club_team_id
      ? (supabase as any).from("club_teams").select("id, age_group, league_id, league_name").eq("id", membership.club_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let inferredClubTeam = clubTeam;
  if (!inferredClubTeam && membership.team_id) {
    const { data: siblingClubTeams } = await (supabase as any)
      .from("club_teams")
      .select("id, age_group, league_id, league_name, status")
      .eq("team_id", membership.team_id)
      .neq("status", "archived");

    const activeSiblingClubTeams = (siblingClubTeams || []).filter((option: any) => option.status !== "inactive");
    const sameAgeGroupOptions = activeSiblingClubTeams.filter(
      (option: any) => option.age_group === (membership.age_group || team?.age_group || null)
    );

    if (sameAgeGroupOptions.length === 1) {
      inferredClubTeam = sameAgeGroupOptions[0];
    } else if (activeSiblingClubTeams.length === 1) {
      inferredClubTeam = activeSiblingClubTeams[0];
    }
  }

  const resolvedLeagueId = membership.league_id || inferredClubTeam?.league_id || team?.league_id || null;
  const { data: league } = resolvedLeagueId
    ? await (supabase as any).from("leagues").select("id, name, age_group").eq("id", resolvedLeagueId).maybeSingle()
    : { data: null };

  return {
    ...membership,
    club_team_id: membership.club_team_id || inferredClubTeam?.id || null,
    age_group: membership.age_group || inferredClubTeam?.age_group || team?.age_group || null,
    team: team || null,
    league:
      league ||
      (inferredClubTeam?.league_name
        ? {
            id: "",
            name: inferredClubTeam.league_name,
            age_group: null,
          }
        : null),
  } as ActiveMembership;
};

export interface PendingTeamInviteSummary {
  id: string;
  team_id: string;
  club_team_id: string | null;
  league_id: string | null;
  age_group: string | null;
  created_at: string;
  team_name: string;
  league_name: string | null;
}

export const fetchPendingTeamInvitesForUser = async (userId: string) => {
  const { data: invites, error } = await (supabase as any)
    .from("team_player_invites")
    .select("id, team_id, club_team_id, league_id, age_group, created_at, status")
    .eq("player_user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const teamIds = [...new Set((invites || []).map((invite: any) => invite.team_id).filter(Boolean))];
  const leagueIds = [...new Set((invites || []).map((invite: any) => invite.league_id).filter(Boolean))];
  const clubTeamIds = [...new Set((invites || []).map((invite: any) => invite.club_team_id).filter(Boolean))];

  const [teamsRes, leaguesRes, clubTeamsRes] = await Promise.all([
    teamIds.length
      ? (supabase as any).from("teams").select("id, name, league_id, age_group").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    leagueIds.length
      ? (supabase as any).from("leagues").select("id, name").in("id", leagueIds)
      : Promise.resolve({ data: [] }),
    clubTeamIds.length
      ? (supabase as any).from("club_teams").select("id, age_group, league_name").in("id", clubTeamIds)
      : Promise.resolve({ data: [] }),
  ]);

  const teamsById = new Map(((teamsRes as any).data || []).map((team: any) => [team.id, team]));
  const leaguesById = new Map(((leaguesRes as any).data || []).map((league: any) => [league.id, league]));
  const clubTeamsById = new Map(((clubTeamsRes as any).data || []).map((clubTeam: any) => [clubTeam.id, clubTeam]));

  return ((invites || []) as any[]).map((invite) => {
    const team = teamsById.get(invite.team_id);
    const clubTeam = invite.club_team_id ? clubTeamsById.get(invite.club_team_id) : null;
    return {
      ...invite,
      team_name: team?.name || "Team",
      age_group: clubTeam?.age_group || invite.age_group || team?.age_group || null,
      league_name:
        clubTeam?.league_name ||
        (invite.league_id ? leaguesById.get(invite.league_id)?.name || null : null) ||
        (team?.league_id ? leaguesById.get(team.league_id)?.name || null : null),
    } as PendingTeamInviteSummary;
  });
};

export const fetchActiveMembershipForUser = async (userId: string) => {
  const membershipRes = await (supabase as any)
    .from("player_team_memberships")
    .select("id, team_id, club_team_id, league_id, age_group, jersey_number, status, player_user_id")
    .eq("player_user_id", userId)
    .in("status", ["accepted", "approved"])
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fallbackMembershipRes =
    membershipRes.error?.message?.includes("jersey_number")
      ? await (supabase as any)
          .from("player_team_memberships")
          .select("id, team_id, club_team_id, league_id, age_group, status, player_user_id")
          .eq("player_user_id", userId)
          .in("status", ["accepted", "approved"])
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : null;

  const membership = membershipRes.data || (fallbackMembershipRes?.data ? { ...fallbackMembershipRes.data, jersey_number: null } : null);

  if (!membership) return null;

  return hydrateMembership(membership);
};

export const fetchActiveMembershipsForUser = async (userId: string) => {
  const membershipRes = await (supabase as any)
    .from("player_team_memberships")
    .select("id, team_id, club_team_id, league_id, age_group, jersey_number, status, player_user_id")
    .eq("player_user_id", userId)
    .in("status", ["accepted", "approved"])
    .order("approved_at", { ascending: false });

  const fallbackMembershipRes =
    membershipRes.error?.message?.includes("jersey_number")
      ? await (supabase as any)
          .from("player_team_memberships")
          .select("id, team_id, club_team_id, league_id, age_group, status, player_user_id")
          .eq("player_user_id", userId)
          .in("status", ["accepted", "approved"])
          .order("approved_at", { ascending: false })
      : null;

  const memberships = membershipRes.data || (fallbackMembershipRes?.data || []).map((membership: any) => ({ ...membership, jersey_number: null }));
  return Promise.all((memberships || []).map(hydrateMembership));
};

export const fetchLiveStandingForMembership = async (membership?: Pick<ActiveMembership, "team_id" | "club_team_id" | "league_id"> | null) => {
  if (!membership?.team_id) return null;

  let query = (supabase as any)
    .from("league_standings")
    .select("league_id, team_id, club_team_id, team_name, position, points, wins, draws, losses, goals_for, goals_against, goal_difference")
    .eq("team_id", membership.team_id);

  if (membership.club_team_id) {
    query = query.eq("club_team_id", membership.club_team_id);
  }

  if (membership.league_id) {
    query = query.eq("league_id", membership.league_id);
  }

  const { data } = await query.order("position", { ascending: true }).maybeSingle();
  return (data || null) as LiveStandingSummary | null;
};

export const fetchRosterForTeam = async (teamId: string) => {
  const [membershipsWithJerseyRes, approvedRequestsRes, legacyPlayersRes, teamRes, profilesFallbackRes] = await Promise.all([
    (supabase as any)
      .from("player_team_memberships")
      .select("id, player_profile_id, player_user_id, age_group, jersey_number, status, created_at")
      .eq("team_id", teamId)
      .in("status", ["accepted", "approved"])
      .order("created_at", { ascending: true }),
    (supabase as any)
      .from("team_join_requests")
      .select("id, player_profile_id, player_user_id, age_group, status, requested_at")
      .eq("team_id", teamId)
      .eq("status", "approved")
      .order("requested_at", { ascending: true }),
    (supabase as any)
      .from("players")
      .select("id, user_id, name, position, jersey_number, profile_image_url")
      .eq("team_id", teamId),
    (supabase as any).from("teams").select("id, name, league_id, age_group").eq("id", teamId).maybeSingle(),
    (supabase as any)
      .from("profiles")
      .select("user_id, full_name, avatar_url, username, position, team_name, account_category")
      .eq("account_category", "player"),
  ]);

  const membershipsRes =
    membershipsWithJerseyRes.error?.message?.includes("jersey_number")
      ? await (supabase as any)
          .from("player_team_memberships")
          .select("id, player_profile_id, player_user_id, age_group, status, created_at")
          .eq("team_id", teamId)
          .in("status", ["accepted", "approved"])
          .order("created_at", { ascending: true })
      : membershipsWithJerseyRes;

  const team = teamRes.data;
  const [profileFallbackRes, legacyClubFallbackRes] = team?.name
    ? await Promise.all([
        (supabase as any)
          .from("player_profiles_public")
          .select("id, user_id, full_name, position, jersey_number, profile_image_url, username, team, team_name"),
        (supabase as any)
          .from("players")
          .select("id, user_id, name, club, league, position, jersey_number, profile_image_url"),
      ])
    : [{ data: [] }, { data: [] }];

  const membershipRows = (membershipsRes.data || []) as any[];
  const approvedRequestRows = ((approvedRequestsRes.data || []) as any[])
    .filter(
      (request) =>
        !membershipRows.some((membership) => membership.player_user_id === request.player_user_id)
    )
    .map((request) => ({
      id: `request-${request.id}`,
      player_profile_id: request.player_profile_id,
      player_user_id: request.player_user_id,
      age_group: request.age_group,
      status: request.status,
      created_at: request.requested_at,
    }));

  const legacyPlayerRows = ((legacyPlayersRes.data || []) as any[])
    .filter(
      (player) =>
        player.user_id &&
        !membershipRows.some((membership) => membership.player_user_id === player.user_id) &&
        !approvedRequestRows.some((request) => request.player_user_id === player.user_id)
    )
    .map((player) => ({
      id: `legacy-${player.id}`,
      player_profile_id: null,
      player_user_id: player.user_id,
      age_group: null,
      status: "approved",
      created_at: new Date().toISOString(),
      player_name: player.name,
      player_position: player.position,
      player_avatar_url: player.profile_image_url,
      player_username: null,
    }));

  const legacyClubFallbackRows = ((legacyClubFallbackRes.data || []) as any[])
    .filter((player) => matchesTeamLabel(player.club, team?.name))
    .filter(
      (player) =>
        player.user_id &&
        !membershipRows.some((membership) => membership.player_user_id === player.user_id) &&
        !approvedRequestRows.some((request) => request.player_user_id === player.user_id) &&
        !legacyPlayerRows.some((legacyPlayer) => legacyPlayer.player_user_id === player.user_id)
    )
    .map((player) => ({
      id: `legacy-club-${player.id}`,
      player_profile_id: null,
      player_user_id: player.user_id,
      age_group: team?.age_group || null,
      status: "approved",
      created_at: new Date().toISOString(),
      player_name: player.name,
      player_position: player.position,
      player_avatar_url: player.profile_image_url,
      player_username: null,
    }));

  const profileFallbackRows = ((profileFallbackRes.data || []) as any[])
    .filter(
      (player) =>
        matchesTeamLabel(player.team, team?.name) ||
        matchesTeamLabel(player.team_name, team?.name)
    )
    .filter(
      (player) =>
        player.user_id &&
        !membershipRows.some((membership) => membership.player_user_id === player.user_id) &&
        !approvedRequestRows.some((request) => request.player_user_id === player.user_id) &&
        !legacyPlayerRows.some((legacyPlayer) => legacyPlayer.player_user_id === player.user_id) &&
        !legacyClubFallbackRows.some((legacyPlayer) => legacyPlayer.player_user_id === player.user_id)
    )
    .map((player) => ({
      id: `profile-${player.id}`,
      player_profile_id: player.id,
      player_user_id: player.user_id,
      age_group: team?.age_group || null,
      status: "approved",
      created_at: new Date().toISOString(),
      player_name: player.full_name,
      player_position: player.position,
      player_avatar_url: player.profile_image_url,
      player_username: player.username,
    }));

  const profilesFallbackRows = ((profilesFallbackRes.data || []) as any[])
    .filter((player) =>
      ((profileFallbackRes.data || []) as any[]).some(
        (visiblePlayer) => visiblePlayer.user_id === player.user_id
      )
    )
    .filter((player) => matchesTeamLabel(player.team_name, team?.name))
    .filter(
      (player) =>
        player.user_id &&
        !membershipRows.some((membership) => membership.player_user_id === player.user_id) &&
        !approvedRequestRows.some((request) => request.player_user_id === player.user_id) &&
        !legacyPlayerRows.some((legacyPlayer) => legacyPlayer.player_user_id === player.user_id) &&
        !legacyClubFallbackRows.some((legacyPlayer) => legacyPlayer.player_user_id === player.user_id) &&
        !profileFallbackRows.some((profilePlayer) => profilePlayer.player_user_id === player.user_id)
    )
    .map((player) => ({
      id: `profiles-${player.user_id}`,
      player_profile_id: "",
      player_user_id: player.user_id,
      age_group: team?.age_group || null,
      status: "approved",
      created_at: new Date().toISOString(),
      player_name: player.full_name || "Unknown Player",
      player_position: player.position || null,
      player_avatar_url: player.avatar_url || null,
      player_username: player.username || null,
    }));

  const memberships = [...membershipRows, ...approvedRequestRows];

  if (!memberships.length && !legacyPlayerRows.length && !legacyClubFallbackRows.length && !profileFallbackRows.length) return [] as TeamRosterPlayer[];

  const playerProfileIds = memberships.map((membership) => membership.player_profile_id).filter(Boolean);
  const [profilesRes, leagueRes] = await Promise.all([
    playerProfileIds.length
      ? (supabase as any)
          .from("player_profiles_public")
          .select("id, user_id, full_name, position, jersey_number, profile_image_url, username")
          .in("id", playerProfileIds)
      : Promise.resolve({ data: [] }),
    team?.league_id
      ? await (supabase as any).from("leagues").select("id, name").eq("id", team.league_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profilesById = new Map((profilesRes.data || []).map((profile) => [profile.id, profile]));
  const rosterFromMemberships = memberships.map((membership) => {
    const profile = profilesById.get(membership.player_profile_id);
    return {
      membership_id: membership.id,
      player_profile_id: membership.player_profile_id,
      player_user_id: membership.player_user_id,
      age_group: membership.age_group,
      status: membership.status,
      created_at: membership.created_at,
      player_name: profile?.full_name || "Unknown Player",
      player_position: profile?.position || null,
      player_jersey_number: membership.jersey_number || profile?.jersey_number || null,
      player_avatar_url: profile?.profile_image_url || null,
      player_username: profile?.username || null,
      team_name: team?.name || "",
      league_name: leagueRes.data?.name || null,
    } satisfies TeamRosterPlayer;
  });

  const rosterFromLegacyPlayers = legacyPlayerRows.map((player) => ({
    membership_id: player.id,
    player_profile_id: "",
    player_user_id: player.player_user_id,
    age_group: null,
    status: "approved",
    created_at: player.created_at,
    player_name: player.player_name,
    player_position: player.player_position,
    player_jersey_number: player.jersey_number || null,
    player_avatar_url: player.player_avatar_url,
    player_username: null,
    team_name: team?.name || "",
    league_name: leagueRes.data?.name || null,
  } satisfies TeamRosterPlayer));

  const rosterFromLegacyClubFallback = legacyClubFallbackRows.map((player) => ({
    membership_id: player.id,
    player_profile_id: "",
    player_user_id: player.player_user_id,
    age_group: player.age_group,
    status: "approved",
    created_at: player.created_at,
    player_name: player.player_name,
    player_position: player.player_position,
    player_jersey_number: player.player_jersey_number || null,
    player_avatar_url: player.player_avatar_url,
    player_username: null,
    team_name: team?.name || "",
    league_name: leagueRes.data?.name || null,
  } satisfies TeamRosterPlayer));

  const rosterFromProfileFallback = profileFallbackRows.map((player) => ({
    membership_id: player.id,
    player_profile_id: player.player_profile_id,
    player_user_id: player.player_user_id,
    age_group: player.age_group,
    status: "approved",
    created_at: player.created_at,
    player_name: player.player_name,
    player_position: player.player_position,
    player_jersey_number: player.player_jersey_number || null,
    player_avatar_url: player.player_avatar_url,
    player_username: player.player_username,
    team_name: team?.name || "",
    league_name: leagueRes.data?.name || null,
  } satisfies TeamRosterPlayer));

  const rosterFromProfilesFallback = profilesFallbackRows.map((player) => ({
    membership_id: player.id,
    player_profile_id: "",
    player_user_id: player.player_user_id,
    age_group: player.age_group,
    status: "approved",
    created_at: player.created_at,
    player_name: player.player_name,
    player_position: player.player_position,
    player_jersey_number: player.player_jersey_number || null,
    player_avatar_url: player.player_avatar_url,
    player_username: player.player_username,
    team_name: team?.name || "",
    league_name: leagueRes.data?.name || null,
  } satisfies TeamRosterPlayer));

  const roster = [...rosterFromMemberships, ...rosterFromLegacyPlayers, ...rosterFromLegacyClubFallback, ...rosterFromProfileFallback, ...rosterFromProfilesFallback];
  const rosterUserIds = [...new Set(roster.map((player) => player.player_user_id).filter(Boolean))];
  const { data: subscriptionRows } = rosterUserIds.length
    ? await (supabase as any)
        .from("profiles")
        .select("user_id, account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
        .in("user_id", rosterUserIds)
    : { data: [] };
  const subscriptionByUserId = new Map((subscriptionRows || []).map((profile: any) => [profile.user_id, profile]));

  return roster.map((player) => ({
    ...player,
    is_pro: getIsPro(subscriptionByUserId.get(player.player_user_id)),
  }));
};
