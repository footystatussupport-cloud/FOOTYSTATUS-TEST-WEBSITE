-- =============================================================================
-- Substitution-rules engine (Phase 2) — rigid validation for serious leagues
-- =============================================================================
-- Each league can be "strict" (enforce_sub_rules = true). When strict, the
-- database REJECTS invalid substitution events regardless of how they were
-- submitted (batch RPC, single upsert, direct write). Casual leagues
-- (enforce_sub_rules = false, the default) stay flexible — nothing is blocked.
--
-- Mirrors tests/subValidation.test.mjs (verified). Reuses league config columns
-- from the auto-minutes migration (allow_reentry, max_substitutions) plus a new
-- enforce flag. Safe to run more than once.
-- =============================================================================

alter table public.leagues
  add column if not exists enforce_sub_rules boolean not null default false;

-- Validate ONE player's proposed on/off event against the strict rules.
-- Returns a human-readable violation message, or null if the action is allowed.
create or replace function public.validate_participation_for_player(
  _match_id uuid,
  _player_profile_id uuid,
  _event_type text,       -- 'sub_in' or 'sub_out' (or the in/out side of a substitution)
  _event_minute integer,
  _exclude_event_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_duration integer := coalesce(public.match_effective_duration(_match_id), 90);
  v_allow_reentry boolean;
  v_max_subs integer;
  v_on_field boolean := false;
  v_ever_red boolean := false;
  v_sub_out_count integer := 0;
  v_team_subs_used integer := 0;
  v_evt record;
begin
  select coalesce(l.allow_reentry, false), l.max_substitutions
    into v_allow_reentry, v_max_subs
  from public.matches m
  left join public.leagues l on l.id = m.league_id
  where m.id = _match_id;

  -- Minute bounds apply to any timed sub.
  if _event_minute is null or _event_minute < 0 then
    return 'Substitution minute cannot be before kickoff.';
  end if;
  if _event_minute > v_duration then
    return format('Substitution minute cannot be after the final whistle (%s minutes).', v_duration);
  end if;

  -- Reconstruct this player's on/off history from existing approved events.
  for v_evt in
    select event_type, event_minute,
           nullif(metadata ->> 'player_in_profile_id', '')::uuid as pin,
           nullif(metadata ->> 'player_out_profile_id', '')::uuid as pout
    from public.match_events
    where match_id = _match_id and status = 'approved'
      and (_exclude_event_id is null or id <> _exclude_event_id)
      and (player_profile_id = _player_profile_id
           or (event_type = 'substitution'
               and (nullif(metadata ->> 'player_in_profile_id', '')::uuid = _player_profile_id
                    or nullif(metadata ->> 'player_out_profile_id', '')::uuid = _player_profile_id)))
    order by coalesce(event_minute, 0) asc, created_at asc
  loop
    if v_evt.event_type = 'sub_in' or (v_evt.event_type = 'substitution' and v_evt.pin = _player_profile_id) then
      v_on_field := true;
    elsif v_evt.event_type = 'sub_out' or (v_evt.event_type = 'substitution' and v_evt.pout = _player_profile_id) then
      v_on_field := false; v_sub_out_count := v_sub_out_count + 1;
    elsif v_evt.event_type = 'injury' then
      v_on_field := false;
    elsif v_evt.event_type = 'red_card' then
      v_on_field := false; v_ever_red := true;
    end if;
  end loop;

  if _event_type = 'sub_in' then
    if v_ever_red then
      return 'A player sent off with a red card cannot return to the match.';
    end if;
    if v_on_field then
      return 'That player is already on the field and cannot be substituted in again.';
    end if;
    if v_sub_out_count > 0 and not v_allow_reentry then
      return 'This competition does not allow a substituted player to return to the match.';
    end if;
    if v_max_subs is not null then
      select count(*) into v_team_subs_used
      from public.match_events
      where match_id = _match_id and status = 'approved'
        and (_exclude_event_id is null or id <> _exclude_event_id)
        and event_type in ('sub_in', 'substitution');
      if v_team_subs_used >= v_max_subs then
        return format('The substitution limit for this competition (%s) has been reached.', v_max_subs);
      end if;
    end if;
  elsif _event_type = 'sub_out' then
    if not v_on_field then
      return 'That player is not currently on the field and cannot be substituted out.';
    end if;
  end if;

  return null;
end;
$$;

-- Enforcement trigger: block invalid subs on strict leagues.
create or replace function public.tg_validate_match_participation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforce boolean;
  v_msg text;
begin
  -- Only substitution-type events need validation.
  if new.event_type not in ('sub_in', 'sub_out', 'substitution') then
    return new;
  end if;

  select coalesce(l.enforce_sub_rules, false) into v_enforce
  from public.matches m
  left join public.leagues l on l.id = m.league_id
  where m.id = new.match_id;

  if not coalesce(v_enforce, false) then
    return new;  -- casual league: stay flexible
  end if;

  if new.event_type = 'sub_in' then
    v_msg := public.validate_participation_for_player(new.match_id, new.player_profile_id, 'sub_in', new.event_minute, new.id);
  elsif new.event_type = 'sub_out' then
    v_msg := public.validate_participation_for_player(new.match_id, new.player_profile_id, 'sub_out', new.event_minute, new.id);
  elsif new.event_type = 'substitution' then
    v_msg := public.validate_participation_for_player(
      new.match_id, nullif(new.metadata ->> 'player_in_profile_id', '')::uuid, 'sub_in', new.event_minute, new.id);
    if v_msg is null then
      v_msg := public.validate_participation_for_player(
        new.match_id, nullif(new.metadata ->> 'player_out_profile_id', '')::uuid, 'sub_out', new.event_minute, new.id);
    end if;
  end if;

  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_match_participation on public.match_events;
create trigger validate_match_participation
  before insert or update on public.match_events
  for each row execute function public.tg_validate_match_participation();

grant execute on function public.validate_participation_for_player(uuid, uuid, text, integer, uuid) to authenticated;
