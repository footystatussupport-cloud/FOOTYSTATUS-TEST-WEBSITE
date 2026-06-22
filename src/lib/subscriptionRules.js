export const ACCOUNT_TIERS = {
  FREE: "free",
  PRO_ANNUAL: "pro_annual",
  PRO_LIFETIME: "pro_lifetime",
};

export const PRO_PLANS = {
  ANNUAL: "annual",
  LIFETIME: "lifetime",
};

export const FREE_VISIBLE_CLIP_LIMIT = 3;
export const FREE_DELETION_LIMIT = 2;
export const PRO_FEED_BOOST_MULTIPLIER = 1.5;

export const isActiveProTier = (profile, now = new Date()) => {
  if (!profile) return false;
  if (profile.account_tier === ACCOUNT_TIERS.PRO_LIFETIME) return true;
  if (profile.account_tier !== ACCOUNT_TIERS.PRO_ANNUAL) return false;
  if (!profile.pro_expires_at) return false;
  return new Date(profile.pro_expires_at).getTime() > now.getTime();
};

export const getAccountTier = (profile, now = new Date()) => {
  if (isActiveProTier(profile, now)) return profile.account_tier;
  return ACCOUNT_TIERS.FREE;
};

export const getIsPro = (profile, now = new Date()) => isActiveProTier(profile, now);

export const getDaysRemaining = (profile, now = new Date()) => {
  if (!profile?.pro_expires_at || profile.account_tier === ACCOUNT_TIERS.PRO_LIFETIME) return null;
  const ms = new Date(profile.pro_expires_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
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

export const createUpgradePatch = (planType, purchaseDate = new Date()) => {
  const startedAt = purchaseDate.toISOString();
  if (planType === PRO_PLANS.LIFETIME) {
    return {
      account_tier: ACCOUNT_TIERS.PRO_LIFETIME,
      pro_started_at: startedAt,
      pro_expires_at: null,
    };
  }

  const expiresAt = new Date(purchaseDate);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return {
    account_tier: ACCOUNT_TIERS.PRO_ANNUAL,
    pro_started_at: startedAt,
    pro_expires_at: expiresAt.toISOString(),
  };
};
