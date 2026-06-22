
-- User settings table (all toggles and selects from Settings page)
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  -- Appearance
  dark_mode BOOLEAN NOT NULL DEFAULT false,
  compact_view BOOLEAN NOT NULL DEFAULT false,
  show_animations BOOLEAN NOT NULL DEFAULT true,
  -- Notifications
  push_notifications BOOLEAN NOT NULL DEFAULT true,
  match_alerts BOOLEAN NOT NULL DEFAULT true,
  goal_notifications BOOLEAN NOT NULL DEFAULT true,
  clip_notifications BOOLEAN NOT NULL DEFAULT true,
  message_notifications BOOLEAN NOT NULL DEFAULT true,
  email_digest BOOLEAN NOT NULL DEFAULT false,
  -- Privacy
  profile_public BOOLEAN NOT NULL DEFAULT true,
  show_online_status BOOLEAN NOT NULL DEFAULT true,
  show_last_seen BOOLEAN NOT NULL DEFAULT true,
  allow_tagging BOOLEAN NOT NULL DEFAULT true,
  show_in_search BOOLEAN NOT NULL DEFAULT true,
  -- Content & Playback
  autoplay_videos BOOLEAN NOT NULL DEFAULT true,
  hd_video_wifi BOOLEAN NOT NULL DEFAULT true,
  show_score_spoilers BOOLEAN NOT NULL DEFAULT true,
  live_commentary BOOLEAN NOT NULL DEFAULT true,
  -- Accessibility
  large_text BOOLEAN NOT NULL DEFAULT false,
  reduced_motion BOOLEAN NOT NULL DEFAULT false,
  screen_reader_optimized BOOLEAN NOT NULL DEFAULT false,
  high_contrast BOOLEAN NOT NULL DEFAULT false,
  -- Data & Storage
  data_saver BOOLEAN NOT NULL DEFAULT false,
  offline_mode BOOLEAN NOT NULL DEFAULT false,
  auto_download_clips BOOLEAN NOT NULL DEFAULT false,
  -- Sound & Haptics
  sound_effects BOOLEAN NOT NULL DEFAULT true,
  vibration BOOLEAN NOT NULL DEFAULT true,
  -- Language & Region
  language TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'auto',
  date_format TEXT NOT NULL DEFAULT 'mdy',
  -- Privacy & Security (detailed)
  profile_visibility TEXT NOT NULL DEFAULT 'public',
  show_contact_info TEXT NOT NULL DEFAULT 'staff_only',
  show_activity_status BOOLEAN NOT NULL DEFAULT true,
  allow_direct_messages TEXT NOT NULL DEFAULT 'everyone',
  allow_profile_views BOOLEAN NOT NULL DEFAULT true,
  show_profile_viewers BOOLEAN NOT NULL DEFAULT true,
  -- Notification preferences (granular)
  in_app_notifications BOOLEAN NOT NULL DEFAULT true,
  email_notifications BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Blocked users table
CREATE TABLE public.blocked_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  blocked_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, blocked_user_id)
);

-- RLS
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- user_settings policies
CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);

-- blocked_users policies
CREATE POLICY "Users can view own blocks" ON public.blocked_users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own blocks" ON public.blocked_users FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own blocks" ON public.blocked_users FOR DELETE USING (auth.uid() = user_id);

-- Auto-create settings for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id) VALUES (new.id);
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_settings();

-- Updated_at trigger
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
