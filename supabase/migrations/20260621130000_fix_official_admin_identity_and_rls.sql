-- Repair and harden Footy Status Official identity recognition.
-- The authenticated auth.users email is authoritative, not profile ownership or a cached JWT.

alter table public.global_admin_users
  drop constraint if exists global_admin_users_official_email_check;

alter table public.global_admin_users
  add constraint global_admin_users_official_email_check
  check (lower(email) = 'footystatussupport@gmail.com');

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('footy_status_role', 'footy_status_admin'),
    updated_at = now()
where lower(coalesce(email, '')) = 'footystatussupport@gmail.com';
insert into public.global_admin_users (user_id, email, role)
select au.id, lower(au.email), 'footy_status_admin'
from auth.users au
where lower(coalesce(au.email, '')) = 'footystatussupport@gmail.com'
on conflict (user_id) do update
set email = excluded.email,
    role = 'footy_status_admin';

create or replace function public.is_footy_status_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users au
    where au.id = auth.uid()
      and lower(coalesce(au.email, '')) = 'footystatussupport@gmail.com'
  );
$$;

create or replace function public.seed_official_footy_status_admin()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  select lower(coalesce(au.email, ''))
  into v_email
  from auth.users au
  where au.id = auth.uid();

  if v_email <> 'footystatussupport@gmail.com' then
    raise exception 'Only the Footy Status Official account can become global admin';
  end if;

  update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('footy_status_role', 'footy_status_admin'),
    updated_at = now()
where lower(coalesce(email, '')) = 'footystatussupport@gmail.com';
insert into public.global_admin_users (user_id, email, role)
  values (auth.uid(), v_email, 'footy_status_admin')
  on conflict (user_id) do update
  set email = excluded.email,
      role = 'footy_status_admin';
end;
$$;

create or replace function public.debug_footy_status_admin_access()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_email text;
  v_profile_email text;
  v_row_exists boolean;
begin
  select lower(coalesce(au.email, ''))
  into v_auth_email
  from auth.users au
  where au.id = auth.uid();

  select lower(coalesce(p.email, ''))
  into v_profile_email
  from public.profiles p
  where p.user_id = auth.uid();

  select exists (
    select 1
    from public.global_admin_users gau
    where gau.user_id = auth.uid()
      and gau.role = 'footy_status_admin'
  ) into v_row_exists;

  return jsonb_build_object(
    'authenticated_user_id', auth.uid(),
    'jwt_email', lower(coalesce(auth.jwt() ->> 'email', '')),
    'session_admin_role', coalesce(auth.jwt() -> 'app_metadata' ->> 'footy_status_role', ''),
    'auth_user_email', v_auth_email,
    'profile_email', v_profile_email,
    'admin_assignment_exists', v_row_exists,
    'recognized_as_official', public.is_footy_status_global_admin()
  );
end;
$$;

revoke all on function public.debug_footy_status_admin_access() from public;
grant execute on function public.debug_footy_status_admin_access() to authenticated;
grant execute on function public.seed_official_footy_status_admin() to authenticated;
grant execute on function public.is_footy_status_global_admin() to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'players', 'player_profiles', 'player_statistics',
    'staff_profiles', 'parent_profiles', 'team_profiles', 'user_contacts',
    'clips', 'club_history', 'player_team_memberships',
    'coach_staff_team_memberships', 'parent_player_links',
    'teams', 'clubs', 'club_teams', 'leagues',
    'account_strikes', 'temporary_bans', 'content_reports',
    'content_report_actions', 'admin_audit_log'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('drop policy if exists "Footy Status Official full access" on public.%I', v_table);
      execute format(
        'create policy "Footy Status Official full access" on public.%I
         for all to authenticated
         using (public.is_footy_status_global_admin())
         with check (public.is_footy_status_global_admin())',
        v_table
      );
    end if;
  end loop;
end;
$$;

create or replace function public.can_view_contact_info(_target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visibility text;
begin
  if _target_user_id is null then return false; end if;
  if public.is_footy_status_global_admin() then return true; end if;
  if auth.uid() = _target_user_id then return true; end if;
  if public.is_public_team_contact_account(_target_user_id) then return true; end if;

  select coalesce(us.show_contact_info, 'everyone')
  into v_visibility
  from public.user_settings us
  where us.user_id = _target_user_id;

  v_visibility := coalesce(v_visibility, 'everyone');
  if v_visibility = 'everyone' then return true; end if;
  if v_visibility = 'staff_only' then
    return public.is_contact_privileged_viewer(auth.uid());
  end if;
  return false;
end;
$$;