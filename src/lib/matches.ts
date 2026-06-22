import { supabase } from "@/integrations/supabase/client";
import { fetchActiveMembershipForUser } from "@/lib/teamMemberships";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

export interface MatchAdminContext {
  isMatchAdmin: boolean;
  managedTeamIds: string[];
  playerProfileId: string | null;
  linkedTeamId: string | null;
}

export interface MatchFeedItem {
  id: string;
  league_id: string;
  league_name: string | null;
  season: string | null;
  region: string | null;
  age_group: string | null;
  division: string | null;
  tier: string | null;
  gender_category: string | null;
  home_team_id: string;
  home_club_team_id?: string | null;
  home_team_name: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_club_team_id?: string | null;
  away_team_name: string;
  away_team_logo_url: string | null;
  scheduled_at: string | null;
  venue: string | null;
  venue_address?: string | null;
  home_jersey_color?: string | null;
  away_jersey_color?: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_possession?: number | null;
  away_possession?: number | null;
  referee_user_id: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchFilmLinkRecord {
  id: string;
  match_id: string;
  submitted_by_user_id: string;
  url: string;
  label: string | null;
  created_at: string;
  removed_at: string | null;
  removed_by_user_id: string | null;
}

export interface LeagueRecord {
  id: string;
  name: string;
  governing_body: string | null;
  region: string | null;
  country: string | null;
  season: string | null;
  age_group: string | null;
  division: string | null;
  tier: string | null;
  gender_category: string | null;
  status: string;
}

export interface LeagueStandingRow {
  league_id: string;
  team_id: string;
  club_team_id?: string | null;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  position: number;
}

export interface MatchEventRecord {
  id: string;
  match_id: string;
  team_id: string;
  player_profile_id: string | null;
  player_user_id: string | null;
  jersey_number: string | null;
  event_type: string;
  event_minute: number | null;
  source: string;
  status: string;
  metadata: Record<string, any> | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  player_name: string | null;
  player_avatar_url: string | null;
}

export interface MatchCommentRecord {
  id: string;
  match_id: string;
  user_id: string;
  body: string;
  parent_comment_id: string | null;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string | null;
}

export interface MatchReportRecord {
  id: string;
  match_id: string;
  uploaded_by_user_id: string;
  image_url: string;
  storage_path: string | null;
  parsing_status: string;
  extracted_data: Record<string, any> | null;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistClaimRecord {
  id: string;
  match_id: string;
  goal_event_id: string;
  claimant_player_profile_id: string;
  claimant_user_id: string;
  team_id: string;
  status: string;
  created_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
}

export interface TeamMatchSnapshot {
  league: LeagueRecord | null;
  standing: LeagueStandingRow | null;
  upcoming: MatchFeedItem[];
  recent: MatchFeedItem[];
}

export interface ClubTeamPageData {
  clubTeam: any | null;
  club: any | null;
  parentTeam: any | null;
  league: LeagueRecord | null;
  standing: LeagueStandingRow | null;
  upcoming: MatchFeedItem[];
  recent: MatchFeedItem[];
}

export const formatMatchDateTime = (value?: string | null) => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export const formatLeagueSubtitle = (league: Partial<LeagueRecord>) =>
  [league.age_group, league.region, league.division || league.tier].filter(Boolean).join(" • ");

const MATCH_AUTO_DURATION_MINUTES = 120;

export const getEffectiveMatchStatus = (match: Pick<MatchFeedItem, "status" | "scheduled_at">) => {
  if (match.status === "cancelled" || match.status === "postponed") return match.status;
  if (!match.scheduled_at) return match.status === "completed" ? "over" : match.status;

  const scheduledAt = new Date(match.scheduled_at).getTime();
  if (Number.isNaN(scheduledAt)) return match.status === "completed" ? "over" : match.status;

  const now = Date.now();
  const liveWindowEnd = scheduledAt + MATCH_AUTO_DURATION_MINUTES * 60 * 1000;

  if (match.status === "completed") return "over";
  if (now < scheduledAt) return "scheduled";
  if (now <= liveWindowEnd) return "live";
  return "over";
};

export const getMatchStatusLabel = (match: Pick<MatchFeedItem, "status" | "scheduled_at">) => {
  switch (getEffectiveMatchStatus(match)) {
    case "live":
      return "Live";
    case "over":
      return "Over";
    case "postponed":
      return "Postponed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Scheduled";
  }
};

export const fetchMatchAdminContext = async (userId?: string | null, userEmail?: string | null): Promise<MatchAdminContext> => {
  if (!userId) {
    return { isMatchAdmin: false, managedTeamIds: [], playerProfileId: null, linkedTeamId: null };
  }

  const [teamProfileRes, playerProfileRes, activeMembership] = await Promise.all([
    (supabase as any).from("team_profiles").select("team_id").eq("user_id", userId),
    (supabase as any).from("player_profiles").select("id").eq("user_id", userId).maybeSingle(),
    fetchActiveMembershipForUser(userId),
  ]);

  return {
    isMatchAdmin: isFootyStatusSuperAdminEmail(userEmail),
    managedTeamIds: (teamProfileRes.data || []).map((row: any) => row.team_id).filter(Boolean),
    playerProfileId: playerProfileRes.data?.id || null,
    linkedTeamId: activeMembership?.team?.id || null,
  };
};

export const fetchMatchesHomeData = async () => {
  const [leagueRes, matchRes] = await Promise.all([
    (supabase as any)
      .from("leagues")
      .select("id, name, governing_body, region, country, season, age_group, division, tier, gender_category, status")
      .neq("status", "archived")
      .order("name"),
    (supabase as any)
      .from("league_match_details")
      .select("*")
      .order("scheduled_at", { ascending: true }),
  ]);

  const leagues = (leagueRes.data || []) as LeagueRecord[];
  const matches = (matchRes.data || []) as MatchFeedItem[];

  const liveMatches = matches.filter((match) => getEffectiveMatchStatus(match) === "live");
  const upcomingMatches = matches.filter((match) => getEffectiveMatchStatus(match) === "scheduled").slice(0, 8);
  const recentResults = matches
    .filter((match) => getEffectiveMatchStatus(match) === "over")
    .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime())
    .slice(0, 8);

