-- Keep the teams-table copy of the kit colors and home field in lockstep with
-- the canonical team_profiles row. team_profiles is what the club's own editor
-- and the Footy Status admin editor both write, while several surfaces
-- (TeamProfile fallback, match creation defaults) still read
-- teams.*_jersey_color / third_kit_color / stadium. Without this sync, an
-- admin edit or an intentional clear on team_profiles left a stale value
-- behind on teams.
--
-- Mirrors the existing sync_team_profile_name_to_profile trigger pattern.

create or replace function public.sync_team_profile_kit_to_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null then
    update public.teams
    set home_jersey_color = new.home_jersey_color,
        away_jersey_color = new.away_jersey_color,
        third_kit_color = new.third_kit_color,
        stadium = new.home_stadium,
        updated_at = now()
    where id = new.team_id
      and (
        coalesce(home_jersey_color, '') is distinct from coalesce(new.home_jersey_color, '')
        or coalesce(away_jersey_color, '') is distinct from coalesce(new.away_jersey_color, '')
        or coalesce(third_kit_color, '') is distinct from coalesce(new.third_kit_color, '')
        or coalesce(stadium, '') is distinct from coalesce(new.home_stadium, '')
      );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_team_profile_kit_to_team_trigger on public.team_profiles;
create trigger sync_team_profile_kit_to_team_trigger
after insert or update of home_jersey_color, away_jersey_color, third_kit_color, home_stadium, team_id on public.team_profiles
for each row
execute function public.sync_team_profile_kit_to_team();
