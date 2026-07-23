// =============================================================================
// Footy Status Pro — native in-app purchase layer (App Store / Google Play)
// =============================================================================
// This is the ONLY path to a Pro upgrade. It is deliberately modular:
//
//   UI (ProUpgradePage)
//     -> purchasePro(plan)  /  restorePurchases()
//        -> native billing bridge (Apple StoreKit / Google Play Billing)
//        -> verifyWithBackend()  ->  Supabase Edge Function `verify-pro-purchase`
//           -> (server) verifies the receipt with Apple/Google
//           -> (server) apply_verified_pro_purchase RPC grants Pro
//
// Nothing here EVER marks an account as Pro on its own. Pro is only ever
// granted by the server, and only after a real receipt is verified. On the web
// build (no native store) every entry point returns an "unavailable" result
// and grants nothing.
//
// To go live you only need to:
//   1. Ship the app inside a native shell (Capacitor/React Native) that exposes
//      a billing bridge on `window.footyStatusBilling` implementing NativeBilling.
//   2. Set the real product ids (env vars below, or edit PRO_PRODUCTS).
//   3. Configure the store credentials the Edge Function needs (server-side).
// No other app code changes are required.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { ProPlanType } from "@/lib/subscriptions";

export type PurchasePlatform = "apple" | "google";

// -----------------------------------------------------------------------------
// Product-id configuration. Filled from env at build time so production ids are
// configured without touching code; falls back to conventional placeholders so
// the mapping is always explicit. The store product for a plan is chosen HERE —
// selecting "monthly" can only ever buy the monthly product, "yearly" the
// yearly product, so the wrong plan can never be activated.
// -----------------------------------------------------------------------------
interface ProductIds {
  apple: string;
  google: string;
}

export const PRO_PRODUCTS: Record<ProPlanType, ProductIds> = {
  monthly: {
    apple: import.meta.env.VITE_IAP_APPLE_MONTHLY_ID || "com.footystatus.pro.monthly",
    google: import.meta.env.VITE_IAP_GOOGLE_MONTHLY_ID || "footy_status_pro_monthly",
  },
  yearly: {
    apple: import.meta.env.VITE_IAP_APPLE_YEARLY_ID || "com.footystatus.pro.yearly",
    google: import.meta.env.VITE_IAP_GOOGLE_YEARLY_ID || "footy_status_pro_yearly",
  },
};

// -----------------------------------------------------------------------------
// Native billing bridge contract. A native wrapper injects an implementation on
// window; the web build has none, so `getNativeBilling()` returns null and all
// purchase entry points report "unavailable".
// -----------------------------------------------------------------------------
export interface NativePurchaseResult {
  platform: PurchasePlatform;
  productId: string;
  // Raw store payload the backend verifies (Apple receipt / Google purchase
  // token + signature). Never trusted on the client.
  receipt: string;
  transactionId?: string | null;
  originalTransactionId?: string | null;
}

export interface NativeBilling {
  platform: PurchasePlatform;
  purchase(productId: string): Promise<NativePurchaseResult>;
  restore(): Promise<NativePurchaseResult[]>;
}

declare global {
  interface Window {
    footyStatusBilling?: NativeBilling;
  }
}

const getNativeBilling = (): NativeBilling | null =>
  (typeof window !== "undefined" && window.footyStatusBilling) || null;

/** True only inside a native shell that exposes the billing bridge. */
export const isPurchaseAvailable = (): boolean => getNativeBilling() !== null;

export class PurchaseUnavailableError extends Error {
  constructor(message = "In-app purchases aren't available on this device yet.") {
    super(message);
    this.name = "PurchaseUnavailableError";
  }
}

export interface PurchaseOutcome {
  status: "activated" | "cancelled" | "unavailable" | "failed";
  tier?: string | null;
  expiresAt?: string | null;
  message?: string;
}

// -----------------------------------------------------------------------------
// Server-side verification. Sends the raw store receipt to the Edge Function,
// which verifies it with Apple/Google and, only on success, grants Pro via the
// service-role RPC. The client never decides Pro status.
// -----------------------------------------------------------------------------
const verifyWithBackend = async (
  plan: ProPlanType,
  result: NativePurchaseResult
): Promise<PurchaseOutcome> => {
  const { data, error } = await supabase.functions.invoke("verify-pro-purchase", {
    body: {
      plan,
      platform: result.platform,
      productId: result.productId,
      receipt: result.receipt,
      transactionId: result.transactionId ?? null,
      originalTransactionId: result.originalTransactionId ?? null,
    },
  });

  if (error) {
    return { status: "failed", message: error.message || "Purchase could not be verified." };
  }

  const verified = (data as any)?.verified === true && (data as any)?.tier;
  if (!verified) {
    return { status: "failed", message: (data as any)?.message || "Purchase could not be verified." };
  }

  return {
    status: "activated",
    tier: (data as any).tier,
    expiresAt: (data as any).expires_at ?? null,
  };
};

/**
 * Start the native purchase flow for the selected plan. Returns only after the
 * store confirms the charge AND the backend verifies the receipt. Any
 * cancellation, failure, or verification miss leaves the account on Free.
 */
export const purchasePro = async (plan: ProPlanType): Promise<PurchaseOutcome> => {
  const billing = getNativeBilling();
  if (!billing) {
    return {
      status: "unavailable",
      message:
        "Footy Status Pro purchases open through the App Store or Google Play in the mobile app. They aren't available here yet.",
    };
  }

  const productId = PRO_PRODUCTS[plan][billing.platform];

  let result: NativePurchaseResult;
  try {
    result = await billing.purchase(productId);
  } catch (err: any) {
    // Native layers throw a cancellation for a user-dismissed sheet.
    if (err?.code === "cancelled" || /cancel/i.test(String(err?.message || ""))) {
      return { status: "cancelled", message: "Purchase cancelled. Your account is unchanged." };
    }
    return { status: "failed", message: err?.message || "The purchase could not be completed." };
  }

  return verifyWithBackend(plan, result);
};

export interface RestoreOutcome {
  status: "restored" | "nothing" | "unavailable" | "failed";
  tier?: string | null;
  expiresAt?: string | null;
  message?: string;
}

/**
 * Restore a previously purchased subscription (reinstall / new device). Asks the
 * store for owned entitlements, then verifies each with the backend. Only a
 * currently-active subscription is restored; expired ones are ignored and no
 * duplicate is ever created (the backend keys off the original transaction id).
 */
export const restorePurchases = async (): Promise<RestoreOutcome> => {
  const billing = getNativeBilling();
  if (!billing) {
    return {
      status: "unavailable",
      message: "Restore is available in the mobile app through the App Store or Google Play.",
    };
  }

  let owned: NativePurchaseResult[];
  try {
    owned = await billing.restore();
  } catch (err: any) {
    return { status: "failed", message: err?.message || "Purchases could not be restored." };
  }

  if (!owned.length) {
    return { status: "nothing", message: "No active Footy Status Pro subscription was found to restore." };
  }

  // Verify each entitlement; the backend ignores expired ones and de-duplicates
  // by original transaction id, so the newest active one wins.
  let best: PurchaseOutcome | null = null;
  for (const entitlement of owned) {
    const plan: ProPlanType = entitlement.productId === PRO_PRODUCTS.yearly[entitlement.platform] ? "yearly" : "monthly";
    const outcome = await verifyWithBackend(plan, entitlement);
    if (outcome.status === "activated") best = outcome;
  }

  if (!best) {
    return { status: "nothing", message: "No active subscription was found to restore." };
  }

  return { status: "restored", tier: best.tier, expiresAt: best.expiresAt };
};
