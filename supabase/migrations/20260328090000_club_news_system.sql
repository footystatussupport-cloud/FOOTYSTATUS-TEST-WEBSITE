ALTER TABLE public.clubs
ADD COLUMN IF NOT EXISTS latitude double precision,
ADD COLUMN IF NOT EXISTS longitude double precision;

CREATE TABLE IF NOT EXISTS public.club_news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  city text,
  latitude double precision,
  longitude double precision,
  visibility text NOT NULL DEFAULT 'public',
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  cover_media_id uuid,
  CONSTRAINT club_news_posts_visibility_check CHECK (visibility = 'public')
);

CREATE TABLE IF NOT EXISTS public.club_news_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.club_news_posts(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  storage_path text NOT NULL,
  media_url text NOT NULL,
  thumbnail_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT club_news_media_type_check CHECK (media_type IN ('image', 'video'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'club_news_posts_cover_media_id_fkey'
  ) THEN
    ALTER TABLE public.club_news_posts
    ADD CONSTRAINT club_news_posts_cover_media_id_fkey
    FOREIGN KEY (cover_media_id) REFERENCES public.club_news_media(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_club_news_posts_team_created_at
ON public.club_news_posts(team_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_news_posts_club_created_at
ON public.club_news_posts(club_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_club_news_media_post_sort
ON public.club_news_media(post_id, sort_order, created_at);

ALTER TABLE public.club_news_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_news_media ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_team_club_account(_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = _user_id
      AND p.account_role = 'team_club'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_owns_club(_club_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.clubs c
    WHERE c.id = _club_id
      AND c.owner_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_owns_club_news_post(_post_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    JOIN public.clubs c ON c.id = p.club_id
    WHERE p.id = _post_id
      AND p.author_user_id = _user_id
      AND c.owner_user_id = _user_id
      AND p.deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.validate_club_news_media_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_media_count integer;
  image_count integer;
  video_count integer;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE media_type = 'image'),
         COUNT(*) FILTER (WHERE media_type = 'video')
  INTO total_media_count, image_count, video_count
  FROM public.club_news_media
  WHERE post_id = NEW.post_id
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  total_media_count := total_media_count + 1;
  IF NEW.media_type = 'image' THEN
    image_count := image_count + 1;
  END IF;
  IF NEW.media_type = 'video' THEN
    video_count := video_count + 1;
  END IF;

  IF total_media_count > 8 THEN
    RAISE EXCEPTION 'A club news post can include at most 8 media items.';
  END IF;

  IF image_count > 5 THEN
    RAISE EXCEPTION 'A club news post can include at most 5 photos.';
  END IF;

  IF video_count > 3 THEN
    RAISE EXCEPTION 'A club news post can include at most 3 videos.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_club_news_media_limits_trigger ON public.club_news_media;
CREATE TRIGGER validate_club_news_media_limits_trigger
BEFORE INSERT OR UPDATE ON public.club_news_media
FOR EACH ROW
EXECUTE FUNCTION public.validate_club_news_media_limits();

DROP POLICY IF EXISTS "Public can view club news posts" ON public.club_news_posts;
CREATE POLICY "Public can view club news posts"
ON public.club_news_posts
FOR SELECT
TO public
USING (deleted_at IS NULL AND visibility = 'public');

DROP POLICY IF EXISTS "Team club owners can insert club news posts" ON public.club_news_posts;
CREATE POLICY "Team club owners can insert club news posts"
ON public.club_news_posts
FOR INSERT
TO authenticated
WITH CHECK (
  author_user_id = auth.uid()
  AND public.is_team_club_account(auth.uid())
  AND public.user_owns_club(club_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.clubs c
    WHERE c.id = club_id
      AND c.primary_team_id = team_id
      AND c.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Team club owners can update club news posts" ON public.club_news_posts;
CREATE POLICY "Team club owners can update club news posts"
ON public.club_news_posts
FOR UPDATE
TO authenticated
USING (public.user_owns_club_news_post(id, auth.uid()))
WITH CHECK (
  author_user_id = auth.uid()
  AND public.is_team_club_account(auth.uid())
  AND public.user_owns_club(club_id, auth.uid())
);

DROP POLICY IF EXISTS "Team club owners can delete club news posts" ON public.club_news_posts;
CREATE POLICY "Team club owners can delete club news posts"
ON public.club_news_posts
FOR DELETE
TO authenticated
USING (public.user_owns_club_news_post(id, auth.uid()));

DROP POLICY IF EXISTS "Public can view club news media" ON public.club_news_media;
CREATE POLICY "Public can view club news media"
ON public.club_news_media
FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    WHERE p.id = post_id
      AND p.deleted_at IS NULL
      AND p.visibility = 'public'
  )
);

DROP POLICY IF EXISTS "Team club owners can insert club news media" ON public.club_news_media;
CREATE POLICY "Team club owners can insert club news media"
ON public.club_news_media
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    WHERE p.id = post_id
      AND public.user_owns_club_news_post(p.id, auth.uid())
      AND public.is_team_club_account(auth.uid())
  )
);

DROP POLICY IF EXISTS "Team club owners can update club news media" ON public.club_news_media;
CREATE POLICY "Team club owners can update club news media"
ON public.club_news_media
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    WHERE p.id = post_id
      AND public.user_owns_club_news_post(p.id, auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    WHERE p.id = post_id
      AND public.user_owns_club_news_post(p.id, auth.uid())
  )
);

DROP POLICY IF EXISTS "Team club owners can delete club news media" ON public.club_news_media;
CREATE POLICY "Team club owners can delete club news media"
ON public.club_news_media
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.club_news_posts p
    WHERE p.id = post_id
      AND public.user_owns_club_news_post(p.id, auth.uid())
  )
);

DROP TRIGGER IF EXISTS update_club_news_posts_updated_at ON public.club_news_posts;
CREATE TRIGGER update_club_news_posts_updated_at
BEFORE UPDATE ON public.club_news_posts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public)
SELECT 'club-news', 'club-news', true
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets WHERE id = 'club-news'
);

