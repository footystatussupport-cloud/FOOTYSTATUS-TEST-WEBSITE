-- =============================================================================
-- Fixture events: full event-type set + transactional batch entry (admin only)
-- =============================================================================
-- Reuses the existing match_events table, upsert_match_event / delete_match_event
-- RPCs and sync_match_stat_bundle(). Adds:
--   1. A wider event_type whitelist (injury, VAR, half/full-time, kickoff, ...).
--   2. Nullable team_id so whole-match phase events (kickoff, half-time, ...)
--      can be stored without a team.
--   3. save_match_events_batch(): inserts many events in ONE transaction, each as
--      its own row, admin-gated, and re-syncs stats once at the end. A goal with
--      an assisting player also gets a linked 'assist' event so assist stats stay
--      correct.
-- Safe to run more than once.
-- =============================================================================

-- 1) Expand the allowed event types. Drop whatever the current check is named.
do $$
declare
  c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.match_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%event_type%';
  if c is not null then
    execute format('alter table public.match_events drop constraint %I', c);
  end if;
end $$;

alter table public.match_events
  add constraint match_events_event_type_check
  check (event_type in (
    'goal','own_goal','assist','yellow_card','second_yellow','red_card',
    'sub_in','sub_out','substitution',
    'penalty_scored','penalty_missed','penalty_awarded','penalty_saved','save',
    'injury','var','kickoff','half_time','full_time','added_time',
    'minutes_played','other'
  ));

-- 2) Allow team-less phase events (kickoff / half-time / full-time / added time).
alter table public.match_events alter column team_id drop not null;

-- 3) Transactional batch insert. Whole function is atomic: any bad event aborts
--    the entire batch, so there are never partial or duplicate-on-retry saves.
create or replace function public.save_match_events_batch(_match_id uuid, _events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb;
  v_team_id uuid;
  v_type text;
  v_minute integer;
  v_profile uuid;
  v_player_user uuid;
  v_jersey text;
  v_meta jsonb;
  v_goal_id uuid;
  v_assist_profile uuid;
  v_assist_user uuid;
  v_count integer := 0;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can add official match events.';
  end if;

  if not exists (select 1 from public.matches where id = _match_id) then
    raise exception 'Match not found.';
  end if;

  if _events is null or jsonb_typeof(_events) <> 'array' or jsonb_array_length(_events) = 0 then
    raise exception 'No events to save.';
  end if;

  for ev in select value from jsonb_array_elements(_events)
  loop
    v_type := nullif(trim(ev->>'event_type'), '');
    v_team_id := nullif(ev->>'team_id', '')::uuid;
    v_minute := nullif(ev->>'event_minute', '')::integer;
    v_profile := nullif(ev->>'player_profile_id', '')::uuid;
    v_jersey := nullif(ev->>'jersey_number', '');
    v_meta := coalesce(ev->'metadata', '{}'::jsonb);

    if v_type is null then
      raise exception 'Every event needs an event type.';
    end if;

    -- Team required for everything except whole-match phase events.
    if v_type not in ('kickoff','half_time','full_time','added_time') and v_team_id is null then
      raise exception 'A % event is missing its team.', replace(v_type, '_', ' ');
    end if;

    -- Player required for player-specific events.
    if v_type in ('goal','own_goal','penalty_scored','penalty_missed','yellow_card','second_yellow','red_card','injury')
       and v_profile is null then
      raise exception 'A % event is missing its player.', replace(v_type, '_', ' ');
    end if;

    -- Substitution needs both players (carried in metadata).
    if v_type = 'substitution'
       and (nullif(v_meta->>'player_in_profile_id','') is null or nullif(v_meta->>'player_out_profile_id','') is null) then
      raise exception 'A substitution needs both the player coming on and the player going off.';
    end if;

    if v_profile is not null then
      select user_id into v_player_user from public.player_profiles where id = v_profile;
    else
      v_player_user := null;
    end if;

    insert into public.match_events (
      match_id, team_id, player_profile_id, player_user_id, jersey_number,
      event_type, event_minute, metadata, source, status, created_by_user_id
    ) values (
      _match_id, v_team_id, v_profile, v_player_user, v_jersey,
      v_type, v_minute, v_meta, 'manual_admin', 'approved', auth.uid()
    )
    returning id into v_goal_id;
    v_count := v_count + 1;

    -- A goal with an assisting player gets its own linked 'assist' event so the
    -- assisting player is credited in stats (matches the rest of the system).
    if v_type = 'goal' and nullif(v_meta->>'assist_profile_id','') is not null then
      v_assist_profile := (v_meta->>'assist_profile_id')::uuid;
      select user_id into v_assist_user from public.player_profiles where id = v_assist_profile;
      insert into public.match_events (
        match_id, team_id, player_profile_id, player_user_id, jersey_number,
        event_type, event_minute, metadata, source, status, created_by_user_id
      ) values (
        _match_id, v_team_id, v_assist_profile, v_assist_user, nullif(v_meta->>'assist_jersey',''),
        'assist', v_minute, jsonb_build_object('goal_event_id', v_goal_id), 'manual_admin', 'approved', auth.uid()
      );
      v_count := v_count + 1;
    end if;
  end loop;

  perform public.sync_match_stat_bundle(_match_id);
  return v_count;
end;
$$;

grant execute on function public.save_match_events_batch(uuid, jsonb) to authenticated;
