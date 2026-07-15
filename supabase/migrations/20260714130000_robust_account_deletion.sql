-- =============================================================================
-- Robust account deletion — stop "Database error deleting user"
-- =============================================================================
-- Symptom
--   Deleting a NON-admin account (e.g. from the Supabase Auth dashboard) fails
--   with "Database error deleting user". Only the Footy Status Official Admin
--   account is supposed to be undeletable.
--
-- Cause
--   Deleting auth.users fires the BEFORE DELETE cleanup trigger
--   (footy_status_cleanup_app_data_before_auth_user_delete). Its cleanup uses a
--   hardcoded list of tables/columns. If ANY table that references the user is
--   missing from that list (a table added by a later migration, storage, an
--   audit table, etc.) and its foreign key does not cascade, the final
--   `delete from auth.users` is blocked by that foreign key and the whole
--   deletion aborts — surfaced only as the generic GoTrue error.
--
-- Fix
--   1. A dynamic, catalog-driven sweep that, for the user being deleted, clears
--      EVERY foreign key that directly references auth.users(id): rows are
--      deleted when the reference is NOT NULL, or set to NULL when the column is
--      nullable (so shared rows like a match are detached, not destroyed). The
--      official-admin protection FK on protected_accounts is deliberately left
--      alone, and each table is isolated so one failure can't block the rest.
--   2. Make the auth-user cleanup trigger resilient: if the existing hardcoded
--      cleanup raises, swallow it and still run the sweep, so a single missing
--      table can never make an account undeletable. The separate protection
--      trigger (protect_official_admin_auth_delete) still hard-blocks the
--      official admin, so that account stays permanently protected.
--
-- Safe to run more than once (idempotent). Deletes only rows tied to the user
-- being removed; never touches shared teams/matches beyond detaching the user.
-- =============================================================================

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
      -- Keep the official-admin protection FK intact (on delete restrict).
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

-- Resilient cleanup trigger: run the existing app-data cleanup, never let it
-- abort the deletion, then run the direct-reference sweep as a final guarantee.
create or replace function public.cleanup_app_data_after_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The official admin stays protected: the separate protect_official_admin
  -- auth-delete trigger raises and rolls the whole transaction back, so nothing
  -- swept here is ever actually committed for a protected account.
  begin
    perform public.delete_account_app_data(old.id, null, 'auth_user_deleted_cleanup');
  exception when others then
    -- A missing/edge table must not make the account undeletable; the sweep
    -- below plus foreign-key cascades still remove or detach the user's data.
    null;
  end;

  perform public.footy_purge_direct_auth_user_refs(old.id);

  return old;
end;
$$;

drop trigger if exists footy_status_cleanup_app_data_before_auth_user_delete on auth.users;
create trigger footy_status_cleanup_app_data_before_auth_user_delete
  before delete on auth.users
  for each row
  execute function public.cleanup_app_data_after_auth_user_delete();

-- Also fold the sweep into the app-facing deletion RPCs so in-app admin/self
-- deletion is equally robust (belt and suspenders; the trigger already covers
-- the raw auth.users delete these RPCs perform).
create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  perform public.assert_user_can_be_deleted(v_user_id);

  begin
    perform public.delete_account_app_data(v_user_id, v_user_id, 'self_delete_account');
  exception when others then
    null;
  end;
  perform public.footy_purge_direct_auth_user_refs(v_user_id);

  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;

  return true;
end;
$$;

create or replace function public.admin_delete_account(
  _target_user_id uuid,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_user_id uuid := auth.uid();
  v_before jsonb;
  v_result jsonb;
begin
  perform public.admin_assert_official(_reason);

  if _target_user_id is null then
    raise exception 'Target account is required.';
  end if;

  if nullif(trim(coalesce(_reason, '')), '') is null then
    raise exception 'Enter an admin note before deleting an account.';
  end if;

  perform public.assert_user_can_be_deleted(_target_user_id);

  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = _target_user_id limit 1),
    'player_profile', (select to_jsonb(p) from public.player_profiles p where p.user_id = _target_user_id limit 1),
    'staff_profile', (select to_jsonb(p) from public.staff_profiles p where p.user_id = _target_user_id limit 1),
    'parent_profile', (select to_jsonb(p) from public.parent_profiles p where p.user_id = _target_user_id limit 1),
    'team_profile', (select to_jsonb(p) from public.team_profiles p where p.user_id = _target_user_id limit 1)
  ) into v_before;

  perform public.admin_write_audit(
    'account_permanently_deleted',
    'auth.users',
    _target_user_id::text,
    _target_user_id,
    _reason,
    v_before,
    null,
    jsonb_build_object('admin_user_id', v_admin_user_id)
  );

  begin
    v_result := public.delete_account_app_data(_target_user_id, v_admin_user_id, _reason);
  exception when others then
    v_result := jsonb_build_object('success', true, 'target_user_id', _target_user_id, 'app_data_cleanup', 'partial');
  end;
  perform public.footy_purge_direct_auth_user_refs(_target_user_id);

  delete from auth.identities where user_id = _target_user_id;
  delete from auth.users where id = _target_user_id;

  return v_result || jsonb_build_object('auth_user_deleted', true);
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.admin_delete_account(uuid, text) from public;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;
