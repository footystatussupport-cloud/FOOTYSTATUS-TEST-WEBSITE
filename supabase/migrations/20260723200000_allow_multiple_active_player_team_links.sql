-- =============================================================================
-- Allow a player to be actively linked to MULTIPLE teams at the same time
-- =============================================================================
-- ROOT CAUSE
--   public.player_team_memberships (the existing, authoritative player <-> team
--   link table) carries this partial unique index from the original linking
--   migration 20260326140000:
--
--     create unique index idx_active_player_team_membership_unique
--       on public.player_team_memberships(player_user_id)
--       where status in ('accepted', 'approved');
--
--   That enforces uniqueness on player_user_id ALONE, so a player can hold at
--   most ONE active link. Any attempt to link a second team fails with a unique
--   violation (23505), which is why joining/accepting a second team could never
--   work and why the app had to overwrite the existing link instead.
--
--   Migration 20260614170000_multi_league_player_memberships.sql already drops
--   this index -- but that migration was never deployed, so the constraint is
--   still live in the database.
--
-- FIX
--   1. Drop the player-only unique index.
--   2. Replace it with the CORRECT uniqueness: one active link per
--      (player, team, daughter team). Duplicate links to the exact same team
--      still cannot be created, but a player may be linked to many teams.
--      club_team_id is coalesced because NULLs are distinct in a unique index,
--      which would otherwise allow duplicate mother-team-only links.
--   3. Revoke pre-existing duplicate rows first, keeping the newest per
--      (player, team, daughter team), so step 2 cannot fail on legacy data.
--
-- NOT CHANGED
--   No new linking system is introduced -- player_team_memberships remains the
--   single authoritative source. RLS, triggers (including the gender check on
--   every link), rosters, invites, requests, Current Stats and the leave flow
--   are untouched. This migration only relaxes an over-restrictive index and
--   adds a correct one.
--
-- Safe to run more than once.
-- =============================================================================

-- 1. Remove the "one active team per player" restriction.
drop index if exists public.idx_active_player_team_membership_unique;

-- 2. Collapse any pre-existing duplicates so the new index can be created.
--    Keeps the most recently approved/updated row per player + team + daughter
--    team and revokes the rest. Nothing is deleted.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        player_user_id,
        team_id,
        coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by approved_at desc nulls last, updated_at desc, created_at desc, id desc
    ) as rn
  from public.player_team_memberships
  where status in ('accepted', 'approved')
)
update public.player_team_memberships m
set status = 'revoked',
    updated_at = now()
from ranked r
where m.id = r.id
  and r.rn > 1;

-- 3. Correct uniqueness: one ACTIVE link per player + team + daughter team.
create unique index if not exists idx_active_player_team_link_unique
  on public.player_team_memberships (
    player_user_id,
    team_id,
    (coalesce(club_team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  where status in ('accepted', 'approved');

comment on index public.idx_active_player_team_link_unique is
  'One active link per player + team + daughter team. Deliberately NOT unique on player_user_id alone: a player may be actively linked to multiple teams.';

-- Helpful for loading every team a player is linked to.
create index if not exists idx_player_team_memberships_player_status
  on public.player_team_memberships (player_user_id, status);

notify pgrst, 'reload schema';
