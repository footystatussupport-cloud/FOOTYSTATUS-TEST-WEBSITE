alter table public.team_profiles
  add column if not exists head_coach_email text,
  add column if not exists head_coach_phone text;

alter table public.teams
  add column if not exists head_coach_email text,
  add column if not exists head_coach_phone text;

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
      sport = coalesce(new.sport, 'Soccer'),
      conference_name = new.league_conference,
      school_website = new.school_website,
      school_logo_url = new.school_logo_url,
      logo_url = coalesce(new.logo_url, new.school_logo_url, logo_url),
      head_coach_name = new.head_coach_name,
      head_coach_email = new.head_coach_email,
      head_coach_phone = new.head_coach_phone,
      team_colors = new.team_colors,
      social_links = new.social_links
    where id = new.team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_team_type_to_owned_team_trigger on public.team_profiles;

create trigger sync_team_type_to_owned_team_trigger
after insert or update of team_id, team_type, school_level, school_name, team_mascot, sport, league_conference, school_website, school_logo_url, logo_url, head_coach_name, head_coach_email, head_coach_phone, team_colors, social_links
on public.team_profiles
for each row
execute function public.sync_team_type_to_owned_team();
