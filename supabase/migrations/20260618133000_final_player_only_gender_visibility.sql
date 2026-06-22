-- Final rule:
-- Only player accounts are gender-restricted.
-- Every non-player account type can view both boy and girl player content.

create or replace function public.current_account_is_player()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (
        coalesce(p.account_role::text, '') = 'player'
        or coalesce(p.account_category::text, '') = 'player'
        or coalesce(p.role::text, '') = 'player'
      )
  );
$$;

create or replace function public.can_view_player(_target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer_gender text;
  target_gender text;
begin
  -- Gender separation applies only to signed-in player accounts.
  if auth.uid() is null then
    return true;
  end if;

  if auth.uid() = _target_user_id then
    return true;
  end if;

  if public.is_footy_status_global_admin() then
    return true;
  end if;

  if not public.current_account_is_player() then
    return true;
  end if;

  if _target_user_id is null then
    return false;
  end if;

  select pp.player_gender
  into viewer_gender
  from public.player_profiles pp
  where pp.user_id = auth.uid()
  limit 1;

  if viewer_gender is null then
    return false;
  end if;

  select pp.player_gender
  into target_gender
  from public.player_profiles pp
  where pp.user_id = _target_user_id
  limit 1;

  return target_gender is not null
    and target_gender = viewer_gender;
end;
$$;

create or replace function public.can_view_player_profile(
  _target_player_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _target_player_profile_id is null then false
    when not public.current_account_is_player() then true
    else coalesce(
      (
        select public.can_view_player(pp.user_id)
        from public.player_profiles pp
        where pp.id = _target_player_profile_id
        limit 1
      ),
      (
        select public.can_view_player(p.user_id)
        from public.players p
        where p.id = _target_player_profile_id
        limit 1
      ),
      false
    )
  end;
$$;

create or replace function public.can_view_account_content(
  _target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when _target_user_id is null then false
    when not exists (
      select 1
      from public.profiles p
      where p.user_id = _target_user_id
        and (
          coalesce(p.account_role::text, '') = 'player'
          or coalesce(p.account_category::text, '') = 'player'
          or coalesce(p.role::text, '') = 'player'
        )
    ) then true
    else public.can_view_player(_target_user_id)
  end;
$$;

alter table public.profiles enable row level security;

drop policy if exists "player account gender visibility" on public.profiles;
create policy "player account gender visibility"
  on public.profiles
  as restrictive
  for select
  to public
  using (public.can_view_account_content(user_id));

alter table public.user_contacts enable row level security;

drop policy if exists "player contact gender visibility"
on public.user_contacts;

create policy "player contact gender visibility"
  on public.user_contacts
  as restrictive
  for select
  to public
  using (public.can_view_account_content(user_id));

alter table public.player_profiles enable row level security;

drop policy if exists "player gender separation select" on public.player_profiles;
create policy "player gender separation select"
  on public.player_profiles
  as restrictive
  for select
  to public
  using (public.can_view_player(user_id));

alter table public.players enable row level security;

drop policy if exists "legacy player gender separation select" on public.players;
create policy "legacy player gender separation select"
  on public.players
  as restrictive
  for select
  to public
  using (
    user_id is not null
    and public.can_view_player(user_id)
  );

alter table public.clips enable row level security;

drop policy if exists "clip gender separation select" on public.clips;
create policy "clip gender separation select"
  on public.clips
  as restrictive
  for select
  to public
  using (
    public.can_view_player(
      coalesce(
        user_id,
        (
          select p.user_id
          from public.players p
          where p.id = clips.player_id
          limit 1
        )
      )
    )
  );

alter table public.player_team_memberships enable row level security;

drop policy if exists "membership gender separation select"
on public.player_team_memberships;

create policy "membership gender separation select"
  on public.player_team_memberships
  as restrictive
  for select
  to public
  using (public.can_view_player(player_user_id));

alter table public.team_player_invites enable row level security;

drop policy if exists "invite player gender visibility"
on public.team_player_invites;

create policy "invite player gender visibility"
  on public.team_player_invites
  as restrictive
  for select
  to public
  using (public.can_view_player(player_user_id));

alter table public.team_join_requests enable row level security;

drop policy if exists "join request player gender visibility"
on public.team_join_requests;

create policy "join request player gender visibility"
  on public.team_join_requests
  as restrictive
  for select
  to public
  using (public.can_view_player(player_user_id));

alter table public.player_statistics enable row level security;

drop policy if exists "player statistics gender visibility"
on public.player_statistics;

create policy "player statistics gender visibility"
  on public.player_statistics
  as restrictive
  for select
  to public
  using (
    public.can_view_player(
      (
        select p.user_id
        from public.players p
        where p.id = player_statistics.player_id
        limit 1
      )
    )
  );

alter table public.club_history
  add column if not exists player_profile_id uuid
    references public.player_profiles(id) on delete cascade;

alter table public.club_history enable row level security;

drop policy if exists "club history gender visibility"
on public.club_history;

create policy "club history gender visibility"
  on public.club_history
  as restrictive
  for select
  to public
  using (
    public.can_view_player(
      coalesce(
        (
          select pp.user_id
          from public.player_profiles pp
          where pp.id = club_history.player_profile_id
          limit 1
        ),
        (
          select p.user_id
          from public.players p
          where p.id = club_history.player_id
          limit 1
        )
      )
    )
  );

alter table public.match_events enable row level security;

drop policy if exists "match event player gender visibility"
on public.match_events;

create policy "match event player gender visibility"
  on public.match_events
  as restrictive
  for select
  to public
  using (
    (
      player_profile_id is null
      and player_user_id is null
    )
    or public.can_view_player(
      coalesce(
        player_user_id,
        (
          select pp.user_id
          from public.player_profiles pp
          where pp.id = match_events.player_profile_id
          limit 1
        )
      )
    )
  );

alter table public.match_comments enable row level security;

drop policy if exists "match comment player gender visibility"
on public.match_comments;

create policy "match comment player gender visibility"
  on public.match_comments
  as restrictive
  for select
  to public
  using (public.can_view_account_content(user_id));

alter table public.assist_claims enable row level security;

drop policy if exists "assist claim player gender visibility"
on public.assist_claims;

create policy "assist claim player gender visibility"
  on public.assist_claims
  as restrictive
  for select
  to public
  using (public.can_view_player(claimant_user_id));

-- Make existing views obey the caller's RLS policies.
-- Each statement is guarded because older databases may not have every view.
do $$
begin
  if to_regclass('public.player_profiles_public') is not null then
    execute 'alter view public.player_profiles_public set (security_invoker = true)';
  end if;

  if to_regclass('public.current_player_statistics') is not null then
    execute 'alter view public.current_player_statistics set (security_invoker = true)';
  end if;

  if to_regclass('public.player_club_history') is not null then
    execute 'alter view public.player_club_history set (security_invoker = true)';
  end if;

  if to_regclass('public.match_event_details') is not null then
    execute 'alter view public.match_event_details set (security_invoker = true)';
  end if;

  if to_regclass('public.match_comment_details') is not null then
    execute 'alter view public.match_comment_details set (security_invoker = true)';
  end if;
end;
$$;

grant execute on function public.current_account_is_player() to anon, authenticated;
grant execute on function public.can_view_player(uuid) to anon, authenticated;
grant execute on function public.can_view_player_profile(uuid) to anon, authenticated;
grant execute on function public.can_view_account_content(uuid) to anon, authenticated;
