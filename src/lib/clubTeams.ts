import { supabase } from "@/integrations/supabase/client";
import type { OfferedClubTeam } from "@/components/club/ClubTeamsManager";

export interface ClubTeamRecord extends OfferedClubTeam {
  id: string;
  club_id: string;
  team_id: string | null;
  league_id: string | null;
  position?: number | null;
  access_code_value: string | null;
  access_code_last4: string | null;
  access_code_updated_at: string | null;
  roster_count: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  is_active: boolean;
}

export type PlayerGender = "boy" | "girl";

export const normalizeTeamGender = (value?: string | null): PlayerGender | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "boy" || normalized === "boys") return "boy";
  if (normalized === "girl" || normalized === "girls") return "girl";
  return null;
};

export const formatTeamGender = (value?: string | null) =>
  normalizeTeamGender(value) === "girl" ? "Girls" : normalizeTeamGender(value) === "boy" ? "Boys" : "Not categorized";

export interface ClubRecord {
  id: string;
  owner_user_id: string;
  team_profile_id: string | null;
  primary_team_id: string | null;
  name: string;
  city: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  founded_year: number | null;
  home_field_address: string | null;
  training_ground_address: string | null;
}

export const getAgeGroupSortValue = (ageGroup?: string | null) => {
  if (!ageGroup) return Number.MAX_SAFE_INTEGER;

  const normalized = ageGroup.trim().toUpperCase();
  const uMatch = normalized.match(/U\s*([0-9]{1,2})/);
  if (uMatch) return Number(uMatch[1]);

  const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const year = Number(yearMatch[0]);
    const now = new Date();
    const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    return Math.max(0, currentSeasonYear - year);
  }

  const genericMatch = normalized.match(/([0-9]{1,2})/);
  return genericMatch ? Number(genericMatch[1]) : Number.MAX_SAFE_INTEGER;
};

const normalizeLeagueToken = (value?: string | null) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const resolvePreferredLeagueLabel = (leagueName?: string | null, preferredLeagueNames: string[] = []) => {
  const trimmedLeagueName = leagueName?.trim() || "";
  if (!trimmedLeagueName) return "";

  const normalizedLeagueName = normalizeLeagueToken(trimmedLeagueName);
  const exactMatch = preferredLeagueNames.find((preferredLeague) => normalizeLeagueToken(preferredLeague) === normalizedLeagueName);
  if (exactMatch) return exactMatch;

  const partialMatch = preferredLeagueNames.find((preferredLeague) => {
    const normalizedPreferredLeague = normalizeLeagueToken(preferredLeague);
    return (
      normalizedLeagueName.includes(normalizedPreferredLeague) ||
      normalizedPreferredLeague.includes(normalizedLeagueName)
    );
  });

  return partialMatch || trimmedLeagueName;
};

export const normalizeOfferedTeams = (teams: OfferedClubTeam[]) =>
  teams
    .map((team) => ({
      ...team,
      age_group: team.age_group?.trim() || "",
      league_name: team.league_name?.trim() || "",
      gender: normalizeTeamGender(team.gender),
      season: team.season?.trim() || null,
      level: team.level?.trim() || null,
      coach_name: team.coach_name?.trim() || null,
      status: team.status || "active",
    }))
    .filter((team) => team.age_group && team.league_name);

