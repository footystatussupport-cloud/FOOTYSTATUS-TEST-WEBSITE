ALTER TABLE public.player_profiles
ADD COLUMN IF NOT EXISTS jersey_number text;

ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS jersey_number text;

DROP VIEW IF EXISTS public.player_profiles_public;
CREATE VIEW public.player_profiles_public
WITH (security_invoker=on) AS
SELECT
  pp.id,
  pp.user_id,
  pp.created_at,
  pp.updated_at,
  pp.full_name,
  pp.team,
  pp.position,
  pp.jersey_number,
  pp.height,
  pp.weight,
  pp.profile_image_url,
  pp.contact_email,
  p.bio,
  p.username,
  p.age_birth_year,
  p.team_name,
  p.avatar_url,
  p.is_pro
FROM public.player_profiles pp
LEFT JOIN public.profiles p ON p.user_id = pp.user_id;
