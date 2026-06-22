CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id_unique ON public.profiles(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id_unique ON public.user_settings(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_profiles_user_id_unique ON public.player_profiles(user_id);

ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.clips c
SET user_id = pp.user_id
FROM public.player_profiles pp
WHERE c.player_id = pp.id
  AND c.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clips_user_id ON public.clips(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_player_id ON public.clips(player_id);
CREATE INDEX IF NOT EXISTS idx_clips_visibility_created_at ON public.clips(visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

DROP POLICY IF EXISTS "Authenticated users can insert clips" ON public.clips;
DROP POLICY IF EXISTS "Clips are viewable by everyone" ON public.clips;
DROP POLICY IF EXISTS "Users can delete their own clips" ON public.clips;
DROP POLICY IF EXISTS "Users can update their own clips" ON public.clips;

CREATE POLICY "Users can insert own clips"
ON public.clips
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    player_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.player_profiles pp
      WHERE pp.id = clips.player_id
        AND pp.user_id = auth.uid()
    )
  )
  AND visibility IN ('public', 'private')
);

CREATE POLICY "Users can update own clips"
ON public.clips
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    player_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.player_profiles pp
      WHERE pp.id = clips.player_id
        AND pp.user_id = auth.uid()
    )
  )
  AND visibility IN ('public', 'private')
);

CREATE POLICY "Users can delete own clips"
ON public.clips
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Public and owner clips are viewable"
ON public.clips
FOR SELECT
TO public
USING (visibility = 'public' OR auth.uid() = user_id OR user_id IS NULL);

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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (new.id, new.email, COALESCE(new.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = CASE WHEN public.profiles.full_name IS NULL OR public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END;

  INSERT INTO public.user_settings (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Clip videos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own clips" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own clips" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own clips" ON storage.objects;

CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Clip videos are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'clips');

CREATE POLICY "Users can upload their own clips"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'clips' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own clips"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'clips' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own clips"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'clips' AND auth.uid()::text = (storage.foldername(name))[1]);