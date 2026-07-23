-- =============================================================================
-- Next Up feed: launch-window algorithm (real clips only, endless via repeats)
-- =============================================================================
-- Problem this fixes
-- ------------------
-- get_next_up_feed excluded every clip that already had a clip_feed_impressions
-- row, and that row is written the moment a clip is *recommended* (not watched).
-- With a small launch catalogue the eligible set drained to zero after one pass
-- and the RPC returned no rows forever, so every viewer got stuck on the
-- "No New Next Up Clips" empty state even though approved clips existed.
--
-- New behaviour
-- -------------
-- Viewing history is now recorded WITHOUT removing a clip from eligibility.
-- The feed runs in "rounds": within a round every eligible clip is served once,
-- and when the round is exhausted a new round starts and the same real clips
-- are served again in a fresh, shuffled rotation. No duplicate clip rows are
-- created and no mock/placeholder content is ever introduced.
--
-- Ranking inside a round:
--   tier 0  never served to this viewer  (includes newly approved clips)
--   tier 1  served before but never watched
--   tier 2  already watched -> the repeat rotation
-- tiers 0/1 order newest-approved first; tier 2 is a weighted shuffle that
-- differs every round. Within each tier clips are round-robined by owner so one
-- clip or one player never appears back-to-back while other clips exist.
--
-- Gender/visibility rules are unchanged and are re-applied on every single row
-- returned (see the final SELECT), including when clips repeat.
-- =============================================================================


-- 1) Viewing history: keep it, but stop using it as an exclusion list. ---------

alter table public.clip_feed_impressions
  add column if not exists last_served_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists serve_count integer not null default 0,
  add column if not exists view_count integer not null default 0;

update public.clip_feed_impressions
set last_served_at = coalesce(last_served_at, viewed_at, recommended_at),
    last_viewed_at = coalesce(last_viewed_at, viewed_at),
    serve_count = greatest(serve_count, 1),
    view_count = case
      when view_count > 0 then view_count
      when viewed_at is not null then 1
      else 0
    end
where last_served_at is null
   or (viewed_at is not null and last_viewed_at is null);

create index if not exists idx_clip_feed_impressions_user_served
  on public.clip_feed_impressions(user_id, last_served_at);


-- 2) Per-viewer round state. --------------------------------------------------

create table if not exists public.next_up_feed_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  round_started_at timestamptz not null default now(),
  round_number integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.next_up_feed_state enable row level security;

drop policy if exists "Users view own next up feed state" on public.next_up_feed_state;
create policy "Users view own next up feed state"
on public.next_up_feed_state for select to authenticated
using (auth.uid() = user_id);

-- Only the SECURITY DEFINER feed functions write this table.
revoke all on public.next_up_feed_state from anon, authenticated;
grant select on public.next_up_feed_state to authenticated;


-- 3) Eligibility, in one place. -----------------------------------------------
-- Every rule a clip must satisfy to be shown to _viewer_user_id. Used by the
-- feed for both the "remaining this round" check and the actual page, so the
-- two can never drift apart.
--
-- NOT granted to client roles: it is called only from inside the SECURITY
-- DEFINER feed function, which already scopes _viewer_user_id to auth.uid().

create or replace function public.next_up_eligible_clips(
  _viewer_user_id uuid,
  _gender_preference text default null
)
returns table (
  clip_id uuid,
  owner_user_id uuid,
  approved_at timestamptz,
  exposure_weight numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(c.user_id, pp.user_id),
    coalesce(c.reviewed_at, c.created_at),
    (
      1.0 + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
    ) * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end
  from public.clips c
  -- Resolve exactly one player profile per clip, preferring the direct
  -- player_id link, so the gender filter can never latch onto the wrong row.
  join lateral (
    select pp_any.*
    from public.player_profiles pp_any
    where (c.player_id is not null and pp_any.id = c.player_id)
       or (c.user_id is not null and pp_any.user_id = c.user_id)
    order by case when pp_any.id = c.player_id then 0 else 1 end, pp_any.id
    limit 1
  ) pp on true
  join public.profiles owner_profile
    on owner_profile.user_id = coalesce(c.user_id, pp.user_id)
  left join public.clip_exposure_state es on es.clip_id = c.id
  where
    -- Approved, real, still-published content only.
    c.review_status = 'approved'
    and c.visibility in ('public', 'restricted')
    and nullif(trim(coalesce(c.video_url, '')), '') is not null
    -- Restricted clips stay staff-only.
    and (
      c.visibility = 'public'
      or public.is_staff_member(_viewer_user_id)
      or exists (
        select 1
        from public.profiles vp
        where vp.user_id = _viewer_user_id
          and coalesce(vp.account_role, vp.account_type, vp.role::text) in (
            'team_club', 'head_coach_assistant', 'coach', 'scout', 'trainer',
            'academy_director', 'team_staff', 'school_team'
          )
      )
    )
    -- Active, non-deleted owner account.
    and coalesce(owner_profile.is_active, true)
    and owner_profile.deleted_at is null
    -- Never show the viewer their own clips in the discovery feed.
    and coalesce(c.user_id, pp.user_id) is distinct from _viewer_user_id
    -- Gender separation + every other account visibility rule.
    and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
    -- Optional scouting-only boys/girls narrowing.
    and (_gender_preference is null or pp.player_gender = _gender_preference)
$$;

revoke all on function public.next_up_eligible_clips(uuid, text) from public;
revoke all on function public.next_up_eligible_clips(uuid, text) from anon, authenticated;


-- 4) The feed. ----------------------------------------------------------------

