-- =============================================================================
-- Fix fixture timeline batch save conflict
-- =============================================================================
-- Root cause:
--   compute_and_store_match_minutes() uses:
--     ON CONFLICT (match_id, player_profile_id)
--   against public.match_player_minutes.
--
-- If match_player_minutes already existed before the auto-minutes migration ran,
-- CREATE TABLE IF NOT EXISTS did not add the unique constraint declared inside
-- the create-table statement. That leaves Postgres with no matching unique or
-- exclusion constraint and causes admin fixture timeline saves to fail with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- This migration:
--   1) safely removes duplicate match_player_minutes rows,
--   2) adds the missing unique index required by ON CONFLICT,
--   3) hardens save_match_events_batch so batch saves are scoped to the fixture
--      and update existing row ids instead of accidentally inserting duplicates.
-- =============================================================================

-- 1) Ensure the per-fixture minutes table exists with the columns used by the
--    minutes engine. Safe if the table already exists.
create table if not exists public.match_player_minutes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_profile_id uuid not null references public.player_profiles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  minutes integer not null default 0,
  started boolean not null default false,
  intervals jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

-- If the table existed without newer columns, add them.
alter table public.match_player_minutes
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists minutes integer not null default 0,
  add column if not exists started boolean not null default false,
  add column if not exists intervals jsonb not null default '[]'::jsonb,
  add column if not exists computed_at timestamptz not null default now();

-- 2) Deduplicate before adding the unique index. Keep the newest computed row
--    for each fixture/player pair.
with ranked_minutes as (
  select
    id,
    row_number() over (
      partition by match_id, player_profile_id
      order by computed_at desc nulls last, id desc
    ) as rn
  from public.match_player_minutes
)
delete from public.match_player_minutes mpm
using ranked_minutes ranked
where mpm.id = ranked.id
  and ranked.rn > 1;

-- 3) Add the exact unique index required by:
--    ON CONFLICT (match_id, player_profile_id)
create unique index if not exists match_player_minutes_match_player_profile_uidx
  on public.match_player_minutes (match_id, player_profile_id);

alter table public.match_player_minutes enable row level security;

drop policy if exists "Match minutes viewable by everyone" on public.match_player_minutes;
create policy "Match minutes viewable by everyone"
  on public.match_player_minutes
  for select
  using (true);

