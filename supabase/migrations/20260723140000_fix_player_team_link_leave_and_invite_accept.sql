-- =============================================================================
-- Fix player <-> daughter-team linking: Leave Team, and Accept Invitation
-- =============================================================================
-- ROOT CAUSE (one shared cause behind both reported errors)
--   public.players is a LEGACY denormalized mirror with two NOT NULL columns:
--       players.club   text NOT NULL
--       players.league text NOT NULL
--   Both linking functions write NULL into them, so the whole transaction
--   aborts with a not-null violation (23502) and the app shows its generic
--   message:
--
--   1) leave_team_membership()
--        - no teams left  -> "set club = null, league = null"      -> 23502
--        - a team remains -> "league = v_next_league_name", which is NULL
--          whenever the remaining team's league is stored as free text with no
--          matching public.leagues row                              -> 23502
--      => "Could not leave team."
--
--   2) sync_club_team_membership() (called by respond_team_player_invite)
--        - "league = league_name_value", resolved through
--          "left join public.leagues l on l.id = coalesce(_league_id, t.league_id)".
--          Daughter teams commonly store league_name as text with league_id
--          NULL, so this is NULL                                    -> 23502
--      => "Invite update failed."  (Decline never runs this path, which is why
--         declining worked.)
--
-- SECOND DEFECT (silently breaks multi-team linking)
--   sync_club_team_membership() began by REVOKING every other active link:
--       update player_team_memberships set status='revoked'
--        where player_user_id = _player_user_id and status in (...)
--          and (team_id <> _team_id or club_team_id <> _club_team_id)
--   So linking a player to a second daughter team silently unlinked them from
--   the first. player_team_memberships is the authoritative link table and a
--   player may be linked to several eligible daughter teams.
--
-- FIXES
--   A) Drop NOT NULL on the legacy players.club / players.league mirror columns.
--      The authoritative link is public.player_team_memberships; these legacy
--      single-value fields must never be treated as the link, and a player with
--      no team legitimately has no club/league.
--   B) sync_club_team_membership: stop revoking other links (multi-team linking
--      works), and keep the legacy mirror update non-destructive.
--   C) leave_team_membership: unlink ONLY the selected daughter team, never
--      raise when the player is already unlinked (returns a safe state), and
--      return the player's remaining linked teams.
--
-- PRESERVED
--   RLS, the enforce_daughter_team_player_gender trigger on
--   player_team_memberships (boys/girls restrictions still enforced on every
--   link), approvals, invites, requests, rosters, Current Stats, notifications,
--   the 5-digit code flow, and admin/coach/parent linking. No new "membership"
--   concept is introduced -- this repairs the existing linking tables.
--
-- Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Legacy mirror columns must be nullable.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- B. Linking a player to a daughter team no longer unlinks their other teams.
-- ---------------------------------------------------------------------------
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
begin
  -- NOTE: the previous implementation revoked every OTHER active link here.
  -- That is removed: a player may be linked to multiple eligible daughter
  -- teams, and linking to one must never unlink them from another.

  -- Update the existing link for exactly this team + daughter team, if any.
  update public.player_team_memberships
  set player_profile_id = coalesce(_player_profile_id, player_profile_id),
      club_id = coalesce(_club_id, club_id),
      club_team_id = _club_team_id,
      league_id = coalesce(_league_id, league_id),
      age_group = coalesce(_age_group, age_group),
      status = _status,
      joined_via = _joined_via,
      approved_at = case when _status in ('accepted', 'approved') then now() else player_team_memberships.approved_at end,
      approved_by = case when _status in ('accepted', 'approved') then _approved_by else player_team_memberships.approved_by end,
      updated_at = now()
  where public.player_team_memberships.player_user_id = _player_user_id
    and public.player_team_memberships.team_id = _team_id
    and coalesce(public.player_team_memberships.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- No existing row for this exact daughter team -> create the link. This is
  -- what prevents duplicate links: one row per (player, team, daughter team).
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
      _league_id,
      _age_group,
      _status,
      _joined_via,
      case when _status in ('accepted', 'approved') then now() else null end,
      case when _status in ('accepted', 'approved') then _approved_by else null end
    );
  end if;

  -- Authoritative display values for the legacy mirror fields. The league is
  -- resolved from the daughter team's own league_name text first, because most
  -- daughter teams store a league/conference name without a public.leagues row.
  select
    t.name,
    coalesce(
      nullif(trim(coalesce(ct.league_name, '')), ''),
      l.name
    )
  into team_name_value, league_name_value
  from public.teams t
  left join public.club_teams ct on ct.id = _club_team_id
  left join public.leagues l on l.id = coalesce(_league_id, ct.league_id, t.league_id)
  where t.id = _team_id;

  -- Legacy mirrors only -- never the source of truth for linked teams.
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

