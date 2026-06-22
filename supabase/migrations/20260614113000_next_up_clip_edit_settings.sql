alter table public.clips
  add column if not exists trim_start_seconds integer not null default 0,
  add column if not exists trim_end_seconds integer,
  add column if not exists playback_volume numeric not null default 1,
  add column if not exists fit_mode text not null default 'cover';

alter table public.clips
  add constraint clips_playback_volume_check
  check (playback_volume >= 0 and playback_volume <= 1)
  not valid;

alter table public.clips
  validate constraint clips_playback_volume_check;

alter table public.clips
  add constraint clips_fit_mode_check
  check (fit_mode in ('cover', 'contain'))
  not valid;

alter table public.clips
  validate constraint clips_fit_mode_check;
