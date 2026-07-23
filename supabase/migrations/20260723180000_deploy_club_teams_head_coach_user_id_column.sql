-- =============================================================================
-- Deploy the missing club_teams.head_coach_user_id column
-- =============================================================================
-- REPORTED ERROR
--   Editing a daughter team from the mother-team profile failed with:
--     column "head_coach_user_id" of relation "club_teams" does not exist
--
-- ROOT CAUSE
--   public.update_daughter_team_details() writes:
--       update public.club_teams set ... head_coach_user_id = _head_coach_user_id ...
--   The column itself is created by migration
--   20260706100000_head_coach_linked_selector.sql, which was never included in a
--   deploy bundle, so the live database never got it. The RPC was deployed
--   without its column dependency, so every daughter-team save aborted.
--
-- WHY THE COLUMN SHOULD EXIST (rather than stripping it from the payload)
--   It is a deliberate feature, not stale code:
--     * 20260706100000 adds the column AND an index for it, and updates
--       save_club_profile() to persist it for created/updated daughter teams.
--     * The daughter-team editor's CoachSelector writes it, so a head coach can
--       be a real linked Coach ACCOUNT (by user id) instead of typed text only.
--     * It complements club_teams.coach_name (free text for coaches with no
--       account yet) -- the two are used together.
--   It designates WHICH coach is the head coach of one specific daughter team.
--   That is distinct from public.coach_staff_team_memberships, which is the
--   general staff roster, so this is not a duplicated coach relationship.
--   Removing it would break the existing head-coach selector.
--
-- SCOPE
--   Schema only: the column plus its index. No coach links are created, moved or
--   removed; no existing row is modified (the column is added as NULL). RLS,
--   triggers, rosters, invites, requests, gender rules and every other daughter
--   team field are untouched.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.club_teams
  add column if not exists head_coach_user_id uuid references auth.users(id) on delete set null;

create index if not exists club_teams_head_coach_user_id_idx
  on public.club_teams (head_coach_user_id);

comment on column public.club_teams.head_coach_user_id is
  'Optional linked Coach account acting as this daughter team''s head coach. Complements club_teams.coach_name (free text). Not a replacement for coach_staff_team_memberships.';

notify pgrst, 'reload schema';
