import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Briefcase, Shield, Mail, Phone, Users, Trophy, Search, KeyRound, Check, X, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { fetchRosterForTeam, formatTeamLeagueLine, TeamRosterPlayer } from "@/lib/teamMemberships";
import { ClubTeamRecord, fetchClubByTeamId, fetchClubTeams, fetchRosterForClubTeam, formatTeamGender, getAgeGroupSortValue, normalizeTeamGender, sanitizeClubTeamAccessCode, updateClubTeamAccessCode } from "@/lib/clubTeams";
import ClubNewsSection from "@/components/club-news/ClubNewsSection";
import ProBadge from "@/components/ProBadge";
import {
  CoachStaffProfile,
  fetchCoachStaffForTeam,
  fetchCoachStaffProfiles,
  inviteCoachStaffToTeam,
  reviewCoachStaffJoinRequest,
  sortCoachStaffByClubStaffRole,
  unlinkCoachStaffFromClub,
} from "@/lib/coachStaffTeams";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";

interface Team {
  id: string;
  name: string;
  league_id: string | null;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  sporting_director: string | null;
  sponsors: string[] | null;
  founded_year: number | null;
  stadium: string | null;
  home_jersey_color: string | null;
  away_jersey_color: string | null;
  third_kit_color: string | null;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points: number;
  age_group: string | null;
  approval_status: string;
  team_type: string | null;
  owner_user_id: string | null;
  access_code_last4: string | null;
}

interface League {
  id: string;
  name: string;
}

interface PlayerSearchResult {
  id: string;
  user_id: string;
  full_name: string;
  position: string | null;
  profile_image_url: string | null;
  username: string | null;
}

interface TeamInvite {
  id: string;
  status: string;
  created_at: string;
  player_profile_id: string;
  player_user_id: string;
  age_group: string | null;
  player_name: string;
}

interface JoinRequest {
  id: string;
  status: string;
  requested_at: string;
  player_profile_id: string;
  player_user_id: string;
  age_group: string | null;
  player_name: string;
  access_code_last4: string | null;
}

