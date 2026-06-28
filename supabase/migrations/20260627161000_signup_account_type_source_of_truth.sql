-- Fix signup account type source of truth for Google OAuth and email signup.
-- New auth users must not be forced into player accounts by defaults.

alter type public.account_type add value if not exists 'referee';

alter table public.profiles
  add column if not exists account_type text,
  add column if not exists account_category text,
  add column if not exists account_role text;

alter table public.profiles
  alter column account_category drop default,
  alter column account_role drop default,
  alter column account_type drop default;

alter table public.profiles
  drop constraint if exists profiles_account_category_check,
  drop constraint if exists profiles_account_role_check,
  drop constraint if exists profiles_account_type_check;

alter table public.profiles
  add constraint profiles_account_category_check
  check (
    account_category is null
    or account_category in ('player', 'team_staff', 'parent', 'referee', 'official')
  ),
  add constraint profiles_account_role_check
  check (
    account_role is null
    or account_role in (
      'player',
      'team_club',
      'school_team',
      'head_coach_assistant',
      'coach',
      'scout',
      'trainer',
      'academy_director',
      'team_staff',
      'parent',
      'referee',
      'footy_status_official',
      'admin',
      'official'
    )
  ),
  add constraint profiles_account_type_check
  check (
    account_type is null
    or account_type in (
      'player',
      'team_club',
      'school_team',
      'head_coach_assistant',
      'coach',
      'scout',
      'trainer',
      'academy_director',
      'team_staff',
      'parent',
      'referee',
      'footy_status_official',
      'admin',
      'official'
    )
  );

create or replace function public.normalize_signup_account_role(_raw_role text, _staff_type text default null)
returns text
language plpgsql
immutable
as $$
declare
  v_role text := lower(trim(coalesce(_raw_role, '')));
  v_staff text := lower(trim(coalesce(_staff_type, '')));
begin
  if v_role in ('', 'null', 'undefined') then
    return null;
  end if;

  if v_role = 'team_staff' and v_staff <> '' then
    v_role := v_staff;
  end if;

  return case v_role
    when 'player' then 'player'
    when 'parent' then 'parent'
    when 'guardian' then 'parent'
    when 'referee' then 'referee'
    when 'official' then 'footy_status_official'
    when 'admin' then 'footy_status_official'
    when 'footy_status_official' then 'footy_status_official'
    when 'footy status official' then 'footy_status_official'
    when 'team' then 'team_club'
    when 'club' then 'team_club'
    when 'club_team' then 'team_club'
    when 'team_club' then 'team_club'
    when 'school' then 'school_team'
    when 'school_team' then 'school_team'
    when 'coach' then 'head_coach_assistant'
    when 'head_coach_assistant' then 'head_coach_assistant'
    when 'trainer' then 'trainer'
    when 'scout' then 'scout'
    when 'academy_director' then 'academy_director'
    else v_role
  end;
end;
$$;

create or replace function public.account_category_for_role(_account_role text)
returns text
language sql
immutable
as $$
  select case
    when _account_role = 'player' then 'player'
    when _account_role = 'parent' then 'parent'
    when _account_role = 'referee' then 'referee'
    when _account_role in ('footy_status_official', 'admin', 'official') then 'official'
    when _account_role is null then null
    else 'team_staff'
  end;
$$;

create or replace function public.legacy_role_for_account_role(_account_role text)
returns public.account_type
language plpgsql
immutable
as $$
begin
  return case _account_role
    when 'player' then 'player'::public.account_type
    when 'parent' then 'parent'::public.account_type
    when 'referee' then 'referee'::public.account_type
    when 'team_club' then 'team'::public.account_type
    when 'school_team' then 'team'::public.account_type
    when 'head_coach_assistant' then 'coach'::public.account_type
    when 'coach' then 'coach'::public.account_type
    when 'scout' then 'scout'::public.account_type
    when 'trainer' then 'trainer'::public.account_type
    when 'academy_director' then 'academy_director'::public.account_type
    else null
  end;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata_username text;
  chosen_username text;
  seed_value text;
  selected_role text;
  selected_category text;
  selected_legacy_role public.account_type;
