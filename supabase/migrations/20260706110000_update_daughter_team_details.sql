-- Each school/club daughter team (Varsity, Junior Varsity, Prep, Middle
-- School, ...) is managed as its own entity. This RPC updates exactly one
-- team and nothing else: not the school account, not any sibling team.
-- Only the owning school/club account or a Footy Status admin may call it.

create or replace function public.update_daughter_team_details(
  _club_team_id uuid,
  _age_group text default null,
  _league_name text default null,
  _gender text default null,
  _season text default null,
  _level text default null,
  _coach_name text default null,
  _head_coach_user_id uuid default null,
  _school_level text default null
)
returns public.club_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  team_row public.club_teams;
  club_row public.clubs;
  normalized_gender text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select * into team_row
  from public.club_teams
  where id = _club_team_id;

  if team_row.id is null then
    raise exception 'Team not found.';
  end if;

  select * into club_row
  from public.clubs
  where id = team_row.club_id;

  if not (club_row.owner_user_id = v_user_id or public.is_footy_status_admin()) then
    raise exception 'Only the school or club account can edit this team.';
  end if;

  normalized_gender := case lower(trim(coalesce(_gender, '')))
    when 'boy' then 'boy'
    when 'boys' then 'boy'
    when 'girl' then 'girl'
    when 'girls' then 'girl'
    else null
  end;

  update public.club_teams
  set age_group = coalesce(nullif(trim(_age_group), ''), age_group),
      league_name = coalesce(nullif(trim(_league_name), ''), league_name),
      gender = coalesce(normalized_gender, gender),
      season = nullif(trim(coalesce(_season, '')), ''),
      level = nullif(trim(coalesce(_level, '')), ''),
      coach_name = nullif(trim(coalesce(_coach_name, '')), ''),
      head_coach_user_id = _head_coach_user_id,
      school_level = coalesce(nullif(trim(_school_level), ''), school_level),
      updated_at = now()
  where id = _club_team_id
  returning * into team_row;

  return team_row;
end;
$$;

grant execute on function public.update_daughter_team_details(uuid, text, text, text, text, text, text, uuid, text) to authenticated;

comment on function public.update_daughter_team_details(uuid, text, text, text, text, text, text, uuid, text) is
  'Updates a single daughter team; never touches the parent school/club account or sibling teams.';
