-- Prevent daughter team/mother team repair flows from failing when public.teams.name
-- already exists. The visible daughter team label still comes from club_teams
-- age_group / league_name / gender; this only makes the internal teams.name safe.

create or replace function public.make_unique_team_name(
  _base_name text,
  _owner_user_id uuid default auth.uid(),
  _exclude_team_id uuid default null
)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  base_name text := coalesce(nullif(trim(_base_name), ''), 'Team');
  suffix_seed text := left(replace(coalesce(_owner_user_id, gen_random_uuid())::text, '-', ''), 8);
  candidate text;
  counter integer := 0;
begin
  loop
    candidate := case
      when counter = 0 then base_name
      else base_name || ' ' || suffix_seed || case when counter > 1 then '-' || counter::text else '' end
    end;

    exit when not exists (
      select 1
      from public.teams t
      where lower(trim(t.name)) = lower(trim(candidate))
        and (_exclude_team_id is null or t.id <> _exclude_team_id)
    );

    counter := counter + 1;
  end loop;

  return candidate;
end;
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

  if filtered_payload ? 'name' then
    filtered_payload := jsonb_set(
      filtered_payload,
      '{name}',
      to_jsonb(public.make_unique_team_name(filtered_payload ->> 'name', auth.uid(), null))
    );
  end if;

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

  begin
    execute format('insert into public.teams (%s) values (%s) returning *', insert_columns, insert_values)
    using filtered_payload
    into team_row;
  exception
    when unique_violation then
      if filtered_payload ? 'name' then
        filtered_payload := jsonb_set(
          filtered_payload,
          '{name}',
          to_jsonb(public.make_unique_team_name((filtered_payload ->> 'name') || ' ' || left(replace(gen_random_uuid()::text, '-', ''), 6), auth.uid(), null))
        );

        execute format('insert into public.teams (%s) values (%s) returning *', insert_columns, insert_values)
        using filtered_payload
        into team_row;
      else
        raise;
      end if;
  end;

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

  if filtered_payload ? 'name' then
    filtered_payload := jsonb_set(
      filtered_payload,
      '{name}',
      to_jsonb(public.make_unique_team_name(filtered_payload ->> 'name', auth.uid(), _team_id))
    );
  end if;

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

  begin
    execute format('update public.teams set %s where id = $2 returning *', update_assignments)
    using filtered_payload, _team_id
    into team_row;
  exception
    when unique_violation then
      if filtered_payload ? 'name' then
        filtered_payload := jsonb_set(
          filtered_payload,
          '{name}',
          to_jsonb(public.make_unique_team_name((filtered_payload ->> 'name') || ' ' || left(replace(gen_random_uuid()::text, '-', ''), 6), auth.uid(), _team_id))
        );

        execute format('update public.teams set %s where id = $2 returning *', update_assignments)
        using filtered_payload, _team_id
        into team_row;
      else
        raise;
      end if;
  end;

  return team_row;
end;
$$;

grant execute on function public.make_unique_team_name(text, uuid, uuid) to authenticated;
grant execute on function public.insert_team_from_valid_payload(jsonb) to authenticated;
grant execute on function public.update_team_from_valid_payload(uuid, jsonb) to authenticated;
