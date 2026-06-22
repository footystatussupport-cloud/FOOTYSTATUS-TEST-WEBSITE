-- Infinite, unseen, randomized Next Up feed with engagement exposure credits.

create table if not exists public.clip_feed_impressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clip_id uuid not null references public.clips(id) on delete cascade,
  recommended_at timestamptz not null default now(),
  viewed_at timestamptz,
  unique (user_id, clip_id)
);

create index if not exists idx_clip_feed_impressions_user_clip
  on public.clip_feed_impressions(user_id, clip_id);

create index if not exists idx_clip_feed_impressions_clip
  on public.clip_feed_impressions(clip_id);

alter table public.clip_feed_impressions enable row level security;

drop policy if exists "Users view own feed impressions" on public.clip_feed_impressions;
create policy "Users view own feed impressions"
on public.clip_feed_impressions for select to authenticated
using (auth.uid() = user_id);

create table if not exists public.clip_exposure_state (
  clip_id uuid primary key references public.clips(id) on delete cascade,
  bonus_exposures_remaining integer not null default 0 check (bonus_exposures_remaining >= 0),
  likes_awarded integer not null default 0,
  shares_awarded integer not null default 0,
  comments_awarded integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.clip_engagement_exposure_awards (
  award_key text primary key,
  clip_id uuid not null references public.clips(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  engagement_type text not null check (engagement_type in ('like', 'share', 'comment')),
  exposure_amount integer not null check (exposure_amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_clip_engagement_awards_clip
  on public.clip_engagement_exposure_awards(clip_id, created_at desc);

create table if not exists public.clip_shares (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_target text,
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

alter table public.clip_exposure_state enable row level security;
alter table public.clip_engagement_exposure_awards enable row level security;
alter table public.clip_shares enable row level security;

drop policy if exists "Users view own shares" on public.clip_shares;
create policy "Users view own shares"
on public.clip_shares for select to authenticated
using (auth.uid() = user_id);

-- Existing playback history counts as previously seen.
insert into public.clip_feed_impressions (user_id, clip_id, recommended_at, viewed_at)
select distinct on (v.user_id, v.clip_id)
  v.user_id, v.clip_id, v.created_at, v.created_at
from public.clip_views v
order by v.user_id, v.clip_id, v.created_at
on conflict (user_id, clip_id) do update
set viewed_at = coalesce(public.clip_feed_impressions.viewed_at, excluded.viewed_at);

create or replace function public.clip_owner_is_active_pro(_clip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        p.account_tier = 'pro_lifetime'
        or (
          p.account_tier = 'pro_annual'
          and p.pro_expires_at is not null
          and p.pro_expires_at > now()
        )
      from public.clips c
      left join public.player_profiles pp on pp.id = c.player_id
      left join public.profiles p on p.user_id = coalesce(c.user_id, pp.user_id)
      where c.id = _clip_id
    ),
    false
  );
$$;

create or replace function public.award_clip_exposure(
  _award_key text,
  _clip_id uuid,
  _actor_user_id uuid,
  _engagement_type text,
  _base_exposures integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
  v_inserted integer;
begin
  if _engagement_type not in ('like', 'share', 'comment') then
    raise exception 'Invalid engagement type';
  end if;

  v_amount := ceil(
    _base_exposures
    * case when public.clip_owner_is_active_pro(_clip_id) then 1.5 else 1 end
  )::integer;

  insert into public.clip_engagement_exposure_awards (
    award_key, clip_id, actor_user_id, engagement_type, exposure_amount
  )
  values (_award_key, _clip_id, _actor_user_id, _engagement_type, v_amount)
  on conflict (award_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 0;
  end if;

  insert into public.clip_exposure_state (
    clip_id,
    bonus_exposures_remaining,
    likes_awarded,
    shares_awarded,
    comments_awarded
  )
  values (
    _clip_id,
    v_amount,
    case when _engagement_type = 'like' then 1 else 0 end,
    case when _engagement_type = 'share' then 1 else 0 end,
    case when _engagement_type = 'comment' then 1 else 0 end
  )
  on conflict (clip_id) do update
  set bonus_exposures_remaining =
        public.clip_exposure_state.bonus_exposures_remaining + excluded.bonus_exposures_remaining,
      likes_awarded = public.clip_exposure_state.likes_awarded + excluded.likes_awarded,
      shares_awarded = public.clip_exposure_state.shares_awarded + excluded.shares_awarded,
      comments_awarded = public.clip_exposure_state.comments_awarded + excluded.comments_awarded,
      updated_at = now();

  return v_amount;
end;
$$;

-- Seed historical engagement exactly once, so existing clips participate too.
insert into public.clip_engagement_exposure_awards (
  award_key, clip_id, actor_user_id, engagement_type, exposure_amount, created_at
)
select
  'like:' || cl.clip_id::text || ':' || cl.user_id::text,
  cl.clip_id,
  cl.user_id,
  'like',
  ceil(10 * case when public.clip_owner_is_active_pro(cl.clip_id) then 1.5 else 1 end)::integer,
  cl.created_at
from public.clip_likes cl
where cl.user_id is not null
on conflict (award_key) do nothing;

insert into public.clip_engagement_exposure_awards (
  award_key, clip_id, actor_user_id, engagement_type, exposure_amount, created_at
)
select
  'comment:' || cc.id::text,
  cc.clip_id,
  cc.user_id,
  'comment',
  ceil(10 * case when public.clip_owner_is_active_pro(cc.clip_id) then 1.5 else 1 end)::integer,
  cc.created_at
from public.clip_comments cc
on conflict (award_key) do nothing;

insert into public.clip_exposure_state (
  clip_id,
  bonus_exposures_remaining,
  likes_awarded,
  shares_awarded,
  comments_awarded,
  updated_at
)
select
  a.clip_id,
  sum(a.exposure_amount)::integer,
  count(*) filter (where a.engagement_type = 'like')::integer,
  count(*) filter (where a.engagement_type = 'share')::integer,
  count(*) filter (where a.engagement_type = 'comment')::integer,
  now()
from public.clip_engagement_exposure_awards a
group by a.clip_id
on conflict (clip_id) do nothing;

create or replace function public.award_like_clip_exposure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_clip_exposure(
    'like:' || new.clip_id::text || ':' || new.user_id::text,
    new.clip_id,
    new.user_id,
    'like',
    10
  );
  return new;
end;
$$;

drop trigger if exists award_like_clip_exposure_trigger on public.clip_likes;
create trigger award_like_clip_exposure_trigger
after insert on public.clip_likes
for each row execute function public.award_like_clip_exposure();

create or replace function public.award_comment_clip_exposure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_clip_exposure(
    'comment:' || new.id::text,
    new.clip_id,
    new.user_id,
    'comment',
    10
  );
  return new;
end;
$$;

drop trigger if exists award_comment_clip_exposure_trigger on public.clip_comments;
create trigger award_comment_clip_exposure_trigger
after insert on public.clip_comments
for each row execute function public.award_comment_clip_exposure();

create or replace function public.award_share_clip_exposure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_clip_exposure(
    'share:' || new.clip_id::text || ':' || new.user_id::text,
    new.clip_id,
    new.user_id,
    'share',
    15
  );
  return new;
end;
$$;

drop trigger if exists award_share_clip_exposure_trigger on public.clip_shares;
create trigger award_share_clip_exposure_trigger
after insert on public.clip_shares
for each row execute function public.award_share_clip_exposure();

create or replace function public.record_clip_share(
  _clip_id uuid,
  _share_target text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  insert into public.clip_shares (clip_id, user_id, share_target)
  values (_clip_id, auth.uid(), nullif(trim(coalesce(_share_target, '')), ''))
  on conflict (clip_id, user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function public.mark_next_up_clip_viewed(_clip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.clip_feed_impressions (user_id, clip_id, viewed_at)
  values (auth.uid(), _clip_id, now())
  on conflict (user_id, clip_id) do update
  set viewed_at = coalesce(public.clip_feed_impressions.viewed_at, now());
end;
$$;

create or replace function public.get_next_up_feed(_limit integer default 12)
returns setof public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(_limit, 12), 30));
  v_is_college_coach boolean := false;
begin
  if v_user_id is null then
    return query
    select c.*
    from public.clips c
    left join public.player_profiles pp on pp.id = c.player_id
    where c.visibility = 'public'
      and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
    order by random()
    limit v_limit;
    return;
  end if;

  select exists (
    select 1
    from public.profiles p
    left join public.staff_profiles sp on sp.user_id = p.user_id
    where p.user_id = v_user_id
      and coalesce(p.account_role, p.role::text) in ('head_coach_assistant', 'coach')
      and (
        lower(coalesce(sp.team_organization_name, '')) like '%college%'
        or lower(coalesce(p.team_name, '')) like '%college%'
        or lower(coalesce(p.club_name, '')) like '%college%'
        or lower(coalesce(p.coaching_role_type, '')) like '%college%'
      )
  ) into v_is_college_coach;

  return query
  with eligible as (
    select
      c.id,
      coalesce(es.bonus_exposures_remaining, 0) as bonus_remaining,
      case
        when c.created_at >= now() - interval '7 days' then 0
        when coalesce(c.likes_count, 0) + (
          select count(*) from public.clip_comments cc where cc.clip_id = c.id
        ) = 0 then 1
        when coalesce(c.likes_count, 0) + (
          select count(*) from public.clip_comments cc where cc.clip_id = c.id
        ) < 10 then 2
        else 3
      end as performance_bucket,
      (
        1.0
        + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
      )
      * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end
      as exposure_weight
    from public.clips c
    left join public.player_profiles pp on pp.id = c.player_id
    left join public.clip_exposure_state es on es.clip_id = c.id
    where c.visibility in (
      'public',
      case
        when exists (
          select 1 from public.profiles vp
          where vp.user_id = v_user_id
            and coalesce(vp.account_role, vp.role::text) in
              ('team_club', 'head_coach_assistant', 'coach', 'scout', 'trainer', 'academy_director')
        ) then 'restricted'
        else 'public'
      end
    )
      and coalesce(c.user_id, pp.user_id) is distinct from v_user_id
      and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
      and not exists (
        select 1
        from public.clip_feed_impressions fi
        where fi.user_id = v_user_id
          and fi.clip_id = c.id
      )
  ),
  randomized as (
    select
      e.*,
      row_number() over (
        partition by e.performance_bucket
        order by (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1))
      ) as bucket_position,
      (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1)) as random_rank
    from eligible e
  ),
  selected as (
    select r.id,
      row_number() over (
        order by
          case when v_is_college_coach then r.bucket_position else 0 end,
          case when v_is_college_coach then r.performance_bucket else 0 end,
          r.random_rank
      ) as feed_position
    from randomized r
    order by
      case when v_is_college_coach then r.bucket_position else 0 end,
      case when v_is_college_coach then r.performance_bucket else 0 end,
      r.random_rank
    limit v_limit
  ),
  inserted as (
    insert into public.clip_feed_impressions (user_id, clip_id)
    select v_user_id, s.id
    from selected s
    on conflict (user_id, clip_id) do nothing
    returning clip_id
  ),
  consumed as (
    update public.clip_exposure_state es
    set bonus_exposures_remaining = greatest(es.bonus_exposures_remaining - 1, 0),
        updated_at = now()
    where es.clip_id in (
      select i.clip_id from inserted i
    )
      and es.bonus_exposures_remaining > 0
    returning es.clip_id
  )
  select c.*
  from selected s
  join inserted i on i.clip_id = s.id
  join public.clips c on c.id = s.id
  order by s.feed_position;
end;
$$;

grant execute on function public.get_next_up_feed(integer) to anon, authenticated;
grant execute on function public.record_clip_share(uuid, text) to authenticated;
grant execute on function public.mark_next_up_clip_viewed(uuid) to authenticated;
