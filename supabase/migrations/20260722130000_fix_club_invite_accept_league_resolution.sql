-- =============================================================================
-- Fix club-team invitation acceptance: resolve the daughter team's league
-- =============================================================================
-- SYMPTOM
--   A player accepting a club-team invite gets:
--     null value in column "league" of relation "players" violates not-null constraint
--
-- EXACT CAUSE (two compounding problems)
--   public.sync_club_team_membership() — used by BOTH respond_team_player_invite
--   (player accepts an invite) and review_team_join_request (club approves a
--   request) — resolved the league name with only:
--       from public.teams t
--       left join public.leagues l on l.id = coalesce(_league_id, t.league_id)
--   It never looked at the DAUGHTER TEAM (public.club_teams), even though the
--   invite links the player to that daughter team and club_teams.league_name is
--   NOT NULL (every daughter team always has a league name) plus an optional
--   club_teams.league_id. So whenever the invite carried no league_id and the
--   mother team had none either, the LEFT JOIN produced NULL and the function
--   wrote:
--       update public.players set ... league = NULL
--   ...which public.players.league (TEXT NOT NULL) rejected, rolling back the
--   whole acceptance — the invite stayed pending and the player stayed unlinked.
--
-- FIX
--   1. Resolve the league from the daughter team's own relationship, in order:
--        a) the league_id carried on the invite / request
--        b) the DAUGHTER TEAM's league_id      (public.club_teams.league_id)  <-- new
--        c) the mother team's league_id        (public.teams.league_id)
--      ...looked up in public.leagues for the real name; if none of those
--      resolve, fall back to the daughter team's own league_name text          <-- new
--      (always present on club_teams). NULL is written only when the club team
--      genuinely has no league at all. No placeholder text is ever stored.
--   2. Store that same resolved league_id on the membership row, so the
--      player_team_memberships / Current Stats grouping uses the correct league.
--   3. Allow public.players.league to be NULL for the genuinely league-less
--      case (same one-line change as the Leave-Team fix; idempotent here).
--
-- NOT CHANGED (verified correct before writing this migration):
--   * Atomicity — respond_team_player_invite is one plpgsql function, so it runs
--     in a single transaction. It marks the invite accepted BEFORE linking, so a
--     failure in linking rolls the status update back too: the invite stays
--     pending and the player is never half-linked.
--   * Security — it requires invite_row.player_user_id = auth.uid() and
--     status = 'pending', and takes team_id / club_team_id from the STORED invite
--     row, so a player cannot redirect acceptance to a different daughter team.
--   * Duplicate protection — sync_club_team_membership updates an existing
--     (player_user_id, team_id, club_team_id) membership and only inserts when
--     none exists; a second Accept fails the 'pending' check instead.
--   * Current Stats — public.current_player_statistics returns exactly one
--     section per (player, team, league), and player_statistics is uniquely
--     constrained on (player, season, team, league) by migration 20260714120000.
--     The section appears from the membership itself; nothing is inserted here,
--     so no duplicate or cumulative section is created.
--
-- Safe to run repeatedly (idempotent). Deletes nothing.
-- =============================================================================

-- A club team may legitimately have no league; store that as NULL, never a
-- placeholder. (Same change as the Leave-Team fix — harmless if already applied.)
alter table public.players alter column league drop not null;
alter table public.players alter column club   drop not null;

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
  team_name_value text;
  league_name_value text;
  v_club_team_league_id uuid;
  v_club_team_league_name text;
  v_team_league_id uuid;
  v_effective_league_id uuid;
begin
  -- Resolve the daughter team's own league relationship first: the invite links
  -- the player to THIS club team, so its league is the source of truth.
  select ct.league_id, nullif(trim(coalesce(ct.league_name, '')), '')
  into v_club_team_league_id, v_club_team_league_name
  from public.club_teams ct
  where ct.id = _club_team_id;

  select t.name, t.league_id
  into team_name_value, v_team_league_id
  from public.teams t
  where t.id = _team_id;

  v_effective_league_id := coalesce(_league_id, v_club_team_league_id, v_team_league_id);

  select l.name
  into league_name_value
  from public.leagues l
  where l.id = v_effective_league_id;

  -- Fall back to the daughter team's stored league name; NULL only when the
  -- club team genuinely has no league.
  league_name_value := coalesce(league_name_value, v_club_team_league_name);

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = _player_user_id
    and status in ('accepted', 'approved')
    and (
      team_id <> _team_id
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  update public.player_team_memberships
  set player_profile_id = _player_profile_id,
      club_id = _club_id,
      club_team_id = _club_team_id,
      league_id = v_effective_league_id,
      age_group = _age_group,
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

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
      _club_id,
      _club_team_id,
      v_effective_league_id,
      _age_group,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  update public.player_profiles
  set team = team_name_value,
      updated_at = now()
  where id = _player_profile_id;

  update public.profiles
  set team_name = team_name_value,
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
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  return membership_row;
end;
$sync_club_team_membership$;

grant execute on function public.sync_club_team_membership(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid) to authenticated;

-- =============================================================================
-- ROLLBACK: restore the previous body from
--   20260418133000_transfer_active_team_on_invite_accept.sql
-- (Re-adding NOT NULL on players.league/club would reintroduce the bug.)
-- =============================================================================
