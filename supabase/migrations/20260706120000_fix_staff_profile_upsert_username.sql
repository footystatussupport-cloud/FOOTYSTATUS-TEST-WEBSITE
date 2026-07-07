-- Fix "Username is required" when scouts / coaches / staff (and team accounts)
-- save profile edits.
--
-- Root cause: save_staff_account_profile and save_team_account_profile ran
--   INSERT INTO public.profiles (...) ON CONFLICT (user_id) DO UPDATE ...
-- without a username column. BEFORE INSERT triggers fire on the proposed row
-- BEFORE conflict resolution, so enforce_profile_username_rules saw a NULL
-- username on its INSERT branch and raised "Username is required" -- even
-- though the statement would have become an UPDATE that never touches the
-- existing username.
--
-- Fixes:
--  1) The trigger now auto-generates a valid unique username for system
--     INSERTs that arrive without one (signup still collects and validates a
--     real username explicitly; this only protects upsert/recovery paths).
--     For genuine upserts the generated value is discarded by the conflict
--     UPDATE, preserving the account's existing username.
--  2) Both RPCs now update-first and only insert (with a generated username)
--     when no profile row exists, so they never rely on trigger behavior.

-- 1) Trigger hardening.
create or replace function public.enforce_profile_username_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text;
begin
  normalized_username := public.normalize_username(new.username);

  -- Profile edits that don't touch the username keep the existing one.
  if tg_op = 'UPDATE' and normalized_username = '' then
    new.username := old.username;
    return new;
  end if;

  -- System inserts (upserts, recovery paths) that arrive without a username
  -- get a valid unique one instead of failing. Signup flows always provide
  -- an explicitly chosen username before this point.
  if tg_op = 'INSERT' and normalized_username = '' then
    new.username := public.generate_unique_username(
      coalesce(
        nullif(trim(coalesce(new.full_name, '')), ''),
        nullif(trim(coalesce(new.club_name, '')), ''),
        split_part(coalesce(new.email, ''), '@', 1),
        'user'
      ),
      new.user_id
    );
    normalized_username := new.username;
  end if;

  if normalized_username = '' then
    raise exception 'Username is required';
  end if;

  if char_length(normalized_username) > 20 then
    raise exception 'This username exceeds the 20-character limit.';
  end if;

  if normalized_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain letters, numbers, and underscores';
  end if;

  if public.username_contains_banned_word(normalized_username) then
    raise exception 'This username contains prohibited language.';
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(normalized_username)
    ) then
      raise exception 'Username is already taken';
    end if;
  else
    if exists (
      select 1
      from public.profiles p
      where lower(p.username) = lower(normalized_username)
        and p.id is distinct from old.id
    ) then
      raise exception 'Username is already taken';
    end if;
  end if;

  new.username := normalized_username;

  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    if old.username_last_changed_at is not null
      and old.username_last_changed_at > now() - interval '14 days' then
      raise exception 'You can only change your username once every 14 days';
    end if;

    new.username_last_changed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_profile_username_rules_trigger on public.profiles;
create trigger enforce_profile_username_rules_trigger
  before insert or update of username on public.profiles
  for each row
  execute function public.enforce_profile_username_rules();

