create or replace function public.get_pending_clip_reviews()
returns table (
  clip_id uuid,
  player_user_id uuid,
  player_name text,
  player_username text,
  player_gender text,
  account_role text,
  title text,
  caption text,
  video_url text,
  thumbnail_url text,
  uploaded_at timestamptz,
  review_status text,
  revision_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();

  return query
  select
    c.id,
    coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id),
    coalesce(p.full_name, pp_by_user.full_name, pp_by_id.full_name, pl.name, 'Player'),
    p.username,
    coalesce(pp_by_user.player_gender, pp_by_id.player_gender, pl.player_gender),
    coalesce(p.account_role, p.account_type, p.role::text, 'player'),
    c.title,
    coalesce(c.caption, c.description),
    c.video_url,
    c.thumbnail_url,
    c.created_at,
    c.review_status,
    c.revision_note
  from public.clips c
  left join public.player_profiles pp_by_user
    on pp_by_user.user_id = c.user_id
  left join public.player_profiles pp_by_id
    on pp_by_id.id = c.player_id
  left join public.players pl
    on pl.id = c.player_id
  left join public.profiles p
    on p.user_id = coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id)
  where c.review_status in ('pending_review', 'needs_revision')
  order by
    case when c.review_status = 'pending_review' then 0 else 1 end,
    coalesce(c.submitted_for_review_at, c.created_at) asc;
end;
$$;

revoke all on function public.get_pending_clip_reviews() from public;
grant execute on function public.get_pending_clip_reviews() to authenticated;
