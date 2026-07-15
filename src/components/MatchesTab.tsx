import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRegisterRefresh } from "@/hooks/usePullToRefresh";
import { CalendarDays, Plus, Shield, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import MatchCard from "@/components/MatchCard";
import {
  createLeague,
  fetchMatchAdminContext,
  fetchMatchesHomeData,
  formatLeagueSubtitle,
  updateLeague,
  uploadLeagueLogo,
  LeagueRecord,
  MatchFeedItem,
} from "@/lib/matches";

const initialLeagueForm = {
  name: "",
  governing_body: "",
  age_group: "",
  region: "",
  season: "",
  division: "",
  tier: "",
  gender_category: "",
};

const MatchesTab = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [leagues, setLeagues] = useState<LeagueRecord[]>([]);
  const [liveMatches, setLiveMatches] = useState<MatchFeedItem[]>([]);
  const [upcomingMatches, setUpcomingMatches] = useState<MatchFeedItem[]>([]);
  const [recentResults, setRecentResults] = useState<MatchFeedItem[]>([]);
  const [isMatchAdmin, setIsMatchAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creatingLeague, setCreatingLeague] = useState(false);
  const [showCreateLeague, setShowCreateLeague] = useState(false);
  const [leagueForm, setLeagueForm] = useState(initialLeagueForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const onPickLogo = (file: File | null) => {
    setLogoFile(file);
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const featuredLeagues = useMemo(() => leagues.slice(0, 6), [leagues]);

  const loadMatchesHome = async () => {
    setLoading(true);
    const [{ leagues, liveMatches, upcomingMatches, recentResults }, adminContext] = await Promise.all([
      fetchMatchesHomeData(),
      fetchMatchAdminContext(user?.id || null, user?.email || null),
    ]);

    setLeagues(leagues);
    setLiveMatches(liveMatches);
    setUpcomingMatches(upcomingMatches);
    setRecentResults(recentResults);
    setIsMatchAdmin(adminContext.isMatchAdmin);
    setLoading(false);
  };

  useEffect(() => {
    loadMatchesHome();
  }, [user?.id]);

  useRegisterRefresh(loadMatchesHome);

  const handleCreateLeague = async () => {
    if (!leagueForm.name.trim()) {
      toast({ title: "League name required", variant: "destructive" });
      return;
    }

    setCreatingLeague(true);
    const { data: created, error } = await createLeague({
      name: leagueForm.name.trim(),
      governing_body: leagueForm.governing_body.trim() || null,
      age_group: leagueForm.age_group.trim() || null,
      region: leagueForm.region.trim() || null,
      season: leagueForm.season.trim() || null,
      division: leagueForm.division.trim() || null,
      tier: leagueForm.tier.trim() || null,
      gender_category: leagueForm.gender_category.trim() || null,
    });

    if (error || !created) {
      toast({ title: "Could not create league", description: error?.message, variant: "destructive" });
      setCreatingLeague(false);
      return;
    }

    // Upload the logo (if chosen) to the new league's folder, then save the URL.
    if (logoFile) {
      try {
        const logoUrl = await uploadLeagueLogo(created.id, logoFile);
        await updateLeague(created.id, { name: created.name, logo_url: logoUrl });
      } catch (uploadError: any) {
        toast({ title: "League created, but the logo failed to upload", description: uploadError?.message, variant: "destructive" });
      }
    }

    toast({ title: "League created" });
    setLeagueForm(initialLeagueForm);
    onPickLogo(null);
    setShowCreateLeague(false);
    await loadMatchesHome();
    setCreatingLeague(false);
  };

  return (
    <div className="px-4 py-6 space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold tracking-wide text-navy">LEAGUES</h2>
            <p className="text-sm text-muted-foreground">Real league tables, matches, and results.</p>
          </div>
          {isMatchAdmin ? (
            <Dialog open={showCreateLeague} onOpenChange={setShowCreateLeague}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" /> League
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create League</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>League Name</Label>
                    <Input value={leagueForm.name} onChange={(e) => setLeagueForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="U12 North Jersey" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Age Group</Label>
                      <Input value={leagueForm.age_group} onChange={(e) => setLeagueForm((prev) => ({ ...prev, age_group: e.target.value }))} placeholder="U12" />
                    </div>
                    <div>
                      <Label>Region</Label>
                      <Input value={leagueForm.region} onChange={(e) => setLeagueForm((prev) => ({ ...prev, region: e.target.value }))} placeholder="North Jersey" />
                    </div>
                    <div>
                      <Label>Season</Label>
                      <Input value={leagueForm.season} onChange={(e) => setLeagueForm((prev) => ({ ...prev, season: e.target.value }))} placeholder="2026 Spring" />
                    </div>
                    <div>
                      <Label>Division</Label>
                      <Input value={leagueForm.division} onChange={(e) => setLeagueForm((prev) => ({ ...prev, division: e.target.value }))} placeholder="Premier" />
                    </div>
                    <div>
                      <Label>Tier</Label>
                      <Input value={leagueForm.tier} onChange={(e) => setLeagueForm((prev) => ({ ...prev, tier: e.target.value }))} placeholder="Tier 1" />
                    </div>
                    <div>
                      <Label>Gender</Label>
                      <Input value={leagueForm.gender_category} onChange={(e) => setLeagueForm((prev) => ({ ...prev, gender_category: e.target.value }))} placeholder="Boys" />
                    </div>
                  </div>
                  <div>
                    <Label>Governing Label</Label>
                    <Input value={leagueForm.governing_body} onChange={(e) => setLeagueForm((prev) => ({ ...prev, governing_body: e.target.value }))} placeholder="USYS" />
                  </div>
                  <div>
                    <Label>League Profile Picture</Label>
                    <div className="mt-1 flex items-center gap-3">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy to-primary">
                        {logoPreview ? (
                          <img src={logoPreview} alt="League logo preview" className="h-full w-full object-cover" />
                        ) : (
                          <Trophy className="h-6 w-6 text-white" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <Input type="file" accept="image/*" onChange={(e) => onPickLogo(e.target.files?.[0] || null)} />
                        {logoPreview ? (
                          <button type="button" className="self-start text-xs text-destructive hover:underline" onClick={() => onPickLogo(null)}>Remove</button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <Button className="w-full" onClick={handleCreateLeague} disabled={creatingLeague}>
                    {creatingLeague ? "Creating..." : "Create League"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>

        {featuredLeagues.length ? (
          <div className="grid gap-3">
            {featuredLeagues.map((league) => (
              <button
                key={league.id}
                onClick={() => navigate(`/league/${league.id}`)}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-navy to-primary">
                    {league.logo_url ? (
                      <img src={league.logo_url} alt={league.name} className="h-full w-full object-cover" />
                    ) : (
                      <Trophy className="h-5 w-5 text-white" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{league.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">{formatLeagueSubtitle(league) || league.season || "League details coming in"}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">Loading leagues...</div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            No leagues yet. Once Footy Status staff creates leagues, they’ll show here.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-live" />
          <h2 className="text-sm font-bold tracking-wide text-navy">LIVE MATCHES</h2>
        </div>
        {liveMatches.length ? (
          <div className="space-y-3">
            {liveMatches.map((match) => (
              <button key={match.id} onClick={() => navigate(`/match/${match.id}`)} className="w-full text-left">
                <MatchCard match={match} />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            No live matches right now.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-navy" />
          <h2 className="text-sm font-bold tracking-wide text-navy">UPCOMING MATCHES</h2>
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
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            No matches yet.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-navy" />
          <h2 className="text-sm font-bold tracking-wide text-navy">RECENT RESULTS</h2>
        </div>
        {recentResults.length ? (
          <div className="space-y-3">
            {recentResults.map((match) => (
              <button key={match.id} onClick={() => navigate(`/match/${match.id}`)} className="w-full text-left">
                <MatchCard match={match} />
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            No completed matches yet.
          </div>
        )}
      </section>
    </div>
  );
};

export default MatchesTab;
