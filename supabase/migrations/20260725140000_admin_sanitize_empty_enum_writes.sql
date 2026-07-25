-- =============================================================================
-- Fix: "invalid input value for enum account_type: \"\"" on admin account edits.
-- =============================================================================
-- ROOT CAUSE
--   The generic admin write path (admin_patch_account_record ->
--   admin_apply_user_row_update, and the source-of-truth sync) applies a JSON
--   changes object to a row with jsonb_populate_record(null::<rowtype>, changes).
--   When the admin "Edit Profile" header saved a Player whose account_role was
--   blank, it sent {"account_role": ""}. An empty string bound for the
--   account_type enum (the profiles.role column and the constrained role/category
--   columns) is cast as ''::account_type and Postgres correctly rejects it.
--
-- FIX (does NOT weaken the enum)
--   Sanitize the changes BEFORE they are applied: drop any key whose value is an
--   empty/whitespace-only string when the target column is not plain text — i.e.
--   enums (account_type), uuids, dates, timestamps, numbers, booleans — or is one
--   of the constrained role/category columns. A blank value there means "not
--   provided", so the existing value is preserved instead of being overwritten
--   with an invalid ''. The account's account_type/role is never blanked by an
--   unrelated edit (e.g. a plan change), and only real values are ever written.
--
-- Safe to run repeatedly (idempotent).
-- =============================================================================

create or replace function public.admin_sanitize_record_changes(
  _table_name text,
  _changes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text;
  v_clean jsonb := '{}'::jsonb;
  v_data_type text;
begin
  if _changes is null then
    return '{}'::jsonb;
  end if;

  for v_key in select jsonb_object_keys(_changes)
  loop
    select data_type into v_data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = v_key;

    -- Unknown columns are left untouched; the callers already skip them safely.
    if v_data_type is null then
      v_clean := v_clean || jsonb_build_object(v_key, _changes->v_key);
      continue;
    end if;

    -- Drop empty/whitespace-only strings that must never be written to a
    -- non-text column (enum/uuid/date/number/boolean) or to a constrained
    -- role/category column. This is what prevents ''::account_type.
    if jsonb_typeof(_changes->v_key) = 'string'
       and length(btrim(coalesce(_changes->>v_key, ''))) = 0
       and (
         v_data_type not in ('text', 'character varying', 'character', 'citext')
         or v_key in ('account_role', 'account_category', 'account_type')
       )
    then
      continue;  -- skip: preserve the existing value instead of writing ''
    end if;

    v_clean := v_clean || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  return v_clean;
end;
$$;

revoke all on function public.admin_sanitize_record_changes(text, jsonb) from public, anon;
grant execute on function public.admin_sanitize_record_changes(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-apply the two writers so they sanitize before touching the row. The bodies
-- are unchanged except for the single sanitize step (and therefore the
-- jsonb_populate_record calls can never see a '' bound for the enum).
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_user_row_update(
  _table_name text,
  _target_user_id uuid,
  _changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_applied jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official('admin_apply_user_row_update');
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_apply_user_row_update');

  if _target_user_id is null then
    raise exception 'Target account id is required.';
  end if;

  if to_regclass('public.' || _table_name) is null then
    return v_applied;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'user_id'
  ) then
    return v_applied;
  end if;

  -- Never let an empty string reach an enum / non-text / role column.
  _changes := public.admin_sanitize_record_changes(_table_name, _changes);

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','user_id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = _table_name
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.%1$I t
       set %2$I = r.%2$I
       from (select * from jsonb_populate_record(null::public.%1$I, $1)) r
       where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;

    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'updated_at'
  ) then
    execute format('update public.%I set updated_at = now() where user_id = $1', _table_name)
    using _target_user_id;
  end if;

  return v_applied;
end;
$$;

create or replace function public.admin_patch_account_record(
  _target_user_id uuid,
  _table_name text,
  _changes jsonb,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_allowed_tables text[] := array['profiles','player_profiles','staff_profiles','parent_profiles','team_profiles'];
  v_applied jsonb := '{}'::jsonb;
  v_sync jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_patch_account_record');
  perform public.admin_repair_account_records(_target_user_id);

  if not (_table_name = any(v_allowed_tables)) then
    raise exception 'That account record cannot be edited here.';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_before using _target_user_id;

  if v_before is null then
    raise exception 'Account record not found for table %. The account could not be repaired automatically.', _table_name;
  end if;

  -- Never let an empty string reach an enum / non-text / role column.
  _changes := public.admin_sanitize_record_changes(_table_name, _changes);

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','user_id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = _table_name
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.%1$I t
       set %2$I = r.%2$I
       from (select * from jsonb_populate_record(null::public.%1$I, $1)) r
       where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;

    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'updated_at'
  ) then
    execute format('update public.%I set updated_at = now() where user_id = $1', _table_name)
    using _target_user_id;
  end if;

  v_sync := public.admin_sync_account_source_of_truth(_target_user_id, _table_name, v_applied);

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_after using _target_user_id;

  perform public.admin_write_audit(
    'account_record_updated',
    _table_name,
    coalesce(v_after->>'id', _target_user_id::text),
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object('applied', v_applied, 'sync', v_sync)
  );

  return v_after || jsonb_build_object('_sync', v_sync);
end;
$$;

revoke all on function public.admin_apply_user_row_update(text, uuid, jsonb) from public, anon;
grant execute on function public.admin_apply_user_row_update(text, uuid, jsonb) to authenticated;
revoke all on function public.admin_patch_account_record(uuid, text, jsonb, text) from public, anon;
grant execute on function public.admin_patch_account_record(uuid, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
