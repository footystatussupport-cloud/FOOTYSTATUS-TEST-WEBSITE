create or replace function public.footy_status_admin_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id
  from public.profiles p
  where lower(coalesce(p.email, '')) = 'footystatussupport@gmail.com'
  limit 1;
$$;

drop policy if exists "admins can delete referee claims" on public.referee_match_claims;

create policy "admins can delete referee claims"
on public.referee_match_claims
for delete
to authenticated
using (public.is_footy_status_admin());

create or replace function public.referee_claim_match_label(_match_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(coalesce(m.home_team_name, '') || ' vs ' || coalesce(m.away_team_name, '')), 'vs'),
    'your match'
  )
  from public.league_match_details m
  where m.id = _match_id
  limit 1;
$$;

create or replace function public.referee_claim_role_label(_role text)
returns text
language sql
stable
as $$
  select case _role
    when 'main_referee' then 'Main referee'
    when 'assistant_referee' then 'Assistant referee'
    when 'fourth_official' then 'Fourth official'
    when 'other' then 'Other match staff'
    else 'Referee'
  end;
$$;

create or replace function public.notify_footy_status_on_referee_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_user_id uuid;
  referee_name text;
  match_label text;
  league_label text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  admin_user_id := public.footy_status_admin_user_id();
  if admin_user_id is null then
    return new;
  end if;

  select coalesce(p.full_name, 'A referee')
  into referee_name
  from public.profiles p
  where p.user_id = new.referee_user_id;

  select
    public.referee_claim_match_label(new.match_id),
    m.league_name
  into match_label, league_label
  from public.league_match_details m
  where m.id = new.match_id;

  perform public.create_notification(
    admin_user_id,
    new.referee_user_id,
    'referee_match_claim_submitted',
    'Referee application submitted',
    referee_name || ' applied to ref ' || coalesce(match_label, 'a match') || coalesce(' in ' || league_label, '') || '.',
    'referee_match_claim',
    new.id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object(
      'claim_id', new.id,
      'match_id', new.match_id,
      'referee_user_id', new.referee_user_id,
      'referee_type', new.referee_type,
      'proof_file_name', new.proof_file_name
    ),
    'referee_match_claim_submitted:' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_footy_status_on_referee_claim_insert on public.referee_match_claims;

create trigger notify_footy_status_on_referee_claim_insert
after insert on public.referee_match_claims
for each row execute function public.notify_footy_status_on_referee_claim();

drop trigger if exists notify_footy_status_on_referee_claim_update on public.referee_match_claims;

create trigger notify_footy_status_on_referee_claim_update
after update on public.referee_match_claims
for each row
when (new.status = 'pending')
execute function public.notify_footy_status_on_referee_claim();

create or replace function public.notify_referee_claim_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_label text;
  role_label text;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  match_label := public.referee_claim_match_label(new.match_id);
  role_label := public.referee_claim_role_label(new.referee_type);

  perform public.create_notification(
    new.referee_user_id,
    new.reviewed_by,
    'referee_match_claim_approved',
    'Referee application approved',
    'Footy Status approved you as ' || role_label || ' for ' || coalesce(match_label, 'your match') || '.',
    'referee_match_claim',
    new.id,
    null,
    null,
    null,
    '/match/' || new.match_id::text,
    jsonb_build_object(
      'claim_id', new.id,
      'match_id', new.match_id,
      'referee_type', new.referee_type,
      'show_name_publicly', new.show_name_publicly
    ),
    'referee_match_claim_approved:' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_referee_claim_approved_update on public.referee_match_claims;

create trigger notify_referee_claim_approved_update
after update on public.referee_match_claims
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function public.notify_referee_claim_approved();

create or replace function public.cleanup_referee_claim_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_id uuid;
begin
  if TG_OP = 'DELETE' then
    claim_id := old.id;
  else
    claim_id := new.id;
  end if;

  delete from public.notifications
  where dedupe_key = 'referee_match_claim_submitted:' || claim_id;

  if TG_OP = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists cleanup_referee_claim_admin_notification_update on public.referee_match_claims;

create trigger cleanup_referee_claim_admin_notification_update
after update on public.referee_match_claims
for each row
when (new.status <> 'pending')
execute function public.cleanup_referee_claim_admin_notification();

drop trigger if exists cleanup_referee_claim_admin_notification_delete on public.referee_match_claims;

create trigger cleanup_referee_claim_admin_notification_delete
after delete on public.referee_match_claims
for each row
execute function public.cleanup_referee_claim_admin_notification();
