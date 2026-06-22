-- Persistent notification read/deleted state with secured owner-only mutations.

alter table public.notifications
  add column if not exists deleted_at timestamptz;

drop policy if exists "Deleted notifications stay hidden" on public.notifications;
create policy "Deleted notifications stay hidden"
on public.notifications
as restrictive
for select
to authenticated
using (deleted_at is null);

create index if not exists idx_notifications_user_active_created_at
on public.notifications(user_id, created_at desc)
where deleted_at is null;

create index if not exists idx_notifications_user_active_unread
on public.notifications(user_id, created_at desc)
where deleted_at is null and is_read = false;

-- Notification history must not be automatically removed when another record changes.
drop trigger if exists clear_handled_team_join_request_notifications on public.team_join_requests;
drop trigger if exists clear_handled_coach_staff_join_request_notifications on public.coach_staff_join_requests;
drop trigger if exists delete_handled_team_player_invite on public.team_player_invites;
drop trigger if exists delete_handled_coach_staff_invite on public.coach_staff_team_invites;
drop trigger if exists cleanup_referee_claim_admin_notification_update on public.referee_match_claims;
drop trigger if exists cleanup_referee_claim_admin_notification_delete on public.referee_match_claims;

create or replace function public.mark_notification_read(_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.notifications;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.notifications
  set is_read = true,
      read_at = coalesce(read_at, now())
  where id = _notification_id
    and user_id = auth.uid()
    and deleted_at is null
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Notification not found.';
  end if;

  return v_notification;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.notifications
  set is_read = true,
      read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and deleted_at is null
    and is_read = false;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.delete_notification(_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification public.notifications;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  update public.notifications
  set deleted_at = now()
  where id = _notification_id
    and user_id = auth.uid()
    and deleted_at is null
  returning * into v_notification;

  if v_notification.id is null then
    raise exception 'Notification not found.';
  end if;

  return v_notification;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.delete_notification(uuid) to authenticated;
