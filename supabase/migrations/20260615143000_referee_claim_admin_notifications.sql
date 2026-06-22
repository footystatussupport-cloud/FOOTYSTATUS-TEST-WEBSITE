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
    coalesce(nullif(trim(coalesce(m.home_team_name, '') || ' vs ' || coalesce(m.away_team_name, '')), 'vs'), 'Match'),
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

insert into public.notifications (
  user_id,
  actor_user_id,
  type,
  title,
  body,
  entity_type,
  entity_id,
  link_path,
  metadata,
  dedupe_key
)
select
  public.footy_status_admin_user_id(),
  c.referee_user_id,
  'referee_match_claim_submitted',
  'Referee application submitted',
  coalesce(p.full_name, 'A referee') || ' applied to ref ' ||
    coalesce(nullif(trim(coalesce(m.home_team_name, '') || ' vs ' || coalesce(m.away_team_name, '')), 'vs'), 'a match') ||
    coalesce(' in ' || m.league_name, '') || '.',
  'referee_match_claim',
  c.id,
  '/profile',
  jsonb_build_object(
    'claim_id', c.id,
    'match_id', c.match_id,
    'referee_user_id', c.referee_user_id,
    'referee_type', c.referee_type,
    'proof_file_name', c.proof_file_name
  ),
  'referee_match_claim_submitted:' || c.id
from public.referee_match_claims c
left join public.profiles p on p.user_id = c.referee_user_id
left join public.league_match_details m on m.id = c.match_id
where c.status = 'pending'
  and public.footy_status_admin_user_id() is not null
  and not exists (
    select 1
    from public.notifications n
    where n.dedupe_key = 'referee_match_claim_submitted:' || c.id
  );
