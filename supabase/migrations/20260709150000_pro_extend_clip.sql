-- Free -> Pro clip length expansion.
--
-- A Free player's approved clip is capped at 25s. After upgrading to Pro they
-- may extend the SAME approved clip up to the Pro cap (45s) using the SAME
-- original video they first uploaded — never a different file. Because the app
-- only stores the trimmed segment (not the full recording), the player re-picks
-- their original file; the app fingerprints it against what was first uploaded
-- and re-trims a longer section. This is the ONE controlled path allowed to
-- replace an approved clip's video, and only via extend_pro_clip().

-- 1) Fingerprint of the original recording captured at first upload.
alter table public.clips
  add column if not exists original_file_name text,
  add column if not exists original_file_size bigint,
  add column if not exists original_duration_seconds numeric;

-- 2) Approved clips keep their video locked EXCEPT when extend_pro_clip sets a
--    transaction-local flag. This recreates the lock trigger with that bypass.
create or replace function public.enforce_clip_review_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
    return new;
  end if;

  if public.is_footy_status_global_admin() then
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     or new.revision_note is distinct from old.revision_note
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by then
    new.review_status := old.review_status;
    new.revision_note := old.revision_note;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;

  -- Approved clips: the reviewed video is permanent for normal edits (caption,
  -- title, display). The only exception is the Pro length-extension path, which
  -- sets app.allow_clip_video_replace = 'on' for its own transaction.
  if old.review_status = 'approved'
     and coalesce(current_setting('app.allow_clip_video_replace', true), '') <> 'on' then
    new.video_url := old.video_url;
    new.thumbnail_url := old.thumbnail_url;
  end if;

  if old.review_status = 'needs_revision'
     and (
       new.video_url is distinct from old.video_url
       or new.title is distinct from old.title
       or new.caption is distinct from old.caption
       or new.description is distinct from old.description
     ) then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_review_workflow_trigger on public.clips;
create trigger enforce_clip_review_workflow_trigger
before insert or update on public.clips
for each row execute function public.enforce_clip_review_workflow();

-- 3) The controlled extension path. Verifies ownership + active Pro + the Pro
--    length cap, then swaps in the re-trimmed longer segment of the SAME
--    original video (the frontend fingerprint-checks the re-picked file first).
create or replace function public.extend_pro_clip(
  _clip_id uuid,
  _video_url text,
  _duration numeric,
  _trim_start numeric,
  _trim_end numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_is_pro boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_clip from public.clips where id = _clip_id;
  if v_clip.id is null then
    raise exception 'Clip not found.';
  end if;
  if v_clip.user_id <> auth.uid() then
    raise exception 'You can only extend your own clip.';
  end if;
  if v_clip.review_status <> 'approved' then
    raise exception 'Only approved clips can be extended.';
  end if;

  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and (
        p.is_pro = true
        or p.account_tier = 'pro_lifetime'
        or (p.account_tier = 'pro_annual' and (p.pro_expires_at is null or p.pro_expires_at > now()))
      )
  ) into v_is_pro;

  if not v_is_pro then
    raise exception 'Extending a clip length requires an active Footy Status Pro account.';
  end if;

  if nullif(trim(coalesce(_video_url, '')), '') is null then
    raise exception 'Missing the extended video.';
  end if;
  if _duration is null or _duration <= 0 or _duration > 45 then
    raise exception 'Pro clips can be up to 45 seconds.';
  end if;

  -- Allow this transaction's update to replace the approved video.
  perform set_config('app.allow_clip_video_replace', 'on', true);

  update public.clips
  set video_url = _video_url,
      duration = _duration,
      trim_start_seconds = coalesce(_trim_start, 0),
      trim_end_seconds = coalesce(_trim_end, _duration)
  where id = _clip_id;
end;
$$;

revoke all on function public.extend_pro_clip(uuid, text, numeric, numeric, numeric) from public;
grant execute on function public.extend_pro_clip(uuid, text, numeric, numeric, numeric) to authenticated;
