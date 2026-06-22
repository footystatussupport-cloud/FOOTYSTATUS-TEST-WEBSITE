import assert from "node:assert/strict";
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
  getIsPro,
  shouldShowAds,
  splitClipsForFreeDowngrade,
} from "../src/lib/subscriptionRules.js";

const now = new Date("2026-06-14T12:00:00Z");
const free = { account_tier: ACCOUNT_TIERS.FREE, clip_deletions_used: 0 };
const annual = { account_tier: ACCOUNT_TIERS.PRO_ANNUAL, pro_expires_at: "2026-07-14T12:00:00Z" };
const expiredAnnual = { account_tier: ACCOUNT_TIERS.PRO_ANNUAL, pro_expires_at: "2026-05-14T12:00:00Z" };
const lifetime = { account_tier: ACCOUNT_TIERS.PRO_LIFETIME, pro_expires_at: null };

assert.equal(canUploadVisibleClip(free, FREE_VISIBLE_CLIP_LIMIT, now), false, "Free users are blocked at 3 visible clips");
assert.equal(canUploadVisibleClip(free, FREE_VISIBLE_CLIP_LIMIT - 1, now), true, "Free users can upload before the visible limit");
assert.equal(canDeleteClip({ ...free, clip_deletions_used: FREE_DELETION_LIMIT }, now), false, "Free users are blocked on 3rd deletion");
assert.equal(canDeleteClip({ ...free, clip_deletions_used: FREE_DELETION_LIMIT - 1 }, now), true, "Free users can use 2 deletions");
assert.equal(canUploadVisibleClip(annual, 99, now), true, "Annual Pro users have unlimited clips");
assert.equal(canDeleteClip(annual, now), true, "Annual Pro users have unlimited deletions");
assert.equal(getIsPro(expiredAnnual, now), false, "Expired annual Pro is not active");
assert.equal(getIsPro(lifetime, now), true, "Lifetime Pro persists forever");

const clips = [4, 1, 3, 2].map((n) => ({ id: String(n), created_at: `2026-06-0${n}T12:00:00Z` }));
assert.deepEqual(splitClipsForFreeDowngrade(clips), {
  visibleClipIds: ["1", "2", "3"],
  hiddenClipIds: ["4"],
}, "Downgrade keeps earliest 3 clips visible and hides the rest");

assert.equal(createUpgradePatch("annual", now).account_tier, ACCOUNT_TIERS.PRO_ANNUAL, "Annual upgrade sets annual tier");
assert.equal(createUpgradePatch("lifetime", now).pro_expires_at, null, "Lifetime upgrade never expires");
assert.equal(applyFeedBoost(10, annual, now), 10 * PRO_FEED_BOOST_MULTIPLIER, "Pro feed boost is 1.5x");
assert.equal(applyFeedBoost(10, free, now), 10, "Free feed ranking is unboosted");
assert.equal(shouldShowAds(free, now), true, "Free users see ads");
assert.equal(shouldShowAds(annual, now), false, "Active Pro users hide ads");
assert.equal(canViewAnalytics(free, now), false, "Free users cannot view analytics");
assert.equal(canViewAnalytics(annual, now), true, "Pro users can view analytics");
assert.equal(getIsPro(annual, now), true, "Pro badge is visible for active annual Pro");
assert.equal(getIsPro(free, now), false, "Pro badge is hidden for Free");

console.log("subscriptionRules tests passed");
