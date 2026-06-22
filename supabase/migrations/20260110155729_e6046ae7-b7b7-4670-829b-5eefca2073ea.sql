-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create players table
CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  club TEXT NOT NULL,
  league TEXT NOT NULL,
  position TEXT,
  height TEXT,
  weight TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  profile_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on players
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Players are viewable by everyone
CREATE POLICY "Players are viewable by everyone" 
ON public.players FOR SELECT USING (true);

-- Create player_statistics table
CREATE TABLE public.player_statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  appearances INTEGER DEFAULT 0,
  starts INTEGER DEFAULT 0,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  mvp_matches INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on player_statistics
ALTER TABLE public.player_statistics ENABLE ROW LEVEL SECURITY;

-- Stats are viewable by everyone
CREATE POLICY "Player statistics are viewable by everyone" 
ON public.player_statistics FOR SELECT USING (true);

-- Create club_history table
CREATE TABLE public.club_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  club_name TEXT NOT NULL,
  level TEXT NOT NULL,
  years TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on club_history
ALTER TABLE public.club_history ENABLE ROW LEVEL SECURITY;

-- Club history is viewable by everyone
CREATE POLICY "Club history is viewable by everyone" 
ON public.club_history FOR SELECT USING (true);

-- Create matches table with scorers info
CREATE TABLE public.matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  match_time TEXT,
  league TEXT,
  is_live BOOLEAN DEFAULT false,
  match_date TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on matches
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- Matches are viewable by everyone
CREATE POLICY "Matches are viewable by everyone" 
ON public.matches FOR SELECT USING (true);

-- Create match_goals table for scorers
CREATE TABLE public.match_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
  scorer_name TEXT NOT NULL,
  minute INTEGER NOT NULL,
  team TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on match_goals
ALTER TABLE public.match_goals ENABLE ROW LEVEL SECURITY;

-- Match goals are viewable by everyone
CREATE POLICY "Match goals are viewable by everyone" 
ON public.match_goals FOR SELECT USING (true);

-- Insert Omar M. Akhtar player
INSERT INTO public.players (name, club, league, position, height, weight, contact_email, contact_phone, profile_image_url)
VALUES ('Omar M. Akhtar', '99 FC', 'J1st League', 'Forward', '5''11"', '165 lbs', 'omar.akhtar@email.com', '+1 (555) 123-4567', NULL);

-- Get the player id and insert stats and club history
INSERT INTO public.player_statistics (player_id, season, appearances, starts, goals, assists, mvp_matches)
SELECT id, '2025-26', 18, 15, 12, 7, 4 FROM public.players WHERE name = 'Omar M. Akhtar';

INSERT INTO public.club_history (player_id, club_name, level, years)
SELECT id, 'Academy United', 'U12', '2018-2020' FROM public.players WHERE name = 'Omar M. Akhtar';

INSERT INTO public.club_history (player_id, club_name, level, years)
SELECT id, 'City Youth FC', 'U14', '2020-2022' FROM public.players WHERE name = 'Omar M. Akhtar';

INSERT INTO public.club_history (player_id, club_name, level, years)
SELECT id, 'Elite Development Academy', 'U16', '2022-2024' FROM public.players WHERE name = 'Omar M. Akhtar';

INSERT INTO public.club_history (player_id, club_name, level, years)
SELECT id, '99 FC', 'Senior', '2024-Present' FROM public.players WHERE name = 'Omar M. Akhtar';

-- Insert some sample matches with goals
INSERT INTO public.matches (home_team, away_team, home_score, away_score, match_time, league, is_live)
VALUES ('FC United', 'City Stars', 2, 1, '65''', 'Premier League', true);

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'James Wilson', 23, 'FC United' FROM public.matches WHERE home_team = 'FC United' AND away_team = 'City Stars';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'Marcus Reid', 45, 'FC United' FROM public.matches WHERE home_team = 'FC United' AND away_team = 'City Stars';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'Carlos Mendez', 52, 'City Stars' FROM public.matches WHERE home_team = 'FC United' AND away_team = 'City Stars';

INSERT INTO public.matches (home_team, away_team, home_score, away_score, match_time, league, is_live)
VALUES ('Athletic SC', 'Rangers FC', 0, 0, '23''', 'Championship', true);

INSERT INTO public.matches (home_team, away_team, home_score, away_score, match_time, league, is_live)
VALUES ('Metro FC', 'United SC', 3, 2, 'Yesterday', 'Premier League', false);

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'David Chen', 12, 'Metro FC' FROM public.matches WHERE home_team = 'Metro FC' AND away_team = 'United SC';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'Alex Torres', 34, 'United SC' FROM public.matches WHERE home_team = 'Metro FC' AND away_team = 'United SC';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'David Chen', 56, 'Metro FC' FROM public.matches WHERE home_team = 'Metro FC' AND away_team = 'United SC';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'Ryan Phillips', 71, 'United SC' FROM public.matches WHERE home_team = 'Metro FC' AND away_team = 'United SC';

INSERT INTO public.match_goals (match_id, scorer_name, minute, team)
SELECT id, 'Mike Johnson', 89, 'Metro FC' FROM public.matches WHERE home_team = 'Metro FC' AND away_team = 'United SC';

-- Function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  RETURN new;
END;
$$;

-- Trigger for new user signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();