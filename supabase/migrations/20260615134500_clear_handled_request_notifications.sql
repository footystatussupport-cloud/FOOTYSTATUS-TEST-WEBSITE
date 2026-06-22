create or replace function public.clear_handled_team_join_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    delete from public.notifications
    where type = 'team_join_requested'
      and entity_type = 'team_join_request'
      and entity_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_handled_team_join_request_notifications on public.team_join_requests;
create trigger clear_handled_team_join_request_notifications
after update on public.team_join_requests
for each row execute function public.clear_handled_team_join_request_notifications();

create or replace function public.clear_handled_coach_staff_join_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    delete from public.notifications
    where type = 'coach_staff_join_requested'
      and entity_type = 'coach_staff_join_request'
      and entity_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_handled_coach_staff_join_request_notifications on public.coach_staff_join_requests;
create trigger clear_handled_coach_staff_join_request_notifications
after update on public.coach_staff_join_requests
for each row execute function public.clear_handled_coach_staff_join_request_notifications();
