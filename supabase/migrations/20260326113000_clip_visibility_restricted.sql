DROP POLICY IF EXISTS "Users can insert own clips" ON public.clips;
DROP POLICY IF EXISTS "Users can update own clips" ON public.clips;
DROP POLICY IF EXISTS "Public and owner clips are viewable" ON public.clips;
DROP POLICY IF EXISTS "Users can view own or allowed clips" ON public.clips;

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
  AND visibility IN ('public', 'restricted', 'private')
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
  AND visibility IN ('public', 'restricted', 'private')
);

CREATE POLICY "Users can view own or allowed clips"
ON public.clips
FOR SELECT
TO public
USING (
  auth.uid() = user_id
  OR visibility = 'public'
  OR (visibility = 'restricted' AND public.is_staff_member(auth.uid()))
  OR user_id IS NULL
);
