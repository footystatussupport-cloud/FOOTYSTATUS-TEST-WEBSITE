// =============================================================================
// admin-delete-account — trusted permanent-deletion orchestrator
// =============================================================================
// Database/application rows plus Supabase Auth are deleted atomically by the
// admin_delete_account RPC. Storage files are discovered before that transaction
// and removed afterward through the supported Storage API with the service role.
// The service key never reaches the browser.
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

interface DeleteAccountRequest {
  target_user_id: string;
  reason: string;
}

interface StorageObjectManifestRow {
  bucket_id: string;
  object_name: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const log = (
    level: "info" | "warn" | "error",
    event: string,
    details: Record<string, unknown> = {},
  ) => {
    console[level](
      JSON.stringify({ request_id: requestId, event, ...details }),
    );
  };

  if (request.method === "OPTIONS") {
    log("info", "cors_preflight_ok", {
      origin: request.headers.get("origin") || "unknown",
    });
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    log("warn", "method_not_allowed", { method: request.method });
    return json(405, {
      success: false,
      error_code: "method_not_allowed",
      message: "Method not allowed.",
    });
  }

  try {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    log("error", "missing_server_configuration", {
      has_supabase_url: Boolean(supabaseUrl),
      has_anon_key: Boolean(anonKey),
      has_service_role_key: Boolean(serviceRoleKey),
    });
    return json(500, {
      success: false,
      error_code: "server_not_configured",
      message: "Permanent account deletion is not configured on the server.",
    });
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    log("warn", "missing_admin_session");
    return json(401, {
      success: false,
      error_code: "missing_admin_session",
      message: "Your admin session is missing. Sign in again and retry.",
    });
  }

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await authed.auth.getUser();
  if (authError || !user) {
    log("warn", "admin_session_rejected", {
      auth_error: authError?.message || null,
    });
    return json(401, {
      success: false,
      error_code: "invalid_admin_session",
      message: "Your admin session has expired. Sign in again and retry.",
    });
  }

  const { data: isAdmin, error: adminError } = await authed.rpc(
    "is_footy_status_global_admin",
  );
  if (adminError) {
    log("error", "admin_verification_failed", {
      caller_user_id: user.id,
      database_error: adminError.message,
    });
    return json(500, {
      success: false,
      error_code: "admin_verification_failed",
      message: "Footy Status could not verify admin access. Please try again.",
    });
  }
  if (!isAdmin) {
    log("warn", "non_admin_delete_rejected", { caller_user_id: user.id });
    return json(403, {
      success: false,
      error_code: "admin_required",
      message: "Only the Footy Status Official account can permanently delete accounts.",
    });
  }

  let body: DeleteAccountRequest;
  try {
    body = await request.json();
  } catch {
    log("warn", "invalid_request_body", { caller_user_id: user.id });
    return json(400, {
      success: false,
      error_code: "invalid_request_body",
      message: "The deletion request was invalid.",
    });
  }

  const targetUserId = String(body.target_user_id || "").trim();
  const reason = String(body.reason || "").trim();
  if (!targetUserId || !uuidPattern.test(targetUserId)) {
    log("warn", "invalid_target_user_id", {
      caller_user_id: user.id,
      has_target: Boolean(targetUserId),
    });
    return json(400, {
      success: false,
      error_code: "invalid_target_user_id",
      message: "Select a valid account to delete.",
    });
  }
  if (!reason) {
    log("warn", "missing_deletion_reason", {
      caller_user_id: user.id,
      target_user_id: targetUserId,
    });
    return json(400, {
      success: false,
      error_code: "missing_deletion_reason",
      message: "Enter an admin note before deleting an account.",
    });
  }
  if (targetUserId === user.id) {
    log("warn", "admin_self_delete_rejected", {
      caller_user_id: user.id,
    });
    return json(403, {
      success: false,
      error_code: "admin_self_delete_forbidden",
      message: "The active Footy Status Admin account cannot delete itself.",
    });
  }

