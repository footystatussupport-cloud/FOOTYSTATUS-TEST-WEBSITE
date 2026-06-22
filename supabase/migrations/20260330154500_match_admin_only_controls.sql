create or replace function public.can_submit_match_report(_match_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $can_submit_report$
  select public.is_match_admin(_user_id)
    or exists (
      select 1
      from public.matches m
      where m.id = _match_id
        and m.referee_user_id = _user_id
    );
$can_submit_report$;

create or replace function public.can_review_assist_claim(_claim_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $can_review_claim$
  select public.is_match_admin(_user_id);
$can_review_claim$;

create or replace function public.upsert_match_event(
  _match_id uuid,
  _team_id uuid,
  _event_type text,
  _player_profile_id uuid default null,
  _jersey_number text default null,
  _event_minute integer default null,
  _metadata jsonb default '{}'::jsonb,
  _source text default 'manual_admin'
)
returns public.match_events
language plpgsql
security definer
set search_path = public
as $upsert_match_event$
declare
  player_user uuid;
  result_row public.match_events;
begin
  if not public.is_match_admin(auth.uid()) then
    raise exception 'Only Footy Status admins can add official match events.';
  end if;

  if _player_profile_id is not null then
    select user_id into player_user
    from public.player_profiles
    where id = _player_profile_id;
  end if;

  insert into public.match_events (
    match_id,
    team_id,
    player_profile_id,
    player_user_id,
    jersey_number,
    event_type,
    event_minute,
    metadata,
    source,
    status,
    created_by_user_id
  )
  values (
    _match_id,
    _team_id,
    _player_profile_id,
    player_user,
    _jersey_number,
    _event_type,
    _event_minute,
    coalesce(_metadata, '{}'::jsonb),
    'manual_admin',
    'approved',
    auth.uid()
  )
  returning * into result_row;

  return result_row;
end;
$upsert_match_event$;

grant execute on function public.can_submit_match_report(uuid, uuid) to authenticated;
grant execute on function public.can_review_assist_claim(uuid, uuid) to authenticated;
grant execute on function public.upsert_match_event(uuid, uuid, text, uuid, text, integer, jsonb, text) to authenticated;
