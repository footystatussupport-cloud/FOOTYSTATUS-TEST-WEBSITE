-- Parent -> child direction of the parent/player link was not displaying under
-- the parent's "Linked Children" section, while the child -> parent direction
-- worked. The link is a single bidirectional parent_player_links row, so the
-- data is stored both ways; the problem is retrieval. The parent-side client
-- query embeds player_profiles, whose restrictive/permissive RLS can hide the
-- child row (and thus the whole result) from the parent account, whereas the
-- child-side query embeds parent_profiles (public read) and works.
--
-- Mirror the working get_player_private_parent_contacts pattern with a
-- SECURITY DEFINER RPC that returns a parent's linked children authoritatively,
-- immune to player_profiles RLS. Only the parent themselves (or an admin) may
-- read their linked children.

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
  'Authoritative list of a parent''s linked children (parent_player_links) with player details, immune to player_profiles RLS. Parent or admin only.';
