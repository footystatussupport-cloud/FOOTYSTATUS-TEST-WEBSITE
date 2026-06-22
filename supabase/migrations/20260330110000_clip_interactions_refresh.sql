create table if not exists public.clip_views (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  playback_source text default 'next_up',
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_clip_views_clip_id_created_at
on public.clip_views (clip_id, created_at desc);

create index if not exists idx_clip_views_user_id_created_at
on public.clip_views (user_id, created_at desc);

alter table public.clip_views enable row level security;

drop policy if exists "Clip views are viewable by everyone" on public.clip_views;
create policy "Clip views are viewable by everyone"
on public.clip_views
for select
to public
using (true);

drop policy if exists "Authenticated users can insert their own clip views" on public.clip_views;
create policy "Authenticated users can insert their own clip views"
on public.clip_views
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can insert their own likes" on public.clip_likes;
create policy "Users can insert their own likes"
on public.clip_likes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own likes" on public.clip_likes;
create policy "Users can delete their own likes"
on public.clip_likes
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.sync_clip_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip_id uuid := coalesce(new.clip_id, old.clip_id);
begin
  if v_clip_id is null then
    return coalesce(new, old);
  end if;

  update public.clips
  set likes_count = (
    select count(*)
    from public.clip_likes
    where clip_id = v_clip_id
  )
  where id = v_clip_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.sync_clip_view_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clip_id is null then
    return new;
  end if;

  update public.clips
  set views_count = (
    select count(*)
    from public.clip_views
    where clip_id = new.clip_id
  )
  where id = new.clip_id;

  return new;
end;
$$;

drop trigger if exists sync_clip_like_count_insert on public.clip_likes;
create trigger sync_clip_like_count_insert
after insert on public.clip_likes
for each row execute function public.sync_clip_like_count();

drop trigger if exists sync_clip_like_count_delete on public.clip_likes;
create trigger sync_clip_like_count_delete
after delete on public.clip_likes
for each row execute function public.sync_clip_like_count();

drop trigger if exists sync_clip_view_count_insert on public.clip_views;
create trigger sync_clip_view_count_insert
after insert on public.clip_views
for each row execute function public.sync_clip_view_count();

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
begin
  if v_user_id is null then
    raise exception 'You must be signed in to like a clip.';
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
  v_view_count integer;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to view a clip.';
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

update public.clips c
set likes_count = (
      select count(*)::integer
      from public.clip_likes l
      where l.clip_id = c.id
    ),
    views_count = (
      select count(*)::integer
      from public.clip_views v
      where v.clip_id = c.id
    );

grant execute on function public.toggle_clip_like(uuid) to authenticated;
grant execute on function public.record_clip_view(uuid, text) to authenticated;
