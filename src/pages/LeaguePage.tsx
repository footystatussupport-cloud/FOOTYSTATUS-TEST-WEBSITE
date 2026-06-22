import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Pencil, Plus, Search, Shield, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import MatchCard from "@/components/MatchCard";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  assignClubTeamToLeague,
  assignTeamToLeague,
  createLeagueFixture,
  fetchApprovedTeamsForLeagueAssignment,
  fetchLeaguePageData,
  fetchMatchAdminContext,
  formatLeagueSubtitle,
  LeagueRecord,
  LeagueStandingRow,
  MatchFeedItem,
  removeClubTeamFromLeague,
  removeTeamFromLeague,
  updateLeague,
} from "@/lib/matches";
import { supabase } from "@/integrations/supabase/client";

const initialFixtureForm = {
  homeSelectionId: "",
  awaySelectionId: "",
  scheduledAt: "",
  venue: "",
  venueAddress: "",
  homeJerseyColor: "",
  awayJerseyColor: "",
  notes: "",
};

const initialLeagueEditForm = {
  name: "",
  governing_body: "",
  age_group: "",
  region: "",
  season: "",
  division: "",
  tier: "",
  gender_category: "",
  status: "active",
};

const LeaguePage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [league, setLeague] = useState<LeagueRecord | null>(null);
  const [standings, setStandings] = useState<LeagueStandingRow[]>([]);
  const [matches, setMatches] = useState<MatchFeedItem[]>([]);
  const [leagueTeams, setLeagueTeams] = useState<any[]>([]);
  const [assignableTeams, setAssignableTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMatchAdmin, setIsMatchAdmin] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showFixtureDialog, setShowFixtureDialog] = useState(false);
  const [showEditLeagueDialog, setShowEditLeagueDialog] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [assignTeamQuery, setAssignTeamQuery] = useState("");
  const [fixtureForm, setFixtureForm] = useState(initialFixtureForm);
  const [leagueEditForm, setLeagueEditForm] = useState(initialLeagueEditForm);
  const [submitting, setSubmitting] = useState(false);

  const upcomingMatches = useMemo(() => matches.filter((match) => match.status === "scheduled" || match.status === "live"), [matches]);
  const completedMatches = useMemo(
    () =>
      matches
        .filter((match) => match.status === "completed" || match.status === "postponed" || match.status === "cancelled")
        .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime()),
    [matches]
  );
  const subTeamByParentTeamId = useMemo(() => {
    const nextMap = new Map<string, any>();
    leagueTeams.forEach((row: any) => {
      if (row.team_id && row.id && String(row.id) !== String(row.team_id) && !nextMap.has(row.team_id)) {
        nextMap.set(row.team_id, row);
      }
    });
    return nextMap;
  }, [leagueTeams]);
  const getTeamDestination = (teamId: string, clubTeamId?: string | null) => {
    if (clubTeamId) return `/club-team/${clubTeamId}`;
    const subTeam = subTeamByParentTeamId.get(teamId);
    return subTeam ? `/club-team/${subTeam.id}` : `/team/${teamId}`;
  };
  const filteredAssignableTeams = useMemo(() => {
    const query = assignTeamQuery.trim().toLowerCase();
    if (!query) return assignableTeams;
    return assignableTeams.filter((team: any) => {
      const searchable = [team.name, team.age_group, team.league_name, team.region].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [assignTeamQuery, assignableTeams]);
  const fixtureTeamOptions = useMemo(
    () =>
      leagueTeams
        .map((row: any) => ({
          selectionId: row.club_team_id || row.team_id,
          teamId: row.team_id,
          clubTeamId: row.club_team_id || null,
          label: [row.teams?.name || "Team", row.teams?.age_group || null, row.teams?.league_name || null].filter(Boolean).join(" • "),
        }))
        .filter((row: any) => row.selectionId && row.teamId),
    [leagueTeams]
  );

  const loadLeague = async () => {
    if (!id) return;
    setLoading(true);

    const [{ league, standings, matches, teams }, adminContext] = await Promise.all([
      fetchLeaguePageData(id),
      fetchMatchAdminContext(user?.id || null, user?.email || null),
    ]);

    setLeague(league);
    setStandings(standings);
    setMatches(matches);
    setLeagueTeams(teams);
    setIsMatchAdmin(adminContext.isMatchAdmin);

    if (league && adminContext.isMatchAdmin) {
      const approved = await fetchApprovedTeamsForLeagueAssignment(league);
      const assignedTeamKeys = new Set(
        (teams || []).map((row: any) => row.club_team_id || row.team_id).filter(Boolean)
      );
      setAssignableTeams(
        approved.filter((team: any) => !assignedTeamKeys.has(team.club_team_id || team.team_id))
      );
    } else {
      setAssignableTeams([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadLeague();
  }, [id, user?.id]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`league-live-sync-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => loadLeague())
      .on("postgres_changes", { event: "*", schema: "public", table: "league_teams" }, () => loadLeague())
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => loadLeague())
      .on("postgres_changes", { event: "*", schema: "public", table: "club_teams" }, () => loadLeague())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!league) return;
    setLeagueEditForm({
      name: league.name || "",
      governing_body: league.governing_body || "",
      age_group: league.age_group || "",
      region: league.region || "",
      season: league.season || "",
      division: league.division || "",
      tier: league.tier || "",
      gender_category: league.gender_category || "",
      status: league.status || "active",
    });
  }, [league]);

  const handleAssignTeam = async () => {
    if (!id || !selectedTeamId) return;
    const selectedTeam = assignableTeams.find((team: any) => team.id === selectedTeamId);
    setSubmitting(true);
    const { error } = selectedTeam?.club_team_id
      ? await assignClubTeamToLeague(id, selectedTeam.club_team_id)
      : await assignTeamToLeague(id, selectedTeam?.team_id || selectedTeamId);
    if (error) {
      toast({ title: "Could not assign team", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Team assigned" });
      setSelectedTeamId("");
      setAssignTeamQuery("");
      setShowAssignDialog(false);
      await loadLeague();
    }
    setSubmitting(false);
  };

  const handleRemoveTeam = async (row: any) => {
    if (!id) return;
    const { error } = row?.club_team_id
      ? await removeClubTeamFromLeague(id, row.club_team_id)
      : await removeTeamFromLeague(id, row.team_id);
    if (error) {
      toast({ title: "Could not remove team", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Team removed from league" });
      await loadLeague();
    }
  };

  const handleCreateFixture = async () => {
    if (!id || !fixtureForm.homeSelectionId || !fixtureForm.awaySelectionId || !fixtureForm.scheduledAt) {
      toast({ title: "Missing fixture details", variant: "destructive" });
      return;
    }

    if (fixtureForm.homeSelectionId === fixtureForm.awaySelectionId) {
      toast({ title: "Teams must be different", variant: "destructive" });
      return;
    }

    const homeTeam = fixtureTeamOptions.find((team) => team.selectionId === fixtureForm.homeSelectionId);
    const awayTeam = fixtureTeamOptions.find((team) => team.selectionId === fixtureForm.awaySelectionId);

    if (!homeTeam || !awayTeam) {
      toast({ title: "Could not resolve fixture teams", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { error } = await createLeagueFixture({
      leagueId: id,
      homeTeamId: homeTeam.teamId,
      awayTeamId: awayTeam.teamId,
      homeClubTeamId: homeTeam.clubTeamId,
      awayClubTeamId: awayTeam.clubTeamId,
      scheduledAt: new Date(fixtureForm.scheduledAt).toISOString(),
      venue: fixtureForm.venue,
      venueAddress: fixtureForm.venueAddress,
      homeJerseyColor: fixtureForm.homeJerseyColor,
      awayJerseyColor: fixtureForm.awayJerseyColor,
      notes: fixtureForm.notes,
    });

    if (error) {
      toast({ title: "Could not create fixture", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Fixture created" });
      setFixtureForm(initialFixtureForm);
      setShowFixtureDialog(false);
      await loadLeague();
    }
    setSubmitting(false);
  };

  const handleUpdateLeague = async () => {
    if (!id || !leagueEditForm.name.trim()) {
      toast({ title: "League name required", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    const { error } = await updateLeague(id, {
      name: leagueEditForm.name.trim(),
      governing_body: leagueEditForm.governing_body.trim() || null,
      age_group: leagueEditForm.age_group.trim() || null,
      region: leagueEditForm.region.trim() || null,
      season: leagueEditForm.season.trim() || null,
      division: leagueEditForm.division.trim() || null,
      tier: leagueEditForm.tier.trim() || null,
      gender_category: leagueEditForm.gender_category.trim() || null,
      status: leagueEditForm.status,
    });

    if (error) {
      toast({ title: "Could not update league", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "League updated" });
      setShowEditLeagueDialog(false);
      await loadLeague();
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/?tab=matches")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Matches
        </button>
        <p className="mt-12 text-center text-muted-foreground">League not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <button onClick={() => navigate("/?tab=matches")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Matches
        </button>
      </header>

      <div className="space-y-6 p-4">
        <section className="rounded-xl border border-border bg-card p-5 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-navy/10">
            <Trophy className="h-8 w-8 text-navy" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{league.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{formatLeagueSubtitle(league) || "League details"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{[league.governing_body, league.season].filter(Boolean).join(" • ")}</p>
        </section>

        {isMatchAdmin ? (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Dialog open={showEditLeagueDialog} onOpenChange={setShowEditLeagueDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Pencil className="h-4 w-4" /> Edit League
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit League</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>League Name</Label>
                    <Input value={leagueEditForm.name} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Age Group</Label>
                      <Input value={leagueEditForm.age_group} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, age_group: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Region</Label>
                      <Input value={leagueEditForm.region} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, region: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Season</Label>
                      <Input value={leagueEditForm.season} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, season: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Division</Label>
                      <Input value={leagueEditForm.division} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, division: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Tier</Label>
                      <Input value={leagueEditForm.tier} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, tier: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Gender</Label>
                      <Input value={leagueEditForm.gender_category} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, gender_category: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Governing Label</Label>
                    <Input value={leagueEditForm.governing_body} onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, governing_body: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select
                      value={leagueEditForm.status}
                      onChange={(e) => setLeagueEditForm((prev) => ({ ...prev, status: e.target.value }))}
                      className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <Button className="w-full" onClick={handleUpdateLeague} disabled={submitting}>
                    {submitting ? "Saving..." : "Save League Changes"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Users className="h-4 w-4" /> Assign Team
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Assign Approved Team</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Search approved teams</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={assignTeamQuery}
                        onChange={(e) => setAssignTeamQuery(e.target.value)}
                        placeholder="Search any team, age group, or league"
                        className="pl-9"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Link the exact approved team and age group into this league.
                    </p>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border p-2">
                    {filteredAssignableTeams.length ? (
                      filteredAssignableTeams.map((team: any) => {
                        const isSelected = selectedTeamId === team.id;
                        return (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => setSelectedTeamId(team.id)}
                            className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                              isSelected
                                ? "border-navy bg-navy/5"
                                : "border-border bg-background hover:bg-muted"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{team.name}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {[
                                    team.age_group || "No age group",
                                    team.league_name || null,
                                    team.approval_status === "approved" ? "Approved" : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" • ")}
                                </p>
                              </div>
                              {isSelected ? (
                                <span className="shrink-0 rounded-full bg-navy px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                  Selected
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                        No approved teams match that search yet.
                      </div>
                    )}
                  </div>
                  <Button className="w-full" onClick={handleAssignTeam} disabled={submitting || !selectedTeamId}>
                    {submitting ? "Assigning..." : "Assign Team"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showFixtureDialog} onOpenChange={setShowFixtureDialog}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" /> Fixture
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Fixture</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Home Team</Label>
                    <select
                      value={fixtureForm.homeSelectionId}
                      onChange={(e) => setFixtureForm((prev) => ({ ...prev, homeSelectionId: e.target.value }))}
                      className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select home team</option>
                      {fixtureTeamOptions.map((team) => (
                        <option key={team.selectionId} value={team.selectionId}>
                          {team.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Away Team</Label>
                    <select
                      value={fixtureForm.awaySelectionId}
                      onChange={(e) => setFixtureForm((prev) => ({ ...prev, awaySelectionId: e.target.value }))}
                      className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select away team</option>
                      {fixtureTeamOptions.map((team) => (
                        <option key={team.selectionId} value={team.selectionId}>
                          {team.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Date / Time</Label>
                    <Input type="datetime-local" value={fixtureForm.scheduledAt} onChange={(e) => setFixtureForm((prev) => ({ ...prev, scheduledAt: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Venue</Label>
                    <Input value={fixtureForm.venue} onChange={(e) => setFixtureForm((prev) => ({ ...prev, venue: e.target.value }))} placeholder="Main Stadium" />
                  </div>
                  <div>
                    <Label>Full Address</Label>
                    <Input
                      value={fixtureForm.venueAddress}
                      onChange={(e) => setFixtureForm((prev) => ({ ...prev, venueAddress: e.target.value }))}
                      placeholder="123 Main St, City, State"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Home Jersey</Label>
                      <Input
                        value={fixtureForm.homeJerseyColor}
                        onChange={(e) => setFixtureForm((prev) => ({ ...prev, homeJerseyColor: e.target.value }))}
                        placeholder="White"
                      />
                    </div>
                    <div>
                      <Label>Away Jersey</Label>
                      <Input
                        value={fixtureForm.awayJerseyColor}
                        onChange={(e) => setFixtureForm((prev) => ({ ...prev, awayJerseyColor: e.target.value }))}
                        placeholder="Blue"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input value={fixtureForm.notes} onChange={(e) => setFixtureForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional note" />
                  </div>
                  <Button className="w-full" onClick={handleCreateFixture} disabled={submitting}>
                    {submitting ? "Creating..." : "Create Fixture"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">STANDINGS</h2>
          </div>
          {standings.length ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="grid grid-cols-[32px_1fr_32px_32px_32px_32px_44px_44px] gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>#</span>
                <span>Team</span>
                <span className="text-center">P</span>
                <span className="text-center">W</span>
                <span className="text-center">D</span>
                <span className="text-center">L</span>
                <span className="text-center">GD</span>
                <span className="text-center">Pts</span>
              </div>
              {standings.map((row) => (
                <button
                  key={row.team_id}
                  onClick={() => navigate(getTeamDestination(row.team_id, (row as any).club_team_id || null))}
                  className="grid w-full grid-cols-[32px_1fr_32px_32px_32px_32px_44px_44px] gap-2 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted"
                >
                  <span className="font-semibold text-navy">{row.position}</span>
                  <span className="truncate font-medium text-foreground">{subTeamByParentTeamId.get(row.team_id)?.teams?.name || row.team_name}</span>
                  <span className="text-center text-sm text-muted-foreground">{row.played}</span>
                  <span className="text-center text-sm">{row.wins}</span>
                  <span className="text-center text-sm">{row.draws}</span>
                  <span className="text-center text-sm">{row.losses}</span>
                  <span className="text-center text-sm">{row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference}</span>
                  <span className="text-center font-semibold text-foreground">{row.points}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No standings yet.</div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">TEAMS</h2>
          </div>
          {leagueTeams.length ? (
            <div className="space-y-2">
              {leagueTeams.map((row: any) => (
                <div key={row.id || row.team_id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <button
                    onClick={() => navigate(row.id && String(row.id) !== String(row.team_id) ? `/club-team/${row.id}` : `/team/${row.team_id}`)}
                    className="min-w-0 flex items-center gap-3 text-left"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted flex items-center justify-center">
                      {row.teams?.logo_url ? (
                        <img src={row.teams.logo_url} alt={row.teams?.name || "Team"} className="h-full w-full object-cover" />
                      ) : (
                        <Shield className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{row.teams?.name || "Team"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[row.teams?.league_name || null, row.teams?.age_group || league.age_group || "Assigned squad"]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>
                  </button>
                  {isMatchAdmin ? (
                    <Button size="sm" variant="outline" onClick={() => handleRemoveTeam(row)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
              No approved teams assigned yet.
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">MATCHES & RESULTS</h2>
          </div>

          {upcomingMatches.length ? (
            <div className="space-y-3">
              {upcomingMatches.map((match) => (
                <button key={match.id} onClick={() => navigate(`/match/${match.id}`)} className="w-full text-left">
                  <MatchCard match={match} />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">No matches yet.</div>
          )}

          {completedMatches.length ? (
            <div className="space-y-3">
              {completedMatches.map((match) => (
                <button key={match.id} onClick={() => navigate(`/match/${match.id}`)} className="w-full text-left">
                  <MatchCard match={match} />
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

export default LeaguePage;
