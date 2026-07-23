// =============================================================================
// verify-pro-purchase — Supabase Edge Function (Deno)
// =============================================================================
// The ONLY place a Footy Status Pro subscription is granted. The mobile app's
// native billing layer sends the raw store receipt here; this function:
//   1. Authenticates the caller from their Supabase JWT.
//   2. Verifies the receipt with Apple App Store / Google Play (server-side,
//      using secrets that never reach the client).
//   3. On success, calls the service-role RPC apply_verified_pro_purchase,
//      which grants Pro (player-only, idempotent).
//   4. Returns { verified, tier, expires_at } — or { verified:false, message }.
//
// The service-role key is read from the environment and is NEVER exposed to the
// browser. Until the store secrets are configured, verification returns
// verified:false so NO account is ever upgraded without a real, checked receipt.
//
// Deploy:  supabase functions deploy verify-pro-purchase
// Secrets: supabase secrets set APPLE_SHARED_SECRET=... GOOGLE_SERVICE_ACCOUNT_JSON=...
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface VerifyRequest {
  plan: "monthly" | "yearly";
  platform: "apple" | "google";
  productId: string;
  receipt: string;
  transactionId?: string | null;
  originalTransactionId?: string | null;
}

interface VerifiedEntitlement {
  active: boolean;
  expiresAt: string | null;         // ISO string
  originalTransactionId: string;
  currentTransactionId: string | null;
  renewalStatus: "auto_renew_on" | "auto_renew_off" | "cancelled" | "expired";
}

// --- Apple App Store verification ------------------------------------------
// TODO(store): call the App Store Server API (or verifyReceipt) with
// APPLE_SHARED_SECRET, validate the productId + bundle id, and return the
// entitlement. Returns null until APPLE_SHARED_SECRET is configured.
async function verifyApple(_req: VerifyRequest): Promise<VerifiedEntitlement | null> {
  const secret = Deno.env.get("APPLE_SHARED_SECRET");
  if (!secret) return null;
  // ---- Real implementation goes here ----
  return null;
}

// --- Google Play verification ----------------------------------------------
// TODO(store): call the Google Play Developer API
// purchases.subscriptionsv2.get with GOOGLE_SERVICE_ACCOUNT_JSON, validate the
// productId + package name, and return the entitlement. Returns null until the
// service account is configured.
async function verifyGoogle(_req: VerifyRequest): Promise<VerifiedEntitlement | null> {
  const creds = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!creds) return null;
  // ---- Real implementation goes here ----
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { verified: false, message: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(200, { verified: false, message: "Purchase verification isn't configured on the server yet." });
  }

  // 1) Authenticate the caller from their JWT.
  const authHeader = request.headers.get("Authorization") || "";
  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await authed.auth.getUser();
  if (authError || !user) {
    return json(401, { verified: false, message: "You must be signed in." });
  }

  let body: VerifyRequest;
  try {
    body = await request.json();
  } catch {
    return json(400, { verified: false, message: "Invalid request body." });
  }

  if (!body?.plan || !body?.platform || !body?.receipt) {
    return json(400, { verified: false, message: "Missing purchase details." });
  }

  // 2) Verify the receipt with the correct store.
  let entitlement: VerifiedEntitlement | null = null;
  try {
    entitlement = body.platform === "apple" ? await verifyApple(body) : await verifyGoogle(body);
  } catch (err) {
    console.error("[verify-pro-purchase] verification error", { userId: user.id, err: String(err) });
    return json(200, { verified: false, message: "The purchase could not be verified." });
  }

  // Not configured yet, or the store rejected the receipt -> grant nothing.
  if (!entitlement) {
    return json(200, {
      verified: false,
      message: "Purchase verification isn't available yet. Your account was not charged for Pro.",
    });
  }
  if (!entitlement.active) {
    return json(200, { verified: false, message: "This subscription is not active." });
  }

  // 3) Grant Pro via the service-role RPC (the only grant path).
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("apply_verified_pro_purchase", {
    _user_id: user.id,
    _plan: body.plan,
    _platform: body.platform,
    _expires_at: entitlement.expiresAt,
    _original_transaction_id: entitlement.originalTransactionId,
    _current_transaction_id: entitlement.currentTransactionId,
    _renewal_status: entitlement.renewalStatus,
  });

  if (error) {
    console.error("[verify-pro-purchase] grant failed", { userId: user.id, error: error.message });
    // A verified receipt for a non-player (or other rule) — do not upgrade.
    return json(200, { verified: false, message: error.message || "Pro could not be activated for this account." });
  }

  return json(200, {
    verified: true,
    tier: (data as any)?.tier ?? null,
    expires_at: (data as any)?.expires_at ?? null,
  });
});
