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

  -- Google/OAuth creates the auth login as soon as the user chooses a Google
  -- account. Do not create a Footy Status profile yet. The real app profile
  -- must only be created after the user submits the onboarding questionnaire.
  if selected_role is null and metadata_username = '' then
    return new;
  end if;

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
