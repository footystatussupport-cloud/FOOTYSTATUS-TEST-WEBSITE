-- Create clips table for player video clips
CREATE TABLE public.clips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  description TEXT,
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  hide_likes BOOLEAN DEFAULT false,
  comments_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create clip likes table
CREATE TABLE public.clip_likes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(clip_id, user_id)
);

-- Create clip comments table
CREATE TABLE public.clip_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clip_id UUID REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clip_comments ENABLE ROW LEVEL SECURITY;

-- Clips policies
CREATE POLICY "Clips are viewable by everyone" 
ON public.clips 
FOR SELECT 
USING (true);

-- Likes policies
CREATE POLICY "Clip likes are viewable by everyone" 
ON public.clip_likes 
FOR SELECT 
USING (true);

CREATE POLICY "Users can insert their own likes" 
ON public.clip_likes 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can delete their own likes" 
ON public.clip_likes 
FOR DELETE 
USING (true);

-- Comments policies
CREATE POLICY "Clip comments are viewable by everyone" 
ON public.clip_comments 
FOR SELECT 
USING (true);

CREATE POLICY "Users can insert comments" 
ON public.clip_comments 
FOR INSERT 
WITH CHECK (true);

-- Insert mock clips data
INSERT INTO public.clips (player_id, title, video_url, thumbnail_url, description, views_count, likes_count)
SELECT 
  p.id,
  CASE 
    WHEN p.name = 'James Rodriguez' THEN 'Amazing Goal vs FC Dallas'
    WHEN p.name = 'Carlos Mendez' THEN 'Hat-trick Highlights'
    WHEN p.name = 'Miguel Santos' THEN 'Best Assists Compilation'
    WHEN p.name = 'David Chen' THEN 'Defensive Skills Reel'
    WHEN p.name = 'Marcus Williams' THEN 'Speed & Dribbling'
    ELSE 'Training Session Highlights'
  END,
  'https://example.com/clip.mp4',
  'https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=400',
  'Check out my latest highlights!',
  FLOOR(RANDOM() * 10000)::INTEGER,
  FLOOR(RANDOM() * 500)::INTEGER
FROM public.players p
WHERE p.name IN ('James Rodriguez', 'Carlos Mendez', 'Miguel Santos', 'David Chen', 'Marcus Williams');