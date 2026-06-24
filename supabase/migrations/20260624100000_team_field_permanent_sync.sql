update public.profiles p
set team_name = pp.team,
    updated_at = now()
from public.player_profiles pp
where pp.user_id = p.user_id
  and nullif(trim(coalesce(p.team_name, '')), '') is null
  and nullif(trim(coalesce(pp.team, '')), '') is not null;

update public.player_profiles pp
set team = p.team_name,
    updated_at = now()
from public.profiles p
where p.user_id = pp.user_id
  and nullif(trim(coalesce(pp.team, '')), '') is null
  and nullif(trim(coalesce(p.team_name, '')), '') is not null;

update public.profiles p
set teams_currently_coaching = sp.team_organization_name,
    updated_at = now()
from public.staff_profiles sp
where sp.user_id = p.user_id
  and nullif(trim(coalesce(p.teams_currently_coaching, '')), '') is null
  and nullif(trim(coalesce(sp.team_organization_name, '')), '') is not null;

update public.staff_profiles sp
set team_organization_name = p.teams_currently_coaching,
    updated_at = now()
from public.profiles p
where p.user_id = sp.user_id
  and nullif(trim(coalesce(sp.team_organization_name, '')), '') is null
  and nullif(trim(coalesce(p.teams_currently_coaching, '')), '') is not null;

update public.profiles p
set club_name = tp.club_name,
    team_name = coalesce(p.team_name, tp.club_name),
    full_name = coalesce(nullif(trim(p.full_name), ''), tp.club_name),
    updated_at = now()
from public.team_profiles tp
where tp.user_id = p.user_id
  and nullif(trim(coalesce(tp.club_name, '')), '') is not null;

create or replace function public.sync_player_profile_team_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set team_name = new.team,
      updated_at = now()
  where user_id = new.user_id
    and coalesce(team_name, '') is distinct from coalesce(new.team, '');

  return new;
end;
$$;

drop trigger if exists sync_player_profile_team_to_profile_trigger on public.player_profiles;
create trigger sync_player_profile_team_to_profile_trigger
after insert or update of team on public.player_profiles
for each row
execute function public.sync_player_profile_team_to_profile();

create or replace function public.sync_profile_team_to_player_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.account_category::text, '') = 'player'
     or coalesce(new.account_role::text, '') = 'player'
     or coalesce(new.role::text, '') = 'player' then
    insert into public.player_profiles (user_id, full_name, team)
    values (new.user_id, coalesce(new.full_name, ''), new.team_name)
    on conflict (user_id) do update
      set team = excluded.team,
          full_name = coalesce(nullif(excluded.full_name, ''), public.player_profiles.full_name),
          updated_at = now()
    where coalesce(public.player_profiles.team, '') is distinct from coalesce(excluded.team, '')
       or coalesce(public.player_profiles.full_name, '') is distinct from coalesce(excluded.full_name, '');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_profile_team_to_player_profile_trigger on public.profiles;
create trigger sync_profile_team_to_player_profile_trigger
after insert or update of team_name, full_name, account_category, account_role, role on public.profiles
for each row
execute function public.sync_profile_team_to_player_profile();

create or replace function public.sync_staff_profile_team_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set teams_currently_coaching = new.team_organization_name,
      updated_at = now()
  where user_id = new.user_id
    and coalesce(teams_currently_coaching, '') is distinct from coalesce(new.team_organization_name, '');

  return new;
end;
$$;

drop trigger if exists sync_staff_profile_team_to_profile_trigger on public.staff_profiles;
create trigger sync_staff_profile_team_to_profile_trigger
after insert or update of team_organization_name on public.staff_profiles
for each row
execute function public.sync_staff_profile_team_to_profile();

create or replace function public.sync_team_profile_name_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set club_name = new.club_name,
      team_name = new.club_name,
      full_name = coalesce(nullif(trim(full_name), ''), new.club_name),
      updated_at = now()
  where user_id = new.user_id
    and (
      coalesce(club_name, '') is distinct from coalesce(new.club_name, '')
      or coalesce(team_name, '') is distinct from coalesce(new.club_name, '')
    );

  if new.team_id is not null then
    update public.teams
    set name = new.club_name,
        updated_at = now()
    where id = new.team_id
      and coalesce(name, '') is distinct from coalesce(new.club_name, '');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_team_profile_name_to_profile_trigger on public.team_profiles;
create trigger sync_team_profile_name_to_profile_trigger
after insert or update of club_name, team_id on public.team_profiles
for each row
execute function public.sync_team_profile_name_to_profile();
