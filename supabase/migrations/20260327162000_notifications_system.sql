create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  secondary_user_id uuid references auth.users(id) on delete set null,
  type text not null,
  title text not null,
  body text not null default '',
  entity_type text,
  entity_id uuid,
  team_id uuid references public.teams(id) on delete set null,
  club_team_id uuid,
  clip_id uuid references public.clips(id) on delete set null,
  link_path text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  is_read boolean not null default false,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_notifications_user_created_at
on public.notifications(user_id, created_at desc);

create index if not exists idx_notifications_user_unread_created_at
on public.notifications(user_id, is_read, created_at desc);

create unique index if not exists idx_notifications_dedupe_key_unique
on public.notifications(dedupe_key)
where dedupe_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "Users can view their own notifications" on public.notifications;
create policy "Users can view their own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update their own notifications" on public.notifications;
create policy "Users can update their own notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.notification_actor_name(_user_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.club_name), ''), nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), 'Someone')
  from public.profiles p
  where p.user_id = _user_id
  limit 1;
$$;

create or replace function public.notification_team_line(_team_name text, _age_group text, _league_name text)
returns text
language sql
immutable
as $$
  select array_to_string(array_remove(array[_team_name, _age_group, _league_name], null), ' • ');
$$;

create or replace function public.create_notification(
  _user_id uuid,
  _actor_user_id uuid,
  _type text,
  _title text,
  _body text default '',
  _entity_type text default null,
  _entity_id uuid default null,
  _team_id uuid default null,
  _club_team_id uuid default null,
  _clip_id uuid default null,
  _link_path text default null,
  _metadata jsonb default '{}'::jsonb,
  _dedupe_key text default null,
  _secondary_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
begin
  if _user_id is null then
    return null;
  end if;

  if _dedupe_key is not null then
    select id
    into notification_id
    from public.notifications
    where dedupe_key = _dedupe_key
    limit 1;

    if notification_id is not null then
      return notification_id;
    end if;
  end if;

  insert into public.notifications (
    user_id,
    actor_user_id,
    secondary_user_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    team_id,
    club_team_id,
    clip_id,
    link_path,
    metadata,
    dedupe_key
  )
  values (
    _user_id,
    _actor_user_id,
    _secondary_user_id,
    _type,
    _title,
    coalesce(_body, ''),
    _entity_type,
    _entity_id,
    _team_id,
    _club_team_id,
    _clip_id,
    _link_path,
    coalesce(_metadata, '{}'::jsonb),
    _dedupe_key
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.notify_on_clip_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clip_row public.clips;
  actor_name text;
begin
  select * into clip_row
  from public.clips
  where id = new.clip_id;

  if clip_row.id is null or clip_row.user_id is null or clip_row.user_id = new.user_id then
    return new;
  end if;

  actor_name := public.notification_actor_name(new.user_id);

  perform public.create_notification(
    clip_row.user_id,
    new.user_id,
    'clip_liked',
    'Clip liked',
    actor_name || ' liked your clip "' || coalesce(clip_row.title, 'Untitled clip') || '".',
    'clip',
    clip_row.id,
    null,
    null,
    clip_row.id,
    '/?tab=next-up&clip=' || clip_row.id,
    jsonb_build_object('clip_id', clip_row.id),
    'clip_liked:' || clip_row.id || ':' || new.user_id
  );

  return new;
end;
$$;

create or replace function public.notify_on_clip_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clip_row public.clips;
  actor_name text;
begin
  select * into clip_row
  from public.clips
  where id = new.clip_id;

  if clip_row.id is null or clip_row.user_id is null or clip_row.user_id = new.user_id then
    return new;
  end if;

  actor_name := coalesce(nullif(trim(new.user_name), ''), public.notification_actor_name(new.user_id));

  perform public.create_notification(
    clip_row.user_id,
    new.user_id,
    'clip_commented',
    'New clip comment',
    actor_name || ' commented on "' || coalesce(clip_row.title, 'Untitled clip') || '".',
    'clip',
    clip_row.id,
    null,
    null,
    clip_row.id,
    '/?tab=next-up&clip=' || clip_row.id,
    jsonb_build_object('clip_id', clip_row.id, 'comment_id', new.id),
    'clip_commented:' || new.id
  );

  return new;
end;
$$;

create or replace function public.notify_on_clip_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    perform public.create_notification(
      new.user_id,
      new.user_id,
      'clip_uploaded',
      'Clip uploaded',
      '"' || coalesce(new.title, 'Untitled clip') || '" is now live on Next Up.',
      'clip',
      new.id,
      null,
      null,
      new.id,
      '/profile',
      jsonb_build_object('clip_id', new.id),
      'clip_uploaded:' || new.id
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_team_invite_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_name_value text;
  league_name_value text;
  inviter_name text;
begin
  select t.name, l.name
  into team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = new.league_id
  where t.id = new.team_id;

  inviter_name := public.notification_actor_name(new.invited_by);

  perform public.create_notification(
    new.player_user_id,
    new.invited_by,
    'team_invite_received',
    'Team invite',
    inviter_name || ' invited you to ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
    'team_invite',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    '/profile',
    jsonb_build_object('invite_id', new.id, 'team_id', new.team_id),
    'team_invite_received:' || new.id
  );

  return new;
end;
$$;

create or replace function public.notify_on_team_invite_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  player_name text;
begin
  if old.status = new.status or new.status not in ('accepted', 'declined') then
    return new;
  end if;

  select t.owner_user_id, t.name, l.name
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = new.league_id
  where t.id = new.team_id;

  if owner_user_id is null then
    return new;
  end if;

  player_name := public.notification_actor_name(new.player_user_id);

  perform public.create_notification(
    owner_user_id,
    new.player_user_id,
    case when new.status = 'accepted' then 'team_invite_accepted' else 'team_invite_declined' end,
    case when new.status = 'accepted' then 'Invite accepted' else 'Invite declined' end,
    player_name || ' ' ||
      case when new.status = 'accepted' then 'accepted your invite to ' else 'declined your invite to ' end ||
      public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
    'team_invite',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    '/team/' || new.team_id,
    jsonb_build_object('invite_id', new.id, 'team_id', new.team_id, 'status', new.status),
    'team_invite_' || new.status || ':' || new.id
  );

  return new;
end;
$$;

create or replace function public.notify_on_team_join_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  player_name text;
begin
  select t.owner_user_id, t.name, l.name
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = new.league_id
  where t.id = new.team_id;

  player_name := public.notification_actor_name(new.player_user_id);

  if new.status = 'pending' and owner_user_id is not null then
    perform public.create_notification(
      owner_user_id,
      new.player_user_id,
      'team_join_requested',
      'New team request',
      player_name || ' requested to join ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
      'team_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/team/' || new.team_id,
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
      'team_join_requested:' || new.id
    );
  elsif new.status = 'approved' then
    perform public.create_notification(
      new.player_user_id,
      owner_user_id,
      'team_join_approved',
      'Team request approved',
      'You joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
      'team_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/profile',
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
      'team_join_approved:' || new.id
    );

    if owner_user_id is not null then
      perform public.create_notification(
        owner_user_id,
        new.player_user_id,
        'player_joined_team',
        'Player joined your team',
        player_name || ' joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
        'team_join_request',
        new.id,
        new.team_id,
        new.club_team_id,
        null,
        '/team/' || new.team_id,
        jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
        'player_joined_team:request:' || new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_team_join_request_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  player_name text;
begin
  if old.status = new.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;

  select t.owner_user_id, t.name, l.name
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = new.league_id
  where t.id = new.team_id;

  player_name := public.notification_actor_name(new.player_user_id);

  if new.status = 'approved' then
    perform public.create_notification(
      new.player_user_id,
      coalesce(new.reviewed_by, owner_user_id),
      'team_join_approved',
      'Team request approved',
      'You joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
      'team_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/profile',
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
      'team_join_approved:' || new.id
    );

    if owner_user_id is not null then
      perform public.create_notification(
        owner_user_id,
        new.player_user_id,
        'player_joined_team',
        'Player joined your team',
        player_name || ' joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
        'team_join_request',
        new.id,
        new.team_id,
        new.club_team_id,
        null,
        '/team/' || new.team_id,
        jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
        'player_joined_team:request:' || new.id
      );
    end if;
  elsif new.status = 'rejected' then
    perform public.create_notification(
      new.player_user_id,
      coalesce(new.reviewed_by, owner_user_id),
      'team_join_rejected',
      'Team request rejected',
      'Your request to join ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || ' was declined.',
      'team_join_request',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/profile',
      jsonb_build_object('request_id', new.id, 'team_id', new.team_id),
      'team_join_rejected:' || new.id
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_membership_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  player_name text;
begin
  if new.status not in ('accepted', 'approved') then
    return new;
  end if;

  select t.owner_user_id, t.name, l.name
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = coalesce(new.league_id, t.league_id)
  where t.id = new.team_id;

  player_name := public.notification_actor_name(new.player_user_id);

  if new.joined_via = 'invite' then
    perform public.create_notification(
      owner_user_id,
      new.player_user_id,
      'player_joined_team',
      'Player joined your team',
      player_name || ' joined ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
      'membership',
      new.id,
      new.team_id,
      new.club_team_id,
      null,
      '/team/' || new.team_id,
      jsonb_build_object('membership_id', new.id, 'team_id', new.team_id),
      'player_joined_team:membership:' || new.id
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_membership_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_user_id uuid;
  team_name_value text;
  league_name_value text;
  player_name text;
begin
  if old.status = new.status or new.status <> 'revoked' or old.status not in ('accepted', 'approved', 'pending') then
    return new;
  end if;

  select t.owner_user_id, t.name, l.name
  into owner_user_id, team_name_value, league_name_value
  from public.teams t
  left join public.leagues l on l.id = coalesce(new.league_id, t.league_id)
  where t.id = new.team_id;

  if owner_user_id is null then
    return new;
  end if;

  player_name := public.notification_actor_name(new.player_user_id);

  perform public.create_notification(
    owner_user_id,
    new.player_user_id,
    'player_left_team',
    'Player left your team',
    player_name || ' left ' || public.notification_team_line(team_name_value, new.age_group, league_name_value) || '.',
    'membership',
    new.id,
    new.team_id,
    new.club_team_id,
    null,
    '/team/' || new.team_id,
    jsonb_build_object('membership_id', new.id, 'team_id', new.team_id),
    'player_left_team:' || new.id
  );

  return new;
end;
$$;

create or replace function public.notify_on_team_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null or new.approval_status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.approval_status = new.approval_status then
    return new;
  end if;

  perform public.create_notification(
    new.owner_user_id,
    null,
    'account_approved',
    'Team approved',
    coalesce(new.name, 'Your team') || ' is now approved on Footy Status.',
    'team',
    new.id,
    new.id,
    null,
    null,
    '/profile',
    jsonb_build_object('team_id', new.id),
    'team_approved:' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_clip_like_insert on public.clip_likes;
create trigger notify_clip_like_insert
after insert on public.clip_likes
for each row execute function public.notify_on_clip_like();

drop trigger if exists notify_clip_comment_insert on public.clip_comments;
create trigger notify_clip_comment_insert
after insert on public.clip_comments
for each row execute function public.notify_on_clip_comment();

drop trigger if exists notify_clip_created_insert on public.clips;
create trigger notify_clip_created_insert
after insert on public.clips
for each row execute function public.notify_on_clip_created();

drop trigger if exists notify_team_invite_insert on public.team_player_invites;
create trigger notify_team_invite_insert
after insert on public.team_player_invites
for each row execute function public.notify_on_team_invite_insert();

drop trigger if exists notify_team_invite_update on public.team_player_invites;
create trigger notify_team_invite_update
after update on public.team_player_invites
for each row execute function public.notify_on_team_invite_update();

drop trigger if exists notify_team_join_request_insert on public.team_join_requests;
create trigger notify_team_join_request_insert
after insert on public.team_join_requests
for each row execute function public.notify_on_team_join_request_insert();

drop trigger if exists notify_team_join_request_update on public.team_join_requests;
create trigger notify_team_join_request_update
after update on public.team_join_requests
for each row execute function public.notify_on_team_join_request_update();

drop trigger if exists notify_membership_insert on public.player_team_memberships;
create trigger notify_membership_insert
after insert on public.player_team_memberships
for each row execute function public.notify_on_membership_insert();

drop trigger if exists notify_membership_update on public.player_team_memberships;
create trigger notify_membership_update
after update on public.player_team_memberships
for each row execute function public.notify_on_membership_update();

drop trigger if exists notify_team_approved_insert on public.teams;
create trigger notify_team_approved_insert
after insert on public.teams
for each row execute function public.notify_on_team_approved();

drop trigger if exists notify_team_approved_update on public.teams;
create trigger notify_team_approved_update
after update on public.teams
for each row execute function public.notify_on_team_approved();
