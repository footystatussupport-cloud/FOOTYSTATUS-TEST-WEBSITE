import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

const migration = read(
  "supabase/migrations/20260724180000_fix_atomic_admin_account_deletion.sql",
);
const normalized = migration.toLowerCase();
const storageHandoff = read(
  "supabase/migrations/20260724200000_account_deletion_storage_api_handoff.sql",
);
const storageHandoffNormalized = storageHandoff.toLowerCase();
const schemaSafeHelpers = read(
  "supabase/migrations/20260724210000_account_deletion_schema_safe_helpers.sql",
);
const schemaSafeHelpersNormalized = schemaSafeHelpers.toLowerCase();

// The exact duplicate-key root cause: daughter-team relationship rows must be
// deleted, never rewritten into duplicate mother-team rows.
for (const table of [
  "coach_staff_team_memberships",
  "coach_staff_team_invites",
  "coach_staff_join_requests",
  "player_team_memberships",
  "team_player_invites",
  "team_join_requests",
]) {
  assert.ok(normalized.includes(`'${table}'`), `Missing daughter-team FK repair for ${table}`);
}
assert.ok(
  normalized.includes(
    "foreign key (club_team_id) references public.club_teams(id) on delete cascade",
  ),
  "Daughter-team relationships must use ON DELETE CASCADE",
);

const adminStart = normalized.indexOf(
  "create or replace function public.admin_delete_account",
);
assert.ok(adminStart >= 0, "Strict admin_delete_account replacement is missing");
const adminBody = normalized.slice(adminStart);
const cleanupIndex = adminBody.indexOf("v_result := public.delete_account_app_data");
const authDeleteIndex = adminBody.indexOf("delete from auth.users");
const verificationIndex = adminBody.indexOf("if v_deleted <> 1");
assert.ok(cleanupIndex >= 0, "Admin deletion must run application cleanup");
assert.ok(
  cleanupIndex < authDeleteIndex,
  "Application cleanup must finish before deleting Supabase Auth",
);
assert.ok(
  authDeleteIndex < verificationIndex,
  "Admin deletion must verify that the Auth row was removed",
);
assert.ok(
  !adminBody.slice(0, adminBody.indexOf("end;\n$$;")).includes("exception when others"),
  "Admin deletion must not swallow cleanup errors or return partial success",
);
assert.ok(
  adminBody.includes("'cleanup_atomic', true"),
  "Admin deletion must return an explicit atomic-cleanup confirmation",
);
assert.ok(
  normalized.includes(
    "revoke all on function public.footy_purge_direct_auth_user_refs(uuid)",
  ) && normalized.includes("from public, anon, authenticated"),
  "The privileged direct-reference sweep must not be callable by arbitrary users",
);
assert.ok(
  normalized.includes("create or replace function public.delete_account_app_data"),
  "The migration must replace the schema-invalid historical cleanup routine",
);
for (const invalidReference of [
  "from public.teams where user_id = _target_user_id",
  "from public.club_teams\n    where owner_user_id",
  "or team_profile_id = any(v_team_profile_ids)",
]) {
  assert.ok(
    !normalized.includes(invalidReference),
    `Cleanup still references a nonexistent schema column: ${invalidReference}`,
  );
}

const frontend = read(
  "src/components/admin/InlineProfileAdminControls.tsx",
);
assert.ok(
  frontend.includes('supabase.functions.invoke("admin-delete-account"'),
  "Admin deletion must run through the trusted Storage API orchestrator",
);
for (const confirmation of [
  "data?.success",
  "data?.auth_user_deleted",
  "data?.cleanup_atomic",
  "data?.storage_cleanup_complete",
]) {
  assert.ok(
    frontend.includes(confirmation),
    `Admin UI must verify server confirmation: ${confirmation}`,
  );
}
assert.ok(
  frontend.includes('"footy-status:account-deleted"'),
  "Admin UI must notify mounted views after deletion",
);
assert.ok(
  frontend.includes('navigate("/?tab=explore", { replace: true })'),
  "Deleted profile history must be replaced by a fresh Explore route",
);

assert.ok(
  storageHandoffNormalized.includes(
    "create or replace function public.admin_account_storage_manifest",
  ),
  "Storage handoff migration must expose the protected read-only manifest",
);
assert.ok(
  !storageHandoffNormalized.includes("delete from storage.objects"),
  "Database functions must never delete directly from protected storage tables",
);
for (const helper of [
  "delete_account_rows_if_column_exists",
  "delete_account_rows_if_column_matches_any",
  "null_account_column_if_exists",
]) {
  assert.ok(
    schemaSafeHelpersNormalized.includes(
      `create or replace function public.${helper}`,
    ),
    `Schema-safe migration must replace ${helper}`,
  );
}
assert.ok(
  schemaSafeHelpersNormalized.includes("c.relkind in ('r', 'p')"),
  "Cleanup helpers must skip views and operate only on real/partitioned tables",
);

const edgeFunction = read(
  "supabase/functions/admin-delete-account/index.ts",
);
for (const edgeRequirement of [
  'authed.rpc(\n    "admin_account_storage_manifest"',
  'authed.rpc(\n    "admin_delete_account"',
  ".storage.from(bucketId).remove(pathBatch)",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  assert.ok(
    edgeFunction.includes(edgeRequirement),
    `Trusted deletion function is missing: ${edgeRequirement}`,
  );
}

const behavioralSuite = read(
  "supabase/tests/account_deletion_regression_test.sql",
);
for (const scenario of [
  "existing error",
  "test 1: coach",
  "tests 2 and 3: player",
  "test 4: team account",
  "test 5: parent, scout, and referee",
]) {
  assert.ok(
    behavioralSuite.toLowerCase().includes(scenario),
    `SQL regression suite is missing scenario: ${scenario}`,
  );
}

console.log("accountDeletion.test.mjs: all static deletion checks passed");
