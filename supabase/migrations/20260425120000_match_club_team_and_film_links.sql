alter table public.matches
  add column if not exists home_club_team_id uuid references public.club_teams(id) on delete set null,
  add column if not exists away_club_team_id uuid references public.club_teams(id) on delete set null,
  add column if not exists venue_address text,
  add column if not exists home_jersey_color text,
  add column if not exists away_jersey_color text,
  add column if not exists home_possession integer,
  add column if not exists away_possession integer;

do $matches_possession_checks$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_home_possession_check'
  ) then
    alter table public.matches
      add constraint matches_home_possession_check
      check (home_possession is null or (home_possession >= 0 and home_possession <= 100));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_away_possession_check'
  ) then
    alter table public.matches
      add constraint matches_away_possession_check
      check (away_possession is null or (away_possession >= 0 and away_possession <= 100));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_total_possession_check'
  ) then
    alter table public.matches
      add constraint matches_total_possession_check
      check (
        home_possession is null
        or away_possession is null
        or home_possession + away_possession = 100
      );
  end if;
end
$matches_possession_checks$;

create table if not exists public.match_film_links (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  submitted_by_user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  label text,
  created_at timestamp with time zone not null default now(),
  removed_at timestamp with time zone,
  removed_by_user_id uuid references auth.users(id) on delete set null,
  constraint match_film_links_url_check check (url ~* '^https?://')
);

create index if not exists idx_match_film_links_match_id_created_at
on public.match_film_links(match_id, created_at desc);

alter table public.match_film_links enable row level security;

drop policy if exists "Match film links are viewable by everyone" on public.match_film_links;
create policy "Match film links are viewable by everyone"
on public.match_film_links
for select
to public
using (removed_at is null);

drop policy if exists "Authenticated users can submit match film links" on public.match_film_links;
create policy "Authenticated users can submit match film links"
on public.match_film_links
for insert
to authenticated
with check (
  auth.uid() = submitted_by_user_id
  and url ~* '^https?://'
);

drop policy if exists "Owners or match admins can remove film links" on public.match_film_links;
create policy "Owners or match admins can remove film links"
on public.match_film_links
for update
to authenticated
using (
  auth.uid() = submitted_by_user_id
  or public.is_match_admin(auth.uid())
)
with check (
  auth.uid() = submitted_by_user_id
  or public.is_match_admin(auth.uid())
);

create or replace view public.league_match_details as
select
  m.id,
  m.league_id,
  l.name as league_name,
  l.season,
  l.region,
  l.age_group,
  l.division,
  l.tier,
  l.gender_category,
  m.home_team_id,
  m.home_club_team_id,
  coalesce(
    case
      when hct.id is not null then concat_ws(' • ', hc.name, hct.age_group, hct.league_name)
      else null
    end,
    ht.name
  ) as home_team_name,
  coalesce(ht.logo_url, htp.logo_url) as home_team_logo_url,
  m.away_team_id,
  m.away_club_team_id,
  coalesce(
    case
      when act.id is not null then concat_ws(' • ', ac.name, act.age_group, act.league_name)
      else null
    end,
    at.name
  ) as away_team_name,
  coalesce(at.logo_url, atp.logo_url) as away_team_logo_url,
  m.scheduled_at,
  m.venue,
  m.venue_address,
  m.home_jersey_color,
  m.away_jersey_color,
  m.home_possession,
  m.away_possession,
  m.status,
  m.home_score,
  m.away_score,
  m.referee_user_id,
  m.notes,
  m.completed_at,
  m.created_at,
  m.updated_at
from public.matches m
left join public.leagues l on l.id = m.league_id
left join public.teams ht on ht.id = m.home_team_id
left join public.team_profiles htp on htp.team_id = ht.id
left join public.club_teams hct on hct.id = m.home_club_team_id
left join public.clubs hc on hc.id = hct.club_id
left join public.teams at on at.id = m.away_team_id
left join public.team_profiles atp on atp.team_id = at.id
left join public.club_teams act on act.id = m.away_club_team_id
left join public.clubs ac on ac.id = act.club_id
where m.league_id is not null
  and m.home_team_id is not null
  and m.away_team_id is not null;

create or replace function public.create_league_match(
  _league_id uuid,
  _home_team_id uuid,
  _away_team_id uuid,
  _scheduled_at timestamp with time zone,
  _venue text default null,
  _referee_user_id uuid default null,
  _notes text default null,
  _home_club_team_id uuid default null,
  _away_club_team_id uuid default null,
  _venue_address text default null,
  _home_jersey_color text default null,
  _away_jersey_color text default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $create_league_match$
declare
  home_team_row public.teams;
  away_team_row public.teams;
  result_row public.matches;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can create fixtures.';
  end if;

  if _home_team_id = _away_team_id and coalesce(_home_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(_away_club_team_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'A team cannot play itself.';
  end if;

  if _home_club_team_id is not null then
    if not exists (
      select 1
      from public.league_teams
      where league_id = _league_id
        and team_id = _home_team_id
        and club_team_id = _home_club_team_id
    ) then
      raise exception 'Home daughter team is not assigned to this league.';
    end if;
  elsif not exists (select 1 from public.league_teams where league_id = _league_id and team_id = _home_team_id) then
    raise exception 'Home team is not assigned to this league.';
  end if;

  if _away_club_team_id is not null then
    if not exists (
      select 1
      from public.league_teams
      where league_id = _league_id
        and team_id = _away_team_id
        and club_team_id = _away_club_team_id
    ) then
      raise exception 'Away daughter team is not assigned to this league.';
    end if;
  elsif not exists (select 1 from public.league_teams where league_id = _league_id and team_id = _away_team_id) then
    raise exception 'Away team is not assigned to this league.';
  end if;

  select * into home_team_row from public.teams where id = _home_team_id;
  select * into away_team_row from public.teams where id = _away_team_id;

  insert into public.matches (
    league_id,
    home_team_id,
    away_team_id,
    home_club_team_id,
    away_club_team_id,
    home_team,
    away_team,
    home_score,
    away_score,
    scheduled_at,
    venue,
    venue_address,
    home_jersey_color,
    away_jersey_color,
    status,
    referee_user_id,
    notes,
    league
  )
  values (
    _league_id,
    _home_team_id,
    _away_team_id,
    _home_club_team_id,
    _away_club_team_id,
    coalesce(home_team_row.name, 'Home Team'),
    coalesce(away_team_row.name, 'Away Team'),
    0,
    0,
    _scheduled_at,
    _venue,
    _venue_address,
    _home_jersey_color,
    _away_jersey_color,
    'scheduled',
    _referee_user_id,
    _notes,
    (select name from public.leagues where id = _league_id)
  )
  returning * into result_row;

  return result_row;
end;
$create_league_match$;

grant execute on function public.create_league_match(uuid, uuid, uuid, timestamp with time zone, text, uuid, text, uuid, uuid, text, text, text) to authenticated;
