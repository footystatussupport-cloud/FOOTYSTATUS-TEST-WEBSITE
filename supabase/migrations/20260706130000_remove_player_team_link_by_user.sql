-- Removing a player from a (daughter) team must work even when the player is
-- shown on the roster only via a typed team name (no real membership row).
-- Those roster entries have synthetic ids like "profile-<uuid>" / "legacy-<id>"
-- that are not membership UUIDs, so the UUID-typed remove_player_from_club_team
-- RPC rejected them ("invalid input syntax for type uuid").
--
-- This RPC removes a player from a team by user id: it revokes any real
-- membership/request/invite for that player + team, and clears the typed team
-- linkage (player_profiles.team, profiles.team_name, players.club/team_id) when
-- the player has no other active membership. Both the club teams page and the
-- player's own profile then reflect the removal.

create or replace function public.remove_player_team_link_by_user(
  _player_user_id uuid,
  _team_id uuid,
  _club_team_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_other_active_membership boolean;
  team_name_value text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if _player_user_id is null or _team_id is null then
    raise exception 'Player and team are required.';
  end if;

  -- Permission: club account for a daughter team, or the team/club owner.
  if _club_team_id is not null then
    if not public.can_manage_club_team(_club_team_id, auth.uid())
       and not public.is_footy_status_admin() then
      raise exception 'Only the parent club account can remove players from this daughter team.';
    end if;
  elsif not public.user_manages_team(_team_id, auth.uid())
        and not public.is_footy_status_admin() then
    raise exception 'Only the team/club account can remove players from this team.';
  end if;

  -- Revoke any real membership rows for this player on this team.
  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (
      _club_team_id is null
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
    )
    and status in ('pending', 'accepted', 'approved');

  update public.team_join_requests
  set status = 'revoked',
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (
      _club_team_id is null
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
    )
    and status in ('pending', 'approved');

  update public.team_player_invites
  set status = 'revoked',
      responded_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (
      _club_team_id is null
      or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id
    )
    and status = 'pending';

  select exists (
    select 1
    from public.player_team_memberships
    where player_user_id = _player_user_id
      and status in ('accepted', 'approved')
  )
  into has_other_active_membership;

  -- Clear the typed team linkage so the player is no longer surfaced on this
  -- team by name (only when they have no remaining active membership anywhere).
  if not has_other_active_membership then
    select name into team_name_value
    from public.teams
    where id = _team_id;

    update public.profiles
    set team_name = null,
        updated_at = now()
    where user_id = _player_user_id
      and (team_name_value is null or lower(trim(coalesce(team_name, ''))) = lower(trim(team_name_value)));

    update public.player_profiles
    set team = null,
        updated_at = now()
    where user_id = _player_user_id
      and (team_name_value is null or lower(trim(coalesce(team, ''))) = lower(trim(team_name_value)));

    update public.players
    set team_id = null,
        club = case
          when team_name_value is not null and lower(trim(coalesce(club, ''))) = lower(trim(team_name_value))
          then null else club
        end
    where user_id = _player_user_id;
  end if;
end;
$$;

grant execute on function public.remove_player_team_link_by_user(uuid, uuid, uuid) to authenticated;

comment on function public.remove_player_team_link_by_user(uuid, uuid, uuid) is
  'Removes a player from a team by user id, including typed team-name linkage. Used when a roster entry has no real membership row.';
