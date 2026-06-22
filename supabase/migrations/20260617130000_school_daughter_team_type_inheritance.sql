create or replace function public.inherit_daughter_team_type_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_team_id_value uuid;
  parent_team_type_value text;
  parent_school_level_value text;
begin
  select coalesce(new.parent_team_id, new.team_id, c.primary_team_id)
  into parent_team_id_value
  from public.clubs c
  where c.id = new.club_id;

  if parent_team_id_value is null then
    return new;
  end if;

  select
    case
      when t.team_type = 'school' or tp.team_type = 'school' then 'school'
      else 'club'
    end,
    coalesce(t.school_level, tp.school_level)
  into parent_team_type_value, parent_school_level_value
  from public.teams t
  left join public.team_profiles tp on tp.team_id = t.id
  where t.id = parent_team_id_value
  limit 1;

  new.parent_team_id := parent_team_id_value;
  new.team_type := coalesce(parent_team_type_value, 'club');

  if new.team_type = 'school' then
    new.school_level := coalesce(
      case lower(coalesce(new.level, new.age_group, ''))
        when 'high school varsity' then 'varsity'
        when 'varsity' then 'varsity'
        when 'junior varsity' then 'junior_varsity'
        when 'junior varsity team' then 'junior_varsity'
        when 'jv' then 'junior_varsity'
        when 'prep' then 'prep'
        when 'prep team' then 'prep'
        when 'middle school' then 'middle_school'
        when 'middle school team' then 'middle_school'
        else null
      end,
      new.school_level,
      parent_school_level_value
    );
  else
    new.school_level := null;
  end if;

  return new;
end;
$$;

drop trigger if exists inherit_daughter_team_type_from_parent_trigger
on public.club_teams;

create trigger inherit_daughter_team_type_from_parent_trigger
before insert or update of club_id, team_id, parent_team_id, level, age_group
on public.club_teams
for each row
execute function public.inherit_daughter_team_type_from_parent();

update public.club_teams ct
set
  parent_team_id = coalesce(ct.parent_team_id, ct.team_id, c.primary_team_id),
  team_type = case
    when t.team_type = 'school' or tp.team_type = 'school' then 'school'
    else 'club'
  end,
  school_level = case
    when t.team_type = 'school' or tp.team_type = 'school' then
      coalesce(
        case lower(coalesce(ct.level, ct.age_group, ''))
          when 'high school varsity' then 'varsity'
          when 'varsity' then 'varsity'
          when 'junior varsity' then 'junior_varsity'
          when 'junior varsity team' then 'junior_varsity'
          when 'jv' then 'junior_varsity'
          when 'prep' then 'prep'
          when 'prep team' then 'prep'
          when 'middle school' then 'middle_school'
          when 'middle school team' then 'middle_school'
          else null
        end,
        ct.school_level,
        t.school_level,
        tp.school_level
      )
    else null
  end,
  updated_at = now()
from public.clubs c
left join public.teams t
  on t.id = c.primary_team_id
left join public.team_profiles tp
  on tp.team_id = c.primary_team_id
where c.id = ct.club_id;

create or replace function public.sync_parent_team_type_to_daughters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.club_teams ct
  set
    team_type = coalesce(new.team_type, 'club'),
    school_level = case
      when coalesce(new.team_type, 'club') = 'school'
        then coalesce(ct.school_level, new.school_level)
      else null
    end,
    parent_team_id = new.id,
    updated_at = now()
  from public.clubs c
  where c.id = ct.club_id
    and c.primary_team_id = new.id;

  return new;
end;
$$;

drop trigger if exists sync_parent_team_type_to_daughters_trigger
on public.teams;

create trigger sync_parent_team_type_to_daughters_trigger
after update of team_type, school_level
on public.teams
for each row
execute function public.sync_parent_team_type_to_daughters();

grant execute on function public.inherit_daughter_team_type_from_parent() to authenticated;
grant execute on function public.sync_parent_team_type_to_daughters() to authenticated;
