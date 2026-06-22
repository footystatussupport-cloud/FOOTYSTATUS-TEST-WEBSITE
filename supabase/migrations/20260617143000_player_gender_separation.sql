alter table public.player_profiles
  add column if not exists player_gender text;

alter table public.players
  add column if not exists player_gender text;

alter table public.player_profiles
  drop constraint if exists player_profiles_player_gender_check;

alter table public.player_profiles
  add constraint player_profiles_player_gender_check
  check (player_gender is null or player_gender in ('boy', 'girl'));

alter table public.players
  drop constraint if exists players_player_gender_check;

alter table public.players
  add constraint players_player_gender_check
  check (player_gender is null or player_gender in ('boy', 'girl'));

create index if not exists idx_player_profiles_player_gender
  on public.player_profiles(player_gender);

create index if not exists idx_players_player_gender
  on public.players(player_gender);

create or replace function public.current_player_gender()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pp.player_gender
  from public.player_profiles pp
  where pp.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.current_account_is_player()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and coalesce(p.account_role::text, p.role::text) = 'player'
  );
$$;

create or replace function public.can_view_player(_target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer_gender text;
  target_gender text;
begin
  if auth.uid() is null then
    return true;
  end if;

  if auth.uid() = _target_user_id then
    return true;
  end if;

  if public.is_footy_status_global_admin() then
    return true;
  end if;

  if not public.current_account_is_player() then
    return true;
  end if;

  viewer_gender := public.current_player_gender();

  if viewer_gender is null then
    return false;
  end if;

  select pp.player_gender
  into target_gender
  from public.player_profiles pp
  where pp.user_id = _target_user_id
  limit 1;

  return target_gender is not null
    and viewer_gender = target_gender;
end;
$$;

create or replace function public.set_own_player_gender(_player_gender text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if _player_gender not in ('boy', 'girl') then
    raise exception 'Choose Boy or Girl';
  end if;

  if not public.current_account_is_player() then
    raise exception 'This selection is only available for player accounts';
  end if;

  if exists (
    select 1
    from public.player_profiles
    where user_id = auth.uid()
      and player_gender is not null
  ) then
    raise exception 'Your selection has already been completed';
  end if;

  update public.player_profiles
  set player_gender = _player_gender,
      updated_at = now()
  where user_id = auth.uid();

  update public.players
  set player_gender = _player_gender
  where user_id = auth.uid();
end;
$$;

create or replace function public.sync_player_gender_to_legacy_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.players
  set player_gender = new.player_gender
  where user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists sync_player_gender_to_legacy_player_trigger
on public.player_profiles;

create trigger sync_player_gender_to_legacy_player_trigger
after insert or update of player_gender
on public.player_profiles
for each row
execute function public.sync_player_gender_to_legacy_player();

update public.player_profiles pp
set player_gender = case
  when lower(coalesce(u.raw_user_meta_data->>'player_gender', '')) in ('boy', 'girl')
    then lower(u.raw_user_meta_data->>'player_gender')
  else pp.player_gender
end
from auth.users u
where u.id = pp.user_id
  and pp.player_gender is null;

update public.players p
set player_gender = pp.player_gender
from public.player_profiles pp
where pp.user_id = p.user_id
  and pp.player_gender is not null
  and p.player_gender is distinct from pp.player_gender;

alter table public.player_profiles enable row level security;
alter table public.players enable row level security;
alter table public.clips enable row level security;
alter table public.player_team_memberships enable row level security;

drop policy if exists "player gender separation select" on public.player_profiles;
create policy "player gender separation select"
  on public.player_profiles
  as restrictive
  for select
  to public
  using (public.can_view_player(user_id));

drop policy if exists "legacy player gender separation select" on public.players;
create policy "legacy player gender separation select"
  on public.players
  as restrictive
  for select
  to public
  using (
    user_id is not null
    and public.can_view_player(user_id)
  );

drop policy if exists "clip gender separation select" on public.clips;
create policy "clip gender separation select"
  on public.clips
  as restrictive
  for select
  to public
  using (
    public.can_view_player(
      coalesce(
        user_id,
        (
          select p.user_id
          from public.players p
          where p.id = clips.player_id
          limit 1
        )
      )
    )
  );

drop policy if exists "membership gender separation select"
on public.player_team_memberships;

create policy "membership gender separation select"
  on public.player_team_memberships
  as restrictive
  for select
  to public
  using (public.can_view_player(player_user_id));

create or replace view public.player_profiles_public
with (security_invoker=on) as
with active_membership as (
  select distinct on (m.player_user_id)
    m.player_user_id,
    m.team_id,
    m.club_team_id,
    m.league_id,
    m.age_group,
    m.jersey_number,
    t.name as team_name,
    l.name as league_name
  from public.player_team_memberships m
  join public.teams t on t.id = m.team_id
  left join public.leagues l
    on l.id = coalesce(m.league_id, t.league_id)
  where m.status in ('accepted', 'approved')
  order by
    m.player_user_id,
    m.approved_at desc nulls last,
    m.updated_at desc,
    m.created_at desc
)
select
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  coalesce(am.team_name, pp.team) as team,
  pp.position,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  pp.jersey_number,
  p.bio,
  p.username,
  p.age_birth_year,
  coalesce(am.team_name, p.team_name) as team_name,
  p.avatar_url,
  p.is_pro,
  p.role,
  am.team_id as current_team_id,
  am.club_team_id as current_club_team_id,
  coalesce(ls.league_id, am.league_id) as current_league_id,
  coalesce(am.league_name, l.name) as current_league_name,
  ls.position as league_position,
  ls.points as team_points,
  ls.wins as team_wins,
  ls.draws as team_draws,
  ls.losses as team_losses
from public.player_profiles pp
left join public.profiles p on p.user_id = pp.user_id
left join active_membership am on am.player_user_id = pp.user_id
left join public.leagues l on l.id = am.league_id
left join public.league_standings ls
  on ls.team_id = am.team_id
 and coalesce(
       ls.club_team_id,
       '00000000-0000-0000-0000-000000000000'::uuid
     ) = coalesce(
       am.club_team_id,
       '00000000-0000-0000-0000-000000000000'::uuid
     )
where public.can_view_player(pp.user_id);

grant select on public.player_profiles_public to anon, authenticated;
grant execute on function public.current_player_gender() to authenticated;
grant execute on function public.current_account_is_player() to authenticated;
grant execute on function public.can_view_player(uuid) to anon, authenticated;
grant execute on function public.set_own_player_gender(text) to authenticated;
