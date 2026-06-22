import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchRefereeClaimsForUser, refereeRoleLabel, RefereeMatchClaim } from "@/lib/referees";
import { formatMatchDateTime } from "@/lib/matches";

interface RefereeProfileDetails {
  full_name: string | null;
  referee_certification_level: string | null;
  referee_license_number: string | null;
  referee_certifying_organization: string | null;
  referee_years_experience: number | null;
  referee_main_experience: string | null;
  referee_assistant_experience: string | null;
  referee_leagues_tournaments: string | null;
  referee_availability: string | null;
  referee_accolades: string | null;
  referee_profile_public: boolean | null;
  bio: string | null;
}

const statusIcon = {
  pending: Clock3,
  approved: CheckCircle2,
  denied: XCircle,
};

const RefereeDashboardPage = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<RefereeProfileDetails | null>(null);
  const [claims, setClaims] = useState<RefereeMatchClaim[]>([]);

  const isRefereeAccount = profile?.account_category === "referee" || profile?.account_role === "referee" || profile?.role === "referee";

  const groupedClaims = useMemo(
    () => ({
      pending: claims.filter((claim) => claim.status === "pending"),
      approved: claims.filter((claim) => claim.status === "approved"),
      denied: claims.filter((claim) => claim.status === "denied"),
    }),
    [claims]
  );

  useEffect(() => {
    const loadDashboard = async () => {
      if (!user?.id) return;
      setLoading(true);
      const [profileRes, claimsRes] = await Promise.all([
        (supabase as any)
          .from("profiles")
          .select(
            "full_name, referee_certification_level, referee_license_number, referee_certifying_organization, referee_years_experience, referee_main_experience, referee_assistant_experience, referee_leagues_tournaments, referee_availability, referee_accolades, referee_profile_public, bio"
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        fetchRefereeClaimsForUser(user.id),
      ]);

      setDetails(profileRes.data || null);
      setClaims(claimsRes.data);
      setLoading(false);
    };

    loadDashboard();
  }, [user?.id]);

  const renderClaimList = (title: string, items: RefereeMatchClaim[], status: keyof typeof statusIcon) => {
    const Icon = statusIcon[status];
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-5 w-5 text-navy" />
          <h2 className="text-sm font-bold tracking-wide text-navy">{title}</h2>
        </div>
        {items.length ? (
          <div className="space-y-3">
            {items.map((claim) => (
              <button
                key={claim.id}
                type="button"
                onClick={() => navigate(`/match/${claim.match_id}`)}
                className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/60"
              >
                <p className="font-semibold text-foreground">
                  {[claim.home_team_name, claim.away_team_name].filter(Boolean).join(" vs ") || "Match assignment"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{claim.league_name || "League match"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {refereeRoleLabel(claim.referee_type)} • {formatMatchDateTime(claim.match_date)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        )}
      </section>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="mb-6 h-8 w-28" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!isRefereeAccount) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/profile")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Profile
        </button>
        <div className="mt-12 rounded-xl border border-border bg-card p-6 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-bold text-foreground">Referee account required</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only referee accounts can use the referee dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <button onClick={() => navigate("/profile")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Profile
        </button>
      </header>

      <main className="space-y-5 p-4">
        <section className="rounded-2xl bg-gradient-to-br from-navy to-primary p-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{details?.full_name || "Referee Dashboard"}</h1>
              <p className="text-sm text-white/75">{details?.referee_certification_level || "Certification level not set"}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-xl font-bold">{groupedClaims.pending.length}</p>
              <p className="text-white/75">Pending</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-xl font-bold">{groupedClaims.approved.length}</p>
              <p className="text-white/75">Approved</p>
            </div>
            <div className="rounded-lg bg-white/10 p-3">
              <p className="text-xl font-bold">{groupedClaims.denied.length}</p>
              <p className="text-white/75">Denied</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-navy" />
            <h2 className="text-sm font-bold tracking-wide text-navy">REFEREE PROFILE INFO</h2>
          </div>
          <div className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Public profile:</span> {details?.referee_profile_public ? "On" : "Private"}</p>
            <p><span className="text-muted-foreground">Certifying organization:</span> {details?.referee_certifying_organization || "Not set"}</p>
            <p><span className="text-muted-foreground">License number:</span> {details?.referee_license_number || "Not set"}</p>
            <p><span className="text-muted-foreground">Experience:</span> {details?.referee_years_experience ?? 0} years</p>
            <p><span className="text-muted-foreground">Availability:</span> {details?.referee_availability || "Not set"}</p>
            {details?.referee_leagues_tournaments ? (
              <p><span className="text-muted-foreground">Leagues / tournaments:</span> {details.referee_leagues_tournaments}</p>
            ) : null}
            {details?.referee_accolades ? (
              <p><span className="text-muted-foreground">Accolades:</span> {details.referee_accolades}</p>
            ) : null}
          </div>
        </section>

        {renderClaimList("PENDING MATCH CLAIMS", groupedClaims.pending, "pending")}
        {renderClaimList("APPROVED MATCH ASSIGNMENTS", groupedClaims.approved, "approved")}
        {renderClaimList("DENIED CLAIMS", groupedClaims.denied, "denied")}
      </main>
    </div>
  );
};

export default RefereeDashboardPage;
