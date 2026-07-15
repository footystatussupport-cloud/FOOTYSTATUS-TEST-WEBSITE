-- =============================================================================
-- Liked Videos — private per-account history of liked Next Up clips
-- =============================================================================
-- Reuses the existing public.clip_likes table (UNIQUE(clip_id, user_id),
-- created_at, clip_id ON DELETE CASCADE — so a deleted clip auto-drops from
-- every history). Adds:
--   1. A scoped SELECT policy so each account can read ONLY its own likes.
--   2. fetch_my_liked_clips(): returns the caller's liked clips joined to clip +
--      player display data, newest-liked first, filtered to available/approved/
--      public clips and respecting player (gender) visibility.
--
-- Security: the RPC keys off auth.uid() with no user parameter, so no account
-- can read another account's liked videos by changing an id / URL / request.
-- Safe to run more than once.
-- =============================================================================

-- 1) Each account may read only its own likes (RLS was enabled with no SELECT
--    policy, so reads were blocked). Insert/delete policies already exist.
drop policy if exists "Users can view their own likes" on public.clip_likes;
create policy "Users can view their own likes"
on public.clip_likes
for select
to authenticated
using (auth.uid() = user_id);

-- 2) The caller's liked clips, newest like first, available clips only.
create or replace function public.fetch_my_liked_clips()
returns table (
  clip jsonb,
  player_user_id uuid,
  player_name text,
  player_avatar_url text,
  liked_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_jsonb(c) as clip,
    c.user_id as player_user_id,
    coalesce(
      nullif(trim(pp.full_name), ''),
      nullif(trim(pr.full_name), ''),
      'Player'
    ) as player_name,
    coalesce(pp.profile_image_url, pr.avatar_url) as player_avatar_url,
    cl.created_at as liked_at
  from public.clip_likes cl
  join public.clips c on c.id = cl.clip_id
  left join public.player_profiles pp on pp.user_id = c.user_id
  left join public.profiles pr on pr.user_id = c.user_id
  where cl.user_id = auth.uid()
    and coalesce(c.review_status, 'approved') = 'approved'
    and coalesce(c.visibility, 'public') = 'public'
    and (c.user_id is null or public.can_view_player(c.user_id))
  order by cl.created_at desc;
$$;

grant execute on function public.fetch_my_liked_clips() to authenticated;
