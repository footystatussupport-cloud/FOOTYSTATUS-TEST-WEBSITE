create or replace function public.notify_on_clip_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clip_row public.clips;
  actor_name text;
  clip_owner_user_id uuid;
begin
  select *
  into clip_row
  from public.clips
  where id = new.clip_id;

  if clip_row.id is null then
    return new;
  end if;

  clip_owner_user_id := clip_row.user_id;

  if clip_owner_user_id is null and clip_row.player_id is not null then
    select pp.user_id
    into clip_owner_user_id
    from public.player_profiles pp
    where pp.id = clip_row.player_id
    limit 1;
  end if;

  if clip_owner_user_id is null and clip_row.player_id is not null then
    select pl.user_id
    into clip_owner_user_id
    from public.players pl
    where pl.id = clip_row.player_id
    limit 1;
  end if;

  if clip_owner_user_id is null or clip_owner_user_id = new.user_id then
    return new;
  end if;

  actor_name := public.notification_actor_name(new.user_id);

  perform public.create_notification(
    clip_owner_user_id,
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

drop trigger if exists notify_clip_like_insert on public.clip_likes;
create trigger notify_clip_like_insert
after insert on public.clip_likes
for each row execute function public.notify_on_clip_like();
