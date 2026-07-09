-- Make parent <-> child linking fully mutual as interactive profile tiles.
--
-- Both directions of the relationship should render a rich profile tile (photo,
-- name, username, account type) that opens the linked account, and stay in sync
-- with each account's live public profile.
--
--  1) Parent side: get_parent_linked_children now also returns the child's live
--     avatar so the "Linked Children" tiles can show the child's profile picture
--     (name / username / age / team were already available).
--
--  2) Player side: a single authoritative RPC returns the player's linked parent
--     accounts as identity tiles (name / username / avatar / account type) plus
--     the parent's contact details. Identity + contact are both gated by
--     public.user_can_view_parent_contacts (the player themselves, an admin, a
--     linked approved parent, or the player's team staff / coaches). The player
--     and admins additionally see still-pending requests so they can approve or
--     deny them from the tile.

-- 1) Add the child's live avatar to the parent-side RPC. -----------------------
-- The function already exists (20260707160000) with a narrower RETURNS TABLE.
-- Postgres cannot change an existing function's return type via CREATE OR
-- REPLACE, so drop it first before recreating with the extra avatar column.
drop function if exists public.get_parent_linked_children(uuid);

create or replace function public.get_parent_linked_children(_parent_user_id uuid)
returns table (
  link_id uuid,
  status text,
  relationship_to_player text,
  notes text,
  created_at timestamptz,
  approved_at timestamptz,
  player_profile_id uuid,
  player_user_id uuid,
  player_full_name text,
  player_username text,
  player_avatar_url text,
  player_team text,
  player_team_name text,
  player_position text,
  player_age_birth_year text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    coalesce(ppl.relationship_to_player, par.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, par.parent_notes) as notes,
    ppl.created_at,
    ppl.approved_at,
    pl.id as player_profile_id,
    pl.user_id as player_user_id,
    coalesce(pl.full_name, prof.full_name) as player_full_name,
    prof.username as player_username,
    coalesce(prof.avatar_url, pl.profile_image_url) as player_avatar_url,
    pl.team as player_team,
    prof.team_name as player_team_name,
    pl.position as player_position,
    prof.age_birth_year as player_age_birth_year
  from public.parent_player_links ppl
  join public.parent_profiles par on par.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pl.user_id
  where par.user_id = _parent_user_id
    and ppl.status <> 'removed'
    and (
      auth.uid() = _parent_user_id
      or public.is_footy_status_admin()
    )
  order by ppl.created_at desc;
$$;

grant execute on function public.get_parent_linked_children(uuid) to authenticated;

comment on function public.get_parent_linked_children(uuid) is
  'Authoritative list of a parent''s linked children (parent_player_links) with the child''s live profile details incl. avatar, immune to player_profiles RLS. Parent or admin only.';

-- 2) Player side: linked parents as identity tiles + gated contact details. ----
create or replace function public.get_player_linked_parents(_player_user_id uuid)
returns table (
  link_id uuid,
  status text,
  parent_user_id uuid,
  parent_full_name text,
  parent_username text,
  parent_avatar_url text,
  relationship_to_player text,
  notes text,
  contact_email text,
  contact_phone text,
  emergency_contact text,
  can_review boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    pp.user_id as parent_user_id,
    coalesce(pp.full_name, prof.full_name) as parent_full_name,
    prof.username as parent_username,
    prof.avatar_url as parent_avatar_url,
    coalesce(ppl.relationship_to_player, pp.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, pp.parent_notes) as notes,
    pp.contact_email,
    pp.contact_phone,
    pp.emergency_contact,
    ((auth.uid() = _player_user_id or public.is_footy_status_admin())
      and ppl.status = 'pending') as can_review
  from public.parent_player_links ppl
  join public.parent_profiles pp on pp.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pp.user_id
  where pl.user_id = _player_user_id
    and public.user_can_view_parent_contacts(_player_user_id)
    and (
      ppl.status = 'approved'
      or (
        (auth.uid() = _player_user_id or public.is_footy_status_admin())
        and ppl.status = 'pending'
      )
    )
  order by
    case ppl.status when 'pending' then 0 else 1 end,
    ppl.created_at desc;
$$;

grant execute on function public.get_player_linked_parents(uuid) to authenticated;

comment on function public.get_player_linked_parents(uuid) is
  'Authoritative list of a player''s linked parent accounts as identity tiles (name / username / avatar) plus contact details. Gated by user_can_view_parent_contacts; the player and admins also see pending requests to review.';
