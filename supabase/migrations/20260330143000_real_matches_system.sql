create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('appmaker', 'admin', 'footystatus_staff')),
  created_at timestamp with time zone not null default now(),
  unique (user_id, role)
);

alter table public.app_admin_roles enable row level security;

drop policy if exists "App admin roles viewable by owner" on public.app_admin_roles;
create policy "App admin roles viewable by owner"
on public.app_admin_roles
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.is_match_admin(_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admin_roles
    where user_id = _user_id
  );
$$;

create or replace function public.user_manages_match_team(_team_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = _team_id
      and t.owner_user_id = _user_id
  )
  or exists (
    select 1
    from public.team_profiles tp
    where tp.team_id = _team_id
      and tp.user_id = _user_id
  );
$$;

alter table public.leagues
  add column if not exists governing_body text,
  add column if not exists region text,
  add column if not exists division text,
  add column if not exists tier text,
  add column if not exists gender_category text,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamp with time zone not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leagues_status_check'
  ) then
    alter table public.leagues
      add constraint leagues_status_check
      check (status in ('active', 'completed', 'archived'));
  end if;
end $$;

drop trigger if exists update_leagues_updated_at on public.leagues;
create trigger update_leagues_updated_at
before update on public.leagues
for each row execute function public.update_updated_at_column();

create table if not exists public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  joined_at timestamp with time zone not null default now(),
  unique (league_id, team_id)
);

create index if not exists idx_league_teams_league_id on public.league_teams(league_id);
create index if not exists idx_league_teams_team_id on public.league_teams(team_id);

alter table public.league_teams enable row level security;

drop policy if exists "League teams viewable by everyone" on public.league_teams;
create policy "League teams viewable by everyone"
on public.league_teams
for select
to public
using (true);

delete from public.match_goals;
delete from public.matches;

alter table public.matches
  add column if not exists league_id uuid references public.leagues(id) on delete set null,
  add column if not exists home_team_id uuid references public.teams(id) on delete set null,
  add column if not exists away_team_id uuid references public.teams(id) on delete set null,
  add column if not exists scheduled_at timestamp with time zone,
  add column if not exists venue text,
  add column if not exists status text not null default 'scheduled',
  add column if not exists referee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists notes text,
  add column if not exists approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamp with time zone,
  add column if not exists updated_at timestamp with time zone not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_status_check'
  ) then
    alter table public.matches
      add constraint matches_status_check
      check (status in ('scheduled', 'live', 'completed', 'postponed', 'cancelled'));
  end if;
end $$;

drop trigger if exists update_matches_updated_at on public.matches;
create trigger update_matches_updated_at
before update on public.matches
for each row execute function public.update_updated_at_column();

