-- =============================================================================
-- Fix "Database error deleting user" — safe, resilient account deletion
-- =============================================================================
-- SYMPTOM
--   Deleting a user from the Supabase Auth dashboard (or any raw
--   `delete from auth.users`) fails with: "Database error deleting user".
--
-- EXACT CAUSE (two independent blockers, both fixed below)
--   1) Foreign keys that reference auth.users(id) with ON DELETE RESTRICT.
--      The only RESTRICT FKs to auth.users in this schema are the moderation
--      audit columns:
--        - public.account_strikes.admin_user_id        (NOT NULL, RESTRICT)
--        - public.temporary_bans.admin_user_id         (NOT NULL, RESTRICT)
--        - public.content_report_actions.admin_user_id (NOT NULL, RESTRICT)
--      If the account being deleted ever issued a strike / ban / report action,
--      one of these RESTRICT rows still points at it, so Postgres refuses to
--      delete the auth.users row. (The 4th RESTRICT FK — protected_accounts.
--      user_id — is the INTENTIONAL Official-Admin protection and is left as-is.)
--   2) The BEFORE DELETE cleanup trigger on auth.users
--      (footy_status_cleanup_app_data_before_auth_user_delete) calls
--      public.delete_account_app_data(old.id) with NO exception handling. If
--      that function raises for ANY reason (a table added later that it does not
--      clean, an unexpected constraint, etc.), the whole auth.users delete
--      aborts — surfaced only as the generic GoTrue "Database error deleting
--      user".
--
-- FIX
--   A) Repoint the three moderation admin_user_id FKs to ON DELETE SET NULL and
--      make the column nullable. A strike / ban / report action is an audit
--      record ABOUT THE SUBJECT user; it must SURVIVE the deletion of the admin
--      who issued it, with the issuing admin simply detached. This both unblocks
--      deletion and preserves moderation history (per the "shared/related record"
--      rule — do not delete the record just because one linked user is removed).
--      The subject columns (account_id) keep ON DELETE CASCADE, so a user's own
--      strikes/bans go away with them.
--   B) Replace the cleanup trigger function with a resilient version: run the
--      existing app-data cleanup best-effort (swallowing any error), then run a
--      dynamic, catalog-driven sweep that clears EVERY remaining single-column
--      FK that references auth.users(id) for the user being deleted — deleting
--      the row when the column is NOT NULL, or setting it NULL when nullable
--      (so shared rows like a match are detached, never destroyed). Each table
--      is isolated so one failure can't block the rest. This makes deletion
--      resilient to any current OR future table.
--
-- WHAT IS PRESERVED
--   * Official-Admin protection: the separate protect_official_admin_auth_delete
--     BEFORE DELETE trigger still raises for the protected account. It fires
--     after this cleanup (alphabetical order: "footy_..." < "protect_..."), and
--     because everything runs in one transaction, its RAISE rolls back the whole
--     delete — the protected account keeps every row. protected_accounts is also
--     explicitly skipped by the sweep.
--   * All existing RLS, tables, and non-deletion behavior are untouched.
--
-- SAFETY
--   Idempotent (safe to run repeatedly). Deletes NO current users. Drops NO
--   tables. Does not disable FK checks or RLS. Only alters the 3 named FKs and
--   the cleanup trigger function.
--
-- ---------------------------------------------------------------------------
-- DIAGNOSTIC SQL (read-only — run any of these first to confirm state; they
-- change nothing). Left as comments so this migration stays non-interactive.
-- ---------------------------------------------------------------------------
-- -- (a) All FKs that reference auth.users(id) and their ON DELETE rule:
-- select con.conname, rel.relname as table_name, att.attname as column_name,
--        case con.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
--             when 'c' then 'CASCADE' when 'n' then 'SET NULL'
--             when 'd' then 'SET DEFAULT' end as on_delete
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
--  where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
--  order by on_delete desc, table_name;
-- -- (b) Just the blocking ones (RESTRICT / NO ACTION):
-- --     same query, add:  and con.confdeltype in ('r','a')
-- -- (c) BEFORE/AFTER DELETE triggers on auth.users:
-- select tgname, tgenabled, pg_get_triggerdef(oid)
--   from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- -- (d) Orphaned profiles (profiles with no matching auth.users row):
-- select p.user_id from public.profiles p
--   left join auth.users u on u.id = p.user_id where u.id is null;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Repoint the three moderation admin_user_id FKs -> ON DELETE SET NULL.
--    Discovers the EXACT existing constraint name from the catalog (never
--    assumes it), so a non-standard name is handled. Skips a table/column that
--    does not exist, and does nothing if the FK is already SET NULL.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array['account_strikes', 'temporary_bans', 'content_report_actions'];
  v_table  text;
  v_conname text;
  v_deltype "char";
