create table if not exists public.team_player_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  player_profile_id uuid not null references public.player_profiles(id) on delete cascade,
  player_user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete set null,
  age_group text,
  organization_id uuid,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamp with time zone not null default now(),
  responded_at timestamp with time zone,
  club_id uuid references public.clubs(id) on delete set null,
  club_team_id uuid references public.club_teams(id) on delete set null,
  constraint team_player_invites_status_check check (status in ('pending', 'accepted', 'declined', 'revoked'))
);

create unique index if not exists idx_pending_team_invite_unique
on public.team_player_invites(team_id, player_user_id)
where status = 'pending';

create index if not exists idx_team_player_invites_player_status
on public.team_player_invites(player_user_id, status, created_at desc);

alter table public.team_player_invites enable row level security;

drop policy if exists "Invites visible to team managers and invited player" on public.team_player_invites;
create policy "Invites visible to team managers and invited player"
on public.team_player_invites
for select
to authenticated
using (
  player_user_id = auth.uid()
  or public.user_manages_team(team_id, auth.uid())
);

create or replace function public.create_team_player_invite_for_club_team(
  _team_id uuid,
  _club_team_id uuid,
  _player_profile_id uuid
)
returns public.team_player_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  team_row public.teams;
  player_row public.player_profiles;
  club_team_row public.club_teams;
  invite_row public.team_player_invites;
begin
  if auth.uid() is null or not public.user_manages_team(_team_id, auth.uid()) or not public.team_is_approved(_team_id) then
    raise exception 'Only approved team accounts can invite players.';
  end if;

  select * into team_row
  from public.teams
  where id = _team_id;

  select * into player_row
  from public.player_profiles
  where id = _player_profile_id;

  select * into club_team_row
  from public.club_teams
  where id = _club_team_id
    and (team_id = _team_id or club_id in (select id from public.clubs where primary_team_id = _team_id))
    and status = 'active';

  if player_row.id is null then
    raise exception 'Player not found.';
  end if;

  if club_team_row.id is null then
    raise exception 'That club team could not be found.';
  end if;

  if exists (
    select 1
    from public.player_team_memberships
    where player_user_id = player_row.user_id
      and status in ('accepted', 'approved')
  ) then
    raise exception 'This player is already linked to an active team.';
  end if;

  insert into public.team_player_invites (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    organization_id,
    invited_by,
    status
  )
  values (
    _team_id,
    club_team_row.club_id,
    club_team_row.id,
    _player_profile_id,
    player_row.user_id,
    coalesce(club_team_row.league_id, team_row.league_id),
    coalesce(club_team_row.age_group, team_row.age_group),
    team_row.organization_id,
    auth.uid(),
    'pending'
  )
  returning * into invite_row;

  return invite_row;
end;
$$;

grant execute on function public.create_team_player_invite_for_club_team(uuid, uuid, uuid) to authenticated;