export const getOfferedTeamDuplicate = (teams: OfferedClubTeam[]) => {
  const seen = new Set<string>();
  for (const team of normalizeOfferedTeams(teams)) {
    const key = [team.age_group, team.league_name, team.gender, team.season, team.level]
      .map((value) => (value || "").toLowerCase())
      .join("|");
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
};

export const fetchClubByTeamId = async (teamId: string) => {
  const { data: club } = await (supabase as any)
    .from("clubs")
    .select("*")
    .eq("primary_team_id", teamId)
    .maybeSingle();

  return (club || null) as ClubRecord | null;
};

export const fetchClubTeams = async (clubId: string) => {
  const { data } = await (supabase as any)
    .from("club_teams")
    .select("*")
    .eq("club_id", clubId)
    .neq("status", "archived")
    .order("league_name", { ascending: true })
    .order("created_at", { ascending: true });

  const clubTeams = (data || []) as ClubTeamRecord[];
  const clubTeamIds = clubTeams.map((team) => team.id).filter(Boolean);
  const { data: standings } = clubTeamIds.length
    ? await (supabase as any)
        .from("league_standings")
        .select("club_team_id, position")
        .in("club_team_id", clubTeamIds)
    : { data: [] };

  const standingsByClubTeamId = new Map(((standings || []) as any[]).map((standing) => [standing.club_team_id, standing.position]));

  return clubTeams
    .map((team) => ({
    ...team,
    position: standingsByClubTeamId.get(team.id) ?? null,
    is_active: team.status !== "inactive" && team.status !== "archived",
    }))
    .sort((a, b) => {
      const leagueDiff = (a.league_name || "").localeCompare(b.league_name || "");
      if (leagueDiff !== 0) return leagueDiff;

      const ageDiff = getAgeGroupSortValue(a.age_group) - getAgeGroupSortValue(b.age_group);
      if (ageDiff !== 0) return ageDiff;

      return (a.level || "").localeCompare(b.level || "");
    });
};

export const fetchClubTeamOptionsForParentTeam = async (teamId: string) => {
  const club = await fetchClubByTeamId(teamId);
  if (!club) return [];
  return fetchClubTeams(club.id);
};

export const sanitizeClubTeamAccessCode = (value: string) => value.replace(/\D/g, "").slice(0, 5);

export const updateClubTeamAccessCode = async (clubTeamId: string, accessCode: string) =>
  (supabase as any).rpc("update_club_team_access_code", {
    _club_team_id: clubTeamId,
    _access_code: sanitizeClubTeamAccessCode(accessCode),
  });

export const archiveClubTeam = async (clubTeamId: string) =>
  (supabase as any).rpc("archive_club_team", {
    _club_team_id: clubTeamId,
  });

export interface CreateDaughterTeamInput {
  parentTeamId?: string | null;
  ageGroup?: string | null;
  leagueOrConference: string;
  schoolLevel?: "varsity" | "junior_varsity" | "prep" | "middle_school" | null;
  gender: PlayerGender;
  season?: string | null;
  level?: string | null;
}

export const createDaughterTeam = async (input: CreateDaughterTeamInput) =>
  (supabase as any).rpc("create_daughter_team", {
    _parent_team_id: input.parentTeamId || null,
    _age_group: input.ageGroup || null,
    _league_or_conference: input.leagueOrConference,
    _school_level: input.schoolLevel || null,
    _gender: input.gender || null,
    _season: input.season || null,
    _level: input.level || null,
    _coach_name: null,
  });

export const setDaughterTeamGender = async (clubTeamId: string, gender: PlayerGender) =>
  (supabase as any).rpc("set_daughter_team_gender", {
    _club_team_id: clubTeamId,
    _gender: gender,
  });

export const fetchRosterForClubTeam = async (clubTeamId: string) => {
  const { data: clubTeam } = await (supabase as any)
    .from("club_teams")
    .select("id, team_id, league_id, league_name, age_group, gender, status")
    .eq("id", clubTeamId)
    .maybeSingle();

  if (!clubTeam) return [];

  const [{ data: siblingClubTeams }, membershipsWithJerseyRes] = await Promise.all([
    clubTeam.team_id
      ? (supabase as any)
          .from("club_teams")
          .select("id, age_group, league_id, league_name, status")
          .eq("team_id", clubTeam.team_id)
          .eq("age_group", clubTeam.age_group)
          .neq("status", "archived")
      : Promise.resolve({ data: [] }),
    clubTeam.team_id
      ? (supabase as any)
          .from("player_team_memberships")
          .select("id, player_profile_id, player_user_id, team_id, club_team_id, league_id, age_group, jersey_number, status, created_at")
          .eq("team_id", clubTeam.team_id)
          .in("status", ["accepted", "approved"])
          .order("created_at", { ascending: true })
      : (supabase as any)
          .from("player_team_memberships")
          .select("id, player_profile_id, player_user_id, team_id, club_team_id, league_id, age_group, jersey_number, status, created_at")
          .eq("club_team_id", clubTeamId)
          .in("status", ["accepted", "approved"])
          .order("created_at", { ascending: true }),
  ]);

  const membershipsRes =
    membershipsWithJerseyRes.error?.message?.includes("jersey_number")
      ? clubTeam.team_id
        ? await (supabase as any)
            .from("player_team_memberships")
            .select("id, player_profile_id, player_user_id, team_id, club_team_id, league_id, age_group, status, created_at")
            .eq("team_id", clubTeam.team_id)
            .in("status", ["accepted", "approved"])
            .order("created_at", { ascending: true })
        : await (supabase as any)
            .from("player_team_memberships")
            .select("id, player_profile_id, player_user_id, team_id, club_team_id, league_id, age_group, status, created_at")
            .eq("club_team_id", clubTeamId)
            .in("status", ["accepted", "approved"])
            .order("created_at", { ascending: true })
      : membershipsWithJerseyRes;

  const activeSiblingClubTeams = (siblingClubTeams || []).filter((team: any) => team.status !== "inactive");
  const canInferByAgeGroupOnly = activeSiblingClubTeams.length === 1;
  const matchingMemberships = ((membershipsRes.data || []) as any[]).filter((membership: any) => {
    if (membership.club_team_id === clubTeamId) return true;
    if (membership.club_team_id) return false;
    if (membership.team_id !== clubTeam.team_id) return false;
    if ((membership.age_group || null) !== (clubTeam.age_group || null)) return false;
    if (membership.league_id && clubTeam.league_id) return membership.league_id === clubTeam.league_id;
    return canInferByAgeGroupOnly;
  });

  const profileIds = matchingMemberships.map((membership: any) => membership.player_profile_id).filter(Boolean);
  const userIds = matchingMemberships.map((membership: any) => membership.player_user_id).filter(Boolean);
  const [{ data: profiles }, { data: profileFallbacks }] = await Promise.all([
    profileIds.length
      ? (supabase as any)
          .from("player_profiles_public")
          .select("id, user_id, full_name, position, jersey_number, profile_image_url, username")
          .in("id", profileIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
  const profileFallbacksByUserId = new Map((profileFallbacks || []).map((profile: any) => [profile.user_id, profile]));

  return matchingMemberships.map((membership: any) => {
    const profile = profilesById.get(membership.player_profile_id);
    const fallbackProfile = profileFallbacksByUserId.get(membership.player_user_id);
    return {
      membership_id: membership.id,
      player_profile_id: membership.player_profile_id,
      player_user_id: membership.player_user_id,
      age_group: membership.age_group,
      status: membership.status,
      created_at: membership.created_at,
      player_name: profile?.full_name || fallbackProfile?.full_name || "Unknown Player",
      player_position: profile?.position || null,
      player_jersey_number: membership.jersey_number || profile?.jersey_number || null,
      player_avatar_url: profile?.profile_image_url || fallbackProfile?.avatar_url || null,
      player_username: profile?.username || fallbackProfile?.username || null,
    };
  });
};