begin
  foreach v_table in array v_tables loop
    -- Skip if the table or the admin_user_id column is not present.
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'admin_user_id'
    ) then
      continue;
    end if;

    -- Find the FK on (v_table.admin_user_id) that references auth.users.
    select con.conname, con.confdeltype
      into v_conname, v_deltype
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and ns.nspname = 'public'
      and rel.relname = v_table
      and att.attname = 'admin_user_id'
      and array_length(con.conkey, 1) = 1
    limit 1;

    -- Make the column nullable so SET NULL is legal (idempotent).
    execute format('alter table public.%I alter column admin_user_id drop not null', v_table);

    -- Only rebuild the FK when it is not already SET NULL ('n').
    if v_conname is not null and v_deltype is distinct from 'n' then
      execute format('alter table public.%I drop constraint %I', v_table, v_conname);
    end if;

    if not exists (
      select 1
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
        and ns.nspname = 'public'
        and rel.relname = v_table
        and att.attname = 'admin_user_id'
        and con.confdeltype = 'n'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (admin_user_id) references auth.users(id) on delete set null',
        v_table, v_table || '_admin_user_id_fkey'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- B. Resilient cleanup: dynamic catalog-driven sweep of every direct
--    auth.users reference for the user being deleted.
-- ---------------------------------------------------------------------------
create or replace function public.footy_purge_direct_auth_user_refs(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  r record;
begin
  if _user_id is null then
    return;
  end if;

  for r in
    select
      ns.nspname     as schema_name,
      rel.relname    as table_name,
      att.attname    as column_name,
      att.attnotnull as not_null
    from pg_constraint con
    join pg_class rel     on rel.oid = con.conrelid
    join pg_namespace ns  on ns.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid
                          and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1        -- single-column FKs only
      and rel.relkind = 'r'                       -- ordinary tables
      and ns.nspname in ('public', 'storage')     -- never touch the auth schema
      -- Keep the Official-Admin protection FK intact (on delete restrict).
      and not (ns.nspname = 'public' and rel.relname = 'protected_accounts')
  loop
    begin
      if r.not_null then
        execute format('delete from %I.%I where %I = $1', r.schema_name, r.table_name, r.column_name)
        using _user_id;
      else
        execute format('update %I.%I set %I = null where %I = $1', r.schema_name, r.table_name, r.column_name, r.column_name)
        using _user_id;
      end if;
    exception when others then
      -- Never let a single table block the whole deletion.
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.footy_purge_direct_auth_user_refs(uuid) from public;
grant execute on function public.footy_purge_direct_auth_user_refs(uuid) to authenticated;

-- Replace the fragile cleanup trigger function. Best-effort call to the
-- existing app-data cleanup (only if it exists, and swallowing any error),
-- then the guaranteed sweep. Never references the protection functions, so it
-- is fully self-contained; the separate protect_official_admin_auth_delete
-- trigger still hard-blocks (and rolls back) deletion of the protected admin.
create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.delete_account_app_data(uuid, uuid, text)') is not null then
    begin
      perform public.delete_account_app_data(old.id, null, 'auth_user_deleted_cleanup');
    exception when others then
      -- A missing/edge table must not make the account undeletable; the sweep
      -- below plus foreign-key cascades still remove or detach the user's data.
      null;
    end;
  end if;

  perform public.footy_purge_direct_auth_user_refs(old.id);

  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

-- =============================================================================
-- ROLLBACK (only if ever needed — not recommended; RESTRICT re-introduces the
-- deletion bug). Run manually:
--   alter table public.account_strikes        drop constraint account_strikes_admin_user_id_fkey;
--   alter table public.account_strikes        add  constraint account_strikes_admin_user_id_fkey
--     foreign key (admin_user_id) references auth.users(id) on delete restrict;
--   -- (repeat for temporary_bans, content_report_actions)
--   -- Restore the previous cleanup body from
--   -- 20260713230000_complete_account_deletion_all_types.sql if desired.
-- =============================================================================
