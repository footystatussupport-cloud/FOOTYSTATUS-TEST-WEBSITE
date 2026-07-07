-- Next Up clips use real video durations, which can include fractional
-- seconds such as 5.17, 8.4, or 24.9. These fields must not be integers.

drop trigger if exists validate_next_up_clip_upload_limits_trigger on public.clips;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'duration'
  ) then
    alter table public.clips
      alter column duration type numeric(8, 2)
      using round(coalesce(duration, 0)::numeric, 2);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'trim_start_seconds'
  ) then
    alter table public.clips
      alter column trim_start_seconds drop default;

    alter table public.clips
      alter column trim_start_seconds type numeric(8, 2)
      using round(coalesce(trim_start_seconds, 0)::numeric, 2);

    alter table public.clips
      alter column trim_start_seconds set default 0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'trim_end_seconds'
  ) then
    alter table public.clips
      alter column trim_end_seconds type numeric(8, 2)
      using round(coalesce(trim_end_seconds, 0)::numeric, 2);
  end if;
end $$;

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
    raise exception 'Free accounts can upload Next Up Clips up to 25 seconds. Please trim your clip to 25 seconds or less.';
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

create trigger validate_next_up_clip_upload_limits_trigger
before insert or update of duration, visibility, user_id
on public.clips
for each row
execute function public.validate_next_up_clip_upload_limits();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'duration'
  ) then
    comment on column public.clips.duration is 'Final posted Next Up clip duration in decimal seconds after trimming.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'trim_start_seconds'
  ) then
    comment on column public.clips.trim_start_seconds is 'Trim start time in decimal seconds.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clips'
      and column_name = 'trim_end_seconds'
  ) then
    comment on column public.clips.trim_end_seconds is 'Trim end time in decimal seconds.';
  end if;
end $$;
