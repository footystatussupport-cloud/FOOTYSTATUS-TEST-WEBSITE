-- Add age_group to leagues table
ALTER TABLE public.leagues ADD COLUMN age_group TEXT;

-- Update J1st League with age group
UPDATE public.leagues SET age_group = 'U17' WHERE name = 'J1st League';

-- Insert players from goal scorers into their respective teams
-- First, get goals and create players for each unique scorer

-- Get all unique goal scorers and insert as players
INSERT INTO public.players (name, club, league, team_id, position)
SELECT DISTINCT 
  mg.scorer_name,
  mg.team,
  'J1st League',
  t.id,
  'Forward'
FROM public.match_goals mg
JOIN public.teams t ON t.name = mg.team
WHERE NOT EXISTS (
  SELECT 1 FROM public.players p WHERE p.name = mg.scorer_name AND p.club = mg.team
);

-- Insert player statistics for each scorer based on their goals
INSERT INTO public.player_statistics (player_id, season, goals, appearances, starts)
SELECT 
  p.id,
  '2024-25',
  (SELECT COUNT(*) FROM public.match_goals mg WHERE mg.scorer_name = p.name AND mg.team = p.club),
  (SELECT COUNT(*) FROM public.match_goals mg WHERE mg.scorer_name = p.name AND mg.team = p.club),
  (SELECT COUNT(*) FROM public.match_goals mg WHERE mg.scorer_name = p.name AND mg.team = p.club)
FROM public.players p
WHERE NOT EXISTS (
  SELECT 1 FROM public.player_statistics ps WHERE ps.player_id = p.id AND ps.season = '2024-25'
);

-- Update Omar's goals count in statistics (he has 8 goals)
UPDATE public.player_statistics 
SET goals = 8, appearances = 12, starts = 10
WHERE player_id = (SELECT id FROM public.players WHERE name = 'Omar M. Akhtar')
AND season = '2024-25';

-- Create matches between all teams so they've all played each other
-- First, let's clear existing matches and create a proper round-robin

-- Get all team pairs and create matches
INSERT INTO public.matches (home_team, away_team, home_score, away_score, league, is_live, match_time, match_date)
VALUES 
-- 99 FC matches
('99 FC', 'United FC', 3, 1, 'J1st League', false, 'FT', '2024-09-15'),
('99 FC', 'City Stars', 2, 0, 'J1st League', false, 'FT', '2024-09-22'),
('99 FC', 'Athletic Club', 4, 2, 'J1st League', false, 'FT', '2024-10-06'),
('99 FC', 'Real Santos', 2, 1, 'J1st League', false, 'FT', '2024-10-20'),
('99 FC', 'FC Thunder', 3, 0, 'J1st League', false, 'FT', '2024-11-03'),
-- United FC matches
('United FC', '99 FC', 0, 2, 'J1st League', false, 'FT', '2024-11-17'),
('United FC', 'City Stars', 1, 1, 'J1st League', false, 'FT', '2024-09-29'),
('United FC', 'Athletic Club', 2, 0, 'J1st League', false, 'FT', '2024-10-13'),
('United FC', 'Real Santos', 3, 2, 'J1st League', false, 'FT', '2024-10-27'),
('United FC', 'FC Thunder', 2, 1, 'J1st League', false, 'FT', '2024-11-10'),
-- City Stars matches  
('City Stars', '99 FC', 1, 1, 'J1st League', false, 'FT', '2024-12-01'),
('City Stars', 'United FC', 2, 1, 'J1st League', false, 'FT', '2024-11-24'),
('City Stars', 'Athletic Club', 1, 0, 'J1st League', false, 'FT', '2024-10-06'),
('City Stars', 'Real Santos', 2, 2, 'J1st League', false, 'FT', '2024-10-20'),
('City Stars', 'FC Thunder', 3, 1, 'J1st League', false, 'FT', '2024-11-03'),
-- Athletic Club matches
('Athletic Club', '99 FC', 0, 1, 'J1st League', false, 'FT', '2024-12-08'),
('Athletic Club', 'United FC', 1, 2, 'J1st League', false, 'FT', '2024-11-24'),
('Athletic Club', 'City Stars', 1, 1, 'J1st League', false, 'FT', '2024-12-15'),
('Athletic Club', 'Real Santos', 2, 0, 'J1st League', false, 'FT', '2024-10-27'),
('Athletic Club', 'FC Thunder', 3, 1, 'J1st League', false, 'FT', '2024-11-10'),
-- Real Santos matches
('Real Santos', '99 FC', 1, 2, 'J1st League', false, 'FT', '2024-12-22'),
('Real Santos', 'United FC', 0, 0, 'J1st League', false, 'FT', '2024-12-01'),
('Real Santos', 'City Stars', 1, 0, 'J1st League', false, 'FT', '2024-12-08'),
('Real Santos', 'Athletic Club', 2, 2, 'J1st League', false, 'FT', '2024-12-15'),
('Real Santos', 'FC Thunder', 2, 1, 'J1st League', false, 'FT', '2024-11-17'),
-- FC Thunder matches
('FC Thunder', '99 FC', 0, 3, 'J1st League', false, 'FT', '2024-12-29'),
('FC Thunder', 'United FC', 1, 2, 'J1st League', false, 'FT', '2024-12-22'),
('FC Thunder', 'City Stars', 0, 1, 'J1st League', false, 'FT', '2024-12-29'),
('FC Thunder', 'Athletic Club', 2, 2, 'J1st League', false, 'FT', '2024-12-08'),
('FC Thunder', 'Real Santos', 1, 1, 'J1st League', false, 'FT', '2024-12-15')
ON CONFLICT DO NOTHING;