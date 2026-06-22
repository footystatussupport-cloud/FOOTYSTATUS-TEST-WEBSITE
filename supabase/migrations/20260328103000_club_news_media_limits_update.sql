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
