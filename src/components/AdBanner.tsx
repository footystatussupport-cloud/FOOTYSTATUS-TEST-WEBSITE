import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { shouldShowAds } from "@/lib/subscriptions";

const AdBanner = () => {
  const { user } = useAuth();
  const [showAds, setShowAds] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.id) {
        setShowAds(true);
        return;
      }
      const { data } = await (supabase as any)
        .from("profiles")
        .select("account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
        .eq("user_id", user.id)
        .maybeSingle();
      setShowAds(shouldShowAds(data));
    };
    load();
  }, [user?.id]);

  if (!showAds) return null;

  return (
    <div className="w-full bg-muted border-y border-border px-4 py-3">
      <div className="flex items-center justify-center gap-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Sponsored</span>
      </div>
      <div className="mt-2 bg-secondary rounded-lg h-16 flex items-center justify-center border border-border">
        <span className="text-sm text-muted-foreground">Advertisement Space</span>
      </div>
    </div>
  );
};

export default AdBanner;
