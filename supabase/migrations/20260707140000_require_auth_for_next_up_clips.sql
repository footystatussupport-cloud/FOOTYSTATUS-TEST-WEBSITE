-- Next Up Clips are a logged-in-only feature.
-- Anonymous users must not receive clip rows, video URLs, captions, player data,
-- or feed results.

alter table public.clips enable row level security;

drop policy if exists "Clip review visibility" on public.clips;
create policy "Clip review visibility"
on public.clips
as restrictive
for select
to public
using (
  auth.uid() is not null
  and (
    review_status = 'approved'
    or auth.uid() = user_id
    or public.is_footy_status_global_admin()
  )
);

drop policy if exists "Authenticated users can read clips only" on public.clips;
create policy "Authenticated users can read clips only"
on public.clips
as restrictive
for select
to public
using (auth.uid() is not null);

create or replace function public.get_next_up_feed(_limit integer default 12)
returns setof public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(_limit, 12), 30));
begin
  if v_user_id is null then
    raise exception 'Log in or sign up to watch Next Up Clips.';
  end if;

  return query
  with eligible as (
    select
      c.id,
      (
        1.0 + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
      ) * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end as exposure_weight
    from public.clips c
    left join public.player_profiles pp on pp.id = c.player_id
    left join public.clip_exposure_state es on es.clip_id = c.id
    where c.review_status = 'approved'
      and c.visibility in ('public', 'restricted')
      and coalesce(c.user_id, pp.user_id) is distinct from v_user_id
      and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
      and not exists (
        select 1 from public.clip_feed_impressions fi
        where fi.user_id = v_user_id and fi.clip_id = c.id
      )
  ),
  selected as (
    select e.id,
      row_number() over (
        order by (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1))
      ) as feed_position
    from eligible e
    order by (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1))
    limit v_limit
  ),
  inserted as (
    insert into public.clip_feed_impressions (user_id, clip_id)
    select v_user_id, s.id from selected s
    on conflict (user_id, clip_id) do nothing
    returning clip_id
  )
  select c.*
  from selected s
  join inserted i on i.clip_id = s.id
  join public.clips c on c.id = s.id
  order by s.feed_position;
end;
$$;

revoke all on function public.get_next_up_feed(integer) from public;
revoke execute on function public.get_next_up_feed(integer) from anon;
grant execute on function public.get_next_up_feed(integer) to authenticated;
