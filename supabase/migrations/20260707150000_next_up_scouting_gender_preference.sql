alter table public.profiles
  add column if not exists next_up_gender_preference text not null default 'both';

alter table public.profiles
  drop constraint if exists profiles_next_up_gender_preference_check;

alter table public.profiles
  add constraint profiles_next_up_gender_preference_check
  check (next_up_gender_preference in ('both', 'boy', 'girl'));

update public.profiles
set next_up_gender_preference = 'both'
where next_up_gender_preference is null
   or next_up_gender_preference not in ('both', 'boy', 'girl');

drop function if exists public.get_next_up_feed(integer);

create or replace function public.get_next_up_feed(
  _limit integer default 12,
  _gender_preference text default null
)
returns setof public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(_limit, 12), 30));
  v_viewer_role text;
  v_effective_gender text := null;
begin
  if v_user_id is null then
    raise exception 'Log in or sign up to watch Next Up Clips.';
  end if;

  select coalesce(p.account_role, p.account_type, p.role::text)
  into v_viewer_role
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if v_viewer_role in ('scout', 'team_staff', 'head_coach_assistant', 'coach', 'trainer', 'academy_director', 'team_club', 'school_team') then
    v_effective_gender := case
      when lower(coalesce(_gender_preference, 'both')) in ('boy', 'boys', 'male') then 'boy'
      when lower(coalesce(_gender_preference, 'both')) in ('girl', 'girls', 'female') then 'girl'
      else null
    end;
  end if;

  return query
  with eligible as (
    select
      c.id,
      (
        1.0 + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
      ) * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end as exposure_weight
    from public.clips c
    left join public.player_profiles pp_by_id on pp_by_id.id = c.player_id
    left join public.player_profiles pp_by_user on pp_by_user.user_id = c.user_id
    left join public.players pl on pl.id = c.player_id
    left join public.clip_exposure_state es on es.clip_id = c.id
    where c.review_status = 'approved'
      and c.visibility in ('public', 'restricted')
      and coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id) is distinct from v_user_id
      and public.can_view_account_content(coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id))
      and (
        v_effective_gender is null
        or coalesce(pp_by_user.player_gender, pp_by_id.player_gender, pl.player_gender) = v_effective_gender
      )
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

revoke all on function public.get_next_up_feed(integer, text) from public;
revoke execute on function public.get_next_up_feed(integer, text) from anon;
grant execute on function public.get_next_up_feed(integer, text) to authenticated;
