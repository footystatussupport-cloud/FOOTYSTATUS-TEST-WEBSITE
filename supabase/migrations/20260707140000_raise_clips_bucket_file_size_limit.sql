-- URGENT: "Upload failed, the object exceeded the maximum allowed size" when a
-- Pro user posts a Next Up clip.
--
-- This is a Supabase Storage size rejection, not a duration check. The `clips`
-- bucket was created with no file_size_limit, so it fell back to the project's
-- global upload limit, which is too small for a real short video file (even a
-- 15-second phone clip can be tens of MB). The upload is rejected before any
-- 25s/45s duration or 3-clip logic runs, so it hits Pro and Free users alike.
--
-- Storage limits are per-bucket and cannot vary by subscription, so the bucket
-- is sized for the largest clip the app ever allows (a 45-second Pro clip).
-- Duration/count gating (25s + 3 clips for Free, 45s + unlimited for Pro) stays
-- enforced in the app and by the clips-table checks.
--
-- 200 MB comfortably fits a 45-second clip at high bitrate (incl. 4K phone
-- video) with headroom.
update storage.buckets
set file_size_limit = 209715200 -- 200 MB
where id = 'clips';
