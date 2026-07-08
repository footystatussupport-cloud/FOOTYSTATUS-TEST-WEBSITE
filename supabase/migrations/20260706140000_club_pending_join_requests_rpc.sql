-- A player's request to join a specific daughter team must reliably appear in
-- the mother club's "Pending Daughter Team Requests" list. Reading
-- team_join_requests directly from the client is fragile: it depends on the
-- request's team_id exactly matching the club's cached mother-team id and on
-- the restrictive gender-visibility RLS policy. This SECURITY DEFINER RPC
-- returns the authoritative pending list for every team the caller manages
-- (mother team + all its daughter teams), with the player details needed for
-- display, so the notification and the pending list always reference the same
-- request records.

create or replace function public.get_club_pending_join_requests(_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  club_id uuid,
  club_team_id uuid,
  player_profile_id uuid,
  player_user_id uuid,
  age_group text,
  league_id uuid,
  access_code_last4 text,
  requested_at timestamptz,
  player_name text,
  player_username text,
  player_avatar_url text,
  player_position text,
  club_team_age_group text,
  club_team_league_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with managed_daughter_teams as (
    select ct.id
    from public.club_teams ct
    join public.clubs c on c.id = ct.club_id
    where ct.status <> 'archived'
      and (
        coalesce(ct.parent_team_id, ct.team_id) = _team_id
        or c.primary_team_id = _team_id
      )
  )
  select
    r.id,
    r.team_id,
    r.club_id,
    r.club_team_id,
    r.player_profile_id,
    r.player_user_id,
    r.age_group,
    r.league_id,
    r.access_code_last4,
    r.requested_at,
    coalesce(pp.full_name, prof.full_name, 'Unknown Player') as player_name,
    coalesce(pp.username, prof.username) as player_username,
    coalesce(pp.profile_image_url, prof.avatar_url) as player_avatar_url,
    pp.position as player_position,
    ct.age_group as club_team_age_group,
    ct.league_name as club_team_league_name
  from public.team_join_requests r
  left join public.player_profiles pp on pp.id = r.player_profile_id
  left join public.profiles prof on prof.user_id = r.player_user_id
  left join public.club_teams ct on ct.id = r.club_team_id
  where r.status = 'pending'
    and (
      public.user_manages_team(_team_id, auth.uid())
      or public.is_footy_status_global_admin()
    )
    and (
      r.team_id = _team_id
      or r.club_team_id in (select id from managed_daughter_teams)
    )
  order by r.requested_at desc;
$$;

grant execute on function public.get_club_pending_join_requests(uuid) to authenticated;

comment on function public.get_club_pending_join_requests(uuid) is
  'Authoritative pending join requests (mother + daughter teams) for a club manager; used by the Pending Daughter Team Requests list.';
