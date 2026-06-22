
-- Create storage bucket for clip videos
INSERT INTO storage.buckets (id, name, public) VALUES ('clips', 'clips', true);

-- Create storage bucket for profile images  
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- RLS policies for clips bucket
CREATE POLICY "Anyone can view clips" ON storage.objects FOR SELECT USING (bucket_id = 'clips');
CREATE POLICY "Authenticated users can upload clips" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'clips');
CREATE POLICY "Users can delete their own clips" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'clips' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS policies for avatars bucket
CREATE POLICY "Anyone can view avatars" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Authenticated users can upload avatars" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "Users can update their own avatar" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete their own avatar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Enable realtime for matches table
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

-- Add RLS policy for authenticated users to insert clips
CREATE POLICY "Authenticated users can insert clips" ON public.clips FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update their own clips" ON public.clips FOR UPDATE TO authenticated USING (player_id IN (SELECT id FROM players WHERE contact_email = (SELECT email FROM auth.users WHERE id = auth.uid())));
CREATE POLICY "Users can delete their own clips" ON public.clips FOR DELETE TO authenticated USING (player_id IN (SELECT id FROM players WHERE contact_email = (SELECT email FROM auth.users WHERE id = auth.uid())));
