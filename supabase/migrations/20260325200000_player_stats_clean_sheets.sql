ALTER TABLE public.player_statistics
ADD COLUMN IF NOT EXISTS clean_sheets integer DEFAULT 0;
