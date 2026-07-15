import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRegisterRefresh } from "@/hooks/usePullToRefresh";
import { ArrowLeft, Check, Clock3, Link2, MapPin, MessageSquare, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import ProBadge from "@/components/ProBadge";
import { getIsPro } from "@/lib/subscriptions";
import { fetchRosterForTeam, TeamRosterPlayer } from "@/lib/teamMemberships";
import { fetchRosterForClubTeam } from "@/lib/clubTeams";
import {
  addMatchEvent,
  claimMatchAssist,
  createMatchFilmLink,
  createMatchComment,
  deleteMatch,
  deleteMatchComment,
  deleteMatchEvent,
  updateMatchDetails,
  updateMatchExtraDetails,
  fetchMatchAdminContext,
  fetchMatchPageData,
  formatMatchDateTime,
  MatchCommentRecord,
  MatchEventRecord,
  MatchFeedItem,
  MatchFilmLinkRecord,
  MatchReportRecord,
  removeMatchFilmLink,
  reviewMatchAssistClaim,
  saveMatchResult,
  updateMatchComment,
  uploadMatchReportImage,
} from "@/lib/matches";
import {
  fetchRefereeClaimsForMatch,
  fetchRefereeVerification,
  refereeRoleLabel,
  refereeVerificationLabel,
  RefereeMatchClaim,
  RefereeMatchRole,
  RefereeVerificationState,
  removeRefereeMatchAssignment,
  reviewRefereeMatchClaim,
  submitRefereeMatchClaim,
  updateRefereeMatchClaim,
} from "@/lib/referees";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import MatchTimeline from "@/components/matches/MatchTimeline";
import MatchEventAdmin from "@/components/matches/MatchEventAdmin";
import MatchdayMinutes from "@/components/matches/MatchdayMinutes";

const initialResultForm = {
  status: "completed",
  homeScore: "0",
  awayScore: "0",
  notes: "",
};

const initialEventForm = {
  teamId: "",
  eventType: "goal",
  playerProfileId: "",
  jerseyNumber: "",
  minute: "",
  started: "false",
};

const MatchDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [match, setMatch] = useState<MatchFeedItem | null>(null);
  const [events, setEvents] = useState<MatchEventRecord[]>([]);
  const [editingEvent, setEditingEvent] = useState<MatchEventRecord | null>(null);
  const [comments, setComments] = useState<MatchCommentRecord[]>([]);
  const [proCommentAuthors, setProCommentAuthors] = useState<Set<string>>(new Set());
  const [reports, setReports] = useState<MatchReportRecord[]>([]);
  const [assistClaims, setAssistClaims] = useState<any[]>([]);
  const [filmLinks, setFilmLinks] = useState<MatchFilmLinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminContext, setAdminContext] = useState({ isMatchAdmin: false, managedTeamIds: [] as string[], playerProfileId: null as string | null, linkedTeamId: null as string | null });
  const [homeRoster, setHomeRoster] = useState<TeamRosterPlayer[]>([]);
  const [awayRoster, setAwayRoster] = useState<TeamRosterPlayer[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState("");
  const [resultForm, setResultForm] = useState(initialResultForm);
  const [eventForm, setEventForm] = useState(initialEventForm);
  const [savingResult, setSavingResult] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  // Admin full-fixture edit + delete.
  const [editFixtureForm, setEditFixtureForm] = useState({
    scheduledAt: "", venue: "", venueAddress: "",
    matchWeek: "", groupName: "", knockoutRound: "", timezone: "",
    assistantReferee1: "", assistantReferee2: "", fourthOfficial: "", weather: "", attendance: "",
  });
  const [savingFixture, setSavingFixture] = useState(false);
  const [showDeleteFixture, setShowDeleteFixture] = useState(false);
  const [deletingFixture, setDeletingFixture] = useState(false);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [filmLinkUrl, setFilmLinkUrl] = useState("");
  const [filmLinkLabel, setFilmLinkLabel] = useState("");
  const [savingFilmLink, setSavingFilmLink] = useState(false);
  const [removingFilmLinkId, setRemovingFilmLinkId] = useState<string | null>(null);
  const [refereeClaims, setRefereeClaims] = useState<RefereeMatchClaim[]>([]);
  const [showRefereeClaimForm, setShowRefereeClaimForm] = useState(false);
  const [refereeVerification, setRefereeVerification] = useState<RefereeVerificationState | null>(null);
  const [showVerificationRequiredDialog, setShowVerificationRequiredDialog] = useState(false);
  const [refereeClaimRole, setRefereeClaimRole] = useState<RefereeMatchRole>("main_referee");
  const [refereeClaimPublicName, setRefereeClaimPublicName] = useState(true);
  const [refereeClaimProofFile, setRefereeClaimProofFile] = useState<File | null>(null);
  const [submittingRefereeClaim, setSubmittingRefereeClaim] = useState(false);
  const [reviewingRefereeClaimId, setReviewingRefereeClaimId] = useState<string | null>(null);
  const [removingRefereeClaimId, setRemovingRefereeClaimId] = useState<string | null>(null);

  const canManageMatch = adminContext.isMatchAdmin;
  const isFootyStatusAdmin = isFootyStatusSuperAdminEmail(user?.email || "") || isFootyStatusSuperAdminEmail(profile?.email || "");
  const isRefereeAccount = profile?.account_category === "referee" || profile?.account_role === "referee" || profile?.role === "referee";
  const ownRefereeClaim = useMemo(
    () => refereeClaims.find((claim) => claim.referee_user_id === user?.id) || null,
    [refereeClaims, user?.id]
  );
  const approvedRefereeClaims = useMemo(() => refereeClaims.filter((claim) => claim.status === "approved"), [refereeClaims]);
  const refereeSpotsFilled = useMemo(() => {
    const approvedMainReferees = approvedRefereeClaims.filter((claim) => claim.referee_type === "main_referee").length;
    const approvedAssistantReferees = approvedRefereeClaims.filter((claim) => claim.referee_type === "assistant_referee").length;
    return approvedMainReferees >= 1 && approvedAssistantReferees >= 2;
  }, [approvedRefereeClaims]);
  const canRequestRefereeSpot = isRefereeAccount && (!refereeSpotsFilled || Boolean(ownRefereeClaim));
  const isVerifiedReferee = refereeVerification?.status === "verified";

  useEffect(() => {
    if (!isRefereeAccount || !user?.id) {
      setRefereeVerification(null);
      return;
    }
    fetchRefereeVerification(user.id).then(setRefereeVerification);
  }, [isRefereeAccount, user?.id]);
  const canUploadRefereeReports = useMemo(() => {
    if (!match || !user?.id) return false;
    return adminContext.isMatchAdmin || match.referee_user_id === user.id || ownRefereeClaim?.status === "approved";
  }, [adminContext.isMatchAdmin, match, ownRefereeClaim?.status, user?.id]);

  const combinedRoster = useMemo(
    () =>
      [
        ...homeRoster.map((player) => ({ ...player, team_id: match?.home_team_id })),
        ...awayRoster.map((player) => ({ ...player, team_id: match?.away_team_id })),
      ].filter((player) => player.player_profile_id),
    [awayRoster, homeRoster, match?.away_team_id, match?.home_team_id]
  );
  const selectedTeamRoster = useMemo(() => {
    if (!match) return [];
    if (eventForm.teamId === match.home_team_id) return homeRoster;
    if (eventForm.teamId === match.away_team_id) return awayRoster;
    return [];
  }, [awayRoster, eventForm.teamId, homeRoster, match]);

  const loadMatch = async () => {
    if (!id) return;
    setLoading(true);

    const [pageData, context] = await Promise.all([fetchMatchPageData(id), fetchMatchAdminContext(user?.id || null, user?.email || null)]);
    setMatch(pageData.match);
    setEvents(pageData.events);
    setComments(pageData.comments);
    const commentUserIds = [...new Set(pageData.comments.map((comment) => comment.user_id).filter(Boolean))];
    if (commentUserIds.length) {
      const { data: authorProfiles } = await (supabase as any)
        .from("profiles")
        .select("user_id, account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
        .in("user_id", commentUserIds);
      setProCommentAuthors(new Set((authorProfiles || []).filter((profile: any) => getIsPro(profile)).map((profile: any) => profile.user_id)));
    } else {
      setProCommentAuthors(new Set());
    }
    setReports(pageData.reports);
    setAssistClaims(pageData.assistClaims);
    setFilmLinks(pageData.filmLinks);
    setAdminContext(context);

    const claimsRes = await fetchRefereeClaimsForMatch(id, context.isMatchAdmin || profile?.account_category === "referee" || profile?.account_role === "referee");
    setRefereeClaims(claimsRes.data);

    if (pageData.match?.home_team_id && pageData.match?.away_team_id) {
      const [home, away] = await Promise.all([
        pageData.match.home_club_team_id
          ? fetchRosterForClubTeam(pageData.match.home_club_team_id)
          : fetchRosterForTeam(pageData.match.home_team_id),
        pageData.match.away_club_team_id
          ? fetchRosterForClubTeam(pageData.match.away_club_team_id)
          : fetchRosterForTeam(pageData.match.away_team_id),
      ]);
      setHomeRoster(home);
      setAwayRoster(away);
      setEventForm((prev) => ({ ...prev, teamId: pageData.match?.home_team_id || prev.teamId }));
      setResultForm((prev) => ({
        ...prev,
        status: pageData.match?.status || "completed",
        homeScore: String(pageData.match?.home_score ?? 0),
        awayScore: String(pageData.match?.away_score ?? 0),
        notes: pageData.match?.notes || "",
      }));
      const m = pageData.match as any;
      setEditFixtureForm({
        scheduledAt: m?.scheduled_at ? new Date(m.scheduled_at).toISOString().slice(0, 16) : "",
        venue: m?.venue || "",
        venueAddress: m?.venue_address || "",
        matchWeek: m?.match_week || "",
        groupName: m?.group_name || "",
        knockoutRound: m?.knockout_round || "",
        timezone: m?.timezone || "",
        assistantReferee1: m?.assistant_referee_1 || "",
        assistantReferee2: m?.assistant_referee_2 || "",
        fourthOfficial: m?.fourth_official || "",
        weather: m?.weather || "",
        attendance: m?.attendance != null ? String(m.attendance) : "",
      });
    } else {
      setHomeRoster([]);
      setAwayRoster([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadMatch();
  }, [id, user?.id, profile?.account_category, profile?.account_role]);

  useRegisterRefresh(loadMatch);

  useEffect(() => {
    if (!ownRefereeClaim) return;
    setRefereeClaimRole(ownRefereeClaim.referee_type);
    setRefereeClaimPublicName(ownRefereeClaim.show_name_publicly);
  }, [ownRefereeClaim]);

  const groupedAssistsByGoalId = useMemo(() => {
    const map = new Map<string, MatchEventRecord[]>();
    events
      .filter((event) => event.event_type === "assist" && event.status === "approved")
      .forEach((event) => {
        const goalId = String(event.metadata?.goal_event_id || "");
        if (!goalId) return;
        map.set(goalId, [...(map.get(goalId) || []), event]);
      });
    return map;
  }, [events]);

  const pendingClaimsByGoalId = useMemo(() => {
    const map = new Map<string, any[]>();
    assistClaims
      .filter((claim) => claim.status === "pending")
      .forEach((claim) => {
        map.set(claim.goal_event_id, [...(map.get(claim.goal_event_id) || []), claim]);
      });
    return map;
  }, [assistClaims]);

  const handleAddComment = async () => {
    if (!id || !user?.id || !commentBody.trim()) return;
    const { error } = await createMatchComment(id, user.id, commentBody);
    if (error) {
      toast({ title: "Could not post comment", description: error.message, variant: "destructive" });
      return;
    }
    setCommentBody("");
    await loadMatch();
  };

  const handleSaveEditedComment = async () => {
    if (!editingCommentId || !editingCommentBody.trim()) return;
    const { error } = await updateMatchComment(editingCommentId, editingCommentBody);
    if (error) {
      toast({ title: "Could not update comment", description: error.message, variant: "destructive" });
      return;
    }
    setEditingCommentId(null);
    setEditingCommentBody("");
    await loadMatch();
  };

  const handleDeleteComment = async (commentId: string) => {
    const { error } = await deleteMatchComment(commentId);
    if (error) {
      toast({ title: "Could not delete comment", description: error.message, variant: "destructive" });
      return;
    }
    await loadMatch();
  };

  const handleSubmitRefereeClaim = async () => {
    // Verification is also enforced in the database; this guard just gives a
    // clear explanation before anything is submitted.
    if (!isVerifiedReferee) {
      setShowVerificationRequiredDialog(true);
      return;
    }

    if (!id || !user?.id || !refereeClaimProofFile) {
      toast({ title: "Proof required", description: "Upload proof that you are assigned to ref this match.", variant: "destructive" });
      return;
    }

    setSubmittingRefereeClaim(true);
    const result = ownRefereeClaim
      ? await updateRefereeMatchClaim({
          claimId: ownRefereeClaim.id,
          refereeType: refereeClaimRole,
          showNamePublicly: refereeClaimPublicName,
          proofFile: refereeClaimProofFile,
          userId: user.id,
          matchId: id,
        })
      : await submitRefereeMatchClaim({
          matchId: id,
          userId: user.id,
          refereeType: refereeClaimRole,
          showNamePublicly: refereeClaimPublicName,
          proofFile: refereeClaimProofFile,
        });

    if (result.error) {
      toast({ title: "Could not submit referee claim", description: result.error.message, variant: "destructive" });
    } else {
      toast({ title: "Submitted for review", description: "Footy Status will review your proof before attaching you to the match." });
      setShowRefereeClaimForm(false);
      setRefereeClaimProofFile(null);
      await loadMatch();
    }
    setSubmittingRefereeClaim(false);
  };

  const handleUpdateRefereePreference = async () => {
    if (!isVerifiedReferee) {
      setShowVerificationRequiredDialog(true);
      return;
    }
    if (!ownRefereeClaim || !id || !user?.id) return;
    setSubmittingRefereeClaim(true);
    const { error } = await updateRefereeMatchClaim({
      claimId: ownRefereeClaim.id,
      refereeType: refereeClaimRole,
      showNamePublicly: refereeClaimPublicName,
      proofFile: null,
      userId: user.id,
      matchId: id,
    });
    if (error) toast({ title: "Could not update referee details", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Referee details updated" });
      await loadMatch();
    }
    setSubmittingRefereeClaim(false);
  };

  const handleReviewRefereeClaim = async (claimId: string, approve: boolean) => {
    if (!user?.id) return;
    setReviewingRefereeClaimId(claimId);
    const { error } = await reviewRefereeMatchClaim({ claimId, reviewerUserId: user.id, approve });
    if (error) toast({ title: "Could not review referee claim", description: error.message, variant: "destructive" });
    else {
      toast({ title: approve ? "Referee approved" : "Referee removed" });
      await loadMatch();
    }
    setReviewingRefereeClaimId(null);
  };

  const handleRemoveRefereeAssignment = async (claim: RefereeMatchClaim, mode: "self" | "admin") => {
    if (!id) return;
    const confirmed = window.confirm(
      mode === "self"
        ? "Are you sure you want to leave this match? You will no longer be listed as a referee for this fixture."
        : "Are you sure you want to remove this referee from this match? They will no longer be linked to this fixture."
    );
    if (!confirmed) return;

    setRemovingRefereeClaimId(claim.id);
    const { error } = await removeRefereeMatchAssignment({ claimId: claim.id, matchId: id });
    if (error) {
      toast({
        title: mode === "self" ? "Could not leave match" : "Could not remove referee",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setRefereeClaims((claims) => claims.filter((item) => item.id !== claim.id));
      toast({ title: mode === "self" ? "You left this match" : "Referee removed from match" });
      await loadMatch();
    }
    setRemovingRefereeClaimId(null);
  };

  const handleOpenRefereeProof = async (proofPath?: string | null) => {
    if (!proofPath) return;
    const { data, error } = await supabase.storage.from("referee-proof").createSignedUrl(proofPath, 60);
    if (error || !data?.signedUrl) {
      toast({ title: "Could not open proof", description: error?.message || "Try again in a moment.", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleSaveResult = async () => {
    if (!id) return;
    setSavingResult(true);
    const { error } = await saveMatchResult({
      matchId: id,
      status: resultForm.status,
      homeScore: Number(resultForm.homeScore),
      awayScore: Number(resultForm.awayScore),
      notes: resultForm.notes,
    });
    if (error) {
      toast({ title: "Could not save result", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Match updated" });
      await loadMatch();
    }
    setSavingResult(false);
  };

  const handleSaveFixture = async () => {
    if (!id || !match) return;
    setSavingFixture(true);
    const core = await updateMatchDetails({
      matchId: id,
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      homeClubTeamId: (match as any).home_club_team_id || null,
      awayClubTeamId: (match as any).away_club_team_id || null,
      scheduledAt: editFixtureForm.scheduledAt ? new Date(editFixtureForm.scheduledAt).toISOString() : match.scheduled_at,
      venue: editFixtureForm.venue || null,
      venueAddress: editFixtureForm.venueAddress || null,
      homeJerseyColor: (match as any).home_jersey_color || null,
      awayJerseyColor: (match as any).away_jersey_color || null,
      notes: resultForm.notes || null,
      status: resultForm.status || null,
    });
    if (core.error) {
      setSavingFixture(false);
      toast({ title: "Could not save fixture", description: core.error.message, variant: "destructive" });
      return;
    }
    const extra = await updateMatchExtraDetails({
      matchId: id,
      matchWeek: editFixtureForm.matchWeek || null,
      groupName: editFixtureForm.groupName || null,
      knockoutRound: editFixtureForm.knockoutRound || null,
      timezone: editFixtureForm.timezone || null,
      assistantReferee1: editFixtureForm.assistantReferee1 || null,
      assistantReferee2: editFixtureForm.assistantReferee2 || null,
      fourthOfficial: editFixtureForm.fourthOfficial || null,
      weather: editFixtureForm.weather || null,
      attendance: editFixtureForm.attendance ? Number(editFixtureForm.attendance) : null,
    });
    setSavingFixture(false);
    if (extra.error) {
      toast({ title: "Could not save extra details", description: extra.error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Fixture updated" });
    await loadMatch();
  };

  const handleDeleteFixture = async () => {
    if (!id || !match) return;
    setDeletingFixture(true);
    const { error } = await deleteMatch(id);
    setDeletingFixture(false);
    if (error) {
      toast({ title: "Could not delete fixture", description: error.message, variant: "destructive" });
      return;
    }
    setShowDeleteFixture(false);
    toast({ title: "Fixture deleted", description: "It has been removed from all schedules." });
    navigate(match.league_id ? `/league/${match.league_id}` : "/");
  };

  const handleAddEvent = async () => {
    if (!id || !eventForm.teamId || !eventForm.eventType) return;
    setSavingEvent(true);
    const selectedPlayer = combinedRoster.find((player) => player.player_profile_id === eventForm.playerProfileId);
    const { error } = await addMatchEvent({
      matchId: id,
      teamId: eventForm.teamId,
      eventType: eventForm.eventType,
      playerProfileId: eventForm.playerProfileId || null,
      jerseyNumber: eventForm.jerseyNumber || selectedPlayer?.player_jersey_number || null,
      minute: eventForm.minute ? Number(eventForm.minute) : null,
      metadata: eventForm.eventType === "minutes_played" ? { started: eventForm.started === "true" } : {},
      source: adminContext.isMatchAdmin ? "manual_admin" : "manual_referee",
    });
    if (error) {
      toast({ title: "Could not add event", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Match event saved" });
      setEventForm((prev) => ({ ...prev, playerProfileId: "", jerseyNumber: "", minute: "", started: "false" }));
      await loadMatch();
    }
    setSavingEvent(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!canManageMatch) return;
    if (!window.confirm("Delete this match event? This cannot be undone and will update the score and player stats.")) {
      return;
    }
    if (editingEvent?.id === eventId) setEditingEvent(null);
    const { error } = await deleteMatchEvent(eventId);
    if (error) {
      toast({ title: "Could not remove event", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match event removed" });
    await loadMatch();
  };

  const handleUploadReports = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!id || !user?.id || !event.target.files?.length) return;
    setUploadingReport(true);
    const files = Array.from(event.target.files);
    for (const file of files) {
      const { error } = await uploadMatchReportImage({ matchId: id, userId: user.id, file });
      if (error) {
        toast({ title: "Could not upload report image", description: error.message, variant: "destructive" });
        setUploadingReport(false);
        return;
      }
    }
    toast({ title: "Referee images uploaded", description: "They’re ready for review and event entry." });
    event.target.value = "";
    await loadMatch();
    setUploadingReport(false);
  };

  const handleClaimAssist = async (goalEventId: string) => {
    const { error } = await claimMatchAssist(goalEventId);
    if (error) {
      toast({ title: "Could not claim assist", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Assist claim submitted" });
      await loadMatch();
    }
  };

  const handleReviewClaim = async (claimId: string, approve: boolean) => {
    const { error } = await reviewMatchAssistClaim(claimId, approve);
    if (error) {
      toast({ title: "Could not review assist claim", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Assist claim approved" : "Assist claim rejected" });
      await loadMatch();
    }
  };

  const handleSubmitFilmLink = async () => {
    if (!id || !user?.id || !filmLinkUrl.trim()) return;
    try {
      new URL(filmLinkUrl.trim());
    } catch {
      toast({ title: "Invalid link", description: "Please enter a full valid URL.", variant: "destructive" });
      return;
    }

    setSavingFilmLink(true);
    const { error } = await createMatchFilmLink({
      matchId: id,
      userId: user.id,
      url: filmLinkUrl,
      label: filmLinkLabel,
    });

    if (error) {
      toast({ title: "Could not submit film link", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Film link added" });
      setFilmLinkUrl("");
      setFilmLinkLabel("");
      await loadMatch();
    }
    setSavingFilmLink(false);
  };

  const handleRemoveFilmLink = async (linkId: string) => {
    if (!user?.id) return;
    setRemovingFilmLinkId(linkId);
    const { error } = await removeMatchFilmLink({ linkId, userId: user.id });
    if (error) {
      toast({ title: "Could not remove film link", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Film link removed" });
      await loadMatch();
    }
    setRemovingFilmLinkId(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="mb-6 h-8 w-28" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/?tab=matches")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Matches
        </button>
        <p className="mt-12 text-center text-muted-foreground">Match not found.</p>
      </div>
    );
  }

  const goalEvents = events.filter((event) => event.event_type === "goal" && event.status === "approved");
  const homeDestination = match.home_club_team_id ? `/club-team/${match.home_club_team_id}` : `/team/${match.home_team_id}`;
  const awayDestination = match.away_club_team_id ? `/club-team/${match.away_club_team_id}` : `/team/${match.away_team_id}`;

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <button onClick={() => navigate("/?tab=matches")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Matches
        </button>
      </header>

      <div className="space-y-6 p-4">
        <section className="rounded-2xl bg-gradient-to-br from-navy to-primary p-5 text-white">
          <p className="text-xs font-semibold tracking-wide text-white/70">{match.league_name || "League Match"}</p>
          <p className="mt-1 text-xs text-white/70">{[match.age_group, match.region, match.division || match.tier].filter(Boolean).join(" • ")}</p>
          <div className="mt-5 flex items-start justify-between gap-3">
            <button className="flex-1 text-center" onClick={() => navigate(homeDestination)}>
              {match.home_team_logo_url ? (
                <img src={match.home_team_logo_url} alt={match.home_team_name} className="mx-auto h-16 w-16 rounded-full border border-white/20 bg-white/10 object-cover" />
              ) : (
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xl font-bold text-white">
                  {match.home_team_name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <p className="mt-3 font-bold text-lg">{match.home_team_name}</p>
              <p className="text-xs text-white/70 mt-1">Home</p>
            </button>
            <div className="shrink-0 pt-6 text-center">
              <p className="text-4xl font-bold">
                {match.status === "scheduled" ? "vs" : `${match.home_score ?? 0}-${match.away_score ?? 0}`}
              </p>
              <p className="mt-2 text-sm font-semibold text-white/80">{match.status === "scheduled" ? formatMatchDateTime(match.scheduled_at) : match.status.toUpperCase()}</p>
            </div>
            <button className="flex-1 text-center" onClick={() => navigate(awayDestination)}>
              {match.away_team_logo_url ? (
                <img src={match.away_team_logo_url} alt={match.away_team_name} className="mx-auto h-16 w-16 rounded-full border border-white/20 bg-white/10 object-cover" />
              ) : (
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xl font-bold text-white">
                  {match.away_team_name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <p className="mt-3 font-bold text-lg">{match.away_team_name}</p>
              <p className="text-xs text-white/70 mt-1">Away</p>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs text-white/75">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {formatMatchDateTime(match.scheduled_at)}
            </span>
            {match.venue ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {match.venue}
              </span>
            ) : null}
            {match.venue_address ? <span>{match.venue_address}</span> : null}
            {match.home_jersey_color || match.away_jersey_color ? (
              <span>{[match.home_jersey_color ? `Home ${match.home_jersey_color}` : null, match.away_jersey_color ? `Away ${match.away_jersey_color}` : null].filter(Boolean).join(" • ")}</span>
            ) : null}
          </div>
          {match.notes ? (
            <div className="mt-4 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-center">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/65">MATCH NOTES</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/90">{match.notes}</p>
            </div>
          ) : null}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold tracking-wide text-navy">MATCH OFFICIALS</h2>
              <p className="text-sm text-muted-foreground">Approved referee assignments appear here.</p>
            </div>
            {canRequestRefereeSpot ? (
              <Button
                size="sm"
                onClick={() => {
                  if (!isVerifiedReferee) {
                    setShowVerificationRequiredDialog(true);
                    return;
                  }
                  setShowRefereeClaimForm((prev) => !prev);
                }}
              >
                I am reffing this game
              </Button>
            ) : null}
          </div>

          {approvedRefereeClaims.length ? (
            <div className="space-y-2">
              {approvedRefereeClaims.map((claim) => {
                const canSelfRemove = claim.referee_user_id === user?.id;
                const canAdminRemove = isFootyStatusAdmin && claim.referee_user_id !== user?.id;
                return (
                  <div key={claim.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{refereeRoleLabel(claim.referee_type)}</p>
                        {claim.show_name_publicly || canManageMatch || isFootyStatusAdmin ? (
                          <button
                            type="button"
                            className="text-left text-muted-foreground hover:text-navy hover:underline"
                            onClick={() => navigate(`/referee-profile/${claim.referee_user_id}`)}
                          >
                            {claim.referee_name || "Referee assigned"}
                          </button>
                        ) : (
                          <p className="text-muted-foreground">{`${refereeRoleLabel(claim.referee_type)} assigned`}</p>
                        )}
                        {canManageMatch && !claim.show_name_publicly ? (
                          <p className="mt-1 text-xs text-muted-foreground">Private on public fixture</p>
                        ) : null}
                      </div>
                      {canSelfRemove || canAdminRemove ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveRefereeAssignment(claim, canSelfRemove ? "self" : "admin")}
                          disabled={removingRefereeClaimId === claim.id}
                        >
                          {canSelfRemove ? "Leave Match" : "Remove Referee"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              No approved referee assignment yet.
            </div>
          )}

          {ownRefereeClaim ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-semibold text-foreground">Your referee request: {ownRefereeClaim.status.replaceAll("_", " ")}</p>
              {ownRefereeClaim.status === "denied" && ownRefereeClaim.review_notes ? (
                <p className="mt-1 text-muted-foreground">{ownRefereeClaim.review_notes}</p>
              ) : null}
            </div>
          ) : null}

          {isRefereeAccount && refereeSpotsFilled && !ownRefereeClaim ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              This fixture has no more referee spots available.
            </div>
          ) : null}

          {isRefereeAccount && !isVerifiedReferee ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-semibold text-foreground">Referee verification required</p>
              <p className="mt-1 text-muted-foreground">
                Only Footy Status Verified Referees can request or manage referee fixtures. Current status:{" "}
                <span className="font-semibold">{refereeVerificationLabel(refereeVerification?.status)}</span>
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate("/referee")}>
                View Verification Status
              </Button>
            </div>
          ) : null}

          {showRefereeClaimForm && canRequestRefereeSpot && isVerifiedReferee ? (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div>
                <Label>What type of referee are you?</Label>
                <select
                  value={refereeClaimRole}
                  onChange={(e) => setRefereeClaimRole(e.target.value as RefereeMatchRole)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="main_referee">Main referee</option>
                  <option value="assistant_referee">Assistant referee</option>
                  <option value="fourth_official">Fourth official / other staff</option>
                  <option value="other">Other match staff</option>
                </select>
              </div>

              <div>
                <Label>Show your name publicly?</Label>
                <select
                  value={refereeClaimPublicName ? "yes" : "no"}
                  onChange={(e) => setRefereeClaimPublicName(e.target.value === "yes")}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="yes">Yes, show my name publicly</option>
                  <option value="no">No, keep my name private</option>
                </select>
              </div>

              <div>
                <Label>Upload proof for this match</Label>
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setRefereeClaimProofFile(e.target.files?.[0] || null)}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">Screenshot, PDF, image, or assignment confirmation.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUpdateRefereePreference}
                  disabled={!ownRefereeClaim || submittingRefereeClaim}
                >
                  Save Preference
                </Button>
                <Button type="button" onClick={handleSubmitRefereeClaim} disabled={submittingRefereeClaim}>
                  {submittingRefereeClaim ? "Submitting..." : ownRefereeClaim ? "Resubmit Proof" : "Submit for Review"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <Dialog open={showDeleteFixture} onOpenChange={(open) => !open && setShowDeleteFixture(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete fixture?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete this fixture? This action cannot be undone. It will be removed
              from both teams' schedules and everywhere else on Footy Status.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteFixture(false)} disabled={deletingFixture}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteFixture} disabled={deletingFixture}>
                {deletingFixture ? "Deleting..." : "Delete Fixture"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showVerificationRequiredDialog} onOpenChange={setShowVerificationRequiredDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Referee Verification Required</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                To protect clubs, teams, and players, only Footy Status Verified Referees may request or manage referee
                fixtures.
              </p>
              <p className="text-muted-foreground">
                Please submit your referee certification and wait for approval before using referee match features.
              </p>
              <p>
                Status: <span className="font-semibold">{refereeVerificationLabel(refereeVerification?.status)}</span>
              </p>
              {refereeVerification?.note ? (
                <p className="text-muted-foreground">Footy Status note: {refereeVerification.note}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowVerificationRequiredDialog(false)}>
                Close
              </Button>
              <Button onClick={() => navigate("/referee")}>View Verification Status</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {match.home_possession != null || match.away_possession != null ? (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold tracking-wide text-navy">TEAM STATISTICS</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-muted/60 px-3 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{match.home_team_name}</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{match.home_possession ?? 0}%</p>
                <p className="text-xs text-muted-foreground">Possession</p>
              </div>
              <div className="rounded-lg bg-muted/60 px-3 py-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{match.away_team_name}</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{match.away_possession ?? 0}%</p>
                <p className="text-xs text-muted-foreground">Possession</p>
              </div>
            </div>
          </section>
        ) : null}

        {canManageMatch ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold tracking-wide text-navy">OFFICIAL RESULT</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <select
                  value={resultForm.status}
                  onChange={(e) => setResultForm((prev) => ({ ...prev, status: e.target.value }))}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                  <option value="postponed">Postponed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={resultForm.notes} onChange={(e) => setResultForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional note" />
              </div>
              <div>
                <Label>{match.home_team_name}</Label>
                <Input inputMode="numeric" value={resultForm.homeScore} onChange={(e) => setResultForm((prev) => ({ ...prev, homeScore: e.target.value }))} />
              </div>
              <div>
                <Label>{match.away_team_name}</Label>
                <Input inputMode="numeric" value={resultForm.awayScore} onChange={(e) => setResultForm((prev) => ({ ...prev, awayScore: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveResult} disabled={savingResult}>
              {savingResult ? "Saving..." : "Save Match Result"}
            </Button>
          </section>
        ) : null}

        {canManageMatch ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold tracking-wide text-navy">EDIT FIXTURE</h2>
            <div>
              <Label>Date / Time</Label>
              <Input type="datetime-local" value={editFixtureForm.scheduledAt} onChange={(e) => setEditFixtureForm((p) => ({ ...p, scheduledAt: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Venue</Label>
                <Input value={editFixtureForm.venue} onChange={(e) => setEditFixtureForm((p) => ({ ...p, venue: e.target.value }))} />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={editFixtureForm.timezone} onChange={(e) => setEditFixtureForm((p) => ({ ...p, timezone: e.target.value }))} placeholder="e.g. EST" />
              </div>
            </div>
            <div>
              <Label>Full Address</Label>
              <Input value={editFixtureForm.venueAddress} onChange={(e) => setEditFixtureForm((p) => ({ ...p, venueAddress: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Match Week</Label>
                <Input value={editFixtureForm.matchWeek} onChange={(e) => setEditFixtureForm((p) => ({ ...p, matchWeek: e.target.value }))} />
              </div>
              <div>
                <Label>Group</Label>
                <Input value={editFixtureForm.groupName} onChange={(e) => setEditFixtureForm((p) => ({ ...p, groupName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Knockout Round</Label>
                <Input value={editFixtureForm.knockoutRound} onChange={(e) => setEditFixtureForm((p) => ({ ...p, knockoutRound: e.target.value }))} />
              </div>
              <div>
                <Label>Attendance</Label>
                <Input inputMode="numeric" value={editFixtureForm.attendance} onChange={(e) => setEditFixtureForm((p) => ({ ...p, attendance: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Assistant Referee 1</Label>
                <Input value={editFixtureForm.assistantReferee1} onChange={(e) => setEditFixtureForm((p) => ({ ...p, assistantReferee1: e.target.value }))} />
              </div>
              <div>
                <Label>Assistant Referee 2</Label>
                <Input value={editFixtureForm.assistantReferee2} onChange={(e) => setEditFixtureForm((p) => ({ ...p, assistantReferee2: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fourth Official</Label>
                <Input value={editFixtureForm.fourthOfficial} onChange={(e) => setEditFixtureForm((p) => ({ ...p, fourthOfficial: e.target.value }))} />
              </div>
              <div>
                <Label>Weather</Label>
                <Input value={editFixtureForm.weather} onChange={(e) => setEditFixtureForm((p) => ({ ...p, weather: e.target.value }))} />
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveFixture} disabled={savingFixture}>
              {savingFixture ? "Saving..." : "Save Fixture Details"}
            </Button>
            <Button variant="destructive" className="w-full" onClick={() => setShowDeleteFixture(true)}>
              Delete Fixture
            </Button>
          </section>
        ) : null}

        {canManageMatch ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold tracking-wide text-navy">REFEREE CLAIM REVIEW</h2>
            {refereeClaims.length ? (
              <div className="space-y-3">
                {refereeClaims.map((claim) => {
                  const isPending = claim.status === "pending";
                  return (
                  <div key={claim.id} className="space-y-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="font-semibold text-foreground">{claim.referee_name || "Referee"}</p>
                      <p className="text-sm text-muted-foreground">
                        {refereeRoleLabel(claim.referee_type)} • {claim.show_name_publicly ? "Public name" : "Private name"} • {claim.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {claim.proof_url ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => handleOpenRefereeProof(claim.proof_url)}>
                          View Proof
                        </Button>
                      ) : null}
                      {isPending ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleReviewRefereeClaim(claim.id, true)}
                          disabled={reviewingRefereeClaimId === claim.id}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {isPending ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleReviewRefereeClaim(claim.id, false)}
                          disabled={reviewingRefereeClaimId === claim.id}
                        >
                          Dismiss
                        </Button>
                      ) : isFootyStatusAdmin ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemoveRefereeAssignment(claim, "admin")}
                          disabled={removingRefereeClaimId === claim.id}
                        >
                          Remove Referee
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No referee claims yet.
              </div>
            )}
          </section>
        ) : null}

        {canUploadRefereeReports ? (
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold tracking-wide text-navy">REFEREE REPORT UPLOADS</h2>
                <p className="text-sm text-muted-foreground">Upload booklet images, then review and enter official events.</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-navy px-3 py-2 text-sm font-medium text-white">
                <Upload className="h-4 w-4" />
                Upload
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleUploadReports} />
              </label>
            </div>
            {reports.length ? (
              <div className="space-y-3">
                {reports.map((report) => (
                  <div key={report.id} className="rounded-xl border border-border p-3">
                    <a href={report.image_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
                      <img src={report.image_url} alt="Referee report" className="h-40 w-full object-cover" />
                    </a>
                    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium capitalize text-foreground">{report.parsing_status.replaceAll("_", " ")}</span>
                      <span className="text-muted-foreground">{formatMatchDateTime(report.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No referee report uploaded yet.
              </div>
            )}
          </section>
        ) : null}

        {canManageMatch ? (
          <MatchEventAdmin
            matchId={id || ""}
            homeTeamId={match.home_team_id}
            awayTeamId={match.away_team_id}
            homeTeamName={match.home_team_name}
            awayTeamName={match.away_team_name}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
            editingEvent={editingEvent}
            onClearEditing={() => setEditingEvent(null)}
            onSaved={loadMatch}
          />
        ) : null}

        {canManageMatch ? (
          <MatchdayMinutes
            matchId={id || ""}
            homeTeamId={match.home_team_id}
            awayTeamId={match.away_team_id}
            homeTeamName={match.home_team_name}
            awayTeamName={match.away_team_name}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
            events={events}
            durationMinutes={(match as any).duration_minutes}
            onChanged={loadMatch}
          />
        ) : null}

        <MatchTimeline
          events={events}
          homeTeamId={match.home_team_id}
          awayTeamId={match.away_team_id}
          homeTeamName={match.home_team_name}
          awayTeamName={match.away_team_name}
          groupedAssistsByGoalId={groupedAssistsByGoalId}
          canManageMatch={canManageMatch}
          onDeleteEvent={handleDeleteEvent}
          onEditEvent={canManageMatch ? setEditingEvent : undefined}
          onClaimAssist={handleClaimAssist}
          canClaimAssist={(event) => {
            const attachedAssists = groupedAssistsByGoalId.get(event.id) || [];
            return Boolean(
              event.event_type === "goal" &&
                adminContext.playerProfileId &&
                adminContext.linkedTeamId === event.team_id &&
                event.player_profile_id !== adminContext.playerProfileId &&
                !pendingClaimsByGoalId
                  .get(event.id)
                  ?.some((claim) => claim.claimant_player_profile_id === adminContext.playerProfileId) &&
                !attachedAssists.some((assist) => assist.player_profile_id === adminContext.playerProfileId),
            );
          }}
        />

        {(assistClaims.length || canManageMatch) ? (
          <section className="space-y-3">
            <h2 className="text-sm font-bold tracking-wide text-navy">ASSIST CLAIMS</h2>
            {assistClaims.length ? (
              <div className="space-y-3">
                {assistClaims.map((claim) => (
                  <div key={claim.id} className="rounded-xl border border-border bg-card p-4">
                    <p className="font-medium text-foreground">Pending assist claim</p>
                    <p className="text-sm text-muted-foreground mt-1">Goal event {claim.goal_event_id.slice(0, 8)} • status: {claim.status}</p>
                    {canManageMatch && claim.status === "pending" ? (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => handleReviewClaim(claim.id, true)}>
                          <Check className="mr-1 h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleReviewClaim(claim.id, false)}>
                          <X className="mr-1 h-4 w-4" /> Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No assist claims yet.</div>
            )}
          </section>
        ) : null}

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold tracking-wide text-navy">TEAM ROSTERS</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">{match.home_team_name}</p>
              {homeRoster.length ? (
                homeRoster.map((player) => (
                  <button
                    key={player.player_profile_id}
                    type="button"
                    onClick={() => navigate(`/player/${player.player_profile_id}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/70 px-3 py-3 text-left transition hover:border-navy/30 hover:bg-muted/40"
                  >
                    {player.player_profile_image_url ? (
                      <img
                        src={player.player_profile_image_url}
                        alt={player.player_name}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                        {(player.player_name || "P").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{player.player_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[player.player_position, player.player_jersey_number ? `#${player.player_jersey_number}` : null].filter(Boolean).join(" • ") || "Rostered player"}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                  No roster added yet.
                </div>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">{match.away_team_name}</p>
              {awayRoster.length ? (
                awayRoster.map((player) => (
                  <button
                    key={player.player_profile_id}
                    type="button"
                    onClick={() => navigate(`/player/${player.player_profile_id}`)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/70 px-3 py-3 text-left transition hover:border-navy/30 hover:bg-muted/40"
                  >
                    {player.player_profile_image_url ? (
                      <img
                        src={player.player_profile_image_url}
                        alt={player.player_name}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                        {(player.player_name || "P").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{player.player_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[player.player_position, player.player_jersey_number ? `#${player.player_jersey_number}` : null].filter(Boolean).join(" • ") || "Rostered player"}
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                  No roster added yet.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">MATCH FILM</h2>
          </div>
          {user?.id ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background p-3">
              <Input value={filmLinkUrl} onChange={(e) => setFilmLinkUrl(e.target.value)} placeholder="https://youtube.com/..." />
              <Input value={filmLinkLabel} onChange={(e) => setFilmLinkLabel(e.target.value)} placeholder="Optional label" />
              <Button onClick={handleSubmitFilmLink} disabled={savingFilmLink || !filmLinkUrl.trim()} className="w-full">
                {savingFilmLink ? "Submitting..." : "Submit Film Link"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sign in to submit a film link for this match.</p>
          )}
          {filmLinks.length ? (
            <div className="space-y-3">
              {filmLinks.map((link) => {
                const canRemoveLink = canManageMatch || link.submitted_by_user_id === user?.id;
                return (
                  <div key={link.id} className="rounded-lg border border-border px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a href={link.url} target="_blank" rel="noreferrer" className="font-medium text-navy underline-offset-4 hover:underline break-all">
                          {link.label || link.url}
                        </a>
                        <p className="mt-1 text-xs text-muted-foreground">{formatMatchDateTime(link.created_at)}</p>
                      </div>
                      {canRemoveLink ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveFilmLink(link.id)}
                          disabled={removingFilmLinkId === link.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No film links have been submitted yet.
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">COMMENTS</h2>
          </div>
          {user?.id ? (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <Textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Share your thoughts on the match" className="min-h-[90px]" />
              <Button onClick={handleAddComment} disabled={!commentBody.trim()}>
                Post Comment
              </Button>
            </div>
          ) : null}
          {comments.length ? (
            <div className="space-y-3">
              {comments.map((comment) => {
                const canEdit = comment.user_id === user?.id;
                const canDelete = canEdit || adminContext.isMatchAdmin;
                return (
                  <div key={comment.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-foreground">{comment.author_name}</p>
                          {proCommentAuthors.has(comment.user_id) ? <ProBadge compact /> : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{formatMatchDateTime(comment.created_at)}</p>
                      </div>
                      <div className="flex gap-2">
                        {canEdit ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditingCommentBody(comment.body);
                            }}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteComment(comment.id)}>
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {editingCommentId === comment.id ? (
                      <div className="mt-3 space-y-3">
                        <Textarea value={editingCommentBody} onChange={(e) => setEditingCommentBody(e.target.value)} className="min-h-[80px]" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEditedComment}>Save</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingCommentId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-foreground whitespace-pre-wrap">{comment.body}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No comments yet.</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default MatchDetails;