-- 4) Replace the batch-save RPC with a fixture-scoped implementation. Existing
--    events are updated only when their id belongs to the same fixture. New
--    events are inserted as separate rows. Goal assist rows are regenerated for
--    the matching goal id so retries/edits do not create stacked assist rows.
create or replace function public.save_match_events_batch(_match_id uuid, _events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb;
  v_event_id uuid;
  v_saved_event_id uuid;
  v_existing_match_id uuid;
  v_team_id uuid;
  v_type text;
  v_minute integer;
  v_profile uuid;
  v_player_user uuid;
  v_jersey text;
  v_meta jsonb;
  v_assist_profile uuid;
  v_assist_user uuid;
  v_count integer := 0;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can add official match events.';
  end if;

  if _match_id is null or not exists (select 1 from public.matches where id = _match_id) then
    raise exception 'Match not found.';
  end if;

  if _events is null or jsonb_typeof(_events) <> 'array' or jsonb_array_length(_events) = 0 then
    raise exception 'No events to save.';
  end if;

  for ev in select value from jsonb_array_elements(_events)
  loop
    v_event_id := nullif(trim(coalesce(ev->>'id', '')), '')::uuid;
    v_type := nullif(trim(coalesce(ev->>'event_type', '')), '');
    v_team_id := nullif(trim(coalesce(ev->>'team_id', '')), '')::uuid;
    v_minute := nullif(trim(coalesce(ev->>'event_minute', '')), '')::integer;
    v_profile := nullif(trim(coalesce(ev->>'player_profile_id', '')), '')::uuid;
    v_jersey := nullif(trim(coalesce(ev->>'jersey_number', '')), '');
    v_meta := coalesce(ev->'metadata', '{}'::jsonb);

    if v_type is null then
      raise exception 'Every event needs an event type.';
    end if;

    if v_type not in (
      'goal','assist','yellow_card','second_yellow','red_card',
      'minutes_played','sub_in','sub_out','substitution',
      'penalty_scored','penalty_missed','penalty_awarded','penalty_saved',
      'own_goal','save','injury','var','kickoff','half_time','full_time',
      'added_time','other'
    ) then
      raise exception 'Unsupported match event type: %', v_type;
    end if;

    if v_minute is not null and v_minute < 0 then
      raise exception 'Match minute cannot be negative.';
    end if;

    -- Team required for everything except whole-match phase events.
    if v_type not in ('kickoff','half_time','full_time','added_time') and v_team_id is null then
      raise exception 'A % event is missing its team.', replace(v_type, '_', ' ');
    end if;

    -- If a team is provided, it must be one of the fixture teams.
    if v_team_id is not null and not exists (
      select 1
      from public.matches m
      where m.id = _match_id
        and (m.home_team_id = v_team_id or m.away_team_id = v_team_id)
    ) then
      raise exception 'The selected team does not belong to this fixture.';
    end if;

    -- Player required for player-specific events.
    if v_type in (
      'goal','own_goal','penalty_scored','penalty_missed',
      'yellow_card','second_yellow','red_card','injury'
    ) and v_profile is null then
      raise exception 'A % event is missing its player.', replace(v_type, '_', ' ');
    end if;

    if v_type = 'substitution'
       and (
         nullif(trim(coalesce(v_meta->>'player_in_profile_id', '')), '') is null
         or nullif(trim(coalesce(v_meta->>'player_out_profile_id', '')), '') is null
       ) then
      raise exception 'A substitution needs both the player coming on and the player going off.';
    end if;

    if v_profile is not null then
      select user_id into v_player_user
      from public.player_profiles
      where id = v_profile;

      if v_player_user is null then
        raise exception 'Selected player was not found.';
      end if;
    else
      v_player_user := null;
    end if;

    v_saved_event_id := null;

    if v_event_id is not null then
      select match_id into v_existing_match_id
      from public.match_events
      where id = v_event_id;

      if v_existing_match_id is not null and v_existing_match_id <> _match_id then
        raise exception 'Cannot update an event from another fixture.';
      end if;

      update public.match_events
      set
        team_id = v_team_id,
        player_profile_id = v_profile,
        player_user_id = v_player_user,
        jersey_number = v_jersey,
        event_type = v_type,
        event_minute = v_minute,
        metadata = v_meta,
        source = 'manual_admin',
        status = 'approved',
        updated_at = now()
      where id = v_event_id
        and match_id = _match_id
      returning id into v_saved_event_id;
    end if;

    if v_saved_event_id is null then
      insert into public.match_events (
        id,
        match_id,
        team_id,
        player_profile_id,
        player_user_id,
        jersey_number,
        event_type,
        event_minute,
        metadata,
        source,
        status,
        created_by_user_id
      ) values (
        coalesce(v_event_id, gen_random_uuid()),
        _match_id,
        v_team_id,
        v_profile,
        v_player_user,
        v_jersey,
        v_type,
        v_minute,
        v_meta,
        'manual_admin',
        'approved',
        auth.uid()
      )
      returning id into v_saved_event_id;
    end if;

    v_count := v_count + 1;

    -- Regenerate linked assist row for this goal only. This prevents duplicate
    -- assist rows when an admin edits/saves the same goal again.
    delete from public.match_events
    where match_id = _match_id
      and event_type = 'assist'
      and metadata->>'goal_event_id' = v_saved_event_id::text;

    if v_type = 'goal' and nullif(trim(coalesce(v_meta->>'assist_profile_id', '')), '') is not null then
      v_assist_profile := (v_meta->>'assist_profile_id')::uuid;

      select user_id into v_assist_user
      from public.player_profiles
      where id = v_assist_profile;

      if v_assist_user is null then
        raise exception 'Selected assisting player was not found.';
      end if;

      insert into public.match_events (
        match_id,
        team_id,
        player_profile_id,
        player_user_id,
        jersey_number,
        event_type,
        event_minute,
        metadata,
        source,
        status,
        created_by_user_id
      ) values (
        _match_id,
        v_team_id,
        v_assist_profile,
        v_assist_user,
        nullif(trim(coalesce(v_meta->>'assist_jersey', '')), ''),
        'assist',
        v_minute,
        jsonb_build_object('goal_event_id', v_saved_event_id),
        'manual_admin',
        'approved',
        auth.uid()
      );

      v_count := v_count + 1;
    end if;
  end loop;

  perform public.sync_match_stat_bundle(_match_id);
  return v_count;
end;
$$;

grant execute on function public.save_match_events_batch(uuid, jsonb) to authenticated;
