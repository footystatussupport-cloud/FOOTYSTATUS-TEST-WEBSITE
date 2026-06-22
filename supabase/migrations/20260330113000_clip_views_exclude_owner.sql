create or replace function public.record_clip_view(
  _clip_id uuid,
  _playback_source text default 'next_up'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_user_id uuid;
  v_view_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to view a clip.';
  end if;

  select user_id
  into v_owner_user_id
  from public.clips
  where id = _clip_id;

  if v_owner_user_id is not null and v_owner_user_id = v_user_id then
    select count(*)::integer
    into v_view_count
    from public.clip_views
    where clip_id = _clip_id;

    return v_view_count;
  end if;

  insert into public.clip_views (clip_id, user_id, playback_source)
  values (_clip_id, v_user_id, nullif(trim(coalesce(_playback_source, '')), ''));

  select count(*)::integer
  into v_view_count
  from public.clip_views
  where clip_id = _clip_id;

  return v_view_count;
end;
$$;

grant execute on function public.record_clip_view(uuid, text) to authenticated;