  // Capture paths before the database/Auth transaction removes profile and clip
  // rows. This RPC is read-only and protected by the same Official Admin check.
  const { data: manifestData, error: manifestError } = await authed.rpc(
    "admin_account_storage_manifest",
    {
      _target_user_id: targetUserId,
      _reason: reason,
    },
  );
  if (manifestError) {
    log("error", "storage_manifest_failed", {
      caller_user_id: user.id,
      target_user_id: targetUserId,
      database_error: manifestError.message,
    });
    return json(500, {
      success: false,
      error_code: "storage_manifest_failed",
      message: "Footy Status could not prepare this account for deletion.",
    });
  }

  const manifest = (manifestData || []) as StorageObjectManifestRow[];

  // One PostgreSQL transaction removes the application graph, identities, and
  // auth.users. Any SQL failure rolls the whole operation back.
  const { data: deletionData, error: deletionError } = await authed.rpc(
    "admin_delete_account",
    {
      _target_user_id: targetUserId,
      _reason: reason,
    },
  );
  if (deletionError) {
    log("error", "database_or_auth_deletion_failed", {
      caller_user_id: user.id,
      target_user_id: targetUserId,
      database_error: deletionError.message,
      database_code: deletionError.code || null,
      database_details: deletionError.details || null,
      database_hint: deletionError.hint || null,
    });
    return json(500, {
      success: false,
      error_code: "account_deletion_failed",
      message: "The account could not be permanently deleted. No success was reported.",
    });
  }

  if (
    !deletionData?.success ||
    !deletionData?.auth_user_deleted ||
    !deletionData?.cleanup_atomic
  ) {
    log("error", "incomplete_database_confirmation", {
      caller_user_id: user.id,
      target_user_id: targetUserId,
      deletion_result: deletionData || null,
    });
    return json(500, {
      success: false,
      error_code: "incomplete_database_confirmation",
      message: "The database did not confirm complete account deletion.",
    });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pathsByBucket = new Map<string, string[]>();
  for (const row of manifest) {
    if (!row.bucket_id || !row.object_name) continue;
    const paths = pathsByBucket.get(row.bucket_id) || [];
    paths.push(row.object_name);
    pathsByBucket.set(row.bucket_id, paths);
  }

  const failedBatches: Array<{ bucket: string; paths: string[]; message: string }> = [];
  let removedCount = 0;

  for (const [bucketId, paths] of pathsByBucket) {
    for (const pathBatch of chunk([...new Set(paths)], 100)) {
      let lastMessage = "";
      let removed = false;

      // Retry transient Storage API failures before reporting a cleanup warning.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { error } = await service.storage.from(bucketId).remove(pathBatch);
        if (!error) {
          removed = true;
          removedCount += pathBatch.length;
          break;
        }
        lastMessage = error.message;
      }

      if (!removed) {
        log("error", "storage_cleanup_batch_failed", {
          target_user_id: targetUserId,
          bucket_id: bucketId,
          path_count: pathBatch.length,
          storage_error: lastMessage || "Storage API removal failed.",
        });
        failedBatches.push({
          bucket: bucketId,
          paths: pathBatch,
          message: lastMessage || "Storage API removal failed.",
        });
      }
    }
  }

  const storageCleanupComplete = failedBatches.length === 0;
  log(storageCleanupComplete ? "info" : "error", "account_deletion_completed", {
    caller_user_id: user.id,
    target_user_id: targetUserId,
    storage_cleanup_complete: storageCleanupComplete,
    storage_objects_found: manifest.length,
    storage_objects_removed: removedCount,
  });
  return json(200, {
    ...deletionData,
    success: storageCleanupComplete,
    account_deleted: true,
    storage_cleanup_complete: storageCleanupComplete,
    storage_objects_found: manifest.length,
    storage_objects_removed: removedCount,
    storage_cleanup_failure_count: failedBatches.length,
    message: storageCleanupComplete
      ? "The account, Auth user, application data, and owned files were permanently removed."
      : "The account was deleted, but some owned files could not be removed after three attempts.",
  });
  } catch (error) {
    log("error", "unhandled_function_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, {
      success: false,
      error_code: "unexpected_server_error",
      message: "Permanent account deletion encountered an unexpected server error.",
    });
  }
});
