import { Briefcase, GraduationCap, Search, Users, Trophy, Shield, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PlayerCard from "./PlayerCard";
import { formatTeamLeagueLine } from "@/lib/teamMemberships";
import { useAuth } from "@/hooks/useAuth";
import { getIsPro } from "@/lib/subscriptions";
import { CoachStaffProfile, fetchCoachStaffProfiles, formatRoleDisplayLabel } from "@/lib/coachStaffTeams";

interface Player {
  id: string;
  name: string;
  club: string;
  league: string;
  position: string | null;
  school_grade?: string | null;
  player_gender?: "boy" | "girl" | string | null;
  profile_image_url: string | null;
  username?: string | null;
  team_name?: string | null;
  user_id?: string | null;
  is_pro?: boolean;
}

interface Team {
  id: string;
  name: string;
  league_id: string | null;
  owner_user_id?: string | null;
  username?: string | null;
  logo_url?: string | null;
  parent_team_id?: string | null;
  age_group?: string | null;
  league_name?: string | null;
  subtitle?: string | null;
  is_sub_team?: boolean;
  team_type?: "club" | "school" | null;
  school_level?: string | null;
  location?: string | null;
  league_conference?: string | null;
  gender?: string | null;
}

interface ClubRecord {
  id: string;
  primary_team_id: string | null;
  team_profile_id: string | null;
}

interface ClubTeamRecord {
  id: string;
  club_id?: string | null;
  team_id: string | null;
  age_group: string | null;
  league_id: string | null;
  league_name: string | null;
  status: string | null;
  team_type?: "club" | "school" | null;
  school_level?: string | null;
  gender?: string | null;
}

interface League {
  id: string;
  name: string;
  country: string | null;
  age_group: string | null;
}

interface RefereeProfile {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  referee_certification_level: string | null;
  referee_certifying_organization: string | null;
  referee_years_experience: number | null;
  referee_leagues_tournaments: string | null;
  referee_availability: string | null;
}

interface ParentExploreProfile {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  relationship_to_player?: string | null;
  child_team?: string | null;
  child_league?: string | null;
  child_age_group?: string | null;
}

const ExploreTab = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [coachStaff, setCoachStaff] = useState<CoachStaffProfile[]>([]);
  const [allCoachStaff, setAllCoachStaff] = useState<CoachStaffProfile[]>([]);
  const [academyStaff, setAcademyStaff] = useState<CoachStaffProfile[]>([]);
  const [allAcademyStaff, setAllAcademyStaff] = useState<CoachStaffProfile[]>([]);
  const [scouts, setScouts] = useState<CoachStaffProfile[]>([]);
  const [allScouts, setAllScouts] = useState<CoachStaffProfile[]>([]);
  const [referees, setReferees] = useState<RefereeProfile[]>([]);
  const [allReferees, setAllReferees] = useState<RefereeProfile[]>([]);
  const [parents, setParents] = useState<ParentExploreProfile[]>([]);
  const [allParents, setAllParents] = useState<ParentExploreProfile[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [allLeagues, setAllLeagues] = useState<League[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [teamTypeFilter, setTeamTypeFilter] = useState<"all" | "club" | "school">("all");
  const [schoolLevelFilter, setSchoolLevelFilter] = useState("all");
  const [teamLocationFilter, setTeamLocationFilter] = useState("");
  const [teamLeagueFilter, setTeamLeagueFilter] = useState("");
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const viewerPlayerGender = profile?.account_role === "player" ? profile.player_gender : null;

  useEffect(() => {
    const fetchData = async () => {
      const [playersRes, playerProfilesRes, teamsRes, leaguesRes, coachStaffProfiles, refereeProfilesRes, parentProfilesRes] = await Promise.all([
        supabase.from("players").select("*"),
        supabase.from("player_profiles_public").select("id, user_id, full_name, team, team_name, position, school_grade, player_gender, profile_image_url, username"),
        (supabase as any).from("teams").select("*").eq("approval_status", "approved").neq("is_active", false),
        supabase.from("leagues").select("*"),
        fetchCoachStaffProfiles().catch(() => []),
        (supabase as any)
          .from("profiles")
          .select("user_id, full_name, username, avatar_url, referee_certification_level, referee_certifying_organization, referee_years_experience, referee_leagues_tournaments, referee_availability")
          .eq("account_category", "referee"),
        (supabase as any)
          .from("profiles")
          .select("user_id, full_name, username, avatar_url, bio, parent_profiles(relationship_to_player, child_team, child_league, child_age_group)")
          .eq("account_category", "parent"),
      ]);

      const profileUserIds = [...new Set((playerProfilesRes.data || []).map((player) => player.user_id).filter(Boolean))];
      const { data: subscriptionRows } = profileUserIds.length
        ? await (supabase as any)
            .from("profiles")
            .select("user_id, account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
            .in("user_id", profileUserIds)
        : { data: [] };
      const subscriptionByUserId = new Map((subscriptionRows || []).map((profile: any) => [profile.user_id, profile]));
      const { data: memberships } = profileUserIds.length
        ? await (supabase as any)
            .from("player_team_memberships")
            .select("player_user_id, team_id, league_id, age_group, status, approved_at")
            .in("player_user_id", profileUserIds)
            .in("status", ["accepted", "approved"])
            .order("approved_at", { ascending: false })
        : { data: [] };

      const activeMembershipByUserId = new Map<string, any>();
      (memberships || []).forEach((membership: any) => {
        if (!activeMembershipByUserId.has(membership.player_user_id)) {
          activeMembershipByUserId.set(membership.player_user_id, membership);
        }
      });

      const teamsById = new Map(((teamsRes.data as any[]) || []).map((team) => [team.id, team]));
      const leaguesById = new Map(((leaguesRes.data as any[]) || []).map((league) => [league.id, league]));
      const teamIds = ((teamsRes.data as any[]) || []).map((team) => team.id);
      const { data: teamProfiles } = teamIds.length
        ? await (supabase as any)
            .from("team_profiles")
            .select("id, team_id, user_id, logo_url, team_type, school_level, city, league_conference")
            .in("team_id", teamIds)
        : { data: [] };
      const { data: clubs } = teamIds.length
        ? await (supabase as any)
            .from("clubs")
            .select("id, primary_team_id, team_profile_id")
            .in("primary_team_id", teamIds)
        : { data: [] };
      const teamOwnerUserIds = [
        ...new Set([
          ...(((teamsRes.data as any[]) || []).map((team) => team.owner_user_id).filter(Boolean)),
          ...(((teamProfiles || []) as any[]).map((teamProfile) => teamProfile.user_id).filter(Boolean)),
        ]),
      ];
      const { data: teamUsernameProfiles } = teamOwnerUserIds.length
        ? await (supabase as any)
            .from("profiles")
            .select("user_id, username")
            .in("user_id", teamOwnerUserIds)
        : { data: [] };
      const clubIds = ((clubs || []) as ClubRecord[]).map((club) => club.id).filter(Boolean);
      const { data: clubTeamsByTeamId } = teamIds.length
        ? await (supabase as any)
            .from("club_teams")
            .select("id, club_id, team_id, age_group, league_id, league_name, status, team_type, school_level, gender")
            .in("team_id", teamIds)
            .neq("status", "archived")
        : { data: [] };
      const { data: clubTeamsByClubId } = clubIds.length
        ? await (supabase as any)
            .from("club_teams")
            .select("id, club_id, team_id, age_group, league_id, league_name, status, team_type, school_level, gender")
            .in("club_id", clubIds)
            .neq("status", "archived")
        : { data: [] };
      const clubTeamsById = new Map<string, ClubTeamRecord>();
      ([...(clubTeamsByTeamId || []), ...(clubTeamsByClubId || [])] as ClubTeamRecord[]).forEach((clubTeam) => {
        clubTeamsById.set(clubTeam.id, clubTeam);
      });
      const clubTeams = Array.from(clubTeamsById.values());

      const teamLogoById = new Map<string, string | null>();
      const teamProfileUserByTeamId = new Map<string, string | null>();
      const teamProfileById = new Map<string, any>();
      const clubById = new Map<string, ClubRecord>();
      const usernameByUserId = new Map<string, string | null>();
      ((teamProfiles || []) as Array<{ id?: string; team_id: string; user_id?: string | null; logo_url: string | null }>).forEach((teamProfile) => {
        if (teamProfile.id) {
          teamProfileById.set(teamProfile.id, teamProfile);
        }
        if (teamProfile.logo_url) {
          teamLogoById.set(teamProfile.team_id, teamProfile.logo_url);
        }
        if (teamProfile.user_id) {
          teamProfileUserByTeamId.set(teamProfile.team_id, teamProfile.user_id);
        }
      });
      ((teamUsernameProfiles || []) as Array<{ user_id: string; username: string | null }>).forEach((profile) => {
        usernameByUserId.set(profile.user_id, profile.username);
      });
      ((clubs || []) as ClubRecord[]).forEach((club) => {
        clubById.set(club.id, club);
      });

      // Merge players table and player_profiles into a unified player list
      const legacyPlayers: Player[] = (playersRes.data || []).map(p => ({
        id: p.id,
        name: p.name,
        club: p.club,
        league: p.league,
        position: p.position,
        player_gender: p.player_gender || null,
        profile_image_url: p.profile_image_url,
        user_id: p.user_id,
      }));

      const profilePlayers: Player[] = (playerProfilesRes.data || []).map((p) => {
        const membership = p.user_id ? activeMembershipByUserId.get(p.user_id) : null;
        const linkedTeam = membership?.team_id ? teamsById.get(membership.team_id) : null;
        const linkedLeague = membership?.league_id ? leaguesById.get(membership.league_id) : null;
        return {
        id: p.id,
        name: p.full_name,
        club: linkedTeam
          ? formatTeamLeagueLine(linkedTeam.name, membership.age_group || linkedTeam.age_group, linkedLeague?.name)
          : p.team_name || p.team || "",
        league: linkedLeague?.name || "",
        position: p.position,
        school_grade: p.school_grade,
        player_gender: p.player_gender || null,
        profile_image_url: p.profile_image_url,
        username: p.username,
        team_name: linkedTeam?.name || p.team_name || p.team,
        user_id: p.user_id,
        is_pro: getIsPro(p.user_id ? subscriptionByUserId.get(p.user_id) : null),
      };
      });

      // Deduplicate by name and prefer real account-backed profile records over seeded legacy rows.
      const mergedByName = new Map<string, Player>();

      profilePlayers.forEach((player) => {
        mergedByName.set(player.name.toLowerCase(), player);
      });

      legacyPlayers.forEach((player) => {
        const key = player.name.toLowerCase();
        if (!mergedByName.has(key)) {
          mergedByName.set(key, player);
        }
      });

      const merged = Array.from(mergedByName.values()).filter((player) => {
        if (!viewerPlayerGender) return true;
        return player.player_gender === viewerPlayerGender;
      });

      setAllPlayers(merged);
      setPlayers(merged);
      const nonTeamOrganizationStaff = coachStaffProfiles.filter(
        (staff) => staff.account_role !== "team_club" && staff.account_role !== "school_team"
      );
      const scoutProfiles = nonTeamOrganizationStaff.filter((staff) => staff.account_role === "scout");
      const academyStaffProfiles = nonTeamOrganizationStaff.filter(
        (staff) => staff.account_role === "academy_director" || staff.account_role === "team_staff"
      );
      const coachProfiles = nonTeamOrganizationStaff.filter(
        (staff) => staff.account_role !== "scout" && staff.account_role !== "academy_director" && staff.account_role !== "team_staff"
      );
      setAllCoachStaff(coachProfiles);
      setCoachStaff(coachProfiles);
      setAllAcademyStaff(academyStaffProfiles);
      setAcademyStaff(academyStaffProfiles);
      setAllScouts(scoutProfiles);
      setScouts(scoutProfiles);
      setAllReferees(refereeProfilesRes.data || []);
      setReferees(refereeProfilesRes.data || []);
      const parentProfiles = ((parentProfilesRes.data || []) as any[]).map((parent) => ({
        user_id: parent.user_id,
        full_name: parent.full_name,
        username: parent.username,
        avatar_url: parent.avatar_url,
        bio: parent.bio,
        relationship_to_player: (Array.isArray(parent.parent_profiles) ? parent.parent_profiles[0] : parent.parent_profiles)?.relationship_to_player || null,
        child_team: (Array.isArray(parent.parent_profiles) ? parent.parent_profiles[0] : parent.parent_profiles)?.child_team || null,
        child_league: (Array.isArray(parent.parent_profiles) ? parent.parent_profiles[0] : parent.parent_profiles)?.child_league || null,
        child_age_group: (Array.isArray(parent.parent_profiles) ? parent.parent_profiles[0] : parent.parent_profiles)?.child_age_group || null,
      }));
      setAllParents(parentProfiles);
      setParents(parentProfiles);

      if (teamsRes.data) {
        const baseTeams = (teamsRes.data as Team[]).map((team) => ({
          ...team,
          username: usernameByUserId.get(teamProfileUserByTeamId.get(team.id) || team.owner_user_id || "") || null,
          logo_url: team.logo_url || teamLogoById.get(team.id) || null,
          team_type: team.team_type || "club",
          school_level: team.school_level || null,
          location: (team as any).city || (team as any).location || null,
          league_conference: (team as any).league_conference || (team as any).conference_name || null,
          subtitle: team.team_type === "school"
            ? [(team as any).conference_name || (team as any).league_conference, formatSchoolLevel(team.school_level)].filter(Boolean).join(" - ")
            : null,
          is_sub_team: false,
        }));
        const subTeams: Team[] = ((clubTeams as ClubTeamRecord[]) || [])
          .map((clubTeam) => {
            const club = clubTeam.club_id ? clubById.get(clubTeam.club_id) : null;
            const parentTeamId = clubTeam.team_id || club?.primary_team_id || null;
            const parentTeam = parentTeamId ? (teamsRes.data as Team[]).find((team) => team.id === parentTeamId) : null;
            const parentTeamProfile = club?.team_profile_id ? teamProfileById.get(club.team_profile_id) : null;
            const parentTeamUserId = parentTeamProfile?.user_id || teamProfileUserByTeamId.get(parentTeam?.id || "") || parentTeam?.owner_user_id || "";
            const leagueName = clubTeam.league_name || null;
            const teamType = clubTeam.team_type || parentTeam?.team_type || parentTeamProfile?.team_type || "club";
            const subtitle = [clubTeam.gender, leagueName, clubTeam.age_group].filter(Boolean).join(" • ");
            return {
              id: `club-team-${clubTeam.id}`,
              name: parentTeam?.name || "Club Team",
              league_id: clubTeam.league_id || null,
              owner_user_id: parentTeam?.owner_user_id || null,
              username: usernameByUserId.get(parentTeamUserId) || null,
              logo_url: parentTeam?.logo_url || teamLogoById.get(parentTeam?.id || "") || null,
              parent_team_id: parentTeamId,
              age_group: clubTeam.age_group || null,
              league_name: leagueName,
              team_type: teamType,
              school_level: clubTeam.school_level || parentTeam?.school_level || parentTeamProfile?.school_level || null,
              location: parentTeamProfile?.city || (parentTeam as any)?.city || null,
              league_conference: leagueName,
              gender: clubTeam.gender || null,
              subtitle,
              is_sub_team: true,
            };
          });
        const visibleSubTeams = viewerPlayerGender
          ? subTeams.filter((team) => {
              const gender = (team.gender || "").toLowerCase();
              if (!gender) return true;
              return gender === viewerPlayerGender || gender === `${viewerPlayerGender}s`;
            })
          : subTeams;
        const normalizedTeams = [...visibleSubTeams, ...baseTeams];
        setAllTeams(normalizedTeams);
        setTeams(normalizedTeams);
      }
      if (leaguesRes.data) {
        setAllLeagues(leaguesRes.data);
        setLeagues(leaguesRes.data);
      }
    };
    fetchData();
  }, [user?.id, profile?.account_role, profile?.player_gender]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      setPlayers(
        allPlayers.filter(
          (player) =>
            player.name.toLowerCase().includes(query) ||
            player.club.toLowerCase().includes(query) ||
            player.league.toLowerCase().includes(query) ||
            (player.username || "").toLowerCase().includes(query) ||
            (player.team_name || "").toLowerCase().includes(query)
        )
      );
      setTeams(
        applyTeamFilters(allTeams.filter((team) =>
          [team.name, team.username, team.subtitle, team.age_group, team.league_name, team.team_type, team.school_level, team.location, team.league_conference]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        ))
      );
      setCoachStaff(
        allCoachStaff.filter((staff) =>
          [
            staff.full_name,
            staff.username,
            staff.coaching_role_type,
            staff.teams_currently_coaching,
            staff.coaching_location,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      );
      setAcademyStaff(
        allAcademyStaff.filter((staff) =>
          [
            staff.full_name,
            staff.username,
            staff.coaching_role_type,
            staff.teams_currently_coaching,
            staff.past_coaching_experience,
            staff.coaching_accolades,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      );
      setScouts(
        allScouts.filter((scout) =>
          [
            scout.full_name,
            scout.username,
            scout.scout_role_title,
            scout.scout_organization,
            scout.scouting_regions,
            scout.scouting_experience,
            scout.scouting_positions?.join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      );
      setReferees(
        allReferees.filter((referee) =>
          [
            referee.full_name,
            referee.username,
            referee.referee_certification_level,
            referee.referee_certifying_organization,
            referee.referee_leagues_tournaments,
            referee.referee_availability,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      );
      setParents(
        allParents.filter((parent) =>
          [
            parent.full_name,
            parent.username,
            parent.relationship_to_player,
            parent.child_team,
            parent.child_league,
            parent.child_age_group,
            parent.bio,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      );
      setLeagues(allLeagues.filter((league) => league.name.toLowerCase().includes(query)));
    } else {
      setPlayers(allPlayers);
      setTeams(applyTeamFilters(allTeams));
      setCoachStaff(allCoachStaff);
      setAcademyStaff(allAcademyStaff);
      setScouts(allScouts);
      setReferees(allReferees);
      setParents(allParents);
      setLeagues(allLeagues);
    }
  // applyTeamFilters reads the filter state listed here; keeping it inline avoids stale team results.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, allPlayers, allTeams, allLeagues, allCoachStaff, allAcademyStaff, allScouts, allReferees, allParents, teamTypeFilter, schoolLevelFilter, teamLocationFilter, teamLeagueFilter]);

  const categories = [
    { icon: Trophy, label: "Leagues", count: allLeagues.length, key: "leagues" },
    { icon: Shield, label: "Teams", count: allTeams.length, key: "teams" },
    { icon: Briefcase, label: "Coaches", count: allCoachStaff.length, key: "coaches" },
    { icon: GraduationCap, label: "Staff", count: allAcademyStaff.length, key: "staff" },
    { icon: Search, label: "Scouts", count: allScouts.length, key: "scouts" },
    { icon: Shield, label: "Referees", count: allReferees.length, key: "referees" },
    { icon: Users, label: "Parents", count: allParents.length, key: "parents" },
    { icon: Users, label: "Players", count: allPlayers.length, key: "players" },
  ];

  const handleCategoryClick = (key: string) => {
    setActiveCategory(activeCategory === key ? null : key);
  };

  const clearCategory = () => {
    setActiveCategory(null);
  };

  function applyTeamFilters(teamList: Team[]) {
    return teamList.filter((team) => {
      const type = team.team_type || "club";
      const matchesType = teamTypeFilter === "all" || type === teamTypeFilter;
      const matchesLevel =
        schoolLevelFilter === "all" ||
        (team.school_level || "").toLowerCase() === schoolLevelFilter ||
        (team.age_group || "").toLowerCase().includes(schoolLevelFilter.replace("_", " "));
      const matchesLocation =
        !teamLocationFilter.trim() ||
        (team.location || "").toLowerCase().includes(teamLocationFilter.trim().toLowerCase());
      const matchesLeague =
        !teamLeagueFilter.trim() ||
        [team.league_name, team.league_conference, team.subtitle]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(teamLeagueFilter.trim().toLowerCase());

      return matchesType && matchesLevel && matchesLocation && matchesLeague;
    });
  }

  function formatSchoolLevel(level?: string | null) {
    switch (level) {
      case "varsity":
        return "High School Varsity";
      case "junior_varsity":
        return "Junior Varsity";
      case "prep":
        return "Prep Team";
      case "middle_school":
        return "Middle School Team";
      default:
        return level || null;
    }
  }

  const getTeamExploreDestination = (team: Team) => {
    if (team.is_sub_team) {
      return `/club-team/${team.id.replace("club-team-", "")}`;
    }

    if (team.owner_user_id && user?.id === team.owner_user_id) {
      return "/profile";
    }

    return `/team/${team.parent_team_id || team.id}`;
  };

  const showPlayers = !activeCategory || activeCategory === "players";
  const showTeams = !activeCategory || activeCategory === "teams";
  const showCoachStaff = !activeCategory || activeCategory === "coaches";
  const showAcademyStaff = !activeCategory || activeCategory === "staff";
  const showScouts = !activeCategory || activeCategory === "scouts";
  const showReferees = !activeCategory || activeCategory === "referees";
  const showParents = !activeCategory || activeCategory === "parents";
  const showLeagues = !activeCategory || activeCategory === "leagues";

  return (
    <div className="px-4 py-6">
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search teams, players, leagues..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-12 rounded-xl border-2 focus:border-navy bg-card"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {categories.map(({ icon: Icon, label, count, key }) => (
          <button
            key={label}
            onClick={() => handleCategoryClick(key)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all duration-200 border-2 ${
              activeCategory === key
                ? "bg-navy text-white border-navy shadow-lg"
                : "bg-card hover:bg-muted border-border hover:border-accent"
            }`}
          >
            <Icon className={`h-6 w-6 ${activeCategory === key ? "text-white" : "text-accent"}`} />
            <span className="text-xs font-medium">{label}</span>
            <span className={`text-xs ${activeCategory === key ? "text-white/80" : "text-muted-foreground"}`}>
              {count} registered
            </span>
          </button>
        ))}
      </div>

      {/* Clear Category Button */}
      {activeCategory && (
        <Button
          variant="outline"
          size="sm"
          onClick={clearCategory}
          className="w-full mb-6 border-accent text-accent hover:bg-accent hover:text-white transition-colors"
        >
          <X className="h-4 w-4 mr-2" />
          Clear Filter - Show All
        </Button>
      )}

      {/* Leagues Section */}
      {showLeagues && leagues.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">LEAGUES</h3>
          {leagues.map((league) => (
            <button
              key={league.id}
              onClick={() => navigate(`/league/${league.id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-navy hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy to-primary flex items-center justify-center shadow-md">
                <Trophy className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{league.name}</p>
                  {league.age_group && (
                    <span className="text-xs font-bold text-white bg-accent px-2 py-0.5 rounded-full">
                      {league.age_group}
                    </span>
                  )}
                </div>
                {league.country && (
                  <p className="text-sm text-muted-foreground">{league.country}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Teams Section */}
      {showTeams && teams.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">TEAMS</h3>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3">
            <select
              value={teamTypeFilter}
              onChange={(event) => setTeamTypeFilter(event.target.value as "all" | "club" | "school")}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">All team types</option>
              <option value="club">Club Teams</option>
              <option value="school">School Teams</option>
            </select>
            <select
              value={schoolLevelFilter}
              onChange={(event) => setSchoolLevelFilter(event.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">All school levels</option>
              <option value="varsity">High School Varsity</option>
              <option value="junior_varsity">Junior Varsity</option>
              <option value="prep">Prep Team</option>
              <option value="middle_school">Middle School Team</option>
            </select>
            <Input
              value={teamLocationFilter}
              onChange={(event) => setTeamLocationFilter(event.target.value)}
              placeholder="Location"
              className="h-10"
            />
            <Input
              value={teamLeagueFilter}
              onChange={(event) => setTeamLeagueFilter(event.target.value)}
              placeholder="League / conference"
              className="h-10"
            />
          </div>
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => navigate(getTeamExploreDestination(team))}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden">
                {team.logo_url ? (
                  <img src={team.logo_url} alt={team.name} className="w-full h-full object-cover" />
                ) : (
                  <Shield className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground">{team.name}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {(team.team_type || "club") === "school" ? "School Team" : "Club Team"}
                  </span>
                </div>
                {team.subtitle ? (
                  <p className="text-sm text-muted-foreground truncate">{team.subtitle}</p>
                ) : null}
                {team.username ? <p className="text-xs text-muted-foreground truncate">@{team.username}</p> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Coaches / Staff Section */}
      {showCoachStaff && coachStaff.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">COACHES / STAFF</h3>
          {coachStaff.map((staff) => (
            <button
              key={staff.user_id}
              onClick={() => navigate(staff.user_id === user?.id ? "/profile" : `/coach/${staff.user_id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy to-primary flex items-center justify-center shadow-md overflow-hidden">
                {staff.avatar_url ? (
                  <img src={staff.avatar_url} alt={staff.full_name || "Coach"} className="w-full h-full object-cover" />
                ) : (
                  <Briefcase className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{staff.full_name || "Coach / Staff"}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[formatRoleDisplayLabel(staff.coaching_role_type || staff.account_role, "Coaching Staff"), staff.teams_currently_coaching].filter(Boolean).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Club Director / Team Staff Section */}
      {showAcademyStaff && academyStaff.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">CLUB DIRECTOR / TEAM STAFF</h3>
          {academyStaff.map((staff) => (
            <button
              key={staff.user_id}
              onClick={() => navigate(staff.user_id === user?.id ? "/profile" : `/staff/${staff.user_id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy to-primary flex items-center justify-center shadow-md overflow-hidden">
                {staff.avatar_url ? (
                  <img src={staff.avatar_url} alt={staff.full_name || "Staff"} className="w-full h-full object-cover" />
                ) : (
                  <GraduationCap className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{staff.full_name || "Team Staff"}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[formatRoleDisplayLabel(staff.coaching_role_type || staff.account_role, "Team Staff"), staff.teams_currently_coaching].filter(Boolean).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Scouts Section */}
      {showScouts && scouts.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">SCOUTS</h3>
          {scouts.map((scout) => (
            <button
              key={scout.user_id}
              onClick={() => navigate(scout.user_id === user?.id ? "/profile" : `/scout/${scout.user_id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy to-primary flex items-center justify-center shadow-md overflow-hidden">
                {scout.avatar_url ? (
                  <img src={scout.avatar_url} alt={scout.full_name || "Scout"} className="w-full h-full object-cover" />
                ) : (
                  <Search className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{scout.full_name || "Scout"}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[formatRoleDisplayLabel(scout.scout_role_title, "Scout"), scout.scout_organization].filter(Boolean).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Referees Section */}
      {showReferees && referees.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">REFEREES</h3>
          {referees.map((referee) => (
            <button
              key={referee.user_id}
              onClick={() => navigate(referee.user_id === user?.id ? "/profile" : `/referee-profile/${referee.user_id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center shadow-md overflow-hidden">
                {referee.avatar_url ? (
                  <img src={referee.avatar_url} alt={referee.full_name || "Referee"} className="w-full h-full object-cover" />
                ) : (
                  <Shield className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{referee.full_name || "Referee"}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[referee.referee_certification_level || "Referee", referee.referee_certifying_organization].filter(Boolean).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Parents Section */}
      {showParents && parents.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">PARENTS / GUARDIANS</h3>
          {parents.map((parent) => (
            <button
              key={parent.user_id}
              onClick={() => navigate(parent.user_id === user?.id ? "/profile" : `/staff/${parent.user_id}`)}
              className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-navy to-primary flex items-center justify-center shadow-md overflow-hidden">
                {parent.avatar_url ? (
                  <img src={parent.avatar_url} alt={parent.full_name || "Parent"} className="w-full h-full object-cover" />
                ) : (
                  <Users className="h-6 w-6 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{parent.full_name || "Parent / Guardian"}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {[parent.relationship_to_player || "Parent / Guardian", parent.child_team, parent.child_league, parent.child_age_group].filter(Boolean).join(" - ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Players Section */}
      {showPlayers && players.length > 0 && (
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-bold tracking-wide text-navy">PLAYERS</h3>
          {players.map((player) => (
            <PlayerCard
              key={player.id}
              id={player.id}
              name={player.name}
              club={player.club}
              league={player.league}
              position={player.position || undefined}
              profileImageUrl={player.profile_image_url}
              isPro={!!player.is_pro}
              onClick={() => navigate(player.user_id && user?.id === player.user_id ? "/profile" : `/player/${player.id}`)}
            />
          ))}
        </div>
      )}

      {players.length === 0 && teams.length === 0 && coachStaff.length === 0 && academyStaff.length === 0 && scouts.length === 0 && referees.length === 0 && parents.length === 0 && leagues.length === 0 && searchQuery && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No results found for "{searchQuery}"</p>
        </div>
      )}
    </div>
  );
};

export default ExploreTab;
