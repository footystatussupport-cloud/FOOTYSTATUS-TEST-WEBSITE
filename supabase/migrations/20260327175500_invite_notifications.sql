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
    jsonb_build_object('invite_id', new.id, 'team_id', new.team_id, 'club_team_id', new.club_team_id),
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
    jsonb_build_object('invite_id', new.id, 'team_id', new.team_id, 'status', new.status, 'club_team_id', new.club_team_id),
    'team_invite_' || new.status || ':' || new.id
  );

  return new;
end;
$$;

drop trigger if exists notify_team_invite_insert on public.team_player_invites;
create trigger notify_team_invite_insert
after insert on public.team_player_invites
for each row execute function public.notify_on_team_invite_insert();

drop trigger if exists notify_team_invite_update on public.team_player_invites;
create trigger notify_team_invite_update
after update on public.team_player_invites
for each row execute function public.notify_on_team_invite_update();