drop function if exists public.get_next_up_feed(integer, text);
drop function if exists public.get_next_up_feed(integer);

create or replace function public.get_next_up_feed(
  _limit integer default 12,
  _gender_preference text default null,
  _restart boolean default false
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
  v_round_started_at timestamptz;
  v_has_remaining boolean := false;
  v_has_any boolean := false;
begin
  if v_user_id is null then
    raise exception 'Log in or sign up to watch Next Up Clips.';
  end if;

  -- The boys/girls selector is a scouting convenience for accounts that are
  -- already permitted to see both. Player accounts never reach this branch, so
  -- they can never widen their own access with it.
  select coalesce(p.account_role, p.account_type, p.role::text)
  into v_viewer_role
  from public.profiles p
  where p.user_id = v_user_id
  limit 1;

  if v_viewer_role in (
    'scout', 'team_staff', 'head_coach_assistant', 'coach', 'trainer',
    'academy_director', 'team_club', 'school_team'
  ) then
    v_effective_gender := case
      when lower(coalesce(_gender_preference, 'both')) in ('boy', 'boys', 'male') then 'boy'
      when lower(coalesce(_gender_preference, 'both')) in ('girl', 'girls', 'female') then 'girl'
      else null
    end;
  end if;

  insert into public.next_up_feed_state (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select s.round_started_at into v_round_started_at
  from public.next_up_feed_state s
  where s.user_id = v_user_id;

  -- Pull-to-refresh / first load: start a fresh round so the newest approved
  -- clips are at the top again instead of resuming mid-rotation.
  if coalesce(_restart, false) then
    v_round_started_at := now();
    update public.next_up_feed_state
    set round_started_at = v_round_started_at,
        round_number = round_number + 1,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  -- Existence probes rather than counts: these stop at the first matching row,
  -- so the feed never scans the whole clip catalogue to decide what to do.
  select exists (
    select 1
    from public.next_up_eligible_clips(v_user_id, v_effective_gender) e
    left join public.clip_feed_impressions fi
      on fi.user_id = v_user_id and fi.clip_id = e.clip_id
    where fi.clip_id is null
       or fi.last_served_at is null
       or fi.last_served_at < v_round_started_at
  )
  into v_has_remaining;

  if not v_has_remaining then
    select exists (
      select 1 from public.next_up_eligible_clips(v_user_id, v_effective_gender)
    )
    into v_has_any;

    -- Genuinely nothing this viewer is allowed to see -> real empty state.
    -- This is the ONLY path that returns zero rows.
    if not v_has_any then
      return;
    end if;

    -- Round exhausted: the viewer has watched everything available, so open a
    -- new round and replay the same real clips in a different order.
    v_round_started_at := now();
    update public.next_up_feed_state
    set round_started_at = v_round_started_at,
        round_number = round_number + 1,
        updated_at = now()
    where user_id = v_user_id;
  end if;

  return query
  with candidates as (
    select
      e.clip_id,
      e.owner_user_id,
      e.approved_at,
      e.exposure_weight,
      case
        when fi.clip_id is null then 0        -- never served (new / newly approved)
        when fi.viewed_at is null then 1      -- served but not watched yet
        else 2                                -- watched -> repeat rotation
      end as tier
    from public.next_up_eligible_clips(v_user_id, v_effective_gender) e
    left join public.clip_feed_impressions fi
      on fi.user_id = v_user_id and fi.clip_id = e.clip_id
    where fi.clip_id is null
       or fi.last_served_at is null
       or fi.last_served_at < v_round_started_at
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by c.tier
        order by
          -- Unwatched: newest approved first.
          case when c.tier < 2 then c.approved_at end desc nulls last,
          -- Repeats: weighted shuffle, re-drawn every round.
          case
            when c.tier = 2
            then (-ln(greatest(random(), 0.000001)) / greatest(c.exposure_weight, 0.1))
          end asc nulls last,
          c.clip_id
      ) as tier_rank
    from candidates c
  ),
  spread as (
    -- Round-robin by owner so the same player never stacks back-to-back while
    -- another eligible player is available.
    select
      r.*,
      row_number() over (
        partition by r.tier, r.owner_user_id
        order by r.tier_rank
      ) as owner_round
    from ranked r
  ),
  page as (
    select
      s.clip_id,
      row_number() over (order by s.tier, s.owner_round, s.tier_rank) as feed_position
    from spread s
    order by s.tier, s.owner_round, s.tier_rank
    limit v_limit
  ),
  served as (
    insert into public.clip_feed_impressions (
      user_id, clip_id, recommended_at, last_served_at, serve_count
    )
    select v_user_id, p.clip_id, now(), now(), 1
    from page p
    on conflict (user_id, clip_id) do update
    set last_served_at = now(),
        serve_count = public.clip_feed_impressions.serve_count + 1
    returning clip_id
  )
  -- Final permission revalidation: every row handed back is re-checked against
  -- approval, publication state and the viewer's gender/visibility rules, so a
  -- repeated clip can never escape the restrictions a fresh clip obeys.
  select c.*
  from page p
  join served sv on sv.clip_id = p.clip_id
  join public.clips c on c.id = p.clip_id
  where c.review_status = 'approved'
    and c.visibility in ('public', 'restricted')
    and public.can_view_account_content(
      coalesce(
        c.user_id,
        (
          select pp.user_id
          from public.player_profiles pp
          where pp.id = c.player_id
          limit 1
        )
      )
    )
  order by p.feed_position;
end;
$$;

revoke all on function public.get_next_up_feed(integer, text, boolean) from public;
revoke execute on function public.get_next_up_feed(integer, text, boolean) from anon;
grant execute on function public.get_next_up_feed(integer, text, boolean) to authenticated;


-- 5) Watch history: record the view, never drop the clip from eligibility. -----

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

  insert into public.clip_feed_impressions (
    user_id, clip_id, viewed_at, last_viewed_at, last_served_at, serve_count, view_count
  )
  values (auth.uid(), _clip_id, now(), now(), now(), 1, 1)
  on conflict (user_id, clip_id) do update
  set viewed_at = coalesce(public.clip_feed_impressions.viewed_at, now()),
      last_viewed_at = now(),
      view_count = public.clip_feed_impressions.view_count + 1;
