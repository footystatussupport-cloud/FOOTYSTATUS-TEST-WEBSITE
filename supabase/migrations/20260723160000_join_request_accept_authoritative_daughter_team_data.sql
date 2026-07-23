-- =============================================================================
-- Accepting a player's join request must never write NULL into players.league
-- =============================================================================
-- REPORTED ERROR
--   Accepting a player's request to join a daughter team failed with:
--     null value in column "league" of relation "players" violates not-null constraint
--
-- ROOT CAUSE
--   review_team_join_request() -> sync_club_team_membership(). That function
--   resolved the league ONLY through the leagues table:
--       left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
--       ... update public.players set league = l.name
--   Daughter teams normally store their competition as FREE TEXT in
--   club_teams.league_name and leave club_teams.league_id NULL (create_daughter_team
--   only sets league_id when a public.leagues row happens to match by name). Older
--   join requests likewise store team_join_requests.league_id = NULL. So l.name
--   resolved to NULL and the write violated players.league NOT NULL, aborting the
--   whole acceptance -- the request stayed pending and the player was never linked.
--
-- THE FIX (authoritative daughter-team data, not nullability)
--   sync_club_team_membership now derives every value it needs from the
--   AUTHORITATIVE daughter-team record (public.club_teams) addressed by
--   _club_team_id, falling back to the parent team, and only then to what the
--   caller passed:
--       league     := club_teams.league_name  -> leagues.name -> existing value
--       age_group  := caller value            -> club_teams.age_group
--       league_id  := caller value            -> club_teams.league_id -> teams.league_id
--   Legacy mirror columns are written with coalesce(), so an accept/join can no
--   longer null them out under any circumstance. This works for requests created
--   BEFORE this fix, because only the daughter-team id is required to resolve
--   the league, age group and mother team.
--
--   NOTE ON NULLABILITY: this fix does NOT rely on players.league being
--   nullable -- the accept path can no longer produce NULL. players.club /
--   players.league are separately made nullable by migration 20260723140000 for
--   one genuine model reason only: a player who has left ALL teams has no club
--   or league, and that state must be representable. Linking never nulls them.
--
-- PRESERVED
--   player_team_memberships stays the single authoritative link table; the
--   enforce_daughter_team_player_gender trigger still validates gender on every
--   link; staff authorization (user_manages_team) inside review_team_join_request
--   is untouched; invites, 5-digit code joining, admin/coach/parent linking and
--   leave-team all call this same function and benefit from the same fix.
--   Multi-team linking is preserved (no other link is revoked).
--
-- Safe to run more than once.
-- =============================================================================

-- Legacy mirror columns must be able to represent "no team at all" (repeated
-- here so this migration is self-sufficient; idempotent).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'club'
  ) then
    execute 'alter table public.players alter column club drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'players' and column_name = 'league'
  ) then
    execute 'alter table public.players alter column league drop not null';
  end if;
end $$;

create or replace function public.sync_club_team_membership(
  _player_profile_id uuid,
  _player_user_id uuid,
  _team_id uuid,
  _club_id uuid,
  _club_team_id uuid,
  _league_id uuid,
  _age_group text,
  _status text,
  _joined_via text,
  _approved_by uuid
)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $sync_club_team_membership$
declare
  membership_row public.player_team_memberships;
  club_team_row public.club_teams;
  team_row public.teams;
  resolved_league_id uuid;
  resolved_age_group text;
  resolved_club_id uuid;
  team_name_value text;
  league_name_value text;
begin
  -- ---- Authoritative daughter-team + mother-team records --------------------
  if _club_team_id is not null then
    select * into club_team_row
    from public.club_teams
    where id = _club_team_id
    limit 1;
  end if;

  select * into team_row
  from public.teams
  where id = _team_id
  limit 1;

  -- Resolve from the daughter team first; the caller's values are only a hint.
  resolved_league_id := coalesce(_league_id, club_team_row.league_id, team_row.league_id);
  resolved_age_group := coalesce(nullif(trim(coalesce(_age_group, '')), ''), club_team_row.age_group);
  resolved_club_id   := coalesce(_club_id, club_team_row.club_id);

  team_name_value := team_row.name;

  -- League: the daughter team's own free-text competition name is authoritative
  -- (most daughter teams have no public.leagues row), then the leagues table.
  league_name_value := coalesce(
    nullif(trim(coalesce(club_team_row.league_name, '')), ''),
    (select l.name from public.leagues l where l.id = resolved_league_id limit 1)
  );

  -- ---- The link itself (one row per player + team + daughter team) ----------
  -- NOTE: other active links are deliberately NOT revoked; a player may be
  -- linked to several eligible daughter teams.
  update public.player_team_memberships
  set player_profile_id = coalesce(_player_profile_id, player_profile_id),
      club_id = coalesce(resolved_club_id, club_id),
      club_team_id = _club_team_id,
      league_id = coalesce(resolved_league_id, league_id),
      age_group = coalesce(resolved_age_group, age_group),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Already linked -> the update above reactivates/refreshes it (safe, no
  -- duplicate). Otherwise create the link.
  if not found then
    insert into public.player_team_memberships (
      player_profile_id,
      player_user_id,
      team_id,
      club_id,
      club_team_id,
      league_id,
      age_group,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    values (
      _player_profile_id,
      _player_user_id,
      _team_id,
      resolved_club_id,
      _club_team_id,
      resolved_league_id,
      resolved_age_group,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  -- ---- Legacy denormalized mirrors (display only, never the link) ----------
  -- coalesce() guarantees a join/accept can never null these columns.
  update public.player_profiles
  set team = coalesce(team_name_value, team),
      updated_at = now()
  where id = _player_profile_id;

  update public.profiles
  set team_name = coalesce(team_name_value, team_name),
      updated_at = now()
  where user_id = _player_user_id;

  update public.players
  set team_id = _team_id,
      club = coalesce(team_name_value, club),
      league = coalesce(league_name_value, league)
  where user_id = _player_user_id;

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = _player_user_id
    and team_id = _team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  return membership_row;
end;
$sync_club_team_membership$;

grant execute on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;

comment on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) is
  'Links a player to one daughter team using authoritative club_teams data. Never revokes other links; never nulls the legacy players mirror columns.';

notify pgrst, 'reload schema';