-- 2) save_staff_account_profile: update-first, never a blind profiles upsert.
create or replace function public.save_staff_account_profile(
  _role text,
  _full_name text,
  _team_organization_name text,
  _city text,
  _coaching_level text,
  _years_experience integer,
  _coaching_licenses text[],
  _age_groups_coached text[],
  _contact_email text,
  _contact_phone text,
  _previous_teams text[],
  _notable_achievements text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.account_type := _role::public.account_type;
  v_account_role text := case when _role = 'coach' then 'head_coach_assistant' else _role end;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  update public.profiles
  set full_name = _full_name,
      email = _contact_email,
      account_category = 'team_staff',
      account_role = v_account_role,
      role = v_role,
      updated_at = now()
  where user_id = v_user_id;

  if not found then
    insert into public.profiles (user_id, full_name, email, username, account_category, account_role, role)
    values (
      v_user_id,
      _full_name,
      _contact_email,
      public.generate_unique_username(
        coalesce(nullif(trim(coalesce(_full_name, '')), ''), split_part(coalesce(_contact_email, ''), '@', 1), 'user'),
        v_user_id
      ),
      'team_staff',
      v_account_role,
      v_role
    );
  end if;

  insert into public.staff_profiles (
    user_id,
    full_name,
    role,
    team_organization_name,
    city,
    coaching_level,
    years_experience,
    coaching_licenses,
    age_groups_coached,
    contact_email,
    contact_phone,
    previous_teams,
    notable_achievements
  )
  values (
    v_user_id,
    _full_name,
    v_role,
    _team_organization_name,
    _city,
    nullif(_coaching_level, '')::public.coaching_level,
    _years_experience,
    _coaching_licenses,
    _age_groups_coached,
    _contact_email,
    _contact_phone,
    _previous_teams,
    _notable_achievements
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    team_organization_name = excluded.team_organization_name,
    city = excluded.city,
    coaching_level = excluded.coaching_level,
    years_experience = excluded.years_experience,
    coaching_licenses = excluded.coaching_licenses,
    age_groups_coached = excluded.age_groups_coached,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    previous_teams = excluded.previous_teams,
    notable_achievements = excluded.notable_achievements,
    updated_at = now();
end;
$$;

-- 3) save_team_account_profile: same update-first pattern.
create or replace function public.save_team_account_profile(
  _club_name text,
  _leagues_offered text[],
  _age_groups_offered text[],
  _city text,
  _home_stadium text,
  _training_ground text,
  _contact_email text,
  _contact_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_league_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select id into v_league_id
  from public.leagues
  where lower(name) = lower(coalesce(_leagues_offered[1], ''))
  limit 1;

  update public.profiles
  set full_name = _club_name,
      club_name = _club_name,
      email = _contact_email,
      account_category = 'team_staff',
      account_role = 'team_club',
      role = 'team',
      updated_at = now()
  where user_id = v_user_id;

  if not found then
    insert into public.profiles (user_id, full_name, club_name, email, username, account_category, account_role, role)
    values (
      v_user_id,
      _club_name,
      _club_name,
      _contact_email,
      public.generate_unique_username(
        coalesce(nullif(trim(coalesce(_club_name, '')), ''), split_part(coalesce(_contact_email, ''), '@', 1), 'user'),
        v_user_id
      ),
      'team_staff',
      'team_club',
      'team'
    );
  end if;

  insert into public.team_profiles (
    user_id,
    club_name,
    leagues_offered,
    city,
    home_stadium,
    training_ground,
    age_groups_offered,
    contact_email,
    contact_phone
  )
  values (
    v_user_id,
    _club_name,
    _leagues_offered,
    _city,
    _home_stadium,
    _training_ground,
    _age_groups_offered,
    _contact_email,
    _contact_phone
  )
  on conflict (user_id) do update set
    club_name = excluded.club_name,
    leagues_offered = excluded.leagues_offered,
    city = excluded.city,
    home_stadium = excluded.home_stadium,
    training_ground = excluded.training_ground,
    age_groups_offered = excluded.age_groups_offered,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    updated_at = now();

  select id into v_team_id
  from public.teams
  where owner_user_id = v_user_id
  limit 1;

  if v_team_id is null then
    insert into public.teams (
      name,
      league_id,
      owner_user_id,
      age_group,
      contact_email,
      contact_phone,
      stadium,
      approval_status
    )
    values (
      _club_name,
      v_league_id,
      v_user_id,
      _age_groups_offered[1],
      _contact_email,
      _contact_phone,
      _home_stadium,
      'approved'
    )
    returning id into v_team_id;
  else
    update public.teams
    set
      name = _club_name,
      league_id = v_league_id,
      age_group = _age_groups_offered[1],
      contact_email = _contact_email,
      contact_phone = _contact_phone,
      stadium = _home_stadium,
      owner_user_id = v_user_id,
      approval_status = 'approved'
    where id = v_team_id;
  end if;

  update public.team_profiles
  set team_id = v_team_id,
      updated_at = now()
  where user_id = v_user_id;
end;
$$;
