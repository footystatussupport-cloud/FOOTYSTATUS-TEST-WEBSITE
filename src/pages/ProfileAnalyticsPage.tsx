import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Lock, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { fetchProfileAnalytics, canViewAnalytics } from "@/lib/subscriptions";
import { supabase } from "@/integrations/supabase/client";

const ProfileAnalyticsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [analytics, setAnalytics] = useState({ total: 0, coaches: 0, scouts: 0, teams: 0, players: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) {
        navigate("/auth");
        return;
      }

      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("account_tier, pro_expires_at, clip_deletions_used")
        .eq("user_id", user.id)
        .maybeSingle();

      const nextAllowed = canViewAnalytics(profile);
      setAllowed(nextAllowed);
      if (nextAllowed) {
        setAnalytics(await fetchProfileAnalytics(user.id));
      }
      setLoading(false);
    };
    load();
  }, [navigate, user?.id]);

  const cards = [
    { label: "Total profile views", value: analytics.total },
    { label: "Coach views", value: analytics.coaches },
    { label: "Scout views", value: analytics.scouts },
    { label: "Team views", value: analytics.teams },
    { label: "Player views", value: analytics.players },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
        </header>

        <main className="px-4 py-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Profile Analytics</h1>
              <p className="text-sm text-muted-foreground">Views grouped by account type.</p>
            </div>
          </div>

          {!loading && !allowed ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-semibold text-foreground">Analytics are a Pro feature</p>
              <p className="mt-1 text-sm text-muted-foreground">Upgrade to see profile views from coaches, scouts, teams, and players.</p>
              <Button className="mt-4" onClick={() => navigate("/pro")}>Upgrade to Pro</Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {cards.map((card) => (
                <div key={card.label} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-navy" />
                    <span className="text-sm font-medium text-foreground">{card.label}</span>
                  </div>
                  <span className="text-lg font-bold text-foreground">{card.value}</span>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ProfileAnalyticsPage;
