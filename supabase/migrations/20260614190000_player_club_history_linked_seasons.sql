alter table public.club_history
  add column if not exists player_profile_id uuid references public.player_profiles(id) on delete cascade,
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists league_id uuid references public.leagues(id) on delete set null,
  add column if not exists season text,
  add column if not exists competition text,
  add column if not exists team_logo_url text,
  add column if not exists position_role text,
  add column if not exists notes text,
  add column if not exists stats_source text not null default 'manual' check (stats_source in ('manual', 'verified')),
  add column if not exists manual_goals integer not null default 0,
  add column if not exists manual_assists integer not null default 0,
  add column if not exists manual_appearances integer not null default 0,
  add column if not exists manual_starts integer not null default 0,
  add column if not exists manual_clean_sheets integer not null default 0,
  add column if not exists manual_yellow_cards integer not null default 0,
  add column if not exists manual_red_cards integer not null default 0,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamp with time zone not null default now();

update public.club_history ch
set
  player_profile_id = pp.id,
  season = coalesce(ch.season, ch.years),
  position_role = coalesce(ch.position_role, ch.level),
  stats_source = case when ch.team_id is not null then 'verified' else 'manual' end
from public.players p
left join public.player_profiles pp on pp.user_id = p.user_id
where ch.player_id = p.id
  and ch.player_profile_id is null;

drop trigger if exists update_club_history_updated_at on public.club_history;
create trigger update_club_history_updated_at
before update on public.club_history
for each row execute function public.update_updated_at_column();

create index if not exists idx_club_history_player_profile_id on public.club_history(player_profile_id);
create index if not exists idx_club_history_team_season on public.club_history(team_id, season);

drop view if exists public.player_club_history;

create or replace view public.player_club_history as
with history_rows as (
  select
    ch.*,
    coalesce(ch.player_profile_id, pp.id) as resolved_player_profile_id,
    pp.user_id as player_user_id,
    t.name as linked_team_name,
    coalesce(tp.logo_url, t.logo_url, ch.team_logo_url) as resolved_team_logo_url,
    l.name as linked_league_name
  from public.club_history ch
  left join public.players p on p.id = ch.player_id
  left join public.player_profiles pp on pp.id = ch.player_profile_id or pp.user_id = p.user_id
  left join public.teams t on t.id = ch.team_id
  left join public.team_profiles tp on tp.team_id = t.id
  left join public.leagues l on l.id = coalesce(ch.league_id, t.league_id)
),
approved_events as (
  select
    me.id,
    me.match_id,
    me.team_id,
    me.player_profile_id,
    me.event_type,
    me.metadata,
    coalesce(l.season, 'Current Season') as season,
    m.status as match_status,
    m.home_team_id,
    m.away_team_id,
    coalesce(m.home_score, 0) as home_score,
    coalesce(m.away_score, 0) as away_score
  from public.match_events me
  join public.matches m on m.id = me.match_id
  left join public.leagues l on l.id = m.league_id
  where me.status = 'approved'
    and me.player_profile_id is not null
    and m.status not in ('cancelled', 'postponed')
),
verified_stats as (
  select
    hr.id as club_history_id,
    count(distinct ae.id) filter (where ae.event_type in ('goal', 'penalty_scored'))::integer as goals,
    count(distinct ae.id) filter (where ae.event_type = 'assist')::integer as assists,
    count(distinct ae.match_id) filter (where ae.event_type in ('minutes_played', 'sub_in'))::integer as appearances,
    count(distinct ae.match_id) filter (
      where ae.event_type = 'minutes_played'
        and coalesce((ae.metadata ->> 'started')::boolean, false)
    )::integer as starts,
    count(distinct ae.match_id) filter (
      where ae.match_status = 'completed'
        and ae.event_type in ('minutes_played', 'sub_in')
        and (
          (ae.team_id = ae.home_team_id and ae.away_score = 0)
          or (ae.team_id = ae.away_team_id and ae.home_score = 0)
        )
    )::integer as clean_sheets,
    count(distinct ae.id) filter (where ae.event_type = 'yellow_card')::integer as yellow_cards,
    count(distinct ae.id) filter (where ae.event_type = 'red_card')::integer as red_cards
  from history_rows hr
  left join approved_events ae
    on ae.player_profile_id = hr.resolved_player_profile_id
   and ae.team_id = hr.team_id
   and (
      hr.season is null
      or hr.season = ''
      or ae.season = hr.season
      or hr.years = ae.season
   )
  group by hr.id
)
select
  hr.id,
  hr.player_id,
  hr.resolved_player_profile_id as player_profile_id,
  hr.player_user_id,
  hr.team_id,
  hr.league_id,
  coalesce(hr.linked_team_name, hr.club_name) as club_name,
  hr.linked_team_name,
  hr.level,
  coalesce(nullif(hr.season, ''), hr.years) as season,
  hr.years,
  coalesce(nullif(hr.competition, ''), hr.linked_league_name) as competition,
  hr.resolved_team_logo_url as team_logo_url,
  hr.position_role,
  hr.notes,
  case when hr.team_id is not null then 'verified' else 'manual' end as stats_source,
  case when hr.team_id is not null then coalesce(vs.goals, 0) else hr.manual_goals end as goals,
  case when hr.team_id is not null then coalesce(vs.assists, 0) else hr.manual_assists end as assists,
  case when hr.team_id is not null then coalesce(vs.appearances, 0) else hr.manual_appearances end as appearances,
  case when hr.team_id is not null then coalesce(vs.starts, 0) else hr.manual_starts end as starts,
  case when hr.team_id is not null then coalesce(vs.clean_sheets, 0) else hr.manual_clean_sheets end as clean_sheets,
  case when hr.team_id is not null then coalesce(vs.yellow_cards, 0) else hr.manual_yellow_cards end as yellow_cards,
  case when hr.team_id is not null then coalesce(vs.red_cards, 0) else hr.manual_red_cards end as red_cards,
  hr.created_at,
  hr.updated_at
from history_rows hr
left join verified_stats vs on vs.club_history_id = hr.id;

grant select on public.player_club_history to public;

drop policy if exists "Players can add their own club history" on public.club_history;
create policy "Players can add their own club history"
on public.club_history
for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and exists (
    select 1
    from public.player_profiles pp
    where pp.id = club_history.player_profile_id
      and pp.user_id = auth.uid()
  )
);

drop policy if exists "Players can edit their own club history" on public.club_history;
create policy "Players can edit their own club history"
on public.club_history
for update
to authenticated
using (
  exists (
    select 1
    from public.player_profiles pp
    where pp.id = club_history.player_profile_id
      and pp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.player_profiles pp
    where pp.id = club_history.player_profile_id
      and pp.user_id = auth.uid()
  )
);

drop policy if exists "Players can remove their own club history" on public.club_history;
create policy "Players can remove their own club history"
on public.club_history
for delete
to authenticated
using (
  exists (
    select 1
    from public.player_profiles pp
    where pp.id = club_history.player_profile_id
      and pp.user_id = auth.uid()
  )
);

drop policy if exists "Footy Status admins can manage club history" on public.club_history;
create policy "Footy Status admins can manage club history"
on public.club_history
for all
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com');
