-- Profile edit saves (e.g. Head Coach, Assistant Coach, Trainer, Team Staff,
-- Academy Director, Referee, Scout, Player, Parent, School/Club Team) update
-- unrelated fields on public.profiles. The enforce_profile_username_rules
-- trigger fires on any UPDATE that references the username column and used
-- to reject the whole save with "Username is required" if that value ever
-- resolved blank, even when the user wasn't touching their username at all.
--
-- On UPDATE, a blank/missing incoming username now falls back to the
-- existing value instead of blocking the save. INSERT (account creation)
-- and the change_username RPC still enforce username strictly.
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

  if tg_op = 'UPDATE' and normalized_username = '' then
    new.username := old.username;
    return new;
  end if;

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
