-- Clips can be any length from 0-25 seconds, including fractional durations
-- (e.g. 5.17s). The duration and trim columns were integers, so posting a
-- fractional-length clip failed with:
--   invalid input syntax for type integer: "5.17"
-- Store exact seconds so the posted clip matches the trim precisely.

alter table public.clips
  alter column duration type numeric using duration::numeric;

alter table public.clips
  alter column trim_start_seconds drop default;

alter table public.clips
  alter column trim_start_seconds type numeric using trim_start_seconds::numeric;

alter table public.clips
  alter column trim_start_seconds set default 0;

alter table public.clips
  alter column trim_end_seconds type numeric using trim_end_seconds::numeric;
