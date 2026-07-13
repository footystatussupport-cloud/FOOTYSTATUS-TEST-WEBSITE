-- =============================================================================
-- REGRESSION FIX: restore the Current Stats section for linked players
-- =============================================================================
-- public.current_player_statistics synthesizes a stats row for every valid
-- player-team membership (team_sources -> verified_rows), so the section shows
-- automatically once a player is linked — no per-player stats row required.
--
-- The 20260712130000 rework set the view to `security_invoker = true`. That made
-- the view enforce the RESTRICTIVE gender-visibility RLS on player_profiles /
-- players / player_team_memberships (public.can_view_player(...)) as the querying
-- user, so those CTEs returned no rows and the Current Stats section disappeared
-- for linked players.
--
-- The original view (20260614180000) had NO security_invoker (definer behavior),
-- which is what made stats visible. This restores that: the view computes and
-- returns team-specific stats regardless of the per-viewer gender RLS. Whether a
-- viewer may reach the profile at all is still governed elsewhere
-- (player_profiles_public + page-level can_view_player checks); this view is the
-- stats companion, which was always definer.
--
-- No frontend change is needed and no data is modified — the section reappears
-- for ALL currently-linked players (existing and future) as soon as this runs.
-- Safe to run more than once.
-- =============================================================================

alter view public.current_player_statistics set (security_invoker = false);

grant select on public.current_player_statistics to anon, authenticated;