DROP POLICY IF EXISTS "Anyone can view club news media bucket" ON storage.objects;
CREATE POLICY "Anyone can view club news media bucket"
ON storage.objects
FOR SELECT
USING (bucket_id = 'club-news');

DROP POLICY IF EXISTS "Team club accounts can upload club news media" ON storage.objects;
CREATE POLICY "Team club accounts can upload club news media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'club-news'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Team club accounts can update club news media" ON storage.objects;
CREATE POLICY "Team club accounts can update club news media"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'club-news'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'club-news'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Team club accounts can delete club news media" ON storage.objects;
CREATE POLICY "Team club accounts can delete club news media"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'club-news'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE OR REPLACE FUNCTION public.fetch_nearby_club_news(
  _viewer_lat double precision,
  _viewer_lng double precision,
  _radius_miles integer DEFAULT 500,
  _limit integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  club_id uuid,
  team_id uuid,
  club_name text,
  title text,
  body text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  cover_media_url text,
  cover_media_type text,
  media_count integer,
  distance_miles double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH post_rows AS (
    SELECT
      p.*,
      c.name AS club_name,
      COALESCE(p.latitude, c.latitude) AS effective_latitude,
      COALESCE(p.longitude, c.longitude) AS effective_longitude
    FROM public.club_news_posts p
    JOIN public.clubs c ON c.id = p.club_id
    WHERE p.deleted_at IS NULL
      AND p.visibility = 'public'
  )
  SELECT
    p.id,
    p.club_id,
    p.team_id,
    p.club_name,
    p.title,
    p.body,
    p.created_at,
    p.updated_at,
    cover.media_url AS cover_media_url,
    cover.media_type AS cover_media_type,
    COALESCE(media_counts.media_count, 0)::integer AS media_count,
    (
      3959.0 * acos(
        LEAST(
          1.0,
          GREATEST(
            -1.0,
            cos(radians(_viewer_lat))
            * cos(radians(p.effective_latitude))
            * cos(radians(p.effective_longitude) - radians(_viewer_lng))
            + sin(radians(_viewer_lat))
            * sin(radians(p.effective_latitude))
          )
        )
      )
    ) AS distance_miles
  FROM post_rows p
  LEFT JOIN public.club_news_media cover ON cover.id = p.cover_media_id
  LEFT JOIN (
    SELECT post_id, COUNT(*) AS media_count
    FROM public.club_news_media
    GROUP BY post_id
  ) media_counts ON media_counts.post_id = p.id
  WHERE _viewer_lat IS NOT NULL
    AND _viewer_lng IS NOT NULL
    AND p.effective_latitude IS NOT NULL
    AND p.effective_longitude IS NOT NULL
    AND (
      3959.0 * acos(
        LEAST(
          1.0,
          GREATEST(
            -1.0,
            cos(radians(_viewer_lat))
            * cos(radians(p.effective_latitude))
            * cos(radians(p.effective_longitude) - radians(_viewer_lng))
            + sin(radians(_viewer_lat))
            * sin(radians(p.effective_latitude))
          )
        )
      )
    ) <= _radius_miles
  ORDER BY p.created_at DESC
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.is_team_club_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_club(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_club_news_post(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_nearby_club_news(double precision, double precision, integer, integer) TO public;
