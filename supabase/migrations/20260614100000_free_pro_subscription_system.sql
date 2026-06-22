alter table public.profiles
  add column if not exists account_tier text not null default 'free',
  add column if not exists pro_expires_at timestamptz,
  add column if not exists pro_started_at timestamptz,
  add column if not exists clip_deletions_used integer not null default 0;

alter table public.profiles
  add constraint profiles_account_tier_check
  check (account_tier in ('free', 'pro_annual', 'pro_lifetime'))
  not valid;

alter table public.profiles
  validate constraint profiles_account_tier_check;

update public.profiles
set
  account_tier = case when is_pro then 'pro_lifetime' else coalesce(account_tier, 'free') end,
  pro_started_at = case when is_pro and pro_started_at is null then now() else pro_started_at end,
  pro_expires_at = case when account_tier = 'pro_lifetime' then null else pro_expires_at end,
  clip_deletions_used = coalesce(clip_deletions_used, 0);

create table if not exists public.profile_views (
  id uuid primary key default gen_random_uuid(),
  viewed_user_id uuid not null,
  viewer_user_id uuid,
  viewer_role text not null default 'player',
  created_at timestamptz not null default now()
);

alter table public.profile_views enable row level security;

drop policy if exists "Users can read their own profile analytics" on public.profile_views;
create policy "Users can read their own profile analytics"
on public.profile_views
for select
using (auth.uid() = viewed_user_id);

drop policy if exists "Signed in users can record profile views" on public.profile_views;
create policy "Signed in users can record profile views"
on public.profile_views
for insert
with check (auth.uid() = viewer_user_id);

create or replace function public.is_active_pro(_account_tier text, _pro_expires_at timestamptz)
returns boolean
language sql
stable
as $$
  select
    case
      when _account_tier = 'pro_lifetime' then true
      when _account_tier = 'pro_annual' and _pro_expires_at > now() then true
      else false
    end;
$$;

create or replace function public.restore_pro_clips(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clips
  set visibility = 'public'
  where user_id = _user_id
    and visibility = 'inactive';
end;
$$;

create or replace function public.apply_free_clip_visibility(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with ranked as (
    select id, row_number() over (order by created_at asc) as rn
    from public.clips
    where user_id = _user_id
      and visibility <> 'inactive'
  )
  update public.clips c
  set visibility = case when ranked.rn <= 3 then 'public' else 'inactive' end
  from ranked
  where c.id = ranked.id;
end;
$$;

create or replace function public.upgrade_to_pro(_user_id uuid, _plan_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _plan_type = 'lifetime' then
    update public.profiles
    set account_tier = 'pro_lifetime',
        is_pro = true,
        pro_started_at = now(),
        pro_expires_at = null,
        updated_at = now()
    where user_id = _user_id;
  elsif _plan_type = 'annual' then
    update public.profiles
    set account_tier = 'pro_annual',
        is_pro = true,
        pro_started_at = now(),
        pro_expires_at = now() + interval '1 year',
        updated_at = now()
    where user_id = _user_id;
  else
    raise exception 'Unknown Pro plan type: %', _plan_type;
  end if;

  perform public.restore_pro_clips(_user_id);
end;
$$;

create or replace function public.downgrade_expired_annual_pro_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
  downgraded_count integer := 0;
begin
  for profile_row in
    select user_id from public.profiles
    where account_tier = 'pro_annual'
      and pro_expires_at < now()
  loop
    update public.profiles
    set account_tier = 'free',
        is_pro = false,
        pro_expires_at = null,
        updated_at = now()
    where user_id = profile_row.user_id;

    perform public.apply_free_clip_visibility(profile_row.user_id);
    downgraded_count := downgraded_count + 1;
  end loop;

  return downgraded_count;
end;
$$;
