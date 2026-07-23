export const ACCOUNT_TIERS = {
  FREE: "free",
  PRO_MONTHLY: "pro_monthly",
  PRO_YEARLY: "pro_yearly",
  // Legacy tiers — no longer sold, but still honored so existing Pro members
  // keep their access. Never granted by the new purchase flow.
  PRO_ANNUAL: "pro_annual",
  PRO_LIFETIME: "pro_lifetime",
};

// The plans a Player can purchase today. The value is the plan the user
// selects; proPurchases.ts maps it to the correct App Store / Google Play
// product id so the right subscription is charged.
export const PRO_PLANS = {
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

// Tiers that are time-limited (need a valid, future pro_expires_at to be active).
const EXPIRING_PRO_TIERS = [
  ACCOUNT_TIERS.PRO_MONTHLY,
  ACCOUNT_TIERS.PRO_YEARLY,
  ACCOUNT_TIERS.PRO_ANNUAL, // legacy
];

export const FREE_VISIBLE_CLIP_LIMIT = 3;
export const FREE_DELETION_LIMIT = 2;
export const PRO_FEED_BOOST_MULTIPLIER = 1.5;

export const isActiveProTier = (profile, now = new Date()) => {
  if (!profile) return false;
  // Lifetime (legacy) never expires.
  if (profile.account_tier === ACCOUNT_TIERS.PRO_LIFETIME) return true;
  // Every other Pro tier is time-limited: it is only active while it has a
  // valid, still-in-the-future expiry. Monthly/Yearly renewals push this date
  // forward on the backend after each verified renewal.
  if (!EXPIRING_PRO_TIERS.includes(profile.account_tier)) return false;
  if (!profile.pro_expires_at) return false;
  return new Date(profile.pro_expires_at).getTime() > now.getTime();
};

// Footy Status Pro is a player-only product. Any account classified as a
// player (boy or girl) is eligible; every other (current or future) account
// type is automatically ineligible.
export const isPlayerAccount = (profile) => {
  if (!profile) return false;
  const role = String(profile.account_role ?? profile.account_type ?? profile.role ?? "").toLowerCase();
  const category = String(profile.account_category ?? "").toLowerCase();
  return role === "player" || category === "player";
};

// True only when the account's classification is actually present on the object.
// Lets tier-only fixtures / partial selects fall back to the pure tier check.
const hasAccountClassification = (profile) =>
  profile != null &&
  (profile.account_role != null ||
    profile.account_type != null ||
    profile.account_category != null ||
    profile.role != null);

// Eligibility to view/purchase Footy Status Pro.
export const isProEligible = (profile) => isPlayerAccount(profile);

export const getAccountTier = (profile, now = new Date()) => {
  if (getIsPro(profile, now)) return profile.account_tier;
  return ACCOUNT_TIERS.FREE;
};

export const getIsPro = (profile, now = new Date()) => {
  // A known non-player account is never Pro, regardless of any tier still
  // stored on the row (legacy/testing). This makes every Pro feature, badge,
  // and boost that keys off getIsPro player-only automatically.
  if (hasAccountClassification(profile) && !isPlayerAccount(profile)) return false;
  return isActiveProTier(profile, now);
};

export const getDaysRemaining = (profile, now = new Date()) => {
  if (!profile?.pro_expires_at || profile.account_tier === ACCOUNT_TIERS.PRO_LIFETIME) return null;
  const ms = new Date(profile.pro_expires_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
};

// Add one calendar month, clamping the day when the next month is shorter
// (e.g. Jan 31 -> Feb 28). Mirrors how the stores bill a monthly cycle.
const addOneMonth = (date) => {
  const result = new Date(date);
  const targetMonth = result.getMonth() + 1;
  result.setMonth(targetMonth);
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0); // roll back to the last day of the intended month
  }
  return result;
};

export const canUploadVisibleClip = (profile, visibleClipCount, now = new Date()) =>
  getIsPro(profile, now) || visibleClipCount < FREE_VISIBLE_CLIP_LIMIT;

export const canDeleteClip = (profile, now = new Date()) =>
  getIsPro(profile, now) || Number(profile?.clip_deletions_used || 0) < FREE_DELETION_LIMIT;

export const applyFeedBoost = (score, profile, now = new Date()) =>
  score * (getIsPro(profile, now) ? PRO_FEED_BOOST_MULTIPLIER : 1);

export const shouldShowAds = (profile, now = new Date()) => !getIsPro(profile, now);

export const canViewAnalytics = (profile, now = new Date()) => getIsPro(profile, now);

export const splitClipsForFreeDowngrade = (clips) => {
  const sorted = [...clips].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return {
    visibleClipIds: sorted.slice(0, FREE_VISIBLE_CLIP_LIMIT).map((clip) => clip.id),
    hiddenClipIds: sorted.slice(FREE_VISIBLE_CLIP_LIMIT).map((clip) => clip.id),
  };
};

// Maps a purchased plan to the account_tier + expiry the backend should store.
// Used server-side conceptually; the authoritative grant lives in the
// apply_verified_pro_purchase RPC (called only after receipt verification).
// This client-side copy is kept only for computing/displaying expiry and for
// tests — it never writes to the database on its own.
export const createUpgradePatch = (planType, purchaseDate = new Date()) => {
  const startedAt = purchaseDate.toISOString();

  if (planType === PRO_PLANS.MONTHLY) {
    return {
      account_tier: ACCOUNT_TIERS.PRO_MONTHLY,
      pro_started_at: startedAt,
      pro_expires_at: addOneMonth(purchaseDate).toISOString(),
    };
  }

  if (planType === PRO_PLANS.YEARLY) {
    const expiresAt = new Date(purchaseDate);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    return {
      account_tier: ACCOUNT_TIERS.PRO_YEARLY,
      pro_started_at: startedAt,
      pro_expires_at: expiresAt.toISOString(),
    };
  }

  // --- Legacy plans (not sold by the new flow; kept for backward compat) ---
  if (planType === "lifetime") {
    return {
      account_tier: ACCOUNT_TIERS.PRO_LIFETIME,
      pro_started_at: startedAt,
      pro_expires_at: null,
    };
  }

  // "annual" (legacy)
  const expiresAt = new Date(purchaseDate);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return {
    account_tier: ACCOUNT_TIERS.PRO_ANNUAL,
    pro_started_at: startedAt,
    pro_expires_at: expiresAt.toISOString(),
  };
};
