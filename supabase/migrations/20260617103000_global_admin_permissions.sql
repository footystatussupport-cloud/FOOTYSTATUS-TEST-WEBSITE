create table if not exists public.global_admin_users (
  user_id uuid primary key,
  email text not null unique,
  role text not null default 'footy_status_admin',
  created_at timestamptz not null default now(),
  constraint global_admin_users_role_check check (role = 'footy_status_admin'),
  constraint global_admin_users_official_email_check check (lower(email) = 'footystatusofficial@gmail.com')
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid,
  action text not null,
  affected_table text,
  affected_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.teams
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.clubs
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.leagues
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

insert into public.global_admin_users (user_id, email)
select user_id, lower(email)
from public.profiles
where lower(coalesce(email, '')) = 'footystatusofficial@gmail.com'
on conflict (user_id) do update set email = excluded.email;

create or replace function public.is_footy_status_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatusofficial@gmail.com'
    and exists (
      select 1
      from public.global_admin_users gau
      where gau.user_id = auth.uid()
        and gau.role = 'footy_status_admin'
        and lower(gau.email) = 'footystatusofficial@gmail.com'
    );
$$;

create or replace function public.seed_official_footy_status_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.global_admin_users (user_id, email)
  select user_id, lower(email)
  from public.profiles
  where user_id = auth.uid()
    and lower(coalesce(email, auth.jwt() ->> 'email', '')) = 'footystatusofficial@gmail.com'
  on conflict (user_id) do update set email = excluded.email;

  if not exists (select 1 from public.global_admin_users where user_id = auth.uid()) then
    raise exception 'Only the official Footy Status account can become global admin';
  end if;
end;
$$;

create or replace function public.log_global_admin_action(
  _action text,
  _affected_table text default null,
  _affected_id text default null,
  _payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_log (admin_user_id, action, affected_table, affected_id, payload)
  values (auth.uid(), _action, _affected_table, _affected_id, coalesce(_payload, '{}'::jsonb));
end;
$$;

create or replace function public.perform_global_admin_action(_action text, _payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_user_id uuid;
  v_player_profile_id uuid;
  v_coach_user_id uuid;
  v_team_id uuid;
  v_club_team_id uuid;
  v_league_id uuid;
  v_target_user_id uuid;
  v_target_id uuid;
  v_table text;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the official Footy Status account can perform this admin action';
  end if;

  if _action = 'update_profile' then
    v_target_user_id := (_payload ->> 'user_id')::uuid;
    update public.profiles
    set
      full_name = coalesce(_payload ->> 'full_name', full_name),
      bio = coalesce(_payload ->> 'bio', bio),
      avatar_url = coalesce(_payload ->> 'avatar_url', avatar_url),
      club_name = coalesce(_payload ->> 'club_name', club_name),
      updated_at = now()
    where user_id = v_target_user_id;
    perform public.log_global_admin_action(_action, 'profiles', v_target_user_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'deactivate_account' then
    v_target_user_id := (_payload ->> 'user_id')::uuid;
    update public.profiles
    set is_active = false, deleted_at = now(), deleted_by = auth.uid()
    where user_id = v_target_user_id;
    perform public.log_global_admin_action(_action, 'profiles', v_target_user_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'link_player_to_team' then
    v_player_user_id := nullif(_payload ->> 'player_user_id', '')::uuid;
    v_player_profile_id := nullif(_payload ->> 'player_profile_id', '')::uuid;
    v_team_id := (_payload ->> 'team_id')::uuid;
    v_club_team_id := nullif(_payload ->> 'club_team_id', '')::uuid;
    v_league_id := nullif(_payload ->> 'league_id', '')::uuid;

    insert into public.player_team_memberships (
      player_user_id,
      player_profile_id,
      team_id,
      club_team_id,
      league_id,
      age_group,
      status,
      approved_at,
      approved_by
    )
    values (
      v_player_user_id,
      v_player_profile_id,
      v_team_id,
      v_club_team_id,
      v_league_id,
      nullif(_payload ->> 'age_group', ''),
      'approved',
      now(),
      auth.uid()
    );
    perform public.log_global_admin_action(_action, 'player_team_memberships', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'remove_player_from_team' then
    v_target_id := (_payload ->> 'membership_id')::uuid;
    update public.player_team_memberships
    set status = 'removed'
    where id = v_target_id;
    perform public.log_global_admin_action(_action, 'player_team_memberships', v_target_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'link_coach_to_team' then
    v_coach_user_id := (_payload ->> 'coach_user_id')::uuid;
    v_team_id := (_payload ->> 'team_id')::uuid;
    v_club_team_id := nullif(_payload ->> 'club_team_id', '')::uuid;

    insert into public.coach_staff_team_memberships (
      coach_user_id,
      team_id,
      club_team_id,
      staff_role,
      status,
      approved_at,
      approved_by
    )
    values (
      v_coach_user_id,
      v_team_id,
      v_club_team_id,
      coalesce(nullif(_payload ->> 'staff_role', ''), 'Coach / Staff'),
      'approved',
      now(),
      auth.uid()
    );
    perform public.log_global_admin_action(_action, 'coach_staff_team_memberships', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'remove_coach_from_team' then
    v_target_id := (_payload ->> 'membership_id')::uuid;
    update public.coach_staff_team_memberships
    set status = 'removed'
    where id = v_target_id;
    perform public.log_global_admin_action(_action, 'coach_staff_team_memberships', v_target_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'link_team_to_league' then
    v_team_id := (_payload ->> 'team_id')::uuid;
    v_league_id := (_payload ->> 'league_id')::uuid;
    insert into public.league_teams (league_id, team_id)
    values (v_league_id, v_team_id)
    on conflict do nothing;
    update public.teams set league_id = v_league_id where id = v_team_id;
    perform public.log_global_admin_action(_action, 'league_teams', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'remove_team_from_league' then
    v_team_id := (_payload ->> 'team_id')::uuid;
    v_league_id := (_payload ->> 'league_id')::uuid;
    delete from public.league_teams where league_id = v_league_id and team_id = v_team_id;
    update public.teams set league_id = null where id = v_team_id and league_id = v_league_id;
    perform public.log_global_admin_action(_action, 'league_teams', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'soft_delete_record' then
    v_table := _payload ->> 'table';
    v_target_id := (_payload ->> 'id')::uuid;
    if v_table not in ('teams', 'clubs', 'leagues') then
      raise exception 'This table cannot be deleted through this action';
    end if;
    execute format('update public.%I set is_active = false, deleted_at = now(), deleted_by = auth.uid() where id = $1', v_table)
    using v_target_id;
    perform public.log_global_admin_action(_action, v_table, v_target_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown global admin action: %', _action;
end;
$$;

grant execute on function public.is_footy_status_global_admin() to authenticated;
grant execute on function public.seed_official_footy_status_admin() to authenticated;
grant execute on function public.perform_global_admin_action(text, jsonb) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'player_profiles',
    'team_profiles',
    'staff_profiles',
    'parent_profiles',
    'players',
    'teams',
    'clubs',
    'club_teams',
    'leagues',
    'league_teams',
    'matches',
    'match_events',
    'player_team_memberships',
    'coach_staff_team_memberships',
    'team_player_invites',
    'team_join_requests',
    'coach_staff_team_invites',
    'coach_staff_join_requests',
    'clips',
    'club_news_posts',
    'referee_match_claims'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = t
          and policyname = 'Footy Status global admin full access'
      ) then
        execute format(
          'create policy "Footy Status global admin full access" on public.%I for all to authenticated using (public.is_footy_status_global_admin()) with check (public.is_footy_status_global_admin())',
          t
        );
      end if;
    end if;
  end loop;
end $$;
