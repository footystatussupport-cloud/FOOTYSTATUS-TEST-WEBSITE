delete from public.team_player_invites
where status <> 'pending';

delete from public.coach_staff_team_invites
where status <> 'pending';

create or replace function public.delete_handled_team_player_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pending' then
    delete from public.notifications
    where entity_type = 'team_invite'
      and entity_id = new.id;

    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists delete_handled_team_player_invite on public.team_player_invites;
create trigger delete_handled_team_player_invite
after update on public.team_player_invites
for each row execute function public.delete_handled_team_player_invite();

create or replace function public.delete_handled_coach_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pending' then
    delete from public.notifications
    where entity_type = 'coach_staff_team_invite'
      and entity_id = new.id;

    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists delete_handled_coach_staff_invite on public.coach_staff_team_invites;
create trigger delete_handled_coach_staff_invite
after update on public.coach_staff_team_invites
for each row execute function public.delete_handled_coach_staff_invite();