create index if not exists idx_matches_league_id_scheduled_at on public.matches(league_id, scheduled_at);
create index if not exists idx_matches_home_team_id on public.matches(home_team_id);
create index if not exists idx_matches_away_team_id on public.matches(away_team_id);
create index if not exists idx_matches_status on public.matches(status);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_profile_id uuid references public.player_profiles(id) on delete set null,
  player_user_id uuid references auth.users(id) on delete set null,
  jersey_number text,
  event_type text not null check (event_type in ('goal', 'assist', 'yellow_card', 'red_card', 'minutes_played', 'sub_in', 'sub_out', 'penalty_scored', 'penalty_missed', 'penalty_awarded', 'own_goal')),
  event_minute integer,
  source text not null default 'manual_admin' check (source in ('referee_upload', 'manual_admin', 'manual_referee', 'player_self_claim')),
  status text not null default 'approved' check (status in ('pending_review', 'approved', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

drop trigger if exists update_match_events_updated_at on public.match_events;
create trigger update_match_events_updated_at
before update on public.match_events
for each row execute function public.update_updated_at_column();

create index if not exists idx_match_events_match_id on public.match_events(match_id);
create index if not exists idx_match_events_match_team_type on public.match_events(match_id, team_id, event_type);
create index if not exists idx_match_events_player_profile_id on public.match_events(player_profile_id);

alter table public.match_events enable row level security;

drop policy if exists "Match events viewable by everyone" on public.match_events;
create policy "Match events viewable by everyone"
on public.match_events
for select
to public
using (true);

create table if not exists public.referee_report_uploads (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  uploaded_by_user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  storage_path text,
  parsing_status text not null default 'pending_review' check (parsing_status in ('pending_review', 'parsed', 'reviewed', 'failed')),
  extracted_data jsonb not null default '{}'::jsonb,
  reviewer_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

drop trigger if exists update_referee_report_uploads_updated_at on public.referee_report_uploads;
create trigger update_referee_report_uploads_updated_at
before update on public.referee_report_uploads
for each row execute function public.update_updated_at_column();

create index if not exists idx_referee_report_uploads_match_id on public.referee_report_uploads(match_id);

alter table public.referee_report_uploads enable row level security;

create or replace function public.can_submit_match_report(_match_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_match_admin(_user_id)
    or exists (
      select 1
      from public.matches m
      where m.id = _match_id
        and m.referee_user_id = _user_id
    )
    or exists (
      select 1
      from public.matches m
      where m.id = _match_id
        and (
          public.user_manages_match_team(m.home_team_id, _user_id)
          or public.user_manages_match_team(m.away_team_id, _user_id)
        )
    );
$$;

drop policy if exists "Referee uploads viewable by everyone" on public.referee_report_uploads;
create policy "Referee uploads viewable by everyone"
on public.referee_report_uploads
for select
to public
using (true);

drop policy if exists "Authorized users can insert referee uploads" on public.referee_report_uploads;
create policy "Authorized users can insert referee uploads"
on public.referee_report_uploads
for insert
to authenticated
with check (
  uploaded_by_user_id = auth.uid()
  and public.can_submit_match_report(match_id, auth.uid())
);

drop policy if exists "Authorized users can update referee uploads" on public.referee_report_uploads;
create policy "Authorized users can update referee uploads"
on public.referee_report_uploads
for update
to authenticated
using (public.can_submit_match_report(match_id, auth.uid()))
with check (public.can_submit_match_report(match_id, auth.uid()));

create table if not exists public.match_comments (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  parent_comment_id uuid references public.match_comments(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

drop trigger if exists update_match_comments_updated_at on public.match_comments;
create trigger update_match_comments_updated_at
before update on public.match_comments
for each row execute function public.update_updated_at_column();

create index if not exists idx_match_comments_match_id_created_at on public.match_comments(match_id, created_at desc);

alter table public.match_comments enable row level security;

drop policy if exists "Match comments viewable by everyone" on public.match_comments;
create policy "Match comments viewable by everyone"
on public.match_comments
for select
to public
using (true);

drop policy if exists "Authenticated users can insert match comments" on public.match_comments;
create policy "Authenticated users can insert match comments"
on public.match_comments
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own match comments" on public.match_comments;
create policy "Users can update their own match comments"
on public.match_comments
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own match comments or admins can moderate" on public.match_comments;
create policy "Users can delete their own match comments or admins can moderate"
on public.match_comments
for delete
to authenticated
using (auth.uid() = user_id or public.is_match_admin(auth.uid()));

create table if not exists public.assist_claims (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  goal_event_id uuid not null references public.match_events(id) on delete cascade,
  claimant_player_profile_id uuid not null references public.player_profiles(id) on delete cascade,
  claimant_user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamp with time zone not null default now(),
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamp with time zone,
  unique (goal_event_id, claimant_player_profile_id)
);

create index if not exists idx_assist_claims_match_id on public.assist_claims(match_id);

alter table public.assist_claims enable row level security;

drop policy if exists "Assist claims viewable by everyone" on public.assist_claims;
create policy "Assist claims viewable by everyone"
on public.assist_claims
for select
to public
using (true);

create or replace function public.can_review_assist_claim(_claim_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_match_admin(_user_id)
    or exists (
      select 1
      from public.assist_claims ac
      where ac.id = _claim_id
        and public.user_manages_match_team(ac.team_id, _user_id)
    )
    or exists (
      select 1
      from public.assist_claims ac
      join public.matches m on m.id = ac.match_id
      where ac.id = _claim_id
        and m.referee_user_id = _user_id
    );
$$;

create or replace view public.league_standings as
with completed_matches as (
  select *
  from public.matches
  where league_id is not null
    and status = 'completed'
),
team_rows as (
  select
    m.league_id,
    m.home_team_id as team_id,
    1 as played,
    case when coalesce(m.home_score, 0) > coalesce(m.away_score, 0) then 1 else 0 end as wins,
    case when coalesce(m.home_score, 0) = coalesce(m.away_score, 0) then 1 else 0 end as draws,
    case when coalesce(m.home_score, 0) < coalesce(m.away_score, 0) then 1 else 0 end as losses,
    coalesce(m.home_score, 0) as goals_for,
    coalesce(m.away_score, 0) as goals_against
  from completed_matches m
  where m.home_team_id is not null
  union all
  select
    m.league_id,
    m.away_team_id as team_id,
    1 as played,
    case when coalesce(m.away_score, 0) > coalesce(m.home_score, 0) then 1 else 0 end as wins,
    case when coalesce(m.away_score, 0) = coalesce(m.home_score, 0) then 1 else 0 end as draws,
    case when coalesce(m.away_score, 0) < coalesce(m.home_score, 0) then 1 else 0 end as losses,
    coalesce(m.away_score, 0) as goals_for,
    coalesce(m.home_score, 0) as goals_against
  from completed_matches m
  where m.away_team_id is not null
),
aggregated as (
  select
    league_id,
    team_id,
    sum(played)::integer as played,
    sum(wins)::integer as wins,
    sum(draws)::integer as draws,
    sum(losses)::integer as losses,
    sum(goals_for)::integer as goals_for,
    sum(goals_against)::integer as goals_against
  from team_rows
  group by league_id, team_id
)
select
  lt.league_id,
  lt.team_id,
  t.name as team_name,
  coalesce(a.played, 0) as played,
  coalesce(a.wins, 0) as wins,
  coalesce(a.draws, 0) as draws,
  coalesce(a.losses, 0) as losses,
  coalesce(a.goals_for, 0) as goals_for,
  coalesce(a.goals_against, 0) as goals_against,
  coalesce(a.goals_for, 0) - coalesce(a.goals_against, 0) as goal_difference,
  (coalesce(a.wins, 0) * 3) + coalesce(a.draws, 0) as points,
  row_number() over (
    partition by lt.league_id
    order by
      ((coalesce(a.wins, 0) * 3) + coalesce(a.draws, 0)) desc,
      (coalesce(a.goals_for, 0) - coalesce(a.goals_against, 0)) desc,
      coalesce(a.goals_for, 0) desc,
      t.name asc
  ) as position
from public.league_teams lt
join public.teams t on t.id = lt.team_id
left join aggregated a on a.league_id = lt.league_id and a.team_id = lt.team_id;

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
  ht.name as home_team_name,
  ht.logo_url as home_team_logo_url,
  m.away_team_id,
  at.name as away_team_name,
  at.logo_url as away_team_logo_url,
  m.scheduled_at,
  m.venue,
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
left join public.teams at on at.id = m.away_team_id
where m.league_id is not null
  and m.home_team_id is not null
  and m.away_team_id is not null;

create or replace view public.match_comment_details as
select
  mc.*,
  coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.club_name), ''), nullif(trim(p.username), ''), 'Footy User') as author_name,
  coalesce(p.avatar_url, pp.profile_image_url, tp.logo_url) as author_avatar_url
from public.match_comments mc
left join public.profiles p on p.user_id = mc.user_id
left join public.player_profiles pp on pp.user_id = mc.user_id
left join public.team_profiles tp on tp.user_id = mc.user_id;

create or replace view public.match_event_details as
select
  me.*,
  coalesce(pp.full_name, p.full_name, p.username, 'Unknown Player') as player_name,
  pp.profile_image_url as player_avatar_url
from public.match_events me
left join public.player_profiles pp on pp.id = me.player_profile_id
left join public.profiles p on p.user_id = me.player_user_id;

create or replace function public.assign_team_to_league(_league_id uuid, _team_id uuid)
returns public.league_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  league_row public.leagues;
  team_row public.teams;
  valid_age_group boolean;
  result_row public.league_teams;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can assign teams to leagues.';
  end if;

  select * into league_row from public.leagues where id = _league_id;
  if league_row.id is null then
    raise exception 'League not found.';
  end if;

  select * into team_row from public.teams where id = _team_id;
  if team_row.id is null then
    raise exception 'Team not found.';
  end if;

  if coalesce(team_row.approval_status, 'pending') <> 'approved' then
    raise exception 'Only approved teams can be assigned to leagues.';
  end if;

  select (
    league_row.age_group is null
    or team_row.age_group = league_row.age_group
    or exists (
      select 1
      from public.team_profiles tp
      where tp.team_id = _team_id
        and tp.age_groups_offered is not null
        and league_row.age_group = any(tp.age_groups_offered)
    )
  ) into valid_age_group;

  if not coalesce(valid_age_group, false) then
    raise exception 'Team age group does not match this league.';
  end if;

  insert into public.league_teams (league_id, team_id)
  values (_league_id, _team_id)
  on conflict (league_id, team_id) do update
    set joined_at = public.league_teams.joined_at
  returning * into result_row;

  update public.teams
  set league_id = _league_id
  where id = _team_id;

  return result_row;
end;
$$;

create or replace function public.remove_team_from_league(_league_id uuid, _team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can remove teams from leagues.';
  end if;

  delete from public.league_teams
  where league_id = _league_id
    and team_id = _team_id;

  update public.teams
  set league_id = null
  where id = _team_id
    and league_id = _league_id;
end;
$$;

create or replace function public.create_league_match(
  _league_id uuid,
  _home_team_id uuid,
  _away_team_id uuid,
  _scheduled_at timestamp with time zone,
  _venue text default null,
  _referee_user_id uuid default null,
  _notes text default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  home_team_row public.teams;
  away_team_row public.teams;
  result_row public.matches;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can create fixtures.';
  end if;

  if _home_team_id = _away_team_id then
    raise exception 'A team cannot play itself.';
  end if;

  if not exists (select 1 from public.league_teams where league_id = _league_id and team_id = _home_team_id) then
    raise exception 'Home team is not assigned to this league.';
  end if;

  if not exists (select 1 from public.league_teams where league_id = _league_id and team_id = _away_team_id) then
    raise exception 'Away team is not assigned to this league.';
  end if;

  select * into home_team_row from public.teams where id = _home_team_id;
  select * into away_team_row from public.teams where id = _away_team_id;

  insert into public.matches (
    league_id,
    home_team_id,
    away_team_id,
    home_team,
    away_team,
    home_score,
    away_score,
    scheduled_at,
    venue,
    status,
    referee_user_id,
    notes,
    league
  )
  values (
    _league_id,
    _home_team_id,
    _away_team_id,
    coalesce(home_team_row.name, 'Home Team'),
    coalesce(away_team_row.name, 'Away Team'),
    0,
    0,
    _scheduled_at,
    _venue,
    'scheduled',
    _referee_user_id,
    _notes,
    (select name from public.leagues where id = _league_id)
  )
  returning * into result_row;

  return result_row;
end;
$$;

create or replace function public.save_match_result(
  _match_id uuid,
  _status text,
  _home_score integer default null,
  _away_score integer default null,
  _notes text default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  result_row public.matches;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can finalize or override results.';
  end if;

  update public.matches
  set status = _status,
      home_score = coalesce(_home_score, home_score),
      away_score = coalesce(_away_score, away_score),
      notes = coalesce(_notes, notes),
      completed_at = case when _status = 'completed' then now() else completed_at end,
      approved_by_user_id = auth.uid(),
      match_time = case when _status = 'completed' then 'FT' when _status = 'live' then coalesce(match_time, 'Live') else match_time end
  where id = _match_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'Match not found.';
  end if;

  return result_row;
end;
$$;

create or replace function public.upsert_match_event(
  _match_id uuid,
  _team_id uuid,
  _event_type text,
  _player_profile_id uuid default null,
  _jersey_number text default null,
  _event_minute integer default null,
  _metadata jsonb default '{}'::jsonb,
  _source text default 'manual_admin'
)
returns public.match_events
language plpgsql
security definer
set search_path = public
as $$
declare
  player_user uuid;
  result_row public.match_events;
begin
  if not (public.is_match_admin(auth.uid()) or public.can_submit_match_report(_match_id, auth.uid())) then
    raise exception 'You are not allowed to add official match events.';
  end if;

  if _player_profile_id is not null then
    select user_id into player_user
    from public.player_profiles
    where id = _player_profile_id;
  end if;

  insert into public.match_events (
    match_id,
    team_id,
    player_profile_id,
    player_user_id,
    jersey_number,
    event_type,
    event_minute,
    metadata,
    source,
    status,
    created_by_user_id
  )
  values (
    _match_id,
    _team_id,
    _player_profile_id,
    player_user,
    _jersey_number,
    _event_type,
    _event_minute,
    coalesce(_metadata, '{}'::jsonb),
    coalesce(_source, 'manual_admin'),
    case when public.is_match_admin(auth.uid()) then 'approved' else 'pending_review' end,
    auth.uid()
  )
  returning * into result_row;

  return result_row;
end;
$$;

create or replace function public.claim_match_assist(_goal_event_id uuid)
returns public.assist_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  goal_row public.match_events;
  claimant_profile public.player_profiles;
  existing_membership record;
  result_row public.assist_claims;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into goal_row
  from public.match_events
  where id = _goal_event_id
    and event_type = 'goal'
    and status = 'approved';

  if goal_row.id is null then
    raise exception 'Goal event not found.';
  end if;

  select * into claimant_profile
  from public.player_profiles
  where user_id = auth.uid();

  if claimant_profile.id is null then
    raise exception 'Only player accounts can claim assists.';
  end if;

  if goal_row.player_profile_id = claimant_profile.id then
    raise exception 'Scorers cannot claim their own assist.';
  end if;

  select *
  into existing_membership
  from public.player_team_memberships
  where player_user_id = auth.uid()
    and team_id = goal_row.team_id
    and status in ('accepted', 'approved')
  order by created_at desc
  limit 1;

  if existing_membership.player_user_id is null then
    raise exception 'You can only claim assists for your own linked team.';
  end if;

  insert into public.assist_claims (
    match_id,
    goal_event_id,
    claimant_player_profile_id,
    claimant_user_id,
    team_id,
    status
  )
  values (
    goal_row.match_id,
    goal_row.id,
    claimant_profile.id,
    auth.uid(),
    goal_row.team_id,
    'pending'
  )
  returning * into result_row;

  return result_row;
end;
$$;

create or replace function public.review_match_assist_claim(_claim_id uuid, _approve boolean)
returns public.assist_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.assist_claims;
begin
  if not public.can_review_assist_claim(_claim_id, auth.uid()) then
    raise exception 'You are not allowed to review this assist claim.';
  end if;

  update public.assist_claims
  set status = case when _approve then 'approved' else 'rejected' end,
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now()
  where id = _claim_id
  returning * into claim_row;

  if claim_row.id is null then
    raise exception 'Assist claim not found.';
  end if;

  if _approve then
    if not exists (
      select 1
      from public.match_events
      where match_id = claim_row.match_id
        and event_type = 'assist'
        and player_profile_id = claim_row.claimant_player_profile_id
        and metadata ->> 'goal_event_id' = claim_row.goal_event_id::text
        and status = 'approved'
    ) then
      insert into public.match_events (
        match_id,
        team_id,
        player_profile_id,
        player_user_id,
        event_type,
        event_minute,
        metadata,
        source,
        status,
        created_by_user_id
      )
      select
        claim_row.match_id,
        claim_row.team_id,
        claim_row.claimant_player_profile_id,
        claim_row.claimant_user_id,
        'assist',
        goal.event_minute,
        jsonb_build_object('goal_event_id', claim_row.goal_event_id),
        'player_self_claim',
        'approved',
        auth.uid()
      from public.match_events goal
      where goal.id = claim_row.goal_event_id;
    end if;
  end if;

  return claim_row;
end;
$$;

insert into storage.buckets (id, name, public)
select 'match-reports', 'match-reports', true
where not exists (
  select 1 from storage.buckets where id = 'match-reports'
);

drop policy if exists "Anyone can view match reports bucket" on storage.objects;
create policy "Anyone can view match reports bucket"
on storage.objects
for select
using (bucket_id = 'match-reports');

drop policy if exists "Authorized users can upload match reports" on storage.objects;
create policy "Authorized users can upload match reports"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'match-reports'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Authorized users can update match reports" on storage.objects;
create policy "Authorized users can update match reports"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'match-reports'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'match-reports'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Authorized users can delete match reports" on storage.objects;
create policy "Authorized users can delete match reports"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'match-reports'
  and auth.uid()::text = (storage.foldername(name))[1]
);

grant execute on function public.is_match_admin(uuid) to authenticated;
grant execute on function public.user_manages_match_team(uuid, uuid) to authenticated;
grant execute on function public.can_submit_match_report(uuid, uuid) to authenticated;
grant execute on function public.can_review_assist_claim(uuid, uuid) to authenticated;
grant execute on function public.assign_team_to_league(uuid, uuid) to authenticated;
grant execute on function public.remove_team_from_league(uuid, uuid) to authenticated;
grant execute on function public.create_league_match(uuid, uuid, uuid, timestamp with time zone, text, uuid, text) to authenticated;
grant execute on function public.save_match_result(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.upsert_match_event(uuid, uuid, text, uuid, text, integer, jsonb, text) to authenticated;
grant execute on function public.claim_match_assist(uuid) to authenticated;
grant execute on function public.review_match_assist_claim(uuid, boolean) to authenticated;
