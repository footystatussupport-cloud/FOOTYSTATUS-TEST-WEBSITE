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
      when hct.id is not null then concat_ws(' - ', hc.name, hct.age_group, hct.league_name)
      else null
    end,
    ht.name
  ) as home_team_name,
  coalesce(htp.logo_url, ht.logo_url) as home_team_logo_url,
  m.away_team_id,
  m.away_club_team_id,
  coalesce(
    case
      when act.id is not null then concat_ws(' - ', ac.name, act.age_group, act.league_name)
      else null
    end,
    at.name
  ) as away_team_name,
  coalesce(atp.logo_url, at.logo_url) as away_team_logo_url,
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

grant select on public.league_match_details to public;
