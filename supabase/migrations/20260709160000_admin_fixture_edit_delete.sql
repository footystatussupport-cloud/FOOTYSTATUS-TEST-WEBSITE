-- Footy Status admin fixture management: full lifetime edit + permanent delete.
--
-- The frontend already calls update_match_details() and delete_match(), but
-- neither RPC existed in the database, so admin edits and deletions failed.
-- This adds both, admin-gated, with NO status/time lock — the Footy Status admin
-- can edit or delete ANY fixture at any time (upcoming, live, completed, or old).
--
-- Deletion relies on the existing ON DELETE CASCADE foreign keys from every
-- child table (match_events, match_comments, referee_match_claims,
-- match_film_links, assist_claims, referee_report_uploads, ...) to matches(id),
-- so removing the match row cleans up every related record with no orphans.

-- Edit any fixture field, at any time (admin only, no lock). ------------------
create or replace function public.update_match_details(
  _match_id uuid,
  _home_team_id uuid,
  _away_team_id uuid,
  _home_club_team_id uuid default null,
  _away_club_team_id uuid default null,
  _scheduled_at timestamptz default null,
  _venue text default null,
  _venue_address text default null,
  _home_jersey_color text default null,
  _away_jersey_color text default null,
  _notes text default null,
  _status text default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  home_team_row public.teams;
  away_team_row public.teams;
  result_row public.matches;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can edit fixtures.';
  end if;

  if _home_team_id = _away_team_id then
    raise exception 'A team cannot play itself.';
  end if;

  select * into home_team_row from public.teams where id = _home_team_id;
  select * into away_team_row from public.teams where id = _away_team_id;

  update public.matches
  set home_team_id = _home_team_id,
      away_team_id = _away_team_id,
      home_team = coalesce(home_team_row.name, home_team),
      away_team = coalesce(away_team_row.name, away_team),
      home_club_team_id = _home_club_team_id,
      away_club_team_id = _away_club_team_id,
      scheduled_at = coalesce(_scheduled_at, scheduled_at),
      venue = _venue,
      venue_address = _venue_address,
      home_jersey_color = _home_jersey_color,
      away_jersey_color = _away_jersey_color,
      notes = _notes,
      status = coalesce(nullif(trim(coalesce(_status, '')), ''), status),
      updated_at = now()
  where id = _match_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Match not found.';
  end if;

  -- Keep team win/loss records in sync when the edit could affect standings.
  begin
    perform public.sync_league_records_from_standings(result_row.league_id);
  exception when others then
    null;
  end;

  return result_row;
end;
$$;

grant execute on function public.update_match_details(uuid, uuid, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text) to authenticated;

-- Permanently delete any fixture (admin only). Children cascade automatically. -
create or replace function public.delete_match(_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_league_id uuid;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can delete fixtures.';
  end if;

  select league_id into target_league_id from public.matches where id = _match_id;

  if not found then
    raise exception 'Match not found.';
  end if;

  -- ON DELETE CASCADE FKs remove match_events, comments, referee claims, film
  -- links, assist claims, reports, etc. — no orphaned records remain.
  delete from public.matches where id = _match_id;

  begin
    perform public.sync_league_records_from_standings(target_league_id);
  exception when others then
    null;
  end;

  return _match_id;
end;
$$;

grant execute on function public.delete_match(uuid) to authenticated;
