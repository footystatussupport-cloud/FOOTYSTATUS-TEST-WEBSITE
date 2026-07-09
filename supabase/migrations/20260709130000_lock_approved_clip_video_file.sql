-- Post-approval Next Up clip editing: once a clip is approved, the reviewed
-- video file is locked. Players may still edit display-only settings (fit mode)
-- and the caption (which stays subject to the existing profanity trigger), but
-- they can never replace the approved video/thumbnail or otherwise swap the
-- media to circumvent moderation. Caption/display edits do NOT trigger another
-- review. Enforced in the database so the frontend cannot bypass it.
--
-- This recreates enforce_clip_review_workflow with one added rule: for non-admin
-- updates to an already-approved clip, video_url and thumbnail_url are forced
-- back to their approved values. Every other rule is preserved verbatim,
-- including the needs_revision -> pending_review resubmission flow.

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

  -- Approved clips: the video that Footy Status reviewed is permanent. A player
  -- can change display settings and the caption, but never the media file.
  -- Caption/display edits keep the clip approved (no re-review).
  if old.review_status = 'approved' then
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
