update public.profiles p
set bio = null,
    updated_at = now()
from public.player_profiles pp
where pp.user_id = p.user_id
  and p.bio is not null
  and lower(trim(p.bio)) in (
    lower(trim(coalesce(pp.team, ''))),
    lower(trim(coalesce(pp.position, ''))),
    lower(trim(coalesce(pp.school_grade, ''))),
    lower(trim(coalesce(pp.height, ''))),
    lower(trim(coalesce(pp.weight, '')))
  );

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
  pp.school_grade,
  pp.player_gender,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  pp.jersey_number,
  p.bio,
  p.username,
  p.age_birth_year,
  coalesce(am.team_name, p.team_name, pp.team) as team_name,
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
