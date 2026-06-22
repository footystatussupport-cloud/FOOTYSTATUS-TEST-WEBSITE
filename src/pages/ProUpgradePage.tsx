import { ArrowLeft, Check, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import ProBadge from "@/components/ProBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { placeholderPaymentSuccess, ProPlanType } from "@/lib/subscriptions";

const plans: Array<{ type: ProPlanType; name: string; price: string; cadence: string; description: string }> = [
  {
    type: "annual",
    name: "Pro Annual",
    price: "$50",
    cadence: "per year",
    description: "Full Pro access for one year, with renewal reminders before it expires.",
  },
  {
    type: "lifetime",
    name: "Pro Lifetime",
    price: "$150",
    cadence: "one-time",
    description: "Pay once and keep Pro features permanently on your account.",
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
  const { user } = useAuth();
  const { toast } = useToast();

  const handleUpgrade = async (planType: ProPlanType) => {
    if (!user?.id) {
      navigate("/auth");
      return;
    }

    try {
      await placeholderPaymentSuccess(user.id, planType);
      toast({ title: "Pro enabled", description: "Payment is placeholder-only for now. Your Pro benefits are active." });
      navigate("/profile");
    } catch (error: any) {
      toast({ title: "Upgrade failed", description: error.message || "Could not enable Pro.", variant: "destructive" });
    }
  };

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
                <Button className="mt-4 w-full gap-2" onClick={() => handleUpgrade(plan.type)}>
                  <Crown className="h-4 w-4" />
                  Continue
                </Button>
              </div>
            ))}
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
      </div>
    </div>
  );
};

export default ProUpgradePage;
