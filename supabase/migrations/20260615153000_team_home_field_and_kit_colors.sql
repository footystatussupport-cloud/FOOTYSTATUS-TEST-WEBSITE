alter table public.team_profiles
  add column if not exists home_jersey_color text,
  add column if not exists away_jersey_color text,
  add column if not exists third_kit_color text;

alter table public.teams
  add column if not exists home_jersey_color text,
  add column if not exists away_jersey_color text,
  add column if not exists third_kit_color text;

update public.team_profiles tp
set
  home_jersey_color = coalesce(tp.home_jersey_color, t.home_jersey_color),
  away_jersey_color = coalesce(tp.away_jersey_color, t.away_jersey_color),
  third_kit_color = coalesce(tp.third_kit_color, t.third_kit_color)
from public.teams t
where tp.team_id = t.id;
