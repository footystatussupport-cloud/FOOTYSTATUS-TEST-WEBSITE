create or replace function public.toggle_clip_like(_clip_id uuid)
returns table (
  liked boolean,
  likes_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_like_exists boolean;
  v_clip_row public.clips;
  v_clip_owner_user_id uuid;
  v_actor_name text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to like a clip.';
  end if;

  select *
  into v_clip_row
  from public.clips
  where id = _clip_id;

  if v_clip_row.id is null then
    raise exception 'Clip not found.';
  end if;

  select exists(
    select 1
    from public.clip_likes
    where clip_id = _clip_id
      and user_id = v_user_id
  )
  into v_like_exists;

  if v_like_exists then
    delete from public.clip_likes
    where clip_id = _clip_id
      and user_id = v_user_id;
  else
    insert into public.clip_likes (clip_id, user_id)
    values (_clip_id, v_user_id)
    on conflict (clip_id, user_id) do nothing;

    v_clip_owner_user_id := v_clip_row.user_id;

    if v_clip_owner_user_id is null and v_clip_row.player_id is not null then
      select pp.user_id
      into v_clip_owner_user_id
      from public.player_profiles pp
      where pp.id = v_clip_row.player_id
      limit 1;
    end if;

    if v_clip_owner_user_id is null and v_clip_row.player_id is not null then
      select pl.user_id
      into v_clip_owner_user_id
      from public.players pl
      where pl.id = v_clip_row.player_id
      limit 1;
    end if;

    if v_clip_owner_user_id is not null and v_clip_owner_user_id <> v_user_id then
      v_actor_name := public.notification_actor_name(v_user_id);

      perform public.create_notification(
        v_clip_owner_user_id,
        v_user_id,
        'clip_liked',
        'Clip liked',
        v_actor_name || ' liked your clip "' || coalesce(v_clip_row.title, 'Untitled clip') || '".',
        'clip',
        v_clip_row.id,
        null,
        null,
        v_clip_row.id,
        '/?tab=next-up&clip=' || v_clip_row.id,
        jsonb_build_object('clip_id', v_clip_row.id),
        'clip_liked:' || v_clip_row.id || ':' || v_user_id
      );
    end if;
  end if;

  return query
  select
    exists(
      select 1
      from public.clip_likes
      where clip_id = _clip_id
        and user_id = v_user_id
    ) as liked,
    (
      select count(*)::integer
      from public.clip_likes
      where clip_id = _clip_id
    ) as likes_count;
end;
$$;

grant execute on function public.toggle_clip_like(uuid) to authenticated;
