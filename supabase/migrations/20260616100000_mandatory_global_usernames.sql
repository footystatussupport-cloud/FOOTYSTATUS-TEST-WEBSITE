alter table public.profiles
  add column if not exists username text,
  add column if not exists username_last_changed_at timestamp with time zone;

create or replace function public.normalize_username(_username text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(_username, '')), '^@+', ''));
$$;

create or replace function public.username_contains_banned_word(_username text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from unnest(array[
      'poop',
      'butt',
      'fart',
      'ass',
      'shit',
      'fuck',
      'bitch',
      'cunt',
      'dick',
      'cock',
      'pussy',
      'sex',
      'porn',
      'nude',
      'nazi',
      'hitler',
      'kkk',
      'terror',
      'rape'
    ]) as banned(word)
    where public.normalize_username(_username) like '%' || banned.word || '%'
  );
$$;

create or replace function public.is_valid_username(_username text)
returns boolean
language sql
immutable
as $$
  select public.normalize_username(_username) <> ''
    and public.normalize_username(_username) ~ '^[a-z0-9_]+$'
    and not public.username_contains_banned_word(_username);
$$;

create or replace function public.generate_unique_username(_seed text, _user_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate text;
  suffix integer := 0;
begin
  base_username := lower(regexp_replace(coalesce(_seed, ''), '[^a-zA-Z0-9_]+', '', 'g'));
  base_username := trim(both '_' from base_username);

  if base_username = '' or public.username_contains_banned_word(base_username) then
    base_username := 'user';
  end if;

  base_username := left(base_username, 24);
  candidate := base_username;

  while exists (
    select 1
    from public.profiles p
    where lower(p.username) = lower(candidate)
      and (_user_id is null or p.user_id is distinct from _user_id)
  ) loop
    suffix := suffix + 1;
    candidate := left(base_username, greatest(1, 30 - length(suffix::text))) || suffix::text;
  end loop;

  return candidate;
end;
$$;

update public.profiles
set username = public.normalize_username(username)
where username is not null;

do $$
declare
  profile_row record;
  seed_value text;
begin
  for profile_row in
    select id, user_id, username, full_name, club_name, email
    from public.profiles
    where username is null
      or public.normalize_username(username) = ''
      or public.normalize_username(username) !~ '^[a-z0-9_]+$'
      or public.username_contains_banned_word(username)
  loop
    seed_value := coalesce(
      nullif(profile_row.full_name, ''),
      nullif(profile_row.club_name, ''),
      split_part(coalesce(profile_row.email, ''), '@', 1),
      'user'
    );

    update public.profiles
    set username = public.generate_unique_username(seed_value, profile_row.user_id),
        username_last_changed_at = null
    where id = profile_row.id;
  end loop;
end $$;

with ranked_usernames as (
  select
    id,
    user_id,
    full_name,
    club_name,
    email,
    row_number() over (partition by lower(username) order by created_at nulls last, id) as username_rank
  from public.profiles
)
update public.profiles p
set username = public.generate_unique_username(
      coalesce(nullif(r.full_name, ''), nullif(r.club_name, ''), split_part(coalesce(r.email, ''), '@', 1), 'user'),
      r.user_id
    ),
    username_last_changed_at = null
from ranked_usernames r
where p.id = r.id
  and r.username_rank > 1;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_valid_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_valid_format
      check (
        username is not null
        and public.normalize_username(username) = username
        and username ~ '^[a-z0-9_]+$'
        and not public.username_contains_banned_word(username)
      );
  end if;
end $$;

alter table public.profiles
  alter column username set not null;

create or replace function public.enforce_profile_username_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text;
begin
  normalized_username := public.normalize_username(new.username);

  if normalized_username = '' then
    raise exception 'Username is required';
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain letters and numbers';
  end if;

  if public.username_contains_banned_word(normalized_username) then
    raise exception 'Username contains inappropriate words';
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(normalized_username)
    ) then
      raise exception 'Username is already taken';
    end if;
  else
    if exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(normalized_username)
        and p.id is distinct from old.id
    ) then
      raise exception 'Username is already taken';
    end if;
  end if;

  new.username := normalized_username;

  if tg_op = 'INSERT' then
    new.username_last_changed_at := new.username_last_changed_at;
  elsif new.username is distinct from old.username then
    if old.username_last_changed_at is not null
      and old.username_last_changed_at > now() - interval '14 days' then
      raise exception 'You can only change your username once every 14 days';
    end if;

    new.username_last_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_username_rules_trigger on public.profiles;
create trigger enforce_profile_username_rules_trigger
  before insert or update of username on public.profiles
  for each row
  execute function public.enforce_profile_username_rules();

create or replace function public.change_username(_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text;
  current_profile record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  normalized_username := public.normalize_username(_username);

  if normalized_username = '' then
    raise exception 'Username is required';
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain letters and numbers';
  end if;

  if public.username_contains_banned_word(normalized_username) then
    raise exception 'Username contains inappropriate words';
  end if;

  select *
  into current_profile
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  if current_profile.id is null then
    raise exception 'Profile not found';
  end if;

  if lower(current_profile.username) = lower(normalized_username) then
    return normalized_username;
  end if;

  if current_profile.username_last_changed_at is not null
    and current_profile.username_last_changed_at > now() - interval '14 days' then
    raise exception 'You can only change your username once every 14 days';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.username) = lower(normalized_username)
      and p.user_id is distinct from auth.uid()
  ) then
    raise exception 'Username is already taken';
  end if;

  update public.profiles
  set username = normalized_username,
      username_last_changed_at = now()
  where user_id = auth.uid();

  return normalized_username;
end;
$$;

grant execute on function public.change_username(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata_username text;
  chosen_username text;
begin
  metadata_username := public.normalize_username(new.raw_user_meta_data ->> 'username');

  if public.is_valid_username(metadata_username) then
    chosen_username := public.generate_unique_username(metadata_username, new.id);
  else
    chosen_username := public.generate_unique_username(
      coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1), 'user'),
      new.id
    );
  end if;

  insert into public.profiles (
    user_id,
    email,
    full_name,
    username,
    username_last_changed_at
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    chosen_username,
    case when public.is_valid_username(metadata_username) then now() else null end
  )
  on conflict (user_id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      username = coalesce(public.profiles.username, excluded.username),
      username_last_changed_at = public.profiles.username_last_changed_at;

  return new;
end;
$$;
