alter table public.team_profiles
  add column if not exists team_type text not null default 'club',
  add column if not exists school_level text,
  add column if not exists school_name text,
  add column if not exists team_mascot text,
  add column if not exists sport text,
  add column if not exists league_conference text,
  add column if not exists school_website text,
  add column if not exists school_logo_url text,
  add column if not exists head_coach_name text,
  add column if not exists team_colors text,
  add column if not exists social_links text;

alter table public.teams
  add column if not exists team_type text not null default 'club',
  add column if not exists school_level text,
  add column if not exists school_name text,
  add column if not exists team_mascot text,
  add column if not exists sport text,
  add column if not exists conference_name text,
  add column if not exists school_website text,
  add column if not exists school_logo_url text,
  add column if not exists head_coach_name text,
  add column if not exists team_colors text,
  add column if not exists social_links text;

alter table public.club_teams
  add column if not exists team_type text not null default 'club',
  add column if not exists school_level text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_profiles_team_type_check'
  ) then
    alter table public.team_profiles
      add constraint team_profiles_team_type_check
      check (team_type in ('club', 'school'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_team_type_check'
  ) then
    alter table public.teams
      add constraint teams_team_type_check
      check (team_type in ('club', 'school'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_teams_team_type_check'
  ) then
    alter table public.club_teams
      add constraint club_teams_team_type_check
      check (team_type in ('club', 'school'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_profiles_school_level_check'
  ) then
    alter table public.team_profiles
      add constraint team_profiles_school_level_check
      check (school_level is null or school_level in ('varsity', 'junior_varsity', 'prep', 'middle_school'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_school_level_check'
  ) then
    alter table public.teams
      add constraint teams_school_level_check
      check (school_level is null or school_level in ('varsity', 'junior_varsity', 'prep', 'middle_school'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_teams_school_level_check'
  ) then
    alter table public.club_teams
      add constraint club_teams_school_level_check
      check (school_level is null or school_level in ('varsity', 'junior_varsity', 'prep', 'middle_school'));
  end if;
end $$;

update public.team_profiles
set team_type = 'club'
where team_type is null;

update public.teams
set team_type = 'club'
where team_type is null;

update public.club_teams
set team_type = 'club'
where team_type is null;

create index if not exists idx_team_profiles_team_type
  on public.team_profiles(team_type);

create index if not exists idx_teams_team_type
  on public.teams(team_type);

create index if not exists idx_teams_school_level
  on public.teams(school_level)
  where team_type = 'school';

create index if not exists idx_club_teams_team_type
  on public.club_teams(team_type);

create index if not exists idx_club_teams_school_level
  on public.club_teams(school_level)
  where team_type = 'school';

create or replace function public.sync_team_type_to_owned_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null then
    update public.teams
    set
      team_type = coalesce(new.team_type, 'club'),
      school_level = new.school_level,
      school_name = new.school_name,
      team_mascot = new.team_mascot,
      sport = new.sport,
      conference_name = new.league_conference,
      school_website = new.school_website,
      school_logo_url = new.school_logo_url,
      logo_url = coalesce(new.logo_url, new.school_logo_url, logo_url),
      head_coach_name = new.head_coach_name,
      team_colors = new.team_colors,
      social_links = new.social_links
    where id = new.team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_team_type_to_owned_team_trigger on public.team_profiles;

create trigger sync_team_type_to_owned_team_trigger
after insert or update of team_id, team_type, school_level, school_name, team_mascot, sport, league_conference, school_website, school_logo_url, logo_url, head_coach_name, team_colors, social_links
on public.team_profiles
for each row
execute function public.sync_team_type_to_owned_team();
