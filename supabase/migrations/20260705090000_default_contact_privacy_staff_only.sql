-- Every new account defaults its contact information to Teams / Coaches / Staff Only.
-- This applies to every account type (player, coach, referee, team staff, club team,
-- school team, scout, parent, academy, and any future types) and to both
-- email/password and Google OAuth signups: both flows finish through
-- finish_account_onboarding(), which inserts into public.profiles and therefore
-- fires the trigger below. Users can still change the setting later.

alter table public.user_settings
  alter column show_contact_info set default 'staff_only';

-- Create the settings row (picking up the staff_only default) the moment an
-- account is created, so the default no longer depends on the client visiting
-- the settings page first.
create or replace function public.ensure_user_settings_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    insert into public.user_settings (user_id)
    values (new.user_id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_user_settings_on_profile_insert on public.profiles;
create trigger ensure_user_settings_on_profile_insert
  after insert on public.profiles
  for each row
  execute function public.ensure_user_settings_row();

-- Contact privacy now follows the account's own setting for every account type.
-- Team/club/school accounts are no longer forced public; they default to
-- staff_only like every other account and can opt into 'everyone' in settings.
-- Accounts without a settings row are treated as staff_only, matching the new default.
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
  if _target_user_id is null then
    return false;
  end if;

  if public.is_footy_status_global_admin() then
    return true;
  end if;

  if auth.uid() = _target_user_id then
    return true;
  end if;

  select us.show_contact_info
  into v_visibility
  from public.user_settings us
  where us.user_id = _target_user_id;

  v_visibility := coalesce(v_visibility, 'staff_only');

  if v_visibility = 'everyone' then
    return true;
  end if;

  if v_visibility = 'staff_only' then
    return public.is_contact_privileged_viewer(auth.uid());
  end if;

  return false;
end;
$$;

drop function if exists public.is_public_team_contact_account(uuid);

comment on function public.can_view_contact_info(uuid) is
  'Returns whether the current viewer may see the target account contact information. Defaults to Teams/Coaches/Staff Only for accounts without an explicit setting.';
