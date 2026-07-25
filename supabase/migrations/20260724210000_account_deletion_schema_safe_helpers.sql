-- =============================================================================
-- Permanent account deletion: schema-safe cleanup helpers
-- =============================================================================
-- Some deployed environments have current_player_statistics as a DISTINCT
-- view. Cleanup helpers must only DELETE/UPDATE real or partitioned tables;
-- views are derived from their source rows and disappear automatically after
-- those source rows are removed.
-- =============================================================================

create or replace function public.delete_account_rows_if_column_exists(
  _table_name text,
  _column_name text,
  _user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_relation regclass;
begin
  v_relation := to_regclass(format('%I.%I', 'public', _table_name));

  if v_relation is null
     or not exists (
       select 1
       from pg_class c
       where c.oid = v_relation
         and c.relkind in ('r', 'p')
     )
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = v_relation
         and a.attname = _column_name
         and a.attnum > 0
         and not a.attisdropped
     ) then
    return;
  end if;

  execute format(
    'delete from %s where %I = $1',
    v_relation,
    _column_name
  )
  using _user_id;
end;
$$;

create or replace function public.delete_account_rows_if_column_matches_any(
  _table_name text,
  _column_name text,
  _ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_relation regclass;
begin
  if coalesce(array_length(_ids, 1), 0) = 0 then
    return;
  end if;

  v_relation := to_regclass(format('%I.%I', 'public', _table_name));

  if v_relation is null
     or not exists (
       select 1
       from pg_class c
       where c.oid = v_relation
         and c.relkind in ('r', 'p')
     )
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = v_relation
         and a.attname = _column_name
         and a.attnum > 0
         and not a.attisdropped
     ) then
    return;
  end if;

  execute format(
    'delete from %s where %I = any($1)',
    v_relation,
    _column_name
  )
  using _ids;
end;
$$;

create or replace function public.null_account_column_if_exists(
  _table_name text,
  _column_name text,
  _user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_relation regclass;
begin
  v_relation := to_regclass(format('%I.%I', 'public', _table_name));

  if v_relation is null
     or not exists (
       select 1
       from pg_class c
       where c.oid = v_relation
         and c.relkind in ('r', 'p')
     )
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = v_relation
         and a.attname = _column_name
         and a.attnum > 0
         and not a.attisdropped
         and not a.attnotnull
     ) then
    return;
  end if;

  execute format(
    'update %s set %I = null where %I = $1',
    v_relation,
    _column_name,
    _column_name
  )
  using _user_id;
end;
$$;

revoke all on function public.delete_account_rows_if_column_exists(text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_account_rows_if_column_matches_any(text, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.null_account_column_if_exists(text, text, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
