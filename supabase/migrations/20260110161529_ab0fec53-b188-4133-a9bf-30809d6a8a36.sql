-- Create teams table
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  league_id UUID,
  logo_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  sporting_director TEXT,
  sponsors TEXT[],
  founded_year INTEGER,
  stadium TEXT,
  wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  goals_for INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create leagues table
CREATE TABLE public.leagues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  logo_url TEXT,
  season TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add foreign key from teams to leagues
ALTER TABLE public.teams 
ADD CONSTRAINT teams_league_id_fkey 
FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE SET NULL;

-- Add team_id to players table
ALTER TABLE public.players ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

-- Enable RLS on teams
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Enable RLS on leagues
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for teams
CREATE POLICY "Teams are viewable by everyone" 
ON public.teams 
FOR SELECT 
USING (true);

-- Create RLS policies for leagues
CREATE POLICY "Leagues are viewable by everyone" 
ON public.leagues 
FOR SELECT 
USING (true);

-- Insert J1st League
INSERT INTO public.leagues (name, country, season)
VALUES ('J1st League', 'USA', '2024-25');

-- Insert 99 FC team with league reference
INSERT INTO public.teams (name, league_id, contact_email, sporting_director, sponsors, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  '99 FC',
  l.id,
  'contact@99fc.com',
  'John Smith',
  ARRAY['Nike', 'Gatorade'],
  8, 2, 2, 24, 12, 26
FROM public.leagues l WHERE l.name = 'J1st League';

-- Insert other teams from the matches
INSERT INTO public.teams (name, league_id, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  'United FC',
  l.id,
  7, 3, 2, 20, 14, 24
FROM public.leagues l WHERE l.name = 'J1st League';

INSERT INTO public.teams (name, league_id, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  'City Stars',
  l.id,
  6, 4, 2, 18, 10, 22
FROM public.leagues l WHERE l.name = 'J1st League';

INSERT INTO public.teams (name, league_id, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  'Athletic Club',
  l.id,
  5, 3, 4, 15, 16, 18
FROM public.leagues l WHERE l.name = 'J1st League';

INSERT INTO public.teams (name, league_id, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  'Real Santos',
  l.id,
  4, 4, 4, 14, 15, 16
FROM public.leagues l WHERE l.name = 'J1st League';

INSERT INTO public.teams (name, league_id, wins, draws, losses, goals_for, goals_against, points)
SELECT 
  'FC Thunder',
  l.id,
  3, 3, 6, 12, 20, 12
FROM public.leagues l WHERE l.name = 'J1st League';

-- Update Omar's player record to link to 99 FC team
UPDATE public.players 
SET team_id = (SELECT id FROM public.teams WHERE name = '99 FC')
WHERE name = 'Omar M. Akhtar';