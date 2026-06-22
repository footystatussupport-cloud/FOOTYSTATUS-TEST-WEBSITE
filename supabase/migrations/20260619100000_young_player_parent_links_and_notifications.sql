-- Secure parent linking for young players ages 6-13.

alter table public.parent_player_links
  add column if not exists status text not null default 'pending',
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists denied_at timestamptz,
  add column if not exists relationship_to_player text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by_user_id uuid references auth.users(id) on delete set null;

alter table public.parent_player_links
  drop constraint if exists parent_player_links_status_check;

alter table public.parent_player_links
  add constraint parent_player_links_status_check
  check (status in ('pending', 'approved', 'denied', 'removed'));

create index if not exists parent_player_links_active_player_idx
  on public.parent_player_links(player_profile_id, status);

create or replace function public.player_age_from_birth_year(_birth_year text)
returns integer
language sql
stable
as $$
  select case
    when substring(coalesce(_birth_year, '') from '[12][0-9]{3}') is null then null
    else extract(year from current_date)::integer
      - substring(_birth_year from '[12][0-9]{3}')::integer
  end;
$$;

create or replace function public.player_is_parent_link_age(_player_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when pp.date_of_birth is not null then
          extract(year from age(current_date, pp.date_of_birth))::integer between 6 and 13
        else
          public.player_age_from_birth_year(p.age_birth_year) between 6 and 13
      end
      from public.player_profiles pp
      left join public.profiles p on p.user_id = pp.user_id
      where pp.id = _player_profile_id
      limit 1
    ),
    false
  );
$$;

create or replace function public.request_parent_player_link(
  _player_user_id uuid,
  _relationship text default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles;
  player_row public.player_profiles;
  active_link_count integer;
  link_id uuid;
begin
  select * into parent_row
  from public.parent_profiles
  where user_id = auth.uid();

  if parent_row.id is null then
    raise exception 'Only parent accounts can request parent-player links';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = _player_user_id;

  if player_row.id is null then
    raise exception 'Player profile not found';
  end if;

  if not public.player_is_parent_link_age(player_row.id) then
    raise exception 'Parent linking is available only for player accounts ages 6 through 13';
  end if;

  if exists (
    select 1
    from public.parent_player_links ppl
    where ppl.parent_profile_id = parent_row.id
      and ppl.player_profile_id = player_row.id
      and ppl.status in ('pending', 'approved')
  ) then
    raise exception 'This parent connection already exists';
  end if;

  select count(*)
  into active_link_count
  from public.parent_player_links ppl
  where ppl.player_profile_id = player_row.id
    and ppl.status in ('pending', 'approved');

  if active_link_count >= 2 then
    raise exception 'This player already has two parent connection slots in use';
  end if;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    relationship_to_player,
    notes,
    removed_at,
    removed_by_user_id,
    denied_at,
    updated_at
  )
  values (
    parent_row.id,
    player_row.id,
    'pending',
    auth.uid(),
    nullif(trim(coalesce(_relationship, parent_row.relationship_to_player, '')), ''),
    nullif(trim(coalesce(_notes, '')), ''),
    null,
    null,
    null,
    now()
  )
  on conflict (parent_profile_id, player_profile_id) do update set
    status = 'pending',
    requested_by_user_id = auth.uid(),
    relationship_to_player = excluded.relationship_to_player,
    notes = excluded.notes,
    removed_at = null,
    removed_by_user_id = null,
    denied_at = null,
    updated_at = now()
  returning id into link_id;

  perform public.create_notification(
    player_row.user_id,
    auth.uid(),
    'parent_link_requested',
    'Parent connection request',
    coalesce(parent_row.full_name, 'A parent account') || ' requested to be linked as your parent or guardian.',
    'parent_player_link',
    link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', link_id, 'parent_user_id', parent_row.user_id),
    'parent_link_requested:' || link_id
  );

  return link_id;
end;
$$;

create or replace function public.review_parent_player_link(
  _link_id uuid,
  _approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  player_row public.player_profiles;
  parent_row public.parent_profiles;
  approved_count integer;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null or link_row.status <> 'pending' then
    raise exception 'Pending parent connection not found';
  end if;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  select * into parent_row
  from public.parent_profiles
  where id = link_row.parent_profile_id;

  if player_row.user_id <> auth.uid()
     and not public.is_footy_status_admin() then
    raise exception 'Only the player or Footy Status admin can review a pending request';
  end if;

  if not public.player_is_parent_link_age(player_row.id) then
    raise exception 'Parent linking is available only for player accounts ages 6 through 13';
  end if;

  if _approve then
    select count(*) into approved_count
    from public.parent_player_links
    where player_profile_id = player_row.id
      and status = 'approved'
      and id <> _link_id;

    if approved_count >= 2 then
      raise exception 'This player already has two approved parent accounts';
    end if;
  end if;

  update public.parent_player_links
  set status = case when _approve then 'approved' else 'denied' end,
      approved_by_user_id = case when _approve then auth.uid() else null end,
      approved_at = case when _approve then now() else null end,
      denied_at = case when _approve then null else now() end,
      updated_at = now()
  where id = _link_id;

  perform public.create_notification(
    parent_row.user_id,
    player_row.user_id,
    case when _approve then 'parent_link_approved' else 'parent_link_denied' end,
    case when _approve then 'Parent connection approved' else 'Parent connection declined' end,
    case
      when _approve then coalesce(player_row.full_name, 'The player') || ' approved your parent connection.'
      else coalesce(player_row.full_name, 'The player') || ' declined your parent connection request.'
    end,
    'parent_player_link',
    _link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', _link_id, 'player_profile_id', player_row.id),
    'parent_link_reviewed:' || _link_id || ':' || case when _approve then 'approved' else 'denied' end
  );
end;
$$;

create or replace function public.remove_own_parent_player_link(_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  parent_row public.parent_profiles;
  player_row public.player_profiles;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null or link_row.status <> 'approved' then
    raise exception 'Approved parent connection not found';
  end if;

  select * into parent_row
  from public.parent_profiles
  where id = link_row.parent_profile_id;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  if parent_row.user_id <> auth.uid()
     and not public.is_footy_status_admin() then
    raise exception 'Only the linked parent can remove this connection';
  end if;

  update public.parent_player_links
  set status = 'removed',
      removed_at = now(),
      removed_by_user_id = auth.uid(),
      updated_at = now()
  where id = _link_id;

  perform public.create_notification(
    player_row.user_id,
    parent_row.user_id,
    'parent_link_removed',
    'Parent connection updated',
    coalesce(parent_row.full_name, 'A parent account') || ' is no longer linked to your account.',
    'parent_player_link',
    _link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', _link_id),
    'parent_link_removed:' || _link_id || ':' || extract(epoch from now())::bigint
  );
end;
$$;

-- Direct table changes cannot be used by a child to break an approved link.
drop policy if exists "Players parents and admins can update parent links"
on public.parent_player_links;

drop policy if exists "Parents and admins can update parent links"
on public.parent_player_links;

create policy "Parents and admins can update parent links"
on public.parent_player_links
for update
to authenticated
using (
  public.is_footy_status_admin()
  or exists (
    select 1
    from public.parent_profiles pp
    where pp.id = parent_profile_id
      and pp.user_id = auth.uid()
  )
)
with check (
  public.is_footy_status_admin()
  or exists (
    select 1
    from public.parent_profiles pp
    where pp.id = parent_profile_id
      and pp.user_id = auth.uid()
  )
);

drop policy if exists "Parents can delete their links"
on public.parent_player_links;

create policy "Parents can delete their links"
on public.parent_player_links
for delete
to authenticated
using (
  public.is_footy_status_admin()
  or exists (
    select 1
    from public.parent_profiles pp
    where pp.id = parent_profile_id
      and pp.user_id = auth.uid()
  )
);

-- Copy every child notification to each approved linked parent.
create or replace function public.fan_out_child_notification_to_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_link record;
  child_profile public.player_profiles;
begin
  if coalesce((new.metadata ->> 'parent_copy')::boolean, false) then
    return new;
  end if;

  select * into child_profile
  from public.player_profiles
  where user_id = new.user_id;

  if child_profile.id is null
     or not public.player_is_parent_link_age(child_profile.id) then
    return new;
  end if;

  for parent_link in
    select ppl.id as link_id, pp.user_id as parent_user_id
    from public.parent_player_links ppl
    join public.parent_profiles pp on pp.id = ppl.parent_profile_id
    where ppl.player_profile_id = child_profile.id
      and ppl.status = 'approved'
  loop
    perform public.create_notification(
      parent_link.parent_user_id,
      new.actor_user_id,
      'child_' || new.type,
      new.title,
      replace(
        replace(new.body, ' your ', ' your child''s '),
        'You ',
        'Your child '
      ),
      new.entity_type,
      new.entity_id,
      new.team_id,
      new.club_team_id,
      new.clip_id,
      coalesce(new.link_path, '/player/' || child_profile.id),
      coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_copy', true,
          'child_user_id', child_profile.user_id,
          'child_player_profile_id', child_profile.id,
          'source_notification_id', new.id,
          'parent_link_id', parent_link.link_id
        ),
      'parent_copy:' || new.id || ':' || parent_link.parent_user_id,
      child_profile.user_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists fan_out_child_notification_to_parents_trigger
on public.notifications;

create trigger fan_out_child_notification_to_parents_trigger
after insert on public.notifications
for each row
execute function public.fan_out_child_notification_to_parents();

-- Roster changes are actionable for the child and automatically fan out to parents.
create or replace function public.notify_child_on_roster_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_name_value text;
  link_path_value text;
begin
  if tg_op = 'UPDATE'
     and old.status in ('accepted', 'approved')
     and new.status in ('revoked', 'rejected') then
    select name into team_name_value
    from public.teams
    where id = new.team_id;

    perform public.create_notification(
      new.player_user_id,
      new.approved_by,
      'roster_removed',
      'Roster updated',
      'You are no longer on the roster for ' || coalesce(team_name_value, 'your team') || '.',
      'membership',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      case
        when new.club_team_id is not null then '/club-team/' || new.club_team_id
        else '/team/' || new.team_id
      end,
      jsonb_build_object('membership_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
      'roster_removed:' || new.id || ':' || extract(epoch from now())::bigint
    );
    return new;
  end if;

  if new.status not in ('accepted', 'approved')
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select name into team_name_value
  from public.teams
  where id = new.team_id;

  link_path_value := case
    when new.club_team_id is not null then '/club-team/' || new.club_team_id
    else '/team/' || new.team_id
  end;

  perform public.create_notification(
    new.player_user_id,
      new.approved_by,
    'roster_added',
    'Added to roster',
    'You were added to the roster for ' || coalesce(team_name_value, 'your team') || '.',
    'membership',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    link_path_value,
    jsonb_build_object('membership_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
    'roster_added:' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_child_roster_membership_insert
on public.player_team_memberships;
create trigger notify_child_roster_membership_insert
after insert on public.player_team_memberships
for each row execute function public.notify_child_on_roster_membership();

drop trigger if exists notify_child_roster_membership_update
on public.player_team_memberships;
create trigger notify_child_roster_membership_update
after update of status on public.player_team_memberships
for each row execute function public.notify_child_on_roster_membership();

-- Notify every active player on a team about fixtures/results; parent fan-out follows.
create or replace function public.notify_team_players_on_match_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row record;
  notification_type text;
  notification_title text;
  notification_body text;
begin
  if tg_op = 'INSERT' then
    notification_type := 'fixture_created';
    notification_title := 'New team fixture';
    notification_body := 'Your team has a new fixture.';
  elsif old.status is distinct from new.status
     and new.status = 'completed' then
    notification_type := 'match_result_posted';
    notification_title := 'Team result posted';
    notification_body := 'Your team''s match result was posted.';
  elsif old.scheduled_at is distinct from new.scheduled_at
     or old.venue is distinct from new.venue then
    notification_type := 'fixture_changed';
    notification_title := 'Fixture updated';
    notification_body := 'Your team''s fixture schedule was updated.';
  elsif old.home_score is distinct from new.home_score
     or old.away_score is distinct from new.away_score
     or old.status is distinct from new.status then
    notification_type := 'match_updated';
    notification_title := 'Match update';
    notification_body := 'Your team''s match was updated.';
  else
    return new;
  end if;

  for membership_row in
    select distinct ptm.player_user_id
    from public.player_team_memberships ptm
    where ptm.status in ('accepted', 'approved')
      and ptm.team_id in (new.home_team_id, new.away_team_id)
  loop
    perform public.create_notification(
      membership_row.player_user_id,
      coalesce(new.approved_by_user_id, auth.uid()),
      notification_type,
      notification_title,
      notification_body,
      'match',
      new.id,
      null,
      null,
      null,
      '/match/' || new.id,
      jsonb_build_object('match_id', new.id, 'league_id', new.league_id),
      notification_type || ':' || new.id || ':' || membership_row.player_user_id
        || case when tg_op = 'UPDATE' then ':' || extract(epoch from new.updated_at)::bigint else '' end
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_team_players_match_insert on public.matches;
create trigger notify_team_players_match_insert
after insert on public.matches
for each row execute function public.notify_team_players_on_match_change();

drop trigger if exists notify_team_players_match_update on public.matches;
create trigger notify_team_players_match_update
after update on public.matches
for each row execute function public.notify_team_players_on_match_change();

-- Team posts notify active players, then fan out to linked parents.
create or replace function public.notify_team_players_on_club_news()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_row record;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  for membership_row in
    select distinct ptm.player_user_id
    from public.player_team_memberships ptm
    where ptm.team_id = new.team_id
      and ptm.status in ('accepted', 'approved')
  loop
    perform public.create_notification(
      membership_row.player_user_id,
      new.author_user_id,
      'team_news_posted',
      'New team update',
      coalesce(new.title, 'Your team posted a new update.'),
      'club_news',
      new.id,
      new.team_id,
      null,
      null,
      '/club-news/' || new.id,
      jsonb_build_object('post_id', new.id, 'team_id', new.team_id),
      'team_news_posted:' || new.id || ':' || membership_row.player_user_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_team_players_club_news_insert
on public.club_news_posts;
create trigger notify_team_players_club_news_insert
after insert on public.club_news_posts
for each row execute function public.notify_team_players_on_club_news();

grant execute on function public.player_age_from_birth_year(text) to anon, authenticated;
grant execute on function public.player_is_parent_link_age(uuid) to authenticated;
grant execute on function public.request_parent_player_link(uuid, text, text) to authenticated;
grant execute on function public.review_parent_player_link(uuid, boolean) to authenticated;
grant execute on function public.remove_own_parent_player_link(uuid) to authenticated;
