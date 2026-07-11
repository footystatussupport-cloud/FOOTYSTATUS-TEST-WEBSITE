import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Static, DB-free guarantees for the Footy Status Official Admin protection.
// The behavioural DB guarantees live in
// supabase/tests/protected_account_protection_test.sql (run in the SQL editor).

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const read = (rel) => readFileSync(join(root, rel), "utf8");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

// --- (10) No service_role / secret key ships in frontend code ---------------
const srcFiles = walk(join(root, "src")).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
const secretPattern = /service_role|SUPABASE_SERVICE_ROLE|service-role-key|SERVICE_ROLE_KEY/;
for (const file of srcFiles) {
  const contents = readFileSync(file, "utf8");
  assert.ok(
    !secretPattern.test(contents),
    `Frontend file must not reference a service_role/secret key: ${file}`,
  );
}
// The shipped client must use only the anon key.
const client = read("src/integrations/supabase/client.ts");
assert.ok(
  client.includes("VITE_SUPABASE_ANON_KEY") && !/service_role/i.test(client),
  "Supabase client must use the anon key only",
);

// --- The migration defines the registry, guard, and triggers ----------------
const migration = read(
  "supabase/migrations/20260711120000_protect_official_admin_account.sql",
);
for (const needle of [
  "create table if not exists public.protected_accounts",
  "enable row level security",
  "function public.assert_user_can_be_deleted",
  "function public.is_account_protected",
  "before delete on auth.users",
  "before delete on public.profiles",
  "protect_registry_no_update",
  "protect_registry_no_delete",
  "security definer",
]) {
  assert.ok(
    migration.toLowerCase().includes(needle.toLowerCase()),
    `Protection migration is missing: ${needle}`,
  );
}

// --- delete_my_account calls the guard BEFORE deleting anything --------------
const fnStart = migration.indexOf("function public.delete_my_account()");
assert.ok(fnStart > -1, "delete_my_account must exist in the migration");
const fnBody = migration.slice(fnStart);
const assertIdx = fnBody.indexOf("assert_user_can_be_deleted");
const firstDeleteIdx = fnBody.search(/\n\s*(perform public\.delete_account_rows_if_column_exists|delete from)/i);
assert.ok(assertIdx > -1, "delete_my_account must call assert_user_can_be_deleted");
assert.ok(
  assertIdx < firstDeleteIdx,
  "assert_user_can_be_deleted must run BEFORE any delete in delete_my_account",
);

// --- Settings UI wires the shared guard and hides the delete control --------
const settings = read("src/pages/SettingsPage.tsx");
assert.ok(
  settings.includes("assertUserCanBeDeleted"),
  "SettingsPage must call the shared assertUserCanBeDeleted guard",
);
assert.ok(
  settings.includes("isCurrentUserDeletionProtected") &&
    settings.includes("!deletionProtected"),
  "SettingsPage must hide the Delete Account control for protected accounts",
);

console.log("protectedAccounts.test.mjs: all static protection checks passed");
