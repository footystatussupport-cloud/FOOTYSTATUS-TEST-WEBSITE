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

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { success: false, message: "Method not allowed." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(500, {
      success: false,
      message: "Permanent account deletion is not configured on the server.",
    });
  }

  const authorization = request.headers.get("Authorization") || "";
  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await authed.auth.getUser();
  if (authError || !user) {
    return json(401, { success: false, message: "You must be signed in." });
  }

  const { data: isAdmin, error: adminError } = await authed.rpc(
    "is_footy_status_global_admin",
  );
  if (adminError || !isAdmin) {
    return json(403, {
      success: false,
      message: "Only the Footy Status Official account can permanently delete accounts.",
    });
  }

  let body: DeleteAccountRequest;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, message: "Invalid request body." });
  }

  const targetUserId = String(body.target_user_id || "").trim();
  const reason = String(body.reason || "").trim();
  if (!targetUserId) {
    return json(400, { success: false, message: "Target account is required." });
  }
  if (!reason) {
    return json(400, {
      success: false,
      message: "Enter an admin note before deleting an account.",
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
    return json(400, {
      success: false,
      message: manifestError.message || "Could not prepare storage cleanup.",
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
    return json(400, {
      success: false,
      message: deletionError.message || "Could not delete account.",
    });
  }

  if (
    !deletionData?.success ||
    !deletionData?.auth_user_deleted ||
    !deletionData?.cleanup_atomic
  ) {
    return json(500, {
      success: false,
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
        failedBatches.push({
          bucket: bucketId,
          paths: pathBatch,
          message: lastMessage || "Storage API removal failed.",
        });
      }
    }
  }

  const storageCleanupComplete = failedBatches.length === 0;
  return json(200, {
    ...deletionData,
    success: storageCleanupComplete,
    account_deleted: true,
    storage_cleanup_complete: storageCleanupComplete,
    storage_objects_found: manifest.length,
    storage_objects_removed: removedCount,
    storage_cleanup_failures: failedBatches,
    message: storageCleanupComplete
      ? "The account, Auth user, application data, and owned files were permanently removed."
      : "The account was deleted, but some owned files could not be removed after three attempts.",
  });
});
