ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age_birth_year text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS team_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS club_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position text;