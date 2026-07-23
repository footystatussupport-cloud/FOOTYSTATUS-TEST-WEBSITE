import { supabase } from "@/integrations/supabase/client";
import {
  ACCOUNT_TIERS,
  FREE_DELETION_LIMIT,
  FREE_VISIBLE_CLIP_LIMIT,
  PRO_FEED_BOOST_MULTIPLIER,
  applyFeedBoost,
  canDeleteClip,
  canUploadVisibleClip,
  canViewAnalytics,
  createUpgradePatch,
  getDaysRemaining,
  getIsPro,
  isPlayerAccount,
  isProEligible,
  shouldShowAds,
} from "@/lib/subscriptionRules";

// New plans are Monthly / Yearly. pro_annual / pro_lifetime remain valid tiers
// for existing members but are never sold or granted by the new purchase flow.
export type AccountTier = "free" | "pro_monthly" | "pro_yearly" | "pro_annual" | "pro_lifetime";
export type ProPlanType = "monthly" | "yearly";

export interface SubscriptionProfile {
  user_id?: string | null;
  account_tier?: AccountTier | null;
  pro_started_at?: string | null;
  pro_expires_at?: string | null;
  clip_deletions_used?: number | null;
  is_pro?: boolean | null;
}

export {
  ACCOUNT_TIERS,
  FREE_DELETION_LIMIT,
  FREE_VISIBLE_CLIP_LIMIT,
  PRO_FEED_BOOST_MULTIPLIER,
  applyFeedBoost,
  canDeleteClip,
  canUploadVisibleClip,
  canViewAnalytics,
  getDaysRemaining,
  getIsPro,
  isPlayerAccount,
  isProEligible,
  shouldShowAds,
};

// NOTE: There is intentionally NO client-side "grant Pro" function here.
// Pro is granted ONLY by the server after a real store purchase is verified
// (see src/lib/proPurchases.ts -> the verify-pro-purchase Edge Function ->
// the apply_verified_pro_purchase RPC, which runs with the service role).
// The old placeholderPaymentSuccess / upgradeToPro helpers and the
// self-serve upgrade_to_pro RPC have been removed so no account can become
// Pro without a verified payment.

export const hideClipsForFreeTier = async (userId: string) => {
  const { data: clips, error } = await (supabase as any)
    .from("clips")
    .select("id, created_at")
    .eq("user_id", userId)
    .neq("visibility", "inactive")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const visibleIds = ((clips || []) as Array<{ id: string }>).slice(0, FREE_VISIBLE_CLIP_LIMIT).map((clip) => clip.id);
  const hiddenIds = ((clips || []) as Array<{ id: string }>).slice(FREE_VISIBLE_CLIP_LIMIT).map((clip) => clip.id);

  if (visibleIds.length) {
    const visibleUpdate = await (supabase as any)
      .from("clips")
      .update({ visibility: "public" })
      .in("id", visibleIds);
    if (visibleUpdate.error) throw visibleUpdate.error;
  }

  if (hiddenIds.length) {
    const hiddenUpdate = await (supabase as any)
      .from("clips")
      .update({ visibility: "inactive" })
      .in("id", hiddenIds);
    if (hiddenUpdate.error) throw hiddenUpdate.error;
  }
};

export const downgradeExpiredProAccounts = async () => {
  // Every time-limited Pro tier (monthly, yearly, and legacy annual) drops back
  // to Free once its expiry passes. Lifetime never expires and is excluded.
  const { data: profiles, error } = await (supabase as any)
    .from("profiles")
    .select("user_id")
    .in("account_tier", ["pro_monthly", "pro_yearly", "pro_annual"])
    .lt("pro_expires_at", new Date().toISOString());

  if (error) throw error;

  for (const profile of profiles || []) {
    if (!profile.user_id) continue;
    const downgrade = await (supabase as any)
      .from("profiles")
      .update({
        account_tier: "free",
        is_pro: false,
        pro_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id);
    if (downgrade.error) throw downgrade.error;
    await hideClipsForFreeTier(profile.user_id);
  }
};

export const recordProfileView = async (viewedUserId: string, viewerUserId?: string | null) => {
  if (!viewerUserId || viewedUserId === viewerUserId) return;
  try {
    const { data: viewerProfile } = await (supabase as any)
      .from("profiles")
      .select("account_role, role")
      .eq("user_id", viewerUserId)
      .maybeSingle();

    await (supabase as any).from("profile_views").insert({
      viewed_user_id: viewedUserId,
      viewer_user_id: viewerUserId,
      viewer_role: viewerProfile?.account_role || viewerProfile?.role || "player",
    });
  } catch (error) {
    console.warn("Profile view analytics could not be recorded:", error);
  }
};

export const fetchProfileAnalytics = async (userId: string) => {
  const { data, error } = await (supabase as any)
    .from("profile_views")
    .select("viewer_role")
    .eq("viewed_user_id", userId);

  if (error) {
    console.warn("Profile analytics could not be loaded:", error);
    return { total: 0, coaches: 0, scouts: 0, teams: 0, players: 0 };
  }

  const rows = data || [];
  const countRole = (roles: string[]) => rows.filter((row: any) => roles.includes(row.viewer_role)).length;
  return {
    total: rows.length,
    coaches: countRole(["coach", "head_coach_assistant"]),
    scouts: countRole(["scout"]),
    teams: countRole(["team", "team_club"]),
    players: countRole(["player"]),
  };
};
