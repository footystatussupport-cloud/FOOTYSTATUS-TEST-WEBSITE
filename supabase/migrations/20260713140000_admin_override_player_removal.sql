-- =============================================================================
-- Footy Status Official Admin override for player removal (+ audit)
-- =============================================================================
-- The membership-based remove_player_from_club_team() predated the admin
-- override layer and had NO admin bypass, so the official admin was blocked with
-- "Only the parent club account can remove players from this daughter team."
-- Its user-id sibling already had a bypass; this brings both in line with the
-- canonical public.is_footy_status_global_admin() rule used everywhere else, and
-- logs the action to admin_audit_log when the admin performs it.
--
-- Ordinary accounts are unchanged: they still need club/team management rights.
-- Safe to run more than once.
-- =============================================================================

-- 1) Membership-id based removal (the path the roster UI uses).
create or replace function public.remove_player_from_club_team(_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row public.player_team_memberships;
  has_other_active_membership boolean;
  team_name_value text;
  is_admin boolean := public.is_footy_status_global_admin();
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into membership_row from public.player_team_memberships where id = _membership_id;
  if membership_row.id is null then
    raise exception 'Player membership not found.';
  end if;

  -- Admin bypasses ownership; everyone else needs the normal rights.
  if not is_admin then
    if membership_row.club_team_id is not null then
      if not public.can_manage_club_team(membership_row.club_team_id, auth.uid()) then
        raise exception 'Only the parent club account can remove players from this daughter team.';
      end if;
    elsif not public.user_manages_team(membership_row.team_id, auth.uid()) then
      raise exception 'Only the team/club account can remove players from this team.';
    end if;
  end if;

  update public.player_team_memberships
  set status = 'revoked', updated_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('pending', 'accepted', 'approved');

  update public.team_join_requests
  set status = 'revoked', reviewed_by = auth.uid(), reviewed_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status in ('pending', 'approved');

  update public.team_player_invites
  set status = 'revoked', responded_at = now()
  where player_user_id = membership_row.player_user_id
    and team_id = membership_row.team_id
    and coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(membership_row.club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status = 'pending';

  select exists (
    select 1 from public.player_team_memberships
    where player_user_id = membership_row.player_user_id and status in ('accepted', 'approved')
  ) into has_other_active_membership;

  if not has_other_active_membership then
    select name into team_name_value from public.teams where id = membership_row.team_id;
    update public.profiles set team_name = null, updated_at = now() where user_id = membership_row.player_user_id;
    update public.player_profiles set team = null, updated_at = now() where user_id = membership_row.player_user_id;
    update public.players
    set team_id = null,
        club = case when team_name_value is not null and club = team_name_value then null else club end
    where user_id = membership_row.player_user_id;
  end if;

  if is_admin then
    insert into public.admin_audit_log (admin_user_id, action, affected_table, affected_id, target_account_id, payload)
    values (auth.uid(), 'admin_remove_player_from_team', 'player_team_memberships', _membership_id::text,
            membership_row.player_user_id,
            jsonb_build_object('team_id', membership_row.team_id, 'club_team_id', membership_row.club_team_id));
  end if;
end;
$$;

grant execute on function public.remove_player_from_club_team(uuid) to authenticated;

-- 2) User-id based removal (typed / name-matched roster entries). Upgrade the
--    bypass to the canonical global-admin check and add the same audit line.
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
  is_admin boolean := public.is_footy_status_global_admin();
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if _player_user_id is null or _team_id is null then
    raise exception 'Player and team are required.';
  end if;

  if not is_admin then
    if _club_team_id is not null then
      if not public.can_manage_club_team(_club_team_id, auth.uid()) then
        raise exception 'Only the parent club account can remove players from this daughter team.';
      end if;
    elsif not public.user_manages_team(_team_id, auth.uid()) then
      raise exception 'Only the team/club account can remove players from this team.';
    end if;
  end if;

  update public.player_team_memberships
  set status = 'revoked', updated_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (_club_team_id is null or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id)
    and status in ('pending', 'accepted', 'approved');

  update public.team_join_requests
  set status = 'revoked', reviewed_by = auth.uid(), reviewed_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (_club_team_id is null or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id)
    and status in ('pending', 'approved');

  update public.team_player_invites
  set status = 'revoked', responded_at = now()
  where player_user_id = _player_user_id
    and team_id = _team_id
    and (_club_team_id is null or coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = _club_team_id)
    and status = 'pending';

  select exists (
    select 1 from public.player_team_memberships
    where player_user_id = _player_user_id and status in ('accepted', 'approved')
  ) into has_other_active_membership;

  if not has_other_active_membership then
    select name into team_name_value from public.teams where id = _team_id;
    update public.profiles set team_name = null, updated_at = now()
    where user_id = _player_user_id
      and (team_name_value is null or lower(trim(coalesce(team_name, ''))) = lower(trim(team_name_value)));
    update public.player_profiles set team = null, updated_at = now()
    where user_id = _player_user_id
      and (team_name_value is null or lower(trim(coalesce(team, ''))) = lower(trim(team_name_value)));
    update public.players
    set team_id = null,
        club = case when team_name_value is not null and lower(trim(coalesce(club, ''))) = lower(trim(team_name_value)) then null else club end
    where user_id = _player_user_id;
  end if;

  if is_admin then
    insert into public.admin_audit_log (admin_user_id, action, affected_table, affected_id, target_account_id, payload)
    values (auth.uid(), 'admin_remove_player_from_team', 'player_team_memberships', _player_user_id::text,
            _player_user_id,
            jsonb_build_object('team_id', _team_id, 'club_team_id', _club_team_id));
  end if;
end;
$$;

grant execute on function public.remove_player_team_link_by_user(uuid, uuid, uuid) to authenticated;