  return { leagues, liveMatches, upcomingMatches, recentResults };
};

export const fetchLeaguePageData = async (leagueId: string) => {
  const [leagueRes, standingsRes, matchesRes, teamsRes, teamProfilesRes] = await Promise.all([
    (supabase as any)
      .from("leagues")
      .select("id, name, governing_body, region, country, season, age_group, division, tier, gender_category, status")
      .eq("id", leagueId)
      .maybeSingle(),
    (supabase as any)
      .from("league_standings")
      .select("*")
      .eq("league_id", leagueId)
      .order("position", { ascending: true }),
    (supabase as any)
      .from("league_match_details")
      .select("*")
      .eq("league_id", leagueId)
      .order("scheduled_at", { ascending: true }),
    (supabase as any)
      .from("league_teams")
      .select("id, team_id, club_team_id, teams(id, name, approval_status, age_group, logo_url)")
      .eq("league_id", leagueId),
    (supabase as any).from("team_profiles").select("team_id, logo_url"),
  ]);

  const linkedClubTeamIds = ((teamsRes.data || []) as any[])
    .map((row: any) => row.club_team_id)
    .filter(Boolean);

  const clubTeamsQuery = (supabase as any)
      .from("club_teams")
      .select("id, team_id, club_id, age_group, league_name, league_id, status, wins, draws, losses, points, clubs(name, primary_team_id)")
      .neq("status", "archived");

  let clubTeamsRes;
  if (linkedClubTeamIds.length) {
    clubTeamsRes = await clubTeamsQuery.in("id", linkedClubTeamIds);
  } else {
    clubTeamsRes = await clubTeamsQuery.eq("league_id", leagueId);
  }

  const parentTeamById = new Map(
    ((teamsRes.data || []) as any[])
      .filter((row: any) => row.team_id && row.teams)
      .map((row: any) => [row.team_id, row.teams])
  );
  const teamProfileLogoById = new Map(
    (((teamProfilesRes.data || []) as any[]) || [])
      .filter((row: any) => row.team_id && row.logo_url)
      .map((row: any) => [row.team_id, row.logo_url])
  );
  const clubTeamById = new Map((((clubTeamsRes.data || []) as any[]) || []).map((clubTeam: any) => [clubTeam.id, clubTeam]));

  const displayTeams =
    (teamsRes.data || []).length > 0
      ? ((teamsRes.data || []) as any[]).map((row: any) => {
          const linkedClubTeam = row.club_team_id ? clubTeamById.get(row.club_team_id) : null;
          return {
            id: linkedClubTeam?.id || row.team_id,
            team_id: row.team_id,
            club_team_id: linkedClubTeam?.id || null,
            teams: {
              name: linkedClubTeam?.clubs?.name || parentTeamById.get(row.team_id)?.name || "Club Team",
              age_group: linkedClubTeam?.age_group || row.teams?.age_group || null,
              league_name: linkedClubTeam?.league_name || null,
              logo_url: parentTeamById.get(row.team_id)?.logo_url || teamProfileLogoById.get(row.team_id) || null,
            },
          };
        })
      : (teamsRes.data || []);

  return {
    league: (leagueRes.data || null) as LeagueRecord | null,
    standings: (standingsRes.data || []) as LeagueStandingRow[],
    matches: (matchesRes.data || []) as MatchFeedItem[],
    teams: displayTeams as any[],
  };
};

export const fetchMatchPageData = async (matchId: string) => {
  const [matchRes, eventRes, commentRes, reportRes, claimRes, filmLinksRes] = await Promise.all([
    (supabase as any).from("league_match_details").select("*").eq("id", matchId).maybeSingle(),
    (supabase as any).from("match_event_details").select("*").eq("match_id", matchId).order("event_minute", { ascending: true }).order("created_at", { ascending: true }),
    (supabase as any).from("match_comment_details").select("*").eq("match_id", matchId).order("created_at", { ascending: false }),
    (supabase as any).from("referee_report_uploads").select("*").eq("match_id", matchId).order("created_at", { ascending: false }),
    (supabase as any).from("assist_claims").select("*").eq("match_id", matchId).order("created_at", { ascending: false }),
    (supabase as any)
      .from("match_film_links")
      .select("*")
      .eq("match_id", matchId)
      .is("removed_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return {
    match: (matchRes.data || null) as MatchFeedItem | null,
    events: (eventRes.data || []) as MatchEventRecord[],
    comments: (commentRes.data || []) as MatchCommentRecord[],
    reports: (reportRes.data || []) as MatchReportRecord[],
    assistClaims: (claimRes.data || []) as AssistClaimRecord[],
    filmLinks: (filmLinksRes.data || []) as MatchFilmLinkRecord[],
  };
};

export const fetchApprovedTeamsForLeagueAssignment = async (_league: Pick<LeagueRecord, "age_group" | "region">) => {
  const [{ data: parentTeams }, { data: clubs }, { data: allClubTeams }] = await Promise.all([
    (supabase as any)
      .from("teams")
      .select("id, name, approval_status, age_group, league_id")
      .eq("approval_status", "approved")
      .order("name"),
    (supabase as any)
      .from("clubs")
      .select("id, name, primary_team_id"),
    (supabase as any)
      .from("club_teams")
      .select("id, club_id, team_id, age_group, league_name, league_id, status")
      .neq("status", "archived"),
  ]);

  const approvedTeams = (parentTeams || []) as any[];
  const clubsById = new Map(((clubs || []) as any[]).map((club) => [club.id, club]));
  const parentTeamById = new Map(approvedTeams.map((team) => [team.id, team]));

  const matchingClubTeams = ((allClubTeams || []) as any[])
    .filter((clubTeam) => clubTeam.status !== "inactive")
    .map((clubTeam) => {
      const club = clubsById.get(clubTeam.club_id);
      const resolvedParentTeamId = clubTeam.team_id || club?.primary_team_id || null;
      const parentTeam = resolvedParentTeamId ? parentTeamById.get(resolvedParentTeamId) : null;
      if (!parentTeam) return null;

      return {
        id: `${resolvedParentTeamId}::${clubTeam.id}`,
        team_id: resolvedParentTeamId,
        club_team_id: clubTeam.id,
        name: club?.name || parentTeam.name,
        approval_status: parentTeam.approval_status,
        age_group: clubTeam.age_group || parentTeam.age_group || null,
        league_id: clubTeam.league_id || parentTeam.league_id || null,
        league_name: clubTeam.league_name || null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const left = [a.name, a.age_group, a.league_name].filter(Boolean).join(" ");
      const right = [b.name, b.age_group, b.league_name].filter(Boolean).join(" ");
      return left.localeCompare(right);
    });

  if (matchingClubTeams.length) return matchingClubTeams;

  return approvedTeams;
};

export const createLeague = async (payload: {
  name: string;
  governing_body?: string | null;
  age_group?: string | null;
  region?: string | null;
  season?: string | null;
  division?: string | null;
  tier?: string | null;
  gender_category?: string | null;
}) =>
  (supabase as any)
    .from("leagues")
    .insert({
      ...payload,
      status: "active",
      created_by: (await supabase.auth.getUser()).data.user?.id || null,
    })
    .select("*")
    .single();

export const updateLeague = async (
  leagueId: string,
  payload: {
    name: string;
    governing_body?: string | null;
    age_group?: string | null;
    region?: string | null;
    season?: string | null;
    division?: string | null;
    tier?: string | null;
    gender_category?: string | null;
    status?: string;
  }
) =>
  (supabase as any)
    .from("leagues")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leagueId)
    .select("*")
    .single();

export const assignTeamToLeague = async (leagueId: string, teamId: string) =>
  (supabase as any).rpc("assign_team_to_league", { _league_id: leagueId, _team_id: teamId });

export const assignClubTeamToLeague = async (leagueId: string, clubTeamId: string) =>
  (supabase as any).rpc("assign_club_team_to_league", { _league_id: leagueId, _club_team_id: clubTeamId });

export const removeTeamFromLeague = async (leagueId: string, teamId: string) =>
  (supabase as any).rpc("remove_team_from_league", { _league_id: leagueId, _team_id: teamId });

export const removeClubTeamFromLeague = async (leagueId: string, clubTeamId: string) =>
  (supabase as any).rpc("remove_club_team_from_league", { _league_id: leagueId, _club_team_id: clubTeamId });

export const createLeagueFixture = async (payload: {
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeClubTeamId?: string | null;
  awayClubTeamId?: string | null;
  scheduledAt: string;
  venue?: string;
  venueAddress?: string;
  homeJerseyColor?: string;
  awayJerseyColor?: string;
  refereeUserId?: string | null;
  notes?: string;
}) =>
  (supabase as any).rpc("create_league_match", {
    _league_id: payload.leagueId,
    _home_team_id: payload.homeTeamId,
    _away_team_id: payload.awayTeamId,
    _scheduled_at: payload.scheduledAt,
    _venue: payload.venue || null,
    _referee_user_id: payload.refereeUserId || null,
    _notes: payload.notes || null,
    _home_club_team_id: payload.homeClubTeamId || null,
    _away_club_team_id: payload.awayClubTeamId || null,
    _venue_address: payload.venueAddress || null,
    _home_jersey_color: payload.homeJerseyColor || null,
    _away_jersey_color: payload.awayJerseyColor || null,
  });

export const saveMatchResult = async (payload: {
  matchId: string;
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  notes?: string;
}) =>
  (supabase as any).rpc("save_match_result", {
    _match_id: payload.matchId,
    _status: payload.status,
    _home_score: payload.homeScore ?? null,
    _away_score: payload.awayScore ?? null,
    _notes: payload.notes || null,
  });

export const updateMatchDetails = async (payload: {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeClubTeamId?: string | null;
  awayClubTeamId?: string | null;
  scheduledAt: string;
  venue?: string | null;
  venueAddress?: string | null;
  homeJerseyColor?: string | null;
  awayJerseyColor?: string | null;
  notes?: string | null;
  status?: string | null;
}) =>
  (supabase as any).rpc("update_match_details", {
    _match_id: payload.matchId,
    _home_team_id: payload.homeTeamId,
    _away_team_id: payload.awayTeamId,
    _home_club_team_id: payload.homeClubTeamId || null,
    _away_club_team_id: payload.awayClubTeamId || null,
    _scheduled_at: payload.scheduledAt,
    _venue: payload.venue || null,
    _venue_address: payload.venueAddress || null,
    _home_jersey_color: payload.homeJerseyColor || null,
    _away_jersey_color: payload.awayJerseyColor || null,
    _notes: payload.notes || null,
    _status: payload.status || null,
  });

export const deleteMatch = async (matchId: string) =>
  (supabase as any).rpc("delete_match", { _match_id: matchId });

export const addMatchEvent = async (payload: {
  eventId?: string | null;
  matchId: string;
  teamId: string;
  eventType: string;
  playerProfileId?: string | null;
  jerseyNumber?: string | null;
  minute?: number | null;
  metadata?: Record<string, any>;
  source?: string;
}) => {
  const nextSignaturePayload = {
    _event_id: payload.eventId || null,
    _match_id: payload.matchId,
    _team_id: payload.teamId,
    _event_type: payload.eventType,
    _player_profile_id: payload.playerProfileId || null,
    _jersey_number: payload.jerseyNumber || null,
    _event_minute: payload.minute ?? null,
    _metadata: payload.metadata || {},
    _source: payload.source || "manual_admin",
  };

  const nextSignatureResult = await (supabase as any).rpc("upsert_match_event", nextSignaturePayload);
  if (!nextSignatureResult.error || payload.eventId) return nextSignatureResult;

  const maybeMissingNewSignature =
    typeof nextSignatureResult.error.message === "string" &&
    nextSignatureResult.error.message.includes("public.upsert_match_event(");

  if (!maybeMissingNewSignature) return nextSignatureResult;

  return (supabase as any).rpc("upsert_match_event", {
    _match_id: payload.matchId,
    _team_id: payload.teamId,
    _event_type: payload.eventType,
    _player_profile_id: payload.playerProfileId || null,
    _jersey_number: payload.jerseyNumber || null,
    _event_minute: payload.minute ?? null,
    _metadata: payload.metadata || {},
    _source: payload.source || "manual_admin",
  });
};

export const deleteMatchEvent = async (eventId: string) =>
  (supabase as any).rpc("delete_match_event", { _event_id: eventId });

export const createMatchComment = async (matchId: string, userId: string, body: string) =>
  (supabase as any)
    .from("match_comments")
    .insert({ match_id: matchId, user_id: userId, body: body.trim() })
    .select("*")
    .single();

export const updateMatchComment = async (commentId: string, body: string) =>
  (supabase as any).from("match_comments").update({ body: body.trim() }).eq("id", commentId);

export const deleteMatchComment = async (commentId: string) =>
  (supabase as any).from("match_comments").delete().eq("id", commentId);

export const uploadMatchReportImage = async (payload: {
  matchId: string;
  userId: string;
  file: File;
}) => {
  const extension = payload.file.name.split(".").pop() || "jpg";
  const path = `${payload.userId}/${payload.matchId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const uploadRes = await supabase.storage.from("match-reports").upload(path, payload.file);
  if (uploadRes.error) return { data: null, error: uploadRes.error };

  const { data: publicUrlData } = supabase.storage.from("match-reports").getPublicUrl(path);
  return (supabase as any)
    .from("referee_report_uploads")
    .insert({
      match_id: payload.matchId,
      uploaded_by_user_id: payload.userId,
      image_url: publicUrlData.publicUrl,
      storage_path: path,
      parsing_status: "pending_review",
    })
    .select("*")
    .single();
};

export const claimMatchAssist = async (goalEventId: string) =>
  (supabase as any).rpc("claim_match_assist", { _goal_event_id: goalEventId });

export const reviewMatchAssistClaim = async (claimId: string, approve: boolean) =>
  (supabase as any).rpc("review_match_assist_claim", { _claim_id: claimId, _approve: approve });

export const createMatchFilmLink = async (payload: {
  matchId: string;
  userId: string;
  url: string;
  label?: string | null;
}) =>
  (supabase as any)
    .from("match_film_links")
    .insert({
      match_id: payload.matchId,
      submitted_by_user_id: payload.userId,
      url: payload.url.trim(),
      label: payload.label?.trim() || null,
    })
    .select("*")
    .single();

export const removeMatchFilmLink = async (payload: { linkId: string; userId: string }) =>
  (supabase as any)
    .from("match_film_links")
    .update({
      removed_at: new Date().toISOString(),
      removed_by_user_id: payload.userId,
    })
    .eq("id", payload.linkId);

export const fetchTeamMatchSnapshot = async (teamId: string): Promise<TeamMatchSnapshot> => {
  const [leagueRes, snapshotRes, matchesRes] = await Promise.all([
    (supabase as any)
      .from("teams")
      .select("league_id, leagues(id, name, governing_body, region, country, season, age_group, division, tier, gender_category, status)")
      .eq("id", teamId)
      .maybeSingle(),
    (supabase as any)
      .from("league_standings")
      .select("*")
      .eq("team_id", teamId)
      .maybeSingle(),
    (supabase as any)
      .from("league_match_details")
      .select("*")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order("scheduled_at", { ascending: true }),
  ]);

  const league = (leagueRes.data?.leagues || null) as LeagueRecord | null;
  const allMatches = (matchesRes.data || []) as MatchFeedItem[];

  return {
    league,
    standing: (snapshotRes.data || null) as LeagueStandingRow | null,
    upcoming: allMatches.filter((match) => { const status = getEffectiveMatchStatus(match); return status === "scheduled" || status === "live"; }).slice(0, 3),
    recent: allMatches
      .filter((match) => getEffectiveMatchStatus(match) === "over")
      .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime())
      .slice(0, 3),
  };
};

export const fetchClubTeamPageData = async (clubTeamId: string): Promise<ClubTeamPageData> => {
  const { data: clubTeam } = await (supabase as any)
    .from("club_teams")
    .select("*")
    .eq("id", clubTeamId)
    .maybeSingle();

  if (!clubTeam) {
    return {
      clubTeam: null,
      club: null,
      parentTeam: null,
      league: null,
      standing: null,
      upcoming: [],
      recent: [],
    };
  }

  const { data: club } = await (supabase as any)
    .from("clubs")
    .select("*")
    .eq("id", clubTeam.club_id)
    .maybeSingle();

  const parentTeamId = clubTeam.team_id || club?.primary_team_id || null;

  const [parentTeamRes, leagueRes, standingRes, directClubTeamMatchesRes, parentFallbackMatchesRes] = await Promise.all([
    parentTeamId
      ? (supabase as any).from("teams").select("*").eq("id", parentTeamId).maybeSingle()
      : Promise.resolve({ data: null }),
    clubTeam.league_id
      ? (supabase as any)
          .from("leagues")
          .select("id, name, governing_body, region, country, season, age_group, division, tier, gender_category, status")
          .eq("id", clubTeam.league_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    clubTeam.league_id && parentTeamId
      ? (supabase as any)
          .from("league_standings")
          .select("*")
          .eq("league_id", clubTeam.league_id)
          .eq("team_id", parentTeamId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    clubTeam.league_id
      ? (supabase as any)
          .from("league_match_details")
          .select("*")
          .eq("league_id", clubTeam.league_id)
          .or(`home_club_team_id.eq.${clubTeamId},away_club_team_id.eq.${clubTeamId}`)
          .order("scheduled_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    clubTeam.league_id && parentTeamId
      ? (supabase as any)
          .from("league_match_details")
          .select("*")
          .eq("league_id", clubTeam.league_id)
          .or(`home_team_id.eq.${parentTeamId},away_team_id.eq.${parentTeamId}`)
          .order("scheduled_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const { data: parentTeamProfile } = parentTeamId
    ? await (supabase as any).from("team_profiles").select("logo_url").eq("team_id", parentTeamId).maybeSingle()
    : { data: null };

  const directMatches = (directClubTeamMatchesRes.data || []) as MatchFeedItem[];
  const fallbackMatches = (parentFallbackMatchesRes.data || []) as MatchFeedItem[];
  const allMatches = (directMatches.length ? directMatches : fallbackMatches).filter((match) => {
    if (!match.home_club_team_id && !match.away_club_team_id) return true;
    return match.home_club_team_id === clubTeamId || match.away_club_team_id === clubTeamId;
  });
  const resolvedParentTeam =
    parentTeamRes.data
      ? {
          ...parentTeamRes.data,
          logo_url: parentTeamRes.data.logo_url || parentTeamProfile?.logo_url || null,
        }
      : null;

  return {
    clubTeam,
    club: club || null,
    parentTeam: resolvedParentTeam,
    league: (leagueRes.data || null) as LeagueRecord | null,
    standing: (standingRes.data || null) as LeagueStandingRow | null,
    upcoming: allMatches.filter((match) => { const status = getEffectiveMatchStatus(match); return status === "scheduled" || status === "live"; }).slice(0, 5),
    recent: allMatches
      .filter((match) => getEffectiveMatchStatus(match) === "over")
      .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime())
      .slice(0, 5),
  };
};