begin
  metadata_username := public.normalize_username(new.raw_user_meta_data ->> 'username');
  selected_role := public.normalize_signup_account_role(
    coalesce(
      new.raw_user_meta_data ->> 'account_role',
      new.raw_user_meta_data ->> 'account_type',
      new.raw_user_meta_data ->> 'selected_account_type',
      new.raw_user_meta_data ->> 'role'
    ),
    new.raw_user_meta_data ->> 'staff_type'
  );
  selected_category := public.account_category_for_role(selected_role);
  selected_legacy_role := public.legacy_role_for_account_role(selected_role);

  seed_value := coalesce(
    nullif(metadata_username, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'user'
  );

  if public.is_valid_username(metadata_username) then
    chosen_username := public.generate_unique_username(metadata_username, new.id);
  else
    chosen_username := public.generate_unique_username(seed_value, new.id);
  end if;

  update public.profiles
  set email = coalesce(public.profiles.email, new.email),
      full_name = coalesce(public.profiles.full_name, new.raw_user_meta_data ->> 'full_name'),
      username = coalesce(public.profiles.username, chosen_username),
      username_last_changed_at = public.profiles.username_last_changed_at,
      account_category = coalesce(public.profiles.account_category, selected_category),
      account_role = coalesce(public.profiles.account_role, selected_role),
      account_type = coalesce(public.profiles.account_type, selected_role),
      role = coalesce(public.profiles.role, selected_legacy_role)
  where user_id = new.id;

  if found then
    return new;
  end if;

  begin
    insert into public.profiles (
      user_id,
      email,
      full_name,
      username,
      username_last_changed_at,
      account_category,
      account_role,
      account_type,
      role
    )
    values (
      new.id,
      new.email,
      new.raw_user_meta_data ->> 'full_name',
      chosen_username,
      case when public.is_valid_username(metadata_username) then now() else null end,
      selected_category,
      selected_role,
      selected_role,
      selected_legacy_role
    );
  exception
    when unique_violation then
      chosen_username := public.generate_unique_username(seed_value || substring(new.id::text from 1 for 8), new.id);

      insert into public.profiles (
        user_id,
        email,
        full_name,
        username,
        username_last_changed_at,
        account_category,
        account_role,
        account_type,
        role
      )
      values (
        new.id,
        new.email,
        new.raw_user_meta_data ->> 'full_name',
        chosen_username,
        null,
        selected_category,
        selected_role,
        selected_role,
        selected_legacy_role
      );
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Keep profile role fields synchronized when the app writes account_role/account_type.
create or replace function public.sync_profile_account_type_fields()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  v_role := public.normalize_signup_account_role(coalesce(new.account_role, new.account_type, new.role::text), null);

  if v_role is not null then
    new.account_role := v_role;
    new.account_type := v_role;
    new.account_category := coalesce(public.account_category_for_role(v_role), new.account_category);
    new.role := coalesce(public.legacy_role_for_account_role(v_role), new.role);
  end if;

  return new;
end;
$$;

drop trigger if exists sync_profile_account_type_fields_trigger on public.profiles;
create trigger sync_profile_account_type_fields_trigger
  before insert or update of account_role, account_type, role on public.profiles
  for each row
  execute function public.sync_profile_account_type_fields();

-- Repair rows that can be confidently identified from account-specific data.
update public.profiles p
set account_category = 'referee',
    account_role = 'referee',
    account_type = 'referee',
    role = 'referee'::public.account_type,
    updated_at = now()
where (
    p.referee_certification_level is not null
    or p.referee_license_number is not null
    or p.referee_certifying_organization is not null
    or p.referee_years_experience is not null
    or exists (select 1 from public.referee_match_claims r where r.referee_user_id = p.user_id)
  );

update public.profiles p
set account_category = 'parent',
    account_role = 'parent',
    account_type = 'parent',
    role = 'parent'::public.account_type,
    updated_at = now()
where exists (select 1 from public.parent_profiles pp where pp.user_id = p.user_id);

update public.profiles p
set account_category = 'team_staff',
    account_role = case
      when sp.role = 'academy_director' then 'academy_director'
      when sp.role = 'scout' then 'scout'
      when sp.role = 'trainer' then 'trainer'
      else 'head_coach_assistant'
    end,
    account_type = case
      when sp.role = 'academy_director' then 'academy_director'
      when sp.role = 'scout' then 'scout'
      when sp.role = 'trainer' then 'trainer'
      else 'head_coach_assistant'
    end,
    role = sp.role,
    updated_at = now()
from public.staff_profiles sp
where sp.user_id = p.user_id;

update public.profiles p
set account_category = 'team_staff',
    account_role = case
      when tp.team_type = 'school' then 'school_team'
      else 'team_club'
    end,
    account_type = case
      when tp.team_type = 'school' then 'school_team'
      else 'team_club'
    end,
    role = 'team'::public.account_type,
    updated_at = now()
from public.team_profiles tp
where tp.user_id = p.user_id;

update public.profiles p
set account_category = 'player',
    account_role = 'player',
    account_type = 'player',
    role = 'player'::public.account_type,
    updated_at = now()
where exists (select 1 from public.player_profiles pp where pp.user_id = p.user_id)
  and not exists (select 1 from public.staff_profiles sp where sp.user_id = p.user_id)
  and not exists (select 1 from public.parent_profiles pap where pap.user_id = p.user_id)
  and not exists (select 1 from public.team_profiles tp where tp.user_id = p.user_id)
  and not (
    p.referee_certification_level is not null
    or p.referee_license_number is not null
    or p.referee_certifying_organization is not null
    or p.referee_years_experience is not null
  );