end;
$$;

grant execute on function public.mark_next_up_clip_viewed(uuid) to authenticated;


-- 6) Invalidate a viewer's round when their own access rules change. ----------
-- Eligibility is recomputed from scratch on every call, so a permission change
-- is enforced immediately. Restarting the round on top of that guarantees the
-- viewer's next page is rebuilt from the top rather than resuming a rotation
-- that was planned under the old permissions.

create or replace function public.reset_next_up_feed_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.next_up_feed_state
  where user_id = coalesce(new.user_id, old.user_id);
  return null;
end;
$$;

drop trigger if exists reset_next_up_feed_round_on_gender_change on public.player_profiles;
create trigger reset_next_up_feed_round_on_gender_change
after update of player_gender on public.player_profiles
for each row
when (new.player_gender is distinct from old.player_gender)
execute function public.reset_next_up_feed_round();

drop trigger if exists reset_next_up_feed_round_on_account_change on public.profiles;
create trigger reset_next_up_feed_round_on_account_change
after update on public.profiles
for each row
when (
  new.account_role is distinct from old.account_role
  or new.account_type is distinct from old.account_type
  or new.role is distinct from old.role
  or new.is_active is distinct from old.is_active
  or new.next_up_gender_preference is distinct from old.next_up_gender_preference
)
execute function public.reset_next_up_feed_round();
