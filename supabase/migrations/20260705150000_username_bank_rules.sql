-- Global username bank rules:
--  * max 20 characters (letters, numbers, underscores; no spaces)
--  * profanity filter
--  * globally unique, case-insensitive (backed by profiles_username_unique_idx)
--  * one username per account; changing a username immediately frees the old one
--  * live availability checking exposed to signup (anon) and profile editing

-- 1) Validation now includes the 20-character limit.
create or replace function public.is_valid_username(_username text)
returns boolean
language sql
immutable
as $$
  select public.normalize_username(_username) <> ''
    and char_length(public.normalize_username(_username)) <= 20
    and public.normalize_username(_username) ~ '^[a-z0-9_]+$'
    and not public.username_contains_banned_word(_username);
$$;

-- 2) Generated fallback usernames respect the 20-character limit too.
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

  base_username := left(base_username, 20);
  candidate := base_username;

  while exists (
    select 1
    from public.profiles p
    where lower(p.username) = lower(candidate)
      and (_user_id is null or p.user_id is distinct from _user_id)
  ) loop
    suffix := suffix + 1;
    candidate := left(base_username, greatest(1, 20 - length(suffix::text))) || suffix::text;
  end loop;

  return candidate;
end;
$$;

-- 3) Existing accounts: shorten any username over 20 characters (keeping it
--    unique) so the new length rule can be enforced for everyone.
do $$
declare
  profile_row record;
begin
  for profile_row in
    select id, user_id, username
    from public.profiles
    where char_length(coalesce(username, '')) > 20
  loop
    update public.profiles
    set username = public.generate_unique_username(left(profile_row.username, 20), profile_row.user_id)
    where id = profile_row.id;
  end loop;
end $$;

-- 4) Recreate the format constraint with the length rule included.
alter table public.profiles
  drop constraint if exists profiles_username_valid_format;

alter table public.profiles
  add constraint profiles_username_valid_format
  check (
    username is not null
    and public.normalize_username(username) = username
    and char_length(username) <= 20
    and username ~ '^[a-z0-9_]+$'
    and not public.username_contains_banned_word(username)
  );

-- 5) Row-level enforcement (applies to every current and future account type,
--    including admin edits). The unique index remains the race-condition backstop.
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

  -- Profile edits that don't touch the username keep the existing one.
  -- Only INSERT (account creation) requires an explicit username.
  if tg_op = 'UPDATE' and normalized_username = '' then
    new.username := old.username;
    return new;
  end if;

  if normalized_username = '' then
    raise exception 'Username is required';
  end if;

  if char_length(normalized_username) > 20 then
    raise exception 'This username exceeds the 20-character limit.';
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain letters, numbers, and underscores';
  end if;

  if public.username_contains_banned_word(normalized_username) then
    raise exception 'This username contains prohibited language.';
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

  if tg_op = 'UPDATE' and new.username is distinct from old.username then
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

-- 6) change_username picks up the length rule (old username is freed the
--    instant the row updates -- there is only ever one owner per username).
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

  if char_length(normalized_username) > 20 then
    raise exception 'This username exceeds the 20-character limit.';
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain letters, numbers, and underscores';
  end if;

  if public.username_contains_banned_word(normalized_username) then
    raise exception 'This username contains prohibited language.';
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
    raise exception 'This username is already taken. Please choose another username.';
  end if;

  update public.profiles
  set username = normalized_username,
      username_last_changed_at = now()
  where user_id = auth.uid();

  return normalized_username;
end;
$$;

grant execute on function public.change_username(text) to authenticated;

-- 7) Live availability check for signup and username changes. Works for
--    signed-out visitors (signup) and treats the caller's own username as
--    available to them. Incomplete signup profiles do not permanently hold
--    a username: the client can release them via release_incomplete_signup_username.
create or replace function public.check_username_availability(_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_username text := public.normalize_username(_username);
  owner_user_id uuid;
begin
  if normalized_username = '' then
    return jsonb_build_object('available', false, 'reason', 'empty', 'message', 'Username is required');
  end if;

  if char_length(normalized_username) > 20 then
    return jsonb_build_object('available', false, 'reason', 'too_long', 'message', 'This username exceeds the 20-character limit.');
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    return jsonb_build_object('available', false, 'reason', 'format', 'message', 'Username can only contain letters, numbers, and underscores');
  end if;

  if public.username_contains_banned_word(normalized_username) then
    return jsonb_build_object('available', false, 'reason', 'banned', 'message', 'This username contains prohibited language.');
  end if;

  select p.user_id
  into owner_user_id
  from public.profiles p
  where lower(p.username) = lower(normalized_username)
  limit 1;

  if owner_user_id is null or owner_user_id = auth.uid() then
    return jsonb_build_object('available', true, 'reason', null, 'message', 'Username available');
  end if;

  return jsonb_build_object('available', false, 'reason', 'taken', 'message', 'This username is already taken. Please choose another username.');
end;
$$;

grant execute on function public.check_username_availability(text) to anon, authenticated;

-- The client-side profile recovery path generates a valid unique username
-- instead of inserting a profile without one.
grant execute on function public.generate_unique_username(text, uuid) to authenticated;

comment on function public.check_username_availability(text) is
  'Live global username bank check: validates length, characters, profanity, and case-insensitive uniqueness.';