-- ---------------------------------------------------------------------------
-- C. Leaving a daughter team unlinks ONLY that team, is safe to repeat, and
--    reports what the player is still linked to.
--    Return type changes from void -> jsonb, so the old signature is dropped.
-- ---------------------------------------------------------------------------
drop function if exists public.leave_team_membership(uuid);

create or replace function public.leave_team_membership(_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $leave_team_membership$
declare
  v_user_id uuid := auth.uid();
  v_membership public.player_team_memberships;
  v_team_name text;
  v_next_membership public.player_team_memberships;
  v_next_team_name text;
  v_next_league_name text;
  v_remaining jsonb;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  -- Only the owner of the link may remove it (never trust a client-sent id).
  select *
  into v_membership
  from public.player_team_memberships
  where id = _membership_id
    and player_user_id = v_user_id;

  if v_membership.id is null then
    -- The link does not belong to this account, or never existed. Do not leak
    -- whether the id exists; report the same safe already-unlinked state.
    return jsonb_build_object(
      'success', true,
      'already_unlinked', true,
      'team_name', null,
      'remaining_teams', coalesce((
        select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'team_id', m.team_id,
          'club_team_id', m.club_team_id
        ))
        from public.player_team_memberships m
        where m.player_user_id = v_user_id
          and m.status in ('accepted', 'approved')
      ), '[]'::jsonb)
    );
  end if;

  select t.name into v_team_name
  from public.teams t
  where t.id = v_membership.team_id;

  -- Already unlinked -> safe no-op, never a destructive error.
  if v_membership.status not in ('accepted', 'approved') then
    return jsonb_build_object(
      'success', true,
      'already_unlinked', true,
      'team_name', v_team_name,
      'remaining_teams', coalesce((
        select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'team_id', m.team_id,
          'club_team_id', m.club_team_id
        ))
        from public.player_team_memberships m
        where m.player_user_id = v_user_id
          and m.status in ('accepted', 'approved')
      ), '[]'::jsonb)
    );
  end if;

  -- Unlink ONLY this daughter team. Every other link is untouched.
  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where id = v_membership.id;

  -- Clear any approved/pending join request for this exact daughter team so the
  -- link cannot be resurrected, leaving other teams' requests alone.
  update public.team_join_requests
  set status = 'revoked',
      reviewed_at = now()
  where player_user_id = v_user_id
    and team_id = v_membership.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) =
        coalesce(v_membership.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('approved', 'pending');

  -- Refresh the legacy mirror fields from whatever link remains (if any).
  select *
  into v_next_membership
  from public.player_team_memberships
  where player_user_id = v_user_id
    and status in ('accepted', 'approved')
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  if v_next_membership.id is null then
    update public.profiles
    set team_name = null, updated_at = now()
    where user_id = v_user_id;

    update public.player_profiles
    set team = null, updated_at = now()
    where user_id = v_user_id;

    -- Nullable now (see section A): a player with no linked team has no club.
    update public.players
    set team_id = null, club = null, league = null
    where user_id = v_user_id;
  else
    select
      t.name,
      coalesce(nullif(trim(coalesce(ct.league_name, '')), ''), l.name)
    into v_next_team_name, v_next_league_name
    from public.teams t
    left join public.club_teams ct on ct.id = v_next_membership.club_team_id
    left join public.leagues l on l.id = coalesce(v_next_membership.league_id, ct.league_id, t.league_id)
    where t.id = v_next_membership.team_id;

    update public.profiles
    set team_name = v_next_team_name, updated_at = now()
    where user_id = v_user_id;

    update public.player_profiles
    set team = v_next_team_name, updated_at = now()
    where user_id = v_user_id;

    update public.players
    set team_id = v_next_membership.team_id,
        club = v_next_team_name,
        league = v_next_league_name
    where user_id = v_user_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'membership_id', m.id,
    'team_id', m.team_id,
    'club_team_id', m.club_team_id
  )), '[]'::jsonb)
  into v_remaining
  from public.player_team_memberships m
  where m.player_user_id = v_user_id
    and m.status in ('accepted', 'approved');

  return jsonb_build_object(
    'success', true,
    'already_unlinked', false,
    'team_name', v_team_name,
    'remaining_teams', v_remaining
  );
end;
$leave_team_membership$;

revoke all on function public.leave_team_membership(uuid) from public, anon;
grant execute on function public.leave_team_membership(uuid) to authenticated;

comment on function public.leave_team_membership(uuid) is
  'Unlinks the signed-in player from exactly one daughter team. Safe to repeat; never touches other linked teams.';

notify pgrst, 'reload schema';
