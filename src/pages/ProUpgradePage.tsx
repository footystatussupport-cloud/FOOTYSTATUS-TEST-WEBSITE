import { useEffect, useState } from "react";
import { ArrowLeft, Check, Crown, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import ProBadge from "@/components/ProBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ProPlanType, isProEligible } from "@/lib/subscriptions";
import { purchasePro, restorePurchases } from "@/lib/proPurchases";

const plans: Array<{ type: ProPlanType; name: string; price: string; cadence: string; description: string }> = [
  {
    type: "monthly",
    name: "Pro Monthly",
    price: "$5",
    cadence: "per month",
    description: "Full Pro access billed monthly. Cancel anytime from your store account.",
  },
  {
    type: "yearly",
    name: "Pro Yearly",
    price: "$50",
    cadence: "per year",
    description: "Full Pro access for a year at a lower monthly rate, renewed annually.",
  },
];

const freeBenefits = [
  "Up to only 3 visible Next Up clips",
  "Post clips up to 25 seconds",
  "2 clip deletions",
  "Ads enabled",
  "No profile analytics",
  "No feed visibility boost",
  "Standard member profile",
];

const proBenefits = [
  "Unlimited Next Up clips",
  "Post clips up to 45 seconds instead of 25 seconds",
  "Unlimited Clip Deletions",
  "No ads",
  "Profile analytics",
  "See who viewed your profile",
  "1.5x feed visibility boost",
  "Unlock Official Footy Status Pro Member Badge and Exclusive Features",
];

const ProUpgradePage = () => {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  const { toast } = useToast();
  const [busyPlan, setBusyPlan] = useState<ProPlanType | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Footy Status Pro is exclusively for player accounts (boys and girls).
  const eligible = isProEligible(profile);

  useEffect(() => {
    if (!loading && user?.id && !eligible) {
      navigate("/other", { replace: true });
    }
  }, [eligible, loading, navigate, user?.id]);

  const handleUpgrade = async (planType: ProPlanType) => {
    if (!user?.id) {
      navigate("/auth");
      return;
    }

    // Server-enforced too, but stop non-players before starting checkout.
    if (!eligible) {
      toast({
        title: "Footy Status Pro is for players only",
        description: "Only player accounts can purchase Footy Status Pro.",
        variant: "destructive",
      });
      return;
    }

    setBusyPlan(planType);
    try {
      // Launches the native store purchase; only resolves to "activated" after
      // the charge is confirmed AND the receipt is verified on the backend.
      const outcome = await purchasePro(planType);
      if (outcome.status === "activated") {
        toast({ title: "Pro activated", description: "Your Footy Status Pro benefits are now active." });
        navigate("/profile");
      } else if (outcome.status === "cancelled") {
        toast({ title: "Purchase cancelled", description: "Your account is unchanged." });
      } else if (outcome.status === "unavailable") {
        toast({ title: "Not available here", description: outcome.message, variant: "destructive" });
      } else {
        toast({ title: "Purchase not completed", description: outcome.message || "You have not been charged.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Purchase failed", description: error.message || "You have not been charged.", variant: "destructive" });
    } finally {
      setBusyPlan(null);
    }
  };

  const handleRestore = async () => {
    if (!eligible) return;
    setRestoring(true);
    try {
      const outcome = await restorePurchases();
      if (outcome.status === "restored") {
        toast({ title: "Purchases restored", description: "Your active Footy Status Pro subscription is back." });
        navigate("/profile");
      } else if (outcome.status === "unavailable") {
        toast({ title: "Not available here", description: outcome.message, variant: "destructive" });
      } else {
        toast({ title: "Nothing to restore", description: outcome.message || "No active subscription was found." });
      }
    } finally {
      setRestoring(false);
    }
  };

  if (!loading && user?.id && !eligible) return null;

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

        {!eligible ? (
          <main className="px-4 py-16">
            <div className="mx-auto max-w-sm text-center">
              <Crown className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <h1 className="text-xl font-bold text-foreground">Footy Status Pro is for players</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Footy Status Pro is a premium subscription designed exclusively for individual player accounts. It isn’t
                available for this account type.
              </p>
              <Button className="mt-6 w-full" variant="outline" onClick={() => navigate("/profile")}>
                Back to profile
              </Button>
            </div>
          </main>
        ) : (
        <main className="px-4 py-6">
          <div className="mb-6 text-center">
            <Crown className="mx-auto mb-3 h-10 w-10 text-amber-600" />
            <h1 className="text-2xl font-bold text-foreground">FootyStatus Pro</h1>
            <p className="mt-2 text-sm text-muted-foreground">More clips, cleaner viewing, and better visibility for serious players.</p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            {plans.map((plan) => (
              <div key={plan.type} className="rounded-lg border border-border bg-card p-4">
                <div className="space-y-2">
                  <div>
                    <h2 className="font-semibold text-foreground">{plan.name}</h2>
                    <p className="text-sm text-muted-foreground">{plan.cadence}</p>
                  </div>
                  <p className="text-xl font-bold text-foreground">{plan.price}</p>
                  <p className="min-h-12 text-xs leading-relaxed text-muted-foreground">{plan.description}</p>
                </div>
                <Button className="mt-4 w-full gap-2" disabled={busyPlan !== null} onClick={() => handleUpgrade(plan.type)}>
                  <Crown className="h-4 w-4" />
                  {busyPlan === plan.type ? "Processing…" : "Continue"}
                </Button>
              </div>
            ))}
          </div>

          <div className="mb-6 space-y-2 text-center">
            <Button variant="outline" className="w-full gap-2" disabled={restoring} onClick={handleRestore}>
              <RotateCcw className="h-4 w-4" />
              {restoring ? "Restoring…" : "Restore Purchases"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Subscriptions are billed through the App Store or Google Play in the Footy Status mobile app and can be
              managed or cancelled there at any time.
            </p>
          </div>

          <section>
            <h2 className="mb-3 text-sm font-bold tracking-wide text-navy">BENEFITS</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-4 text-sm font-semibold text-foreground">Free Version</h3>
                <ul className="space-y-3 text-xs leading-relaxed text-muted-foreground">
                  {freeBenefits.map((benefit) => (
                    <li key={benefit} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-gradient-to-br from-red-600 via-white to-blue-700 p-[3px] shadow-sm dark:from-accent dark:via-muted dark:to-accent">
                <div className="relative h-full overflow-hidden rounded-[6px] bg-white p-4 dark:bg-card">
                  <h3 className="relative mb-4 flex w-full items-center justify-between gap-2 text-sm font-bold text-navy">
                    <span className="whitespace-nowrap">Footy Status Pro</span>
                    <ProBadge
                      compact
                      className="shrink-0 border border-yellow-500 bg-white px-1.5 py-0 text-[9px] leading-4 text-yellow-700 shadow-sm"
                    />
                  </h3>
                  <ul className="relative space-y-3 text-xs leading-relaxed text-foreground">
                    {proBenefits.map((benefit) => (
                      <li key={benefit} className="flex gap-2">
                        <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                          <Check className="h-2.5 w-2.5 stroke-[3]" />
                        </span>
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </main>
        )}
      </div>
    </div>
  );
};

export default ProUpgradePage;
