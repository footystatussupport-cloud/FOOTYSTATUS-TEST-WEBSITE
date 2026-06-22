alter table public.club_teams
  add column if not exists parent_team_id uuid references public.teams(id) on delete set null;

update public.club_teams
set parent_team_id = team_id
where parent_team_id is null
  and team_id is not null;

create or replace function public.sync_club_team_parent_team_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_team_id is null then
    new.parent_team_id := new.team_id;
  end if;

  if new.team_id is null then
    new.team_id := new.parent_team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_club_team_parent_team_id_trigger on public.club_teams;

create trigger sync_club_team_parent_team_id_trigger
before insert or update of team_id, parent_team_id
on public.club_teams
for each row
execute function public.sync_club_team_parent_team_id();

create or replace function public.archive_club_team(_club_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
begin
  select c.owner_user_id
    into v_owner_user_id
  from public.club_teams ct
  join public.clubs c on c.id = ct.club_id
  where ct.id = _club_team_id;

  if v_owner_user_id is null then
    raise exception 'Daughter team not found';
  end if;

  if v_owner_user_id <> auth.uid() then
    raise exception 'You are not allowed to delete this daughter team';
  end if;

  update public.club_teams
  set status = 'archived'
  where id = _club_team_id;
end;
$$;

grant execute on function public.archive_club_team(uuid) to authenticated;