interface TeamProfileDetails {
  club_name: string | null;
  logo_url: string | null;
  leagues_offered: string[] | null;
  founded_year: number | null;
  city: string | null;
  home_stadium: string | null;
  training_ground: string | null;
  home_jersey_color: string | null;
  away_jersey_color: string | null;
  third_kit_color: string | null;
  age_groups_offered: string[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  team_type: string | null;
}

interface TeamStaffMember {
  id: string;
  staff_name: string;
  staff_role: string;
  personal_email: string | null;
}

const TeamProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [team, setTeam] = useState<Team | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [players, setPlayers] = useState<TeamRosterPlayer[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerResults, setPlayerResults] = useState<PlayerSearchResult[]>([]);
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [teamProfileDetails, setTeamProfileDetails] = useState<TeamProfileDetails | null>(null);
  const [teamStaffMembers, setTeamStaffMembers] = useState<TeamStaffMember[]>([]);
  const [linkedCoachStaff, setLinkedCoachStaff] = useState<any[]>([]);
  const [coachStaffSearch, setCoachStaffSearch] = useState("");
  const [coachStaffResults, setCoachStaffResults] = useState<CoachStaffProfile[]>([]);
  const [coachStaffRequests, setCoachStaffRequests] = useState<any[]>([]);
  const [coachStaffInvites, setCoachStaffInvites] = useState<any[]>([]);
  const [teamBio, setTeamBio] = useState<string | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubTeams, setClubTeams] = useState<ClubTeamRecord[]>([]);
  const [clubTeamRosters, setClubTeamRosters] = useState<Record<string, TeamRosterPlayer[]>>({});
  const [viewerManagedTeamId, setViewerManagedTeamId] = useState<string | null>(null);
  const [activeInviteClubTeamId, setActiveInviteClubTeamId] = useState<string | null>(null);
  const [clubTeamPlayerSearch, setClubTeamPlayerSearch] = useState("");
  const [clubTeamPlayerResults, setClubTeamPlayerResults] = useState<PlayerSearchResult[]>([]);
  const [clubTeamPlayerSearchLoading, setClubTeamPlayerSearchLoading] = useState(false);
  const [invitingClubTeamId, setInvitingClubTeamId] = useState<string | null>(null);
  const [clubTeamAccessCodes, setClubTeamAccessCodes] = useState<Record<string, string>>({});
  const [savingClubTeamAccessCodeId, setSavingClubTeamAccessCodeId] = useState<string | null>(null);
  const [generatedAccessCode, setGeneratedAccessCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const isOfficialFootyStatusAccount = isFootyStatusSuperAdminEmail(user?.email);
  const isTeamOrganizationAccount = profile?.account_role === "team_club" || profile?.account_role === "school_team";
  const teamAccountLabel =
    teamProfileDetails?.team_type === "school" || team?.team_type === "school"
      ? "School Team"
      : "Club Team";
  const userOwnsTeam = !!user && !!team && team.owner_user_id === user.id;
  const canManageTeam = !!(
    user &&
    team &&
    (isOfficialFootyStatusAccount ||
      userOwnsTeam ||
      viewerManagedTeamId === team.id ||
      (isTeamOrganizationAccount && viewerManagedTeamId === team.id))
  );
  const linkedClubStaff = useMemo(
    () =>
      sortCoachStaffByClubStaffRole(
        linkedCoachStaff.filter((staff) => {
          const staffProfile = staff.profile || staff.profiles || {};
          return staffProfile.account_role === "academy_director";
        })
      ),
    [linkedCoachStaff]
  );
  const linkedNonClubStaff = useMemo(
    () =>
      linkedCoachStaff.filter((staff) => {
        const staffProfile = staff.profile || staff.profiles || {};
        return staffProfile.account_role !== "academy_director";
      }),
    [linkedCoachStaff]
  );
  const teamApproved = team?.approval_status === "approved";
  const playersByAgeGroup = useMemo(() => {
    const grouped = new Map<string, TeamRosterPlayer[]>();
    players.forEach((player) => {
      const key = player.age_group || team?.age_group || "Roster";
      const current = grouped.get(key) || [];
      current.push(player);
      grouped.set(key, current);
    });
    return Array.from(grouped.entries());
  }, [players, team?.age_group]);
  const clubTeamsByLeague = useMemo(() => {
    const activeTeams = clubTeams.filter((clubTeam) => clubTeam.status !== "archived");
    const sortTeams = (teams: ClubTeamRecord[]) =>
      [...teams].sort((a, b) => {
        const leagueDiff = (a.league_name || "").localeCompare(b.league_name || "");
        return leagueDiff || getAgeGroupSortValue(a.age_group) - getAgeGroupSortValue(b.age_group);
      });
    const boys = sortTeams(activeTeams.filter((team) => normalizeTeamGender(team.gender) === "boy"));
    const girls = sortTeams(activeTeams.filter((team) => normalizeTeamGender(team.gender) === "girl"));
    const sections: Array<readonly [string, ClubTeamRecord[]]> =
      profile?.account_role === "player" && profile.player_gender === "girl"
        ? [["Girls Teams", girls], ["Boys Teams", boys]]
        : [["Boys Teams", boys], ["Girls Teams", girls]];
    const uncategorized = sortTeams(activeTeams.filter((team) => !normalizeTeamGender(team.gender)));
    if (uncategorized.length) sections.push(["Needs Categorization", uncategorized]);
    return sections;
  }, [clubTeams, profile?.account_role, profile?.player_gender]);
  const stopTileEvent = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  const formatInviteStatus = (status?: string | null) => {
    if (!status) return "Pending";
    if (status === "revoked" || status === "cancelled") return "Cancelled";
    if (status === "rejected") return "Declined";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  useEffect(() => {
    setClubTeamAccessCodes((prev) => {
      const next: Record<string, string> = {};
      clubTeamsByLeague.forEach(([, teams]) => {
        teams.forEach((clubTeam) => {
          next[clubTeam.id] = prev[clubTeam.id] ?? clubTeam.access_code_value ?? "";
        });
      });
      return next;
    });
  }, [clubTeamsByLeague]);

  const fetchManagementData = async (teamId: string) => {
    const [inviteRes, requestRes] = await Promise.all([
      (supabase as any)
        .from("team_player_invites")
        .select("id, status, created_at, player_profile_id, player_user_id, age_group")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("team_join_requests")
        .select("id, status, requested_at, player_profile_id, player_user_id, age_group, access_code_last4")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
    ]);

    const playerIds = [
      ...new Set([
        ...(inviteRes.data || []).map((invite: any) => invite.player_profile_id),
        ...(requestRes.data || []).map((request: any) => request.player_profile_id),
      ]),
    ];

    let profilesById = new Map<string, PlayerSearchResult>();
    if (playerIds.length) {
      const { data: profiles } = await (supabase as any)
        .from("player_profiles_public")
        .select("id, user_id, full_name, position, profile_image_url, username")
        .in("id", playerIds);
      profilesById = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
    }

    setPendingInvites(
      (inviteRes.data || []).map((invite: any) => ({
        ...invite,
        player_name: profilesById.get(invite.player_profile_id)?.full_name || "Unknown Player",
      }))
    );
    setJoinRequests(
      (requestRes.data || []).map((request: any) => ({
        ...request,
        player_name: profilesById.get(request.player_profile_id)?.full_name || "Unknown Player",
      }))
    );
  };

  const fetchTeamData = async () => {
    if (!id) return;

    const { data: teamData } = await (supabase as any)
      .from("teams")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!teamData) {
      setLoading(false);
      return;
    }

    setTeam(teamData as Team);

    const club = await fetchClubByTeamId(teamData.id);
    setClubId(club?.id || null);

    const [leagueRes, roster, teamProfileRes, offeredClubTeams, profileRes] = await Promise.all([
      teamData.league_id
        ? (supabase as any).from("leagues").select("*").eq("id", teamData.league_id).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchRosterForTeam(teamData.id),
      (supabase as any)
        .from("team_profiles")
        .select("id, club_name, logo_url, leagues_offered, founded_year, city, home_stadium, training_ground, home_jersey_color, away_jersey_color, third_kit_color, age_groups_offered, contact_email, contact_phone, team_type")
        .eq("team_id", teamData.id)
        .maybeSingle(),
      club ? fetchClubTeams(club.id) : Promise.resolve([]),
      teamData.owner_user_id
        ? (supabase as any).from("profiles").select("bio").eq("user_id", teamData.owner_user_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const [linkedStaffRows, staffRequestsInitialRes, staffInvitesInitialRes] = await Promise.all([
      fetchCoachStaffForTeam(teamData.id).catch(() => []),
      (supabase as any)
        .from("coach_staff_join_requests")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, requested_at, requested_assignments, general_club_role, request_kind, profiles!coach_staff_join_requests_coach_user_id_fkey(user_id, full_name, avatar_url, username, coaching_role_type)")
        .eq("team_id", teamData.id)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
      (supabase as any)
        .from("coach_staff_team_invites")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, created_at, profiles!coach_staff_team_invites_coach_user_id_fkey(user_id, full_name, avatar_url, username, coaching_role_type)")
        .eq("team_id", teamData.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    let staffRequests = staffRequestsInitialRes.data || [];
    let staffInvites = staffInvitesInitialRes.data || [];

    if (staffRequestsInitialRes.error || staffInvitesInitialRes.error) {
      const [plainRequestsRes, plainInvitesRes] = await Promise.all([
        (supabase as any)
          .from("coach_staff_join_requests")
          .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, requested_at, requested_assignments, general_club_role, request_kind")
          .eq("team_id", teamData.id)
          .eq("status", "pending")
          .order("requested_at", { ascending: false }),
        (supabase as any)
          .from("coach_staff_team_invites")
          .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, created_at")
          .eq("team_id", teamData.id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
      ]);
      const staffUserIds = [
        ...new Set([
          ...((plainRequestsRes.data || []) as any[]).map((request) => request.coach_user_id),
          ...((plainInvitesRes.data || []) as any[]).map((invite) => invite.coach_user_id),
        ]),
      ];
      const { data: staffProfiles } = staffUserIds.length
        ? await (supabase as any)
            .from("profiles")
            .select("user_id, full_name, avatar_url, username, coaching_role_type")
            .in("user_id", staffUserIds)
        : { data: [] };
      const profilesByUserId = new Map((staffProfiles || []).map((staff: any) => [staff.user_id, staff]));
      staffRequests = (plainRequestsRes.data || []).map((request: any) => ({ ...request, profiles: profilesByUserId.get(request.coach_user_id) || null }));
      staffInvites = (plainInvitesRes.data || []).map((invite: any) => ({ ...invite, profiles: profilesByUserId.get(invite.coach_user_id) || null }));
    }

    setLeague((leagueRes.data || null) as League | null);
    setPlayers(roster);
    setLinkedCoachStaff(linkedStaffRows);
    setCoachStaffRequests(staffRequests);
    setCoachStaffInvites(staffInvites);
    setTeamProfileDetails((teamProfileRes.data || null) as TeamProfileDetails | null);
    setTeamBio(profileRes.data?.bio || null);
    if (!teamData.logo_url && teamProfileRes.data?.logo_url) {
      setTeam({
        ...(teamData as Team),
        logo_url: teamProfileRes.data.logo_url,
      });
    }
    setClubTeams(offeredClubTeams);

    if (offeredClubTeams.length) {
      const rosters = await Promise.all(
        offeredClubTeams.map(async (clubTeam) => {
          const teamGender = normalizeTeamGender(clubTeam.gender);
          const playerCanViewRoster =
            profile?.account_role !== "player" ||
            (!!profile.player_gender && profile.player_gender === teamGender);
          return [clubTeam.id, playerCanViewRoster ? await fetchRosterForClubTeam(clubTeam.id) : []] as const;
        })
      );
      setClubTeamRosters(Object.fromEntries(rosters));
    } else {
      setClubTeamRosters({});
    }

    if (teamProfileRes.data?.id) {
      const staffWithEmail = await (supabase as any)
        .from("team_staff")
        .select("id, staff_name, staff_role, personal_email")
        .eq("team_profile_id", teamProfileRes.data.id)
        .order("created_at", { ascending: true });

      if (staffWithEmail.error?.message?.includes("personal_email")) {
        const fallbackStaff = await (supabase as any)
          .from("team_staff")
          .select("id, staff_name, staff_role")
          .eq("team_profile_id", teamProfileRes.data.id)
          .order("created_at", { ascending: true });

        setTeamStaffMembers(
          ((fallbackStaff.data || []) as any[]).map((staff) => ({
            ...staff,
            personal_email: null,
          }))
        );
      } else {
        setTeamStaffMembers((staffWithEmail.data || []) as TeamStaffMember[]);
      }
    } else {
      setTeamStaffMembers([]);
    }


    setLoading(false);
  };

  useEffect(() => {
    const fetchViewerManagedTeam = async () => {
      if (!user || !isTeamOrganizationAccount) {
        setViewerManagedTeamId(null);
        return;
      }

      const { data } = await (supabase as any)
        .from("team_profiles")
        .select("team_id")
        .eq("user_id", user.id)
        .maybeSingle();

      setViewerManagedTeamId(data?.team_id || null);
    };

    fetchViewerManagedTeam();
  }, [user?.id, profile?.account_role]);

  useEffect(() => {
    fetchTeamData();
  }, [id, user?.id]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`team-live-sync-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "club_teams" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "league_teams" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_profiles" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_staff" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "player_team_memberships" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_player_invites" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_join_requests" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_staff_team_memberships" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_staff_team_invites" }, () => fetchTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_staff_join_requests" }, () => fetchTeamData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!team?.id) return;

    if (canManageTeam) {
      fetchManagementData(team.id);
      return;
    }

    setPendingInvites([]);
    setJoinRequests([]);
  }, [canManageTeam, team?.id]);

  useEffect(() => {
    const runPlayerSearch = async () => {
      if (!canManageTeam || !playerSearch.trim()) {
        setPlayerResults([]);
        return;
      }

      const { data } = await (supabase as any)
        .from("player_profiles_public")
        .select("id, user_id, full_name, position, profile_image_url, username")
        .ilike("full_name", `%${playerSearch.trim()}%`)
        .limit(6);

      const activePlayerIds = new Set(players.map((player) => player.player_profile_id));
      const pendingPlayerIds = new Set([
        ...pendingInvites.map((invite) => invite.player_profile_id),
        ...joinRequests.map((request) => request.player_profile_id),
      ]);

      setPlayerResults(
        (data || []).filter(
          (player: PlayerSearchResult) =>
            !activePlayerIds.has(player.id) &&
            !pendingPlayerIds.has(player.id)
        )
      );
    };

    runPlayerSearch();
  }, [playerSearch, canManageTeam, players, pendingInvites, joinRequests]);

  useEffect(() => {
    const runCoachStaffSearch = async () => {
      if (!canManageTeam || !coachStaffSearch.trim()) {
        setCoachStaffResults([]);
        return;
      }

      const results = await fetchCoachStaffProfiles(coachStaffSearch).catch(() => []);
      const activeUserIds = new Set(linkedCoachStaff.map((staff) => staff.coach_user_id));
      const pendingUserIds = new Set([
        ...coachStaffInvites.filter((invite) => invite.status === "pending").map((invite) => invite.coach_user_id),
        ...coachStaffRequests.map((request) => request.coach_user_id),
      ]);
      setCoachStaffResults(results.filter((staff) => !activeUserIds.has(staff.user_id) && !pendingUserIds.has(staff.user_id)));
    };

    runCoachStaffSearch();
  }, [coachStaffSearch, canManageTeam, linkedCoachStaff, coachStaffInvites, coachStaffRequests]);

  useEffect(() => {
    const runClubTeamPlayerSearch = async () => {
      if (!canManageTeam || !activeInviteClubTeamId || !clubTeamPlayerSearch.trim()) {
        setClubTeamPlayerResults([]);
        setClubTeamPlayerSearchLoading(false);
        return;
      }

      const rosterIds = new Set((clubTeamRosters[activeInviteClubTeamId] || []).map((player) => player.player_profile_id));
      const query = clubTeamPlayerSearch.trim();
      const selectedTeamGender = normalizeTeamGender(
        clubTeams.find((clubTeam) => clubTeam.id === activeInviteClubTeamId)?.gender
      );
      setClubTeamPlayerSearchLoading(true);

      const { data } = await (supabase as any)
        .from("player_profiles")
        .select("id, user_id, full_name, position, profile_image_url, player_gender")
        .eq("player_gender", selectedTeamGender)
        .ilike("full_name", `%${query}%`)
        .limit(6);

      setClubTeamPlayerResults(
        ((data || []) as PlayerSearchResult[]).filter((player) => !rosterIds.has(player.id))
      );
      setClubTeamPlayerSearchLoading(false);
    };

    runClubTeamPlayerSearch();
  }, [canManageTeam, activeInviteClubTeamId, clubTeamPlayerSearch, clubTeamRosters, clubTeams]);

  const handleInvitePlayer = async (playerProfileId: string) => {
    if (!team) return;
    setActionLoading(true);
    const { error } = await (supabase as any).rpc("create_team_player_invite", {
      _team_id: team.id,
      _player_profile_id: playerProfileId,
    });

    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invite sent" });
      setPlayerSearch("");
      await fetchManagementData(team.id);
    }
    setActionLoading(false);
  };

  const handleInviteCoachStaff = async (coachUserId: string, staffRole?: string | null) => {
    if (!team || !user) return;
    setActionLoading(true);
    const { error } = await inviteCoachStaffToTeam(team.id, coachUserId, user.id, staffRole || "Coaching Staff");

    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Staff invite sent" });
      setCoachStaffSearch("");
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleReviewCoachStaffRequest = async (request: any, approve: boolean) => {
    setActionLoading(true);
    const { error } = await reviewCoachStaffJoinRequest(request, approve);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Coach/staff approved" : "Request rejected" });
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleCancelInvite = async (invite: any, inviteType: "player" | "staff") => {
    if (!team) return;

    const confirmed = window.confirm("Cancel this pending invitation?");
    if (!confirmed) return;

    setActionLoading(true);
    const table = inviteType === "player" ? "team_player_invites" : "coach_staff_team_invites";
    const nextStatus = inviteType === "player" ? "revoked" : "cancelled";
    const timestampColumn = inviteType === "player" ? "responded_at" : "reviewed_at";
    const { error } = await (supabase as any)
      .from(table)
      .update({ status: nextStatus, [timestampColumn]: new Date().toISOString() })
      .eq("id", invite.id);

    if (error) {
      toast({ title: "Could not cancel invite", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invite cancelled" });
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleResendInvite = async (invite: any, inviteType: "player" | "staff") => {
    if (!team) return;

    setActionLoading(true);
    const table = inviteType === "player" ? "team_player_invites" : "coach_staff_team_invites";
    const resetPayload =
      inviteType === "player"
        ? { status: "pending", created_at: new Date().toISOString(), responded_at: null }
        : { status: "pending", created_at: new Date().toISOString(), reviewed_at: null };
    const { error } = await (supabase as any).from(table).update(resetPayload).eq("id", invite.id);

    if (error) {
      toast({ title: "Could not resend invite", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invite resent" });
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleReviewJoinRequest = async (requestId: string, approve: boolean) => {
    if (!team) return;
    setActionLoading(true);
    const { error } = await (supabase as any).rpc("review_team_join_request", {
      _request_id: requestId,
      _approve: approve,
    });

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Player approved" : "Request rejected" });
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleRegenerateAccessCode = async () => {
    if (!team) return;
    setActionLoading(true);
    const { data, error } = await (supabase as any).rpc("regenerate_team_access_code", {
      _team_id: team.id,
    });

    if (error) {
      toast({ title: "Could not generate code", description: error.message, variant: "destructive" });
    } else {
      setGeneratedAccessCode(data || null);
      toast({ title: "New access code created" });
      await fetchTeamData();
    }
    setActionLoading(false);
  };

  const handleInvitePlayerToClubTeam = async (clubTeamId: string, playerProfileId: string) => {
    if (!team) return;
    setInvitingClubTeamId(clubTeamId);

    const inviteRes = await (supabase as any).rpc("create_team_player_invite_for_club_team", {
      _team_id: team.id,
      _club_team_id: clubTeamId,
      _player_profile_id: playerProfileId,
    });
    const error = inviteRes.error;

    if (error) {
      const description =
        typeof error.message === "string" &&
        (error.message.includes("create_team_player_invite_for_club_team") || error.message.includes("function public.create_team_player_invite_for_club_team"))
          ? "The exact club-team invite system is not ready yet. Run the club-team invite SQL first so invites include the club name, age group, and league."
          : error.message;
      toast({ title: "Invite failed", description, variant: "destructive" });
      setInvitingClubTeamId(null);
      return;
    }

    toast({ title: "Invite sent" });
    setClubTeamPlayerSearch("");
    setClubTeamPlayerResults([]);
    setActiveInviteClubTeamId(null);
    setInvitingClubTeamId(null);
    await fetchManagementData(team.id);
  };

  const handleSaveClubTeamAccessCode = async (clubTeamId: string) => {
    const nextCode = sanitizeClubTeamAccessCode(clubTeamAccessCodes[clubTeamId] || "");
    if (nextCode.length !== 5) {
      toast({ title: "Invalid code", description: "Access code must be exactly 5 digits.", variant: "destructive" });
      return;
    }

    setSavingClubTeamAccessCodeId(clubTeamId);
    const { data, error } = await updateClubTeamAccessCode(clubTeamId, nextCode);

    if (error) {
      toast({ title: "Could not update code", description: error.message, variant: "destructive" });
      setSavingClubTeamAccessCodeId(null);
      return;
    }

    setClubTeams((prev) =>
      prev.map((clubTeam) =>
        clubTeam.id === clubTeamId
          ? {
              ...clubTeam,
              access_code_value: data?.access_code_value || nextCode,
              access_code_last4: data?.access_code_last4 || nextCode.slice(-4),
              access_code_updated_at: data?.access_code_updated_at || new Date().toISOString(),
            }
          : clubTeam
      )
    );
    setClubTeamAccessCodes((prev) => ({ ...prev, [clubTeamId]: data?.access_code_value || nextCode }));
    toast({ title: "Access code updated", description: "Players can now use this code for this exact daughter team." });
    setSavingClubTeamAccessCodeId(null);
  };

  const handleRemovePlayerFromTeam = async (membershipId: string) => {
    if (!team || !canManageTeam) return;

    const confirmed = window.confirm("Are you sure you want to remove this player from this team?");
    if (!confirmed) return;

    setActionLoading(true);
    const { error } = await (supabase as any).rpc("remove_player_from_club_team", {
      _membership_id: membershipId,
    });

    if (error) {
      toast({ title: "Could not remove player", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Player removed" });
      await fetchTeamData();
    }

    setActionLoading(false);
  };

  const handleRemoveCoachStaffFromTeam = async (staff: any) => {
    if (!team || !canManageTeam) return;

    const confirmed = window.confirm("Remove this coach/staff member from this team?");
    if (!confirmed) return;

    setActionLoading(true);
    const { error } = await unlinkCoachStaffFromClub(team.id, staff.coach_user_id);

    if (error) {
      toast({ title: "Could not remove staff member", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coach/staff removed" });
      await fetchTeamData();
    }

    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-24 w-24 rounded-full mx-auto mb-4" />
        <Skeleton className="h-6 w-48 mx-auto mb-2" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/?tab=explore")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Explore
        </button>
        <p className="text-center mt-12 text-muted-foreground">Team not found</p>
      </div>
    );
  }

  const locationLine = teamProfileDetails?.city || null;

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 bg-background border-b border-border px-4 py-3 z-10">
        <button
          onClick={() => navigate("/?tab=explore")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          Back to Explore
        </button>
      </header>

      <div className="p-4">
        <InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} />
        <div className="bg-card border border-border rounded-xl p-6 mb-6 text-center">
          <div className="flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-navy flex items-center justify-center overflow-hidden mb-4">
            {team.logo_url ? (
              <img src={team.logo_url} alt={team.name} className="w-full h-full object-cover" />
            ) : (
              <Shield className="h-12 w-12 text-white" />
            )}
          </div>
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
            <h1 className="col-start-2 max-w-[14rem] break-words text-center text-2xl font-bold text-foreground">{team.name}</h1>
            <div className="col-start-3 ml-2 justify-self-start">
              {teamApproved ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white shadow-sm" aria-label="Official Footy authenticated profile">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          </div>
          <span className="mt-2 inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {teamAccountLabel}
          </span>
          {teamBio ? <p className="mx-auto mt-2 w-full max-w-xs break-words whitespace-pre-wrap text-center text-sm text-muted-foreground" style={{ textAlign: "center" }}>{teamBio}</p> : null}
        </div>
        </div>

        <ClubNewsSection
          teamId={team.id}
          clubId={clubId}
          clubName={teamProfileDetails?.club_name || team.name}
          canManage={canManageTeam}
          userId={user?.id || null}
          city={teamProfileDetails?.city || null}
        />

        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Details</h2><InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} section="profile" label="Edit team details" /></div>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            <div className="flex items-center gap-3 p-4">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Club / Organization</p>
                <p className="font-medium">{teamProfileDetails?.club_name || team.name}</p>
              </div>
            </div>
            {teamProfileDetails?.leagues_offered?.length ? (
              <div className="flex items-center gap-3 p-4">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Leagues Provided</p>
                  <p className="font-medium">{teamProfileDetails.leagues_offered.join(", ")}</p>
                </div>
              </div>
            ) : null}
            {teamProfileDetails?.age_groups_offered?.length ? (
              <div className="flex items-center gap-3 p-4">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Age Groups Provided</p>
                  <p className="font-medium">{teamProfileDetails.age_groups_offered.join(", ")}</p>
                </div>
              </div>
            ) : null}
            {locationLine ? (
              <div className="flex items-center gap-3 p-4">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">City / State</p>
                  <p className="font-medium">{locationLine}</p>
                </div>
              </div>
            ) : null}
            {teamProfileDetails?.training_ground ? (
              <div className="flex items-center gap-3 p-4">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Training Ground Address</p>
                  <p className="font-medium">{teamProfileDetails.training_ground}</p>
                </div>
              </div>
            ) : null}
            {team.founded_year ? (
              <div className="flex items-center gap-3 p-4">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Founded</p>
                  <p className="font-medium">{team.founded_year}</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Contact Information</h2><InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} section="profile" label="Edit team contact information" /></div>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {team.contact_email && (
                <div className="flex items-center gap-3 min-w-0 p-4">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Team Email</p>
                    <a href={`mailto:${team.contact_email}`} className="font-medium text-navy hover:underline break-all">
                      {team.contact_email}
                    </a>
                  </div>
                </div>
              )}
              {team.contact_phone && (
                <div className="flex items-center gap-3 p-4">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Main Team Phone</p>
                    <a href={`tel:${team.contact_phone}`} className="font-medium text-navy hover:underline">
                      {team.contact_phone}
                    </a>
                  </div>
                </div>
              )}
              {!team.contact_email && !team.contact_phone ? (
                <div className="p-4 text-sm text-muted-foreground">No contact information added yet.</div>
              ) : null}
            </div>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-navy mb-3">Home Field & Kits</h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            <div className="flex items-center gap-3 p-4">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Home Field</p>
                <p className="font-medium">{teamProfileDetails?.home_stadium || team.stadium || "No home field added yet"}</p>
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm text-muted-foreground mb-3">Jersey Colors</p>
              <div className="grid grid-cols-1 gap-2">
                {[
                  ["Home", teamProfileDetails?.home_jersey_color || team.home_jersey_color],
                  ["Away", teamProfileDetails?.away_jersey_color || team.away_jersey_color],
                  ["3rd Kit", teamProfileDetails?.third_kit_color || team.third_kit_color],
                ].map(([label, color]) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="text-sm text-muted-foreground">{color || (label === "3rd Kit" ? "Optional" : "Not added")}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Club Staff</h2><InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} section="teams" label="Manage staff links" /></div>
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              {linkedClubStaff.map((staff) => {
                const staffProfile = staff.profile || staff.profiles || {};
                return (
                  <div key={staff.id} className="rounded-lg border border-border p-3 space-y-3">
                    <button
                      onClick={() => navigate(staff.coach_user_id === user?.id ? "/profile" : `/staff/${staff.coach_user_id}`)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                        {staffProfile.avatar_url ? (
                          <img src={staffProfile.avatar_url} alt={staffProfile.full_name || "Club staff"} className="w-full h-full object-cover" />
                        ) : (
                          <Briefcase className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{staffProfile.full_name || "Club Staff"}</p>
                        <p className="text-sm text-muted-foreground truncate">{staff.staff_role || staffProfile.coaching_role_type || "Club Director / Team Staff"}</p>
                      </div>
                    </button>
                    {canManageTeam ? (
                      <Button size="sm" variant="outline" onClick={() => handleRemoveCoachStaffFromTeam(staff)} disabled={actionLoading}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              {teamStaffMembers.map((staff) => (
                <div key={staff.id} className="rounded-lg border border-border p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{staff.staff_name}</p>
                    {staff.staff_role ? <span className="text-sm text-muted-foreground">{staff.staff_role}</span> : null}
                  </div>
                  {staff.personal_email ? (
                    <a href={`mailto:${staff.personal_email}`} className="font-medium text-navy hover:underline break-all">
                      {staff.personal_email}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">No email added yet</p>
                  )}
                </div>
              ))}
              {!linkedClubStaff.length && !teamStaffMembers.length ? (
                <p className="text-sm text-muted-foreground">No club staff linked yet.</p>
              ) : null}
            </div>
        </section>

        <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Coaching Staff</h2><InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} section="teams" label="Manage coach links" /></div>
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              {linkedNonClubStaff.length > 0 ? (
                <div className="space-y-3">
                  {linkedNonClubStaff.map((staff) => {
                    const staffProfile = staff.profile || staff.profiles || {};
                    return (
                      <div key={staff.id} className="rounded-lg border border-border p-3 space-y-3">
                        <button
                          onClick={() => navigate(staff.coach_user_id === user?.id ? "/profile" : `/coach/${staff.coach_user_id}`)}
                          className="w-full flex items-center gap-3 text-left"
                        >
                          <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                            {staffProfile.avatar_url ? (
                              <img src={staffProfile.avatar_url} alt={staffProfile.full_name || "Coach"} className="w-full h-full object-cover" />
                            ) : (
                              <Briefcase className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{staffProfile.full_name || "Coach / Staff"}</p>
                            <p className="text-xs text-muted-foreground">{staff.staff_role || staffProfile.coaching_role_type || "Coaching Staff"}</p>
                          </div>
                        </button>
                        {canManageTeam ? (
                          <Button size="sm" variant="outline" onClick={() => handleRemoveCoachStaffFromTeam(staff)} disabled={actionLoading}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No linked coaches or staff yet.</p>
              )}

              {canManageTeam ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium">Invite Coach / Staff</p>
                  <Input value={coachStaffSearch} onChange={(e) => setCoachStaffSearch(e.target.value)} placeholder="Search coach/staff profiles" />
                  {coachStaffResults.map((staff) => (
                    <div key={staff.user_id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <button className="flex items-center gap-3 min-w-0 text-left" onClick={() => navigate(staff.user_id === user?.id ? "/profile" : `/coach/${staff.user_id}`)}>
                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                          {staff.avatar_url ? (
                            <img src={staff.avatar_url} alt={staff.full_name || "Coach"} className="w-full h-full object-cover" />
                          ) : (
                            <Briefcase className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{staff.full_name || "Coach / Staff"}</p>
                          <p className="text-xs text-muted-foreground">{staff.coaching_role_type || "Coaching Staff"}</p>
                        </div>
                      </button>
                      <Button size="sm" onClick={() => handleInviteCoachStaff(staff.user_id, staff.coaching_role_type)} disabled={actionLoading}>
                        Invite
                      </Button>
                    </div>
                  ))}
                  {coachStaffSearch.trim() && !coachStaffResults.length ? (
                    <p className="text-sm text-muted-foreground">No matching coach/staff profiles found.</p>
                  ) : null}
                </div>
              ) : null}

            </div>
        </section>

        {canManageTeam && clubTeams.length === 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-bold tracking-wide mb-3">TEAM ACCESS</h2>
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              {!teamApproved ? (
                <p className="text-sm text-muted-foreground">
                  Your team must be approved for its league before you can invite players or approve join requests.
                </p>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <KeyRound className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Team access code</p>
                      {generatedAccessCode ? (
                        <p className="text-sm text-navy font-semibold">{generatedAccessCode}</p>
                      ) : team.access_code_last4 ? (
                        <p className="text-sm text-muted-foreground">Current code ending in {team.access_code_last4}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Generate a code so players can request to join.</p>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={handleRegenerateAccessCode} disabled={actionLoading}>
                    {team.access_code_last4 ? "Regenerate Access Code" : "Generate Access Code"}
                  </Button>
                </>
              )}
            </div>
          </section>
        )}

        {!clubTeams.length && players.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Club Players</h2><InlineProfileAdminControls targetUserId={team.owner_user_id} targetName={team.name} section="teams" label="Manage player links" /></div>
          {players.length > 0 ? (
            <div className="space-y-4">
              {playersByAgeGroup.map(([ageGroup, groupedPlayers]) => (
                <div key={ageGroup} className="space-y-2">
                  <div className="bg-card border border-border rounded-xl px-4 py-3">
                    <p className="font-medium text-foreground">
                      {formatTeamLeagueLine(team.name, ageGroup, league?.name)}
                    </p>
                  </div>
                  {groupedPlayers.map((player) => (
                    <button
                      key={player.membership_id}
                      onClick={() => navigate(player.player_user_id === user?.id ? "/profile" : `/player/${player.player_profile_id}`)}
                      className="w-full bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between gap-4 hover:bg-muted transition-colors text-left"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                          {player.player_avatar_url ? (
                            <img src={player.player_avatar_url} alt={player.player_name} className="w-full h-full object-cover rounded-full" />
                          ) : (
                            <Users className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground truncate">{player.player_name}</p>
                            {player.is_pro ? <ProBadge compact /> : null}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{player.player_position || "Player"}</p>
                        </div>
                      </div>
                      <p className="shrink-0 text-2xl font-semibold text-foreground/80">{player.player_jersey_number ? `#${player.player_jersey_number}` : "--"}</p>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </section>
        )}

        <section className="mb-6">
            <h2 className="text-lg font-semibold text-navy mb-3">Teams Offered</h2>
            {clubTeams.length > 0 ? (
            <div className="space-y-5">
              {clubTeamsByLeague.map(([leagueName, leagueTeams]) => (
                <div key={leagueName} className="space-y-3">
                  <div className="bg-card border border-border rounded-xl px-4 py-2.5">
                    <p className="font-semibold text-sm">{leagueName}</p>
                  </div>
                  {leagueTeams.map((clubTeam) => {
                const savedClubTeamAccessCode = clubTeam.access_code_value ?? "";
                const clubTeamAccessCode = clubTeamAccessCodes[clubTeam.id] ?? savedClubTeamAccessCode;
                const clubTeamAccessCodeChanged = sanitizeClubTeamAccessCode(clubTeamAccessCode) !== savedClubTeamAccessCode;
                const clubTeamAccessCodeIsValid = sanitizeClubTeamAccessCode(clubTeamAccessCode).length === 5;
                return (
                  <div
                    key={clubTeam.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/club-team/${clubTeam.id}`)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/club-team/${clubTeam.id}`);
                      }
                    }}
                    className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
                  >
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-navy/10 ring-1 ring-border">
                          {team.logo_url ? (
                            <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-navy text-white">
                              <Shield className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{team.name}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {[clubTeam.age_group, clubTeam.league_name].filter(Boolean).join(" • ") || "Club team"}
                              </p>
                            </div>
                            <Badge variant="outline" className="shrink-0 rounded-full">
                              {clubTeam.status === "inactive" ? "Inactive" : "Active"}
                            </Badge>
                          </div>
                          {[clubTeam.coach_name ? `Coach ${clubTeam.coach_name}` : null, formatTeamGender(clubTeam.gender), clubTeam.season, clubTeam.level]
                            .filter(Boolean)
                            .length ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {[clubTeam.coach_name ? `Coach ${clubTeam.coach_name}` : null, formatTeamGender(clubTeam.gender), clubTeam.season, clubTeam.level]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-1.5">
                        <div className="grid grid-cols-5 overflow-hidden rounded-xl bg-background text-center">
                          <div className="px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Wins</p>
                          <p className="text-sm font-semibold text-foreground">{clubTeam.wins || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Losses</p>
                          <p className="text-sm font-semibold text-foreground">{clubTeam.losses || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ties</p>
                          <p className="text-sm font-semibold text-foreground">{clubTeam.draws || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Points</p>
                          <p className="text-sm font-semibold text-foreground">{clubTeam.points || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Place</p>
                          <p className="text-sm font-semibold text-foreground">{clubTeam.position ? `#${clubTeam.position}` : "--"}</p>
                          </div>
                        </div>
                      </div>
                          {canManageTeam ? (
                        <>
                          <div
                            className="mt-3 rounded-xl border border-border bg-background p-3 shadow-sm"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <div className="flex items-start gap-3">
                              <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                              <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-foreground">5-digit access code</p>
                                  <Badge variant="secondary" className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                                    {savedClubTeamAccessCode ? savedClubTeamAccessCode : "No code"}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                  <Input
                                    value={clubTeamAccessCode}
                                    onClick={stopTileEvent}
                                    onMouseDown={stopTileEvent}
                                    onKeyDown={stopTileEvent}
                                    onChange={(e) =>
                                      setClubTeamAccessCodes((prev) => ({
                                        ...prev,
                                        [clubTeam.id]: sanitizeClubTeamAccessCode(e.target.value),
                                      }))
                                    }
                                    inputMode="numeric"
                                    maxLength={5}
                                    placeholder="12345"
                                    className="max-w-[180px] text-center"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveClubTeamAccessCode(clubTeam.id);
                                    }}
                                    onMouseDown={stopTileEvent}
                                    onKeyDown={stopTileEvent}
                                    disabled={savingClubTeamAccessCodeId === clubTeam.id || !clubTeamAccessCodeIsValid || !clubTeamAccessCodeChanged}
                                  >
                                    {savingClubTeamAccessCodeId === clubTeam.id ? "Saving..." : "Save"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div
                            className="mt-3 rounded-xl border border-border bg-background p-3 shadow-sm"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <button
                              type="button"
                              disabled={!teamApproved || clubTeam.status !== "active"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveInviteClubTeamId((prev) => (prev === clubTeam.id ? null : clubTeam.id));
                                setClubTeamPlayerSearch("");
                                setClubTeamPlayerResults([]);
                              }}
                              onMouseDown={stopTileEvent}
                              onKeyDown={stopTileEvent}
                              className={`w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                                !teamApproved || clubTeam.status !== "active"
                                  ? "border-border bg-muted text-muted-foreground opacity-70 cursor-not-allowed"
                                  : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                              }`}
                            >
                              Invite Player
                            </button>
                          </div>
                          {!teamApproved || clubTeam.status !== "active" ? (
                            <p className="mt-3 text-[11px] text-muted-foreground">
                              {!teamApproved ? "Team approval is required before you can invite players." : "This team must be active before you can invite players."}
                            </p>
                          ) : null}
                          {activeInviteClubTeamId === clubTeam.id ? (
                            <div
                              className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3"
                              onClick={stopTileEvent}
                              onMouseDown={stopTileEvent}
                              onKeyDown={stopTileEvent}
                            >
                              <Input
                                value={clubTeamPlayerSearch}
                                onClick={stopTileEvent}
                                onMouseDown={stopTileEvent}
                                onKeyDown={stopTileEvent}
                                onChange={(e) => setClubTeamPlayerSearch(e.target.value)}
                                placeholder="Search players from Explore"
                              />
                              {clubTeamPlayerSearch.trim() ? (
                                clubTeamPlayerSearchLoading ? (
                                  <p className="text-xs text-muted-foreground">Searching players...</p>
                                ) : clubTeamPlayerResults.length > 0 ? (
                                  <div className="space-y-2">
                                    {clubTeamPlayerResults.map((player) => (
                                      <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium truncate">{player.full_name}</p>
                                          <p className="text-xs text-muted-foreground truncate">
                                            {[player.position, player.username ? `@${player.username}` : null].filter(Boolean).join(" • ") || "Player"}
                                          </p>
                                        </div>
                                        <Button
                                          size="sm"
                                          className="h-8 px-3 shrink-0"
                                          disabled={invitingClubTeamId === clubTeam.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleInvitePlayerToClubTeam(clubTeam.id, player.id);
                                          }}
                                          onMouseDown={stopTileEvent}
                                          onKeyDown={stopTileEvent}
                                        >
                                          {invitingClubTeamId === clubTeam.id ? "Sending..." : "Invite"}
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No matching players found.</p>
                                )
                              ) : (
                                <p className="text-xs text-muted-foreground">Start typing a player name to invite them to this exact team.</p>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
                </div>
              ))}
            </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">
                No teams offered yet.
              </div>
            )}
        </section>

        {canManageTeam && (
          <section className="mb-6">
            <h2 className="text-sm font-bold tracking-wide mb-3">PENDING JOIN REQUESTS</h2>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              {joinRequests.length ? joinRequests.map((request) => (
                <div key={request.id} className="rounded-lg border border-border p-3 space-y-2">
                  <button className="text-left" onClick={() => navigate(request.player_user_id === user?.id ? "/profile" : `/player/${request.player_profile_id}`)}>
                    <p className="font-medium">{request.player_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTeamLeagueLine(team.name, request.age_group || team.age_group, league?.name)}
                    </p>
                    {request.access_code_last4 && (
                      <p className="text-xs text-muted-foreground">Code ending in {request.access_code_last4}</p>
                    )}
                  </button>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => handleReviewJoinRequest(request.id, true)} disabled={!teamApproved || actionLoading}>
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => handleReviewJoinRequest(request.id, false)} disabled={actionLoading}>
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              )) : null}
              {coachStaffRequests.length ? coachStaffRequests.map((request) => {
                const staffProfile = request.profiles || {};
                return (
                  <div key={request.id} className="rounded-lg border border-border p-3 space-y-2">
                    <button className="text-left" onClick={() => navigate(request.coach_user_id === user?.id ? "/profile" : `/coach/${request.coach_user_id}`)}>
                      <p className="font-medium">{staffProfile.full_name || "Coach / Staff"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[request.staff_role || staffProfile.coaching_role_type || "Coaching Staff", formatTeamLeagueLine(team.name, request.age_group || team.age_group, league?.name)]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                      {request.general_club_role ? <p className="text-xs text-muted-foreground">General Coach / Club Staff</p> : null}
                      {(request.requested_assignments || []).map((assignment: any) => (
                        <p key={assignment.club_team_id} className="text-xs text-muted-foreground">
                          {assignment.team_name || "Daughter team"} - {assignment.role}
                        </p>
                      ))}
                    </button>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => handleReviewCoachStaffRequest(request, true)} disabled={!teamApproved || actionLoading}>
                        <Check className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => handleReviewCoachStaffRequest(request, false)} disabled={actionLoading}>
                        <X className="h-4 w-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                );
              }) : null}
              {!joinRequests.length && !coachStaffRequests.length ? (
                <p className="text-sm text-muted-foreground">No pending join requests.</p>
              ) : null}
            </div>
          </section>
        )}

        {canManageTeam && (
          <section className="mb-6">
            <h2 className="text-sm font-bold tracking-wide mb-3">PENDING INVITES</h2>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              {pendingInvites.length ? pendingInvites.map((invite) => (
                <div key={invite.id} className="rounded-lg border border-border p-3 space-y-2">
                  <button
                    onClick={() => navigate(invite.player_user_id === user?.id ? "/profile" : `/player/${invite.player_profile_id}`)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{invite.player_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Player invite for {formatTeamLeagueLine(team.name, invite.age_group || team.age_group, league?.name)}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 rounded-full">{formatInviteStatus(invite.status)}</Badge>
                    </div>
                  </button>
                  {invite.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => handleResendInvite(invite, "player")} disabled={actionLoading}>
                        Resend
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCancelInvite(invite, "player")} disabled={actionLoading}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </div>
              )) : null}
              {coachStaffInvites.length ? coachStaffInvites.map((invite) => {
                const staffProfile = invite.profiles || {};
                return (
                  <div key={invite.id} className="rounded-lg border border-border p-3 space-y-2">
                    <button
                      onClick={() => navigate(invite.coach_user_id === user?.id ? "/profile" : `/coach/${invite.coach_user_id}`)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{staffProfile.full_name || "Coach / Staff"}</p>
                          <p className="text-xs text-muted-foreground">{invite.staff_role || staffProfile.coaching_role_type || "Staff"} invite</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-full">{formatInviteStatus(invite.status)}</Badge>
                      </div>
                    </button>
                    {invite.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleResendInvite(invite, "staff")} disabled={actionLoading}>
                          Resend
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCancelInvite(invite, "staff")} disabled={actionLoading}>
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              }) : null}
              {!pendingInvites.length && !coachStaffInvites.length ? (
                <p className="text-sm text-muted-foreground">No pending invites.</p>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default TeamProfile;
