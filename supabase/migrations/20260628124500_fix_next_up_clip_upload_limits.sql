-- Enforce the correct Next Up clip limits on the backend:
-- Free player accounts: max 3 active clips, each up to 25 seconds.
-- Footy Status Pro player accounts: unlimited active clips, each up to 45 seconds.

create or replace function public.is_active_pro_profile(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when p.account_tier = 'pro_lifetime' then true
        when p.account_tier = 'pro_annual' and p.pro_expires_at is not null and p.pro_expires_at > now() then true
        when coalesce(p.is_pro, false) = true and (p.pro_expires_at is null or p.pro_expires_at > now()) then true
        else false
      end
      from public.profiles p
      where p.user_id = _user_id
      limit 1
    ),
    false
  );
$$;

create or replace function public.validate_next_up_clip_upload_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uploader_id uuid := coalesce(new.user_id, auth.uid());
  is_pro boolean := false;
  clip_duration_seconds numeric := coalesce(new.duration::numeric, 0);
  active_clip_count integer := 0;
begin
  if uploader_id is null then
    return new;
  end if;

  is_pro := public.is_active_pro_profile(uploader_id);

  if is_pro and clip_duration_seconds > 45 then
    raise exception 'Pro accounts can upload clips up to 45 seconds.';
  elsif not is_pro and clip_duration_seconds > 25 then
    raise exception 'Free accounts can upload clips up to 25 seconds.';
  end if;

  if not is_pro and coalesce(new.visibility, 'public') <> 'inactive' then
    select count(*)
    into active_clip_count
    from public.clips c
    where c.user_id = uploader_id
      and c.visibility <> 'inactive'
      and (tg_op = 'INSERT' or c.id <> new.id);

    if active_clip_count >= 3 then
      raise exception 'Free accounts can only have 3 active clips. Upgrade to Pro or delete a clip to upload another.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_next_up_clip_upload_limits_trigger on public.clips;
create trigger validate_next_up_clip_upload_limits_trigger
before insert or update of duration, visibility, user_id
on public.clips
for each row
execute function public.validate_next_up_clip_upload_limits();

grant execute on function public.is_active_pro_profile(uuid) to authenticated;
grant execute on function public.validate_next_up_clip_upload_limits() to authenticated;
