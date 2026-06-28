-- Fix daughter team creation on databases where public.teams is missing updated_at.
-- Also harden dynamic team insert/update helpers so invalid timestamp/id payload fields
-- cannot block daughter team creation again.

alter table public.teams
  add column if not exists updated_at timestamp with time zone not null default now();

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_updated_at_column'
  ) then
    drop trigger if exists update_teams_updated_at on public.teams;
    create trigger update_teams_updated_at
      before update on public.teams
      for each row
      execute function public.update_updated_at_column();
  end if;
end;
$$;

create or replace function public.filter_existing_team_columns(_payload jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'teams'
      and a.attname = item.key
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attidentity = ''
  );
$$;

create or replace function public.insert_team_from_valid_payload(_payload jsonb)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  filtered_payload jsonb := public.filter_existing_team_columns(_payload);
  ignored_columns text[];
  insert_columns text;
  insert_values text;
  team_row public.teams;
begin
  select coalesce(array_agg(item.key order by item.key), '{}'::text[])
  into ignored_columns
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where not (filtered_payload ? item.key);

  raise notice 'teams insert payload before filtering: %', _payload;
  raise notice 'teams insert payload after filtering: %, ignored columns: %', filtered_payload, ignored_columns;

  select
    string_agg(quote_ident(a.attname), ', ' order by a.attnum),
    string_agg(
      case
        when t.typname = 'jsonb' then format('($1 -> %L)', a.attname)
        else format('($1 ->> %L)::%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
      end,
      ', ' order by a.attnum
    )
  into insert_columns, insert_values
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'teams'
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and a.attname <> 'id'
    and filtered_payload ? a.attname
    and filtered_payload -> a.attname <> 'null'::jsonb;

  if insert_columns is null then
    raise exception 'No valid teams columns were provided.';
  end if;

  execute format('insert into public.teams (%s) values (%s) returning *', insert_columns, insert_values)
  using filtered_payload
  into team_row;

  return team_row;
end;
$$;

create or replace function public.update_team_from_valid_payload(_team_id uuid, _payload jsonb)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  filtered_payload jsonb := public.filter_existing_team_columns(_payload);
  ignored_columns text[];
  update_assignments text;
  team_row public.teams;
begin
  select coalesce(array_agg(item.key order by item.key), '{}'::text[])
  into ignored_columns
  from jsonb_each(coalesce(_payload, '{}'::jsonb)) as item(key, value)
  where not (filtered_payload ? item.key);

  raise notice 'teams update payload before filtering: %', _payload;
  raise notice 'teams update payload after filtering: %, ignored columns: %', filtered_payload, ignored_columns;

  select string_agg(
    format(
      '%I = %s',
      a.attname,
      case
        when t.typname = 'jsonb' then format('($1 -> %L)', a.attname)
        else format('($1 ->> %L)::%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
      end
    ),
    ', ' order by a.attnum
  )
  into update_assignments
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'teams'
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = ''
    and a.attname not in ('id', 'created_at', 'updated_at')
    and filtered_payload ? a.attname
    and filtered_payload -> a.attname <> 'null'::jsonb;

  if update_assignments is null then
    select *
    into team_row
    from public.teams
    where id = _team_id;

    return team_row;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'teams'
      and a.attname = 'updated_at'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    update_assignments := update_assignments || ', updated_at = now()';
  end if;

  execute format('update public.teams set %s where id = $2 returning *', update_assignments)
  using filtered_payload, _team_id
  into team_row;

  return team_row;
end;
$$;

grant execute on function public.filter_existing_team_columns(jsonb) to authenticated;
grant execute on function public.insert_team_from_valid_payload(jsonb) to authenticated;
grant execute on function public.update_team_from_valid_payload(uuid, jsonb) to authenticated;
