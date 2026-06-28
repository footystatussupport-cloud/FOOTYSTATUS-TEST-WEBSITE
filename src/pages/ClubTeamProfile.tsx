import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, KeyRound, Search, Shield, Trophy, UserPlus, Users, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import MatchCard from "@/components/MatchCard";
import { fetchRosterForClubTeam, formatTeamGender, normalizeTeamGender, sanitizeClubTeamAccessCode, updateClubTeamAccessCode } from "@/lib/clubTeams";
import { fetchClubTeamPageData, formatLeagueSubtitle, type ClubTeamPageData } from "@/lib/matches";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import ProBadge from "@/components/ProBadge";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";
import {
  assignCoachStaffToClubTeam,
  COACHING_ROLE_OPTIONS,
  CoachStaffProfile,
  fetchCoachProfiles,
  fetchCoachStaffForClubTeam,
  fetchMotherTeamCoachStaffOptions,
  inviteCoachStaffToTeam,
  unlinkCoachStaffFromTeam,
} from "@/lib/coachStaffTeams";

const ClubTeamProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [pageData, setPageData] = useState<ClubTeamPageData | null>(null);
  const [roster, setRoster] = useState<any[]>([]);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerResults, setPlayerResults] = useState<any[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [accessCodeValue, setAccessCodeValue] = useState("");
  const [savingAccessCode, setSavingAccessCode] = useState(false);
  const [viewerManagedTeamId, setViewerManagedTeamId] = useState<string | null>(null);
  const [viewerManagedClubId, setViewerManagedClubId] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<any[]>([]);
  const [linkedCoaches, setLinkedCoaches] = useState<any[]>([]);
  const [motherTeamCoaches, setMotherTeamCoaches] = useState<any[]>([]);
  const [showCoachInvitePanel, setShowCoachInvitePanel] = useState(false);
  const [coachSearch, setCoachSearch] = useState("");
  const [coachResults, setCoachResults] = useState<CoachStaffProfile[]>([]);
  const [coachSearchLoading, setCoachSearchLoading] = useState(false);
  const [coachRoleSelections, setCoachRoleSelections] = useState<Record<string, string>>({});
  const [coachActionLoading, setCoachActionLoading] = useState<string | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [playerJoinState, setPlayerJoinState] = useState<"none" | "pending" | "member">("none");
  const [requestingToJoin, setRequestingToJoin] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const loadPage = async () => {
      if (!id) return;
      setLoading(true);
      const data = await fetchClubTeamPageData(id);
      const teamGender = normalizeTeamGender(data.clubTeam?.gender);
      const playerCanViewRoster =
        profile?.account_role !== "player" ||
        (!!profile.player_gender && profile.player_gender === teamGender);
      const nextRoster = playerCanViewRoster ? await fetchRosterForClubTeam(id) : [];
      setPageData(data);
      setRoster(nextRoster);
      setLoading(false);
    };

    loadPage();
  }, [id, reloadToken, profile?.account_role, profile?.player_gender]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`club-team-live-sync-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "club_teams" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "league_teams" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_staff_team_memberships" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "coach_staff_team_invites" }, () => setReloadToken((value) => value + 1))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const clubTeam = pageData?.clubTeam ?? null;
  const club = pageData?.club ?? null;
  const parentTeam = pageData?.parentTeam ?? null;
  const league = pageData?.league ?? null;
  const standing = pageData?.standing ?? null;
  const upcoming = pageData?.upcoming ?? [];
  const recent = pageData?.recent ?? [];
  const clubName = club?.name || parentTeam?.name || "";
  const leagueLabel = clubTeam?.league_name || null;
  const ageGroupLabel = clubTeam?.age_group || null;
  const clubTeamGender = normalizeTeamGender(clubTeam?.gender);
  const rosterIsAvailable =
    profile?.account_role !== "player" ||
    (!!profile.player_gender && profile.player_gender === clubTeamGender);
  const savedAccessCode = clubTeam?.access_code_value || "";
  const accessCodeDraft = sanitizeClubTeamAccessCode(accessCodeValue);
  const accessCodeChanged = accessCodeDraft !== savedAccessCode;
  const accessCodeIsValid = accessCodeDraft.length === 5;
  const isOfficialFootyStatusAccount = isFootyStatusSuperAdminEmail(user?.email);
  const canManageClubTeam =
    !!user &&
    !!club &&
    !!parentTeam &&
    (isOfficialFootyStatusAccount ||
      (profile?.account_role === "team_club" &&
        ((club?.owner_user_id && club.owner_user_id === user.id) ||
          viewerManagedClubId === club.id ||
          parentTeam.owner_user_id === user.id ||
          viewerManagedTeamId === parentTeam.id)));
  const canRequestToJoinClubTeam =
    !!user &&
    profile?.account_role === "player" &&
    playerJoinState === "none" &&
    !!clubTeamGender &&
    profile?.player_gender === clubTeamGender;
  const parentClubDestination = parentTeam?.id ? `/team/${parentTeam.id}` : null;
  const rosterProfileIds = useMemo(() => new Set(roster.map((player) => player.player_profile_id)), [roster]);
  const linkedCoachUserIds = useMemo(() => new Set(linkedCoaches.map((coach) => coach.coach_user_id)), [linkedCoaches]);
  const assignableMotherTeamCoaches = useMemo(
    () => motherTeamCoaches.filter((coach) => !linkedCoachUserIds.has(coach.coach_user_id)),
    [linkedCoachUserIds, motherTeamCoaches]
  );
  const coachRoleOptions = useMemo(() => Array.from(new Set(["Head Coach", "Assistant Coach", "Trainer Coach", ...COACHING_ROLE_OPTIONS])), []);
  const getCoachProfileRole = (coach: any) => coach.profile?.coaching_role_type || coach.coaching_role_type || "Coach";
  const getSelectedCoachRole = (key: string, fallback?: string | null) => coachRoleSelections[key] || fallback || "Head Coach";

  useEffect(() => {
    const fetchViewerManagedTeam = async () => {
      if (!user || profile?.account_role !== "team_club") {
        setViewerManagedTeamId(null);
        return;
      }

      const { data } = await (supabase as any)
        .from("team_profiles")
        .select("team_id, club_id")
        .eq("user_id", user.id)
        .maybeSingle();

      setViewerManagedTeamId(data?.team_id || null);
      setViewerManagedClubId(data?.club_id || null);
    };

    fetchViewerManagedTeam();
  }, [user?.id, profile?.account_role]);

  useEffect(() => {
    setAccessCodeValue(clubTeam?.access_code_value || "");
  }, [clubTeam?.id, clubTeam?.access_code_value]);

  useEffect(() => {
    const searchPlayers = async () => {
      if (!canManageClubTeam || !showInvitePanel || !playerSearch.trim()) {
        setPlayerResults([]);
        setPlayerSearchLoading(false);
        return;
      }

      const query = playerSearch.trim();
      setPlayerSearchLoading(true);
      const { data } = await (supabase as any)
        .from("player_profiles")
        .select("id, user_id, full_name, position, profile_image_url, player_gender")
        .eq("player_gender", clubTeamGender)
        .ilike("full_name", `%${query}%`)
        .limit(8);

      setPlayerResults(((data || []) as any[]).filter((player) => !rosterProfileIds.has(player.id)));
      setPlayerSearchLoading(false);
    };

    searchPlayers();
  }, [canManageClubTeam, showInvitePanel, playerSearch, rosterProfileIds, clubTeamGender]);

  useEffect(() => {
    const loadCoaches = async () => {
      if (!id || !parentTeam?.id) {
        setLinkedCoaches([]);
        setMotherTeamCoaches([]);
        return;
      }

      const [daughterCoaches, motherCoaches] = await Promise.all([
        fetchCoachStaffForClubTeam(parentTeam.id, id).catch(() => []),
        fetchMotherTeamCoachStaffOptions(parentTeam.id).catch(() => []),
      ]);
      setLinkedCoaches(daughterCoaches);
      setMotherTeamCoaches(motherCoaches);
    };

    loadCoaches();
  }, [id, parentTeam?.id, reloadToken]);

  useEffect(() => {
    const searchCoaches = async () => {
      if (!canManageClubTeam || !showCoachInvitePanel || !coachSearch.trim()) {
        setCoachResults([]);
        setCoachSearchLoading(false);
        return;
      }

      setCoachSearchLoading(true);
      const results = await fetchCoachProfiles(coachSearch).catch(() => []);
      setCoachResults(results.filter((coach) => !linkedCoachUserIds.has(coach.user_id)));
      setCoachSearchLoading(false);
    };

    searchCoaches();
  }, [canManageClubTeam, showCoachInvitePanel, coachSearch, linkedCoachUserIds]);

  useEffect(() => {
    const fetchManagementData = async () => {
      if (!canManageClubTeam || !id || !parentTeam?.id) {
        setPendingInvites([]);
        setPendingJoinRequests([]);
        return;
      }

      const [inviteRes, requestRes] = await Promise.all([
        (supabase as any)
          .from("team_player_invites")
          .select("id, player_profile_id, player_user_id, created_at")
          .eq("team_id", parentTeam.id)
          .eq("club_team_id", id)
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        (supabase as any)
          .from("team_join_requests")
          .select("id, player_profile_id, player_user_id, requested_at, access_code_last4")
          .eq("team_id", parentTeam.id)
          .eq("club_team_id", id)
          .eq("status", "pending")
          .order("requested_at", { ascending: false }),
      ]);

      const profileIds = [
        ...new Set([
          ...((inviteRes.data || []) as any[]).map((invite) => invite.player_profile_id),
          ...((requestRes.data || []) as any[]).map((request) => request.player_profile_id),
        ]),
      ].filter(Boolean);
      const { data: playerProfiles } = profileIds.length
        ? await (supabase as any)
            .from("player_profiles_public")
            .select("id, user_id, full_name, profile_image_url, username")
            .in("id", profileIds)
        : { data: [] };
      const playerProfilesById = new Map((playerProfiles || []).map((player: any) => [player.id, player]));

      setPendingInvites(
        ((inviteRes.data || []) as any[]).map((invite) => {
          const playerProfile = playerProfilesById.get(invite.player_profile_id);
          return {
            ...invite,
            player_name: playerProfile?.full_name || "Unknown Player",
            player_avatar_url: playerProfile?.profile_image_url || null,
            player_username: playerProfile?.username || null,
          };
        })
      );

      setPendingJoinRequests(
        ((requestRes.data || []) as any[]).map((request) => {
          const playerProfile = playerProfilesById.get(request.player_profile_id);
          return {
            ...request,
            player_name: playerProfile?.full_name || "Unknown Player",
            player_avatar_url: playerProfile?.profile_image_url || null,
            player_username: playerProfile?.username || null,
          };
        })
      );
    };

    fetchManagementData();
  }, [canManageClubTeam, id, parentTeam?.id]);

  useEffect(() => {
    const fetchPlayerJoinState = async () => {
      if (!id || !user || profile?.account_role !== "player") {
        setPlayerJoinState("none");
        return;
      }

      const [membershipRes, requestRes] = await Promise.all([
        (supabase as any)
          .from("player_team_memberships")
          .select("id")
          .eq("player_user_id", user.id)
          .eq("club_team_id", id)
          .in("status", ["accepted", "approved"])
          .maybeSingle(),
        (supabase as any)
          .from("team_join_requests")
          .select("id")
          .eq("player_user_id", user.id)
          .eq("club_team_id", id)
          .eq("status", "pending")
          .maybeSingle(),
      ]);

      if (membershipRes.data?.id) {
        setPlayerJoinState("member");
      } else if (requestRes.data?.id) {
        setPlayerJoinState("pending");
      } else {
        setPlayerJoinState("none");
      }
    };

    fetchPlayerJoinState();
  }, [id, user?.id, profile?.account_role, reloadToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!pageData?.clubTeam || !pageData.parentTeam) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/?tab=explore")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Explore
        </button>
        <p className="mt-12 text-center text-muted-foreground">Team not found.</p>
      </div>
    );
  }

  const reloadClubTeamPage = async () => {
    if (!id) return;
    setLoading(true);
    const [data, nextRoster] = await Promise.all([fetchClubTeamPageData(id), fetchRosterForClubTeam(id)]);
    setPageData(data);
    setRoster(nextRoster);
    setLoading(false);
  };

  const handleInvitePlayer = async (playerProfileId: string) => {
    if (!canManageClubTeam || !id) return;

    setActionLoading(true);
    const { error } = await (supabase as any).rpc("create_team_player_invite_for_club_team", {
      _team_id: parentTeam.id,
      _club_team_id: id,
      _player_profile_id: playerProfileId,
    });

    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Invite sent" });
      setPlayerSearch("");
      setPlayerResults([]);
      setShowInvitePanel(false);
    }

    setActionLoading(false);
  };

  const handleRemovePlayer = async (membershipId: string) => {
    if (!canManageClubTeam) return;

    const confirmed = window.confirm("Are you sure you want to remove this player from this daughter team?");
    if (!confirmed) return;

    setActionLoading(true);
    const { error } = await (supabase as any).rpc("remove_player_from_club_team", {
      _membership_id: membershipId,
    });

    if (error) {
      toast({ title: "Could not remove player", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Player removed" });
      await reloadClubTeamPage();
    }

    setActionLoading(false);
  };

  const handleSaveAccessCode = async () => {
    if (!canManageClubTeam || !clubTeam?.id) return;

    const normalizedCode = sanitizeClubTeamAccessCode(accessCodeValue);
    if (normalizedCode.length !== 5) {
      toast({ title: "Invalid code", description: "Access code must be exactly 5 digits.", variant: "destructive" });
      return;
    }

    setSavingAccessCode(true);
    const { data, error } = await updateClubTeamAccessCode(clubTeam.id, normalizedCode);

    if (error) {
      toast({ title: "Could not update code", description: error.message, variant: "destructive" });
    } else {
      setPageData((prev) => (prev ? { ...prev, clubTeam: data } : prev));
      setAccessCodeValue(data?.access_code_value || normalizedCode);
      toast({ title: "Access code updated", description: "Players can now use this code for this exact team." });
    }

    setSavingAccessCode(false);
  };

  const formatManagementTimestamp = (value?: string | null) => {
    if (!value) return null;
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return null;
    return parsedDate.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleReviewJoinRequest = async (requestId: string, approve: boolean) => {
    setReviewingRequestId(requestId);
    const { error } = await (supabase as any).rpc("review_team_join_request", {
      _request_id: requestId,
      _approve: approve,
    });

    if (error) {
      toast({ title: "Could not update request", description: error.message, variant: "destructive" });
      setReviewingRequestId(null);
      return;
    }

    toast({ title: approve ? "Player approved" : "Request rejected" });
    await reloadClubTeamPage();
    setReviewingRequestId(null);
  };

  const handleRequestToJoinClubTeam = async () => {
    if (!id) return;

    setRequestingToJoin(true);
    const { error } = await (supabase as any).rpc("request_join_club_team", {
      _club_team_id: id,
    });

    if (error) {
      const lowerMessage = (error.message || "").toLowerCase();
      const description = lowerMessage.includes("eligible") ? "You are not eligible to join this team." : error.message;
      toast({ title: "Could not request to join", description, variant: "destructive" });
      setRequestingToJoin(false);
      return;
    }

    toast({ title: "Request sent", description: "The team can approve your request from their daughter-team profile." });
    setPlayerJoinState("pending");
    setRequestingToJoin(false);
  };

  const handleInviteCoach = async (coach: CoachStaffProfile) => {
    if (!canManageClubTeam || !id || !parentTeam?.id || !user) return;

    const role = getSelectedCoachRole(`invite-${coach.user_id}`, coach.coaching_role_type);
    setCoachActionLoading(coach.user_id);
    const { error } = await inviteCoachStaffToTeam(parentTeam.id, coach.user_id, user.id, role, {
      club_team_id: id,
      league_id: clubTeam?.league_id || null,
      age_group: clubTeam?.age_group || null,
    });

    if (error) {
      toast({ title: "Coach invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coach invite sent", description: "The invite is linked to this exact daughter team." });
      setCoachSearch("");
      setCoachResults([]);
      setShowCoachInvitePanel(false);
      setReloadToken((value) => value + 1);
    }

    setCoachActionLoading(null);
  };

  const handleAssignMotherCoach = async (coach: any) => {
    if (!canManageClubTeam || !id || !parentTeam?.id) return;

    const role = getSelectedCoachRole(`assign-${coach.coach_user_id}`, coach.staff_role || getCoachProfileRole(coach));
    setCoachActionLoading(coach.coach_user_id);
    const { error } = await assignCoachStaffToClubTeam(parentTeam.id, id, coach.coach_user_id, role, {
      league_id: clubTeam?.league_id || null,
      age_group: clubTeam?.age_group || null,
    });

    if (error) {
      toast({ title: "Could not assign coach", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coach assigned", description: "This coach is now linked to this exact daughter team." });
      setReloadToken((value) => value + 1);
    }

    setCoachActionLoading(null);
  };

  const handleRemoveCoach = async (membershipId: string) => {
    if (!canManageClubTeam) return;

    const confirmed = window.confirm("Remove this coach from this daughter team?");
    if (!confirmed) return;

    setCoachActionLoading(membershipId);
    const { error } = await unlinkCoachStaffFromTeam(membershipId);

    if (error) {
      toast({ title: "Could not remove coach", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coach removed" });
      setReloadToken((value) => value + 1);
    }

    setCoachActionLoading(null);
  };

  const openMotherTeamProfile = () => {
    if (!parentClubDestination) {
      toast({
        title: "Mother team profile missing",
        description: "This daughter team is not linked to a mother team profile yet.",
        variant: "destructive",
      });
      return;
    }

    navigate(parentClubDestination);
  };

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <button onClick={openMotherTeamProfile} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          {clubTeam?.team_type === "school" || parentTeam?.team_type === "school" ? "Back to School" : "Back to Club"}
        </button>
      </header>

      <div className="space-y-6 p-4">
        <InlineProfileAdminControls targetUserId={parentTeam.owner_user_id} targetName={`${clubName} ${ageGroupLabel || ""}`.trim()} />
        <section className="rounded-xl border border-border bg-card p-6 text-center">
          <button
            type="button"
            onClick={openMotherTeamProfile}
            className="mx-auto mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-navy transition-transform hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label="Open mother team profile"
          >
            {parentTeam.logo_url ? (
              <img src={parentTeam.logo_url} alt={parentTeam.name} className="h-full w-full object-cover" />
            ) : (
              <Shield className="h-12 w-12 text-white" />
            )}
          </button>
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
            <button
              type="button"
              onClick={openMotherTeamProfile}
              className="col-start-2 max-w-[14rem] break-words text-center text-2xl font-bold text-foreground transition-colors hover:text-primary"
            >
              {clubName}
            </button>
            <div className="col-start-3 ml-2 justify-self-start">
              {parentTeam.approval_status === "approved" ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white shadow-sm">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-semibold">
              {clubTeam?.team_type === "school" || parentTeam?.team_type === "school" ? "School Team" : "Club Team"}
            </Badge>
            {leagueLabel ? (
              <Badge variant="secondary" className="rounded-full bg-navy/10 px-3 py-1 text-xs font-semibold text-navy hover:bg-navy/10">
                {leagueLabel}
              </Badge>
            ) : null}
            {ageGroupLabel ? (
              <Badge variant="secondary" className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted">
                {ageGroupLabel}
              </Badge>
            ) : null}
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-semibold">
              {formatTeamGender(clubTeamGender)}
            </Badge>
          </div>
          {league ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => navigate(`/league/${league.id}`)}
                className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                Open Linked League
              </button>
            </div>
          ) : null}
        </section>

        {profile?.account_role === "player" && (canRequestToJoinClubTeam || playerJoinState === "pending" || playerJoinState === "member") ? (
          <section className="rounded-xl border border-border bg-card p-4">
            {canRequestToJoinClubTeam ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-bold tracking-wide text-navy">JOIN THIS TEAM</p>
                  <p className="mt-1 text-sm text-muted-foreground">Send a request to join this daughter team roster.</p>
                </div>
                <Button className="w-full" onClick={handleRequestToJoinClubTeam} disabled={requestingToJoin}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {requestingToJoin ? "Sending request..." : "Request to Join Team"}
                </Button>
              </div>
            ) : playerJoinState === "pending" ? (
              <div>
                <p className="text-sm font-bold tracking-wide text-navy">JOIN REQUEST SENT</p>
                <p className="mt-1 text-sm text-muted-foreground">Your request is waiting for team approval.</p>
              </div>
            ) : playerJoinState === "member" ? (
              <div>
                <p className="text-sm font-bold tracking-wide text-navy">TEAM MEMBER</p>
                <p className="mt-1 text-sm text-muted-foreground">You are linked to this daughter team roster.</p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold tracking-wide text-navy">TEAM STATISTICS</p>
              {league ? (
                <button onClick={() => navigate(`/league/${league.id}`)} className="mt-2 text-left hover:underline">
                  <p className="font-semibold text-foreground">{league.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{formatLeagueSubtitle(league)}</p>
                </button>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">League not assigned yet.</p>
              )}
            </div>
            {standing ? (
              <div className="rounded-lg bg-muted px-3 py-2 text-center">
                <p className="text-xs text-muted-foreground">Position</p>
                <p className="text-lg font-bold text-foreground">#{standing.position}</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg border border-border px-2 py-2">
              <p className="text-xs text-muted-foreground">Wins</p>
              <p className="font-semibold">{clubTeam.wins}</p>
            </div>
            <div className="rounded-lg border border-border px-2 py-2">
              <p className="text-xs text-muted-foreground">Draws</p>
              <p className="font-semibold">{clubTeam.draws}</p>
            </div>
            <div className="rounded-lg border border-border px-2 py-2">
              <p className="text-xs text-muted-foreground">Losses</p>
              <p className="font-semibold">{clubTeam.losses}</p>
            </div>
            <div className="rounded-lg border border-border px-2 py-2">
              <p className="text-xs text-muted-foreground">Points</p>
              <p className="font-semibold">{clubTeam.points}</p>
            </div>
          </div>
          {canManageClubTeam ? (
            <div className="mt-4 rounded-lg border border-border bg-background p-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">5-digit access code</p>
                    <Badge variant="secondary" className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                      {savedAccessCode ? savedAccessCode : "No code"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <Input
                      value={accessCodeValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setAccessCodeValue(sanitizeClubTeamAccessCode(e.target.value))}
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="12345"
                      className="max-w-[180px] text-center"
                    />
                    <Button type="button" onClick={handleSaveAccessCode} disabled={savingAccessCode || !accessCodeIsValid || !accessCodeChanged}>
                      {savingAccessCode ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-navy" />
              <div className="flex items-center gap-2"><h2 className="text-sm font-bold tracking-wide text-navy">COACHES</h2><InlineProfileAdminControls targetUserId={parentTeam.owner_user_id} targetName={clubName} section="teams" label="Manage coach links" /></div>
            </div>
            {canManageClubTeam && rosterIsAvailable && clubTeamGender ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowCoachInvitePanel((prev) => !prev);
                  setCoachSearch("");
                  setCoachResults([]);
                }}
              >
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                Invite Coach
              </Button>
            ) : null}
          </div>

          {canManageClubTeam && assignableMotherTeamCoaches.length ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Assign from mother team coaches</p>
                <p className="text-xs text-muted-foreground">Choose an existing club coach and link them to this daughter team.</p>
              </div>
              <div className="space-y-2">
                {assignableMotherTeamCoaches.map((coach) => {
                  const profileInfo = coach.profile || {};
                  const roleKey = `assign-${coach.coach_user_id}`;
                  return (
                    <div key={coach.id} className="rounded-lg border border-border px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                          {profileInfo.avatar_url ? (
                            <img src={profileInfo.avatar_url} alt={profileInfo.full_name || "Coach"} className="h-full w-full object-cover" />
                          ) : (
                            <Users className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{profileInfo.full_name || "Coach"}</p>
                          <p className="truncate text-xs text-muted-foreground">{coach.staff_role || getCoachProfileRole(coach)}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                        <Select
                          value={getSelectedCoachRole(roleKey, coach.staff_role || getCoachProfileRole(coach))}
                          onValueChange={(value) => setCoachRoleSelections((prev) => ({ ...prev, [roleKey]: value }))}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Coach role" />
                          </SelectTrigger>
                          <SelectContent>
                            {coachRoleOptions.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" disabled={coachActionLoading === coach.coach_user_id} onClick={() => handleAssignMotherCoach(coach)}>
                          Assign
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {canManageClubTeam && showCoachInvitePanel ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={coachSearch}
                  onChange={(e) => setCoachSearch(e.target.value)}
                  placeholder="Search coach accounts from Explore"
                  className="pl-9"
                />
              </div>
              {coachSearch.trim() ? (
                coachSearchLoading ? (
                  <p className="text-xs text-muted-foreground">Searching coaches...</p>
                ) : coachResults.length ? (
                  <div className="space-y-2">
                    {coachResults.map((coach) => {
                      const roleKey = `invite-${coach.user_id}`;
                      return (
                        <div key={coach.user_id} className="rounded-lg border border-border px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                              {coach.avatar_url ? (
                                <img src={coach.avatar_url} alt={coach.full_name || "Coach"} className="h-full w-full object-cover" />
                              ) : (
                                <Users className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-foreground">{coach.full_name || "Coach"}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {[coach.coaching_role_type || "Coach", coach.username ? `@${coach.username}` : null].filter(Boolean).join(" - ")}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                            <Select
                              value={getSelectedCoachRole(roleKey, coach.coaching_role_type)}
                              onValueChange={(value) => setCoachRoleSelections((prev) => ({ ...prev, [roleKey]: value }))}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Coach role" />
                              </SelectTrigger>
                              <SelectContent>
                                {coachRoleOptions.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button size="sm" disabled={coachActionLoading === coach.user_id} onClick={() => handleInviteCoach(coach)}>
                              Invite
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No coach accounts found.</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Only coach-type accounts appear here.</p>
              )}
            </div>
          ) : null}

          {linkedCoaches.length ? (
            <div className="space-y-2">
              {linkedCoaches.map((coach) => {
                const profileInfo = coach.profile || {};
                return (
                  <div key={coach.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(coach.coach_user_id === user?.id ? "/profile" : `/staff/${coach.coach_user_id}`)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-primary"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                        {profileInfo.avatar_url ? (
                          <img src={profileInfo.avatar_url} alt={profileInfo.full_name || "Coach"} className="h-full w-full object-cover" />
                        ) : (
                          <Users className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{profileInfo.full_name || "Coach"}</p>
                        <p className="truncate text-sm text-muted-foreground">{coach.staff_role || getCoachProfileRole(coach)}</p>
                      </div>
                    </button>
                    {canManageClubTeam ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={coachActionLoading === coach.id}
                        onClick={() => handleRemoveCoach(coach.id)}
                        aria-label="Remove coach"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No coaches linked yet.</div>
          )}
        </section>

        {canManageClubTeam && (pendingJoinRequests.length > 0 || pendingInvites.length > 0) ? (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold tracking-wide text-navy">REQUESTS & INVITES</p>
              <Badge variant="secondary" className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                {pendingJoinRequests.length + pendingInvites.length}
              </Badge>
            </div>
            <div className="mt-4 space-y-3">
              {pendingJoinRequests.map((request) => (
                <div key={request.id} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                      {request.player_avatar_url ? (
                        <img src={request.player_avatar_url} alt={request.player_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{request.player_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[request.player_username ? `@${request.player_username}` : null, formatManagementTimestamp(request.requested_at)]
                          .filter(Boolean)
                          .join(" • ") || "Pending request"}
                      </p>
                      {request.access_code_last4 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">Code ending in {request.access_code_last4}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="flex-1" disabled={reviewingRequestId === request.id} onClick={() => handleReviewJoinRequest(request.id, true)}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={reviewingRequestId === request.id} onClick={() => handleReviewJoinRequest(request.id, false)}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                      {invite.player_avatar_url ? (
                        <img src={invite.player_avatar_url} alt={invite.player_name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Users className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{invite.player_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[invite.player_username ? `@${invite.player_username}` : null, formatManagementTimestamp(invite.created_at)]
                          .filter(Boolean)
                          .join(" • ") || "Pending invite"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">Invite sent for this exact team.</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-navy" />
              <div className="flex items-center gap-2"><h2 className="text-sm font-bold tracking-wide text-navy">ROSTER</h2><InlineProfileAdminControls targetUserId={parentTeam.owner_user_id} targetName={clubName} section="teams" label="Manage player links" /></div>
            </div>
            {canManageClubTeam ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowInvitePanel((prev) => !prev);
                  setPlayerSearch("");
                  setPlayerResults([]);
                }}
              >
                Invite Player
              </Button>
            ) : null}
          </div>
          {canManageClubTeam && rosterIsAvailable && clubTeamGender && showInvitePanel ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <Input
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="Search players from Explore"
              />
              {playerSearch.trim() ? (
                playerSearchLoading ? (
                  <p className="text-xs text-muted-foreground">Searching players...</p>
                ) : playerResults.length ? (
                  <div className="space-y-2">
                    {playerResults.map((player) => (
                      <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                            {player.profile_image_url ? (
                              <img src={player.profile_image_url} alt={player.full_name} className="h-full w-full object-cover" />
                            ) : (
                              <Users className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{player.full_name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[player.position, player.username ? `@${player.username}` : null].filter(Boolean).join(" • ") || "Player"}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="shrink-0"
                          disabled={actionLoading}
                          onClick={() => handleInvitePlayer(player.id)}
                        >
                          {actionLoading ? "Sending..." : "Invite"}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No matching players found.</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Start typing a player name to invite them to this exact daughter team.</p>
              )}
            </div>
          ) : null}
          {!rosterIsAvailable ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
              Roster is not available.
            </div>
          ) : !clubTeamGender ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
              This team must be categorized as Boys or Girls before its roster can be managed.
            </div>
          ) : roster.length ? (
            <div className="space-y-2">
              {roster.map((player) => (
                <div key={player.membership_id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <button
                    onClick={() => navigate(player.player_user_id === user?.id ? "/profile" : `/player/${player.player_profile_id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-primary"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                      {player.player_avatar_url ? (
                        <img src={player.player_avatar_url} alt={player.player_name} className="h-full w-full object-cover" />
                      ) : (
                        <Users className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-foreground">{player.player_name}</p>
                        {player.is_pro ? <ProBadge compact /> : null}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{player.player_position || "Player"}</p>
                    </div>
                  </button>
                  <p className="shrink-0 text-2xl font-semibold text-foreground/80">{player.player_jersey_number ? `#${player.player_jersey_number}` : "--"}</p>
                  {canManageClubTeam ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={actionLoading}
                      onClick={() => handleRemovePlayer(player.membership_id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No players linked yet.</div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">UPCOMING MATCHES</h2>
          </div>
          {upcoming.length ? (
            <div className="space-y-3">
              {upcoming.map((fixture) => (
                <button key={fixture.id} onClick={() => navigate(`/match/${fixture.id}`)} className="w-full text-left">
                  <MatchCard match={fixture} />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No matches yet.</div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">RECENT RESULTS</h2>
          </div>
          {recent.length ? (
            <div className="space-y-3">
              {recent.map((fixture) => (
                <button key={fixture.id} onClick={() => navigate(`/match/${fixture.id}`)} className="w-full text-left">
                  <MatchCard match={fixture} />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No results yet.</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ClubTeamProfile;
