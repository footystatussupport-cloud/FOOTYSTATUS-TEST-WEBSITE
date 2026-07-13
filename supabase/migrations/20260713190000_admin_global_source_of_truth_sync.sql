-- =============================================================================
-- Global admin source-of-truth synchronization
-- =============================================================================
-- Critical fix:
-- Admin edits must update the real records the rest of the app reads, not only
-- the admin bundle view. The app still has mirrored profile data across:
--   profiles, player_profiles, players, staff_profiles, parent_profiles,
--   team_profiles, teams, and user_contacts.
--
-- This migration adds a single synchronization layer and calls it after every
-- admin patch/contact save. The target is always the immutable auth user id.
-- =============================================================================

create or replace function public.admin_apply_user_row_update(
  _table_name text,
  _target_user_id uuid,
  _changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_applied jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official('admin_apply_user_row_update');
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_apply_user_row_update');

  if _target_user_id is null then
    raise exception 'Target account id is required.';
  end if;

  if to_regclass('public.' || _table_name) is null then
    return v_applied;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'user_id'
  ) then
    return v_applied;
  end if;

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','user_id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = _table_name
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.%1$I t
       set %2$I = r.%2$I
       from (select * from jsonb_populate_record(null::public.%1$I, $1)) r
       where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;

    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'updated_at'
  ) then
    execute format('update public.%I set updated_at = now() where user_id = $1', _table_name)
    using _target_user_id;
  end if;

  return v_applied;
end;
$$;

create or replace function public.admin_sync_account_source_of_truth(
  _target_user_id uuid,
  _source_table text default null,
  _source_changes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_player jsonb;
  v_legacy_player jsonb;
  v_staff jsonb;
  v_parent jsonb;
  v_team_profile jsonb;
  v_role text;
  v_category text;
  v_is_player boolean := false;
  v_is_staff boolean := false;
  v_is_parent boolean := false;
  v_is_team boolean := false;
  v_is_referee boolean := false;
  v_personal_email text;
  v_personal_phone text;
  v_staff_email text;
  v_staff_phone text;
  v_primary_email text;
  v_primary_phone text;
  v_team_id uuid;
  v_team_name text;
  v_team_logo text;
  v_result jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official();
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_sync_account_source_of_truth');

  select to_jsonb(p) into v_profile
  from public.profiles p
  where p.user_id = _target_user_id
  limit 1;

  if v_profile is null then
    raise exception 'Target profile not found.';
  end if;

  select to_jsonb(pp) into v_player
  from public.player_profiles pp
  where pp.user_id = _target_user_id
  limit 1;

  select to_jsonb(pl) into v_legacy_player
  from public.players pl
  where pl.user_id = _target_user_id
  order by pl.created_at asc nulls last
  limit 1;

  select to_jsonb(sp) into v_staff
  from public.staff_profiles sp
  where sp.user_id = _target_user_id
  limit 1;

  select to_jsonb(ppar) into v_parent
  from public.parent_profiles ppar
  where ppar.user_id = _target_user_id
  limit 1;

  select to_jsonb(tp) into v_team_profile
  from public.team_profiles tp
  where tp.user_id = _target_user_id
  limit 1;

  v_role := lower(coalesce(v_profile->>'account_role', v_profile->>'account_type', v_profile->>'role', ''));
  v_category := lower(coalesce(v_profile->>'account_category', ''));
  v_is_player := v_role = 'player' or v_category = 'player';
  v_is_parent := v_role = 'parent' or v_category = 'parent';
  v_is_referee := v_role = 'referee' or v_category = 'referee';
  v_is_team := v_role in ('team_club', 'school_team', 'team', 'school') or v_category = 'team';
  v_is_staff := not v_is_team and (
    v_category = 'team_staff'
    or v_role in ('head_coach_assistant', 'coach', 'trainer', 'academy_director', 'team_staff', 'scout')
  );

  select value into v_personal_email
  from public.user_contacts
  where user_id = _target_user_id
    and contact_type = 'player_email'
    and nullif(trim(value), '') is not null
  limit 1;

  select value into v_personal_phone
  from public.user_contacts
  where user_id = _target_user_id
    and contact_type = 'player_phone'
    and nullif(trim(value), '') is not null
  limit 1;

  select value into v_staff_email
  from public.user_contacts
  where user_id = _target_user_id
    and contact_type = 'coach_email'
    and nullif(trim(value), '') is not null
  limit 1;

  select value into v_staff_phone
  from public.user_contacts
  where user_id = _target_user_id
    and contact_type = 'coach_phone'
    and nullif(trim(value), '') is not null
  limit 1;

  v_primary_email := case
    when v_is_staff then coalesce(v_staff_email, v_staff->>'contact_email', v_profile->>'email')
    when v_is_team then coalesce(v_team_profile->>'contact_email', v_profile->>'email')
    else coalesce(v_personal_email, v_parent->>'contact_email', v_player->>'contact_email', v_profile->>'email')
  end;

  v_primary_phone := case
    when v_is_staff then coalesce(v_staff_phone, v_staff->>'contact_phone')
    when v_is_team then v_team_profile->>'contact_phone'
    else coalesce(v_personal_phone, v_parent->>'contact_phone', v_player->>'contact_phone')
  end;

  if v_is_player then
    perform public.admin_apply_user_row_update('profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_player->>'full_name', v_profile->>'full_name'),
      'position', coalesce(v_player->>'position', v_profile->>'position'),
      'height', coalesce(v_player->>'height', v_profile->>'height'),
      'weight', coalesce(v_player->>'weight', v_profile->>'weight'),
      'school_grade', coalesce(v_player->>'school_grade', v_profile->>'school_grade'),
      'team_name', coalesce(v_player->>'team', v_profile->>'team_name'),
      'player_gender', coalesce(v_player->>'player_gender', v_profile->>'player_gender'),
      'email', v_primary_email
    ));

    perform public.admin_apply_user_row_update('player_profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_profile->>'full_name', v_player->>'full_name'),
      'position', coalesce(v_player->>'position', v_profile->>'position'),
      'height', coalesce(v_player->>'height', v_profile->>'height'),
      'weight', coalesce(v_player->>'weight', v_profile->>'weight'),
      'school_grade', coalesce(v_player->>'school_grade', v_profile->>'school_grade'),
      'team', coalesce(v_player->>'team', v_profile->>'team_name'),
      'player_gender', coalesce(v_player->>'player_gender', v_profile->>'player_gender'),
      'profile_image_url', coalesce(v_profile->>'avatar_url', v_player->>'profile_image_url'),
      'contact_email', v_primary_email,
      'contact_phone', v_primary_phone
    ));

    perform public.admin_apply_user_row_update('players', _target_user_id, jsonb_build_object(
      'name', coalesce(v_profile->>'full_name', v_player->>'full_name', v_legacy_player->>'name'),
      'position', coalesce(v_player->>'position', v_profile->>'position'),
      'height', coalesce(v_player->>'height', v_profile->>'height'),
      'weight', coalesce(v_player->>'weight', v_profile->>'weight'),
      'club', coalesce(v_player->>'team', v_profile->>'team_name', v_legacy_player->>'club'),
      'profile_image_url', coalesce(v_profile->>'avatar_url', v_player->>'profile_image_url', v_legacy_player->>'profile_image_url'),
      'contact_email', v_primary_email,
      'contact_phone', v_primary_phone,
      'player_gender', coalesce(v_player->>'player_gender', v_profile->>'player_gender')
    ));

    if nullif(trim(coalesce(v_primary_email, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_email', lower(trim(v_primary_email)), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    if nullif(trim(coalesce(v_primary_phone, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_phone', trim(v_primary_phone), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    perform public.admin_resolve_legacy_player(_target_user_id);
    v_result := v_result || jsonb_build_object('player_synced', true);
  end if;

  if v_is_parent then
    perform public.admin_apply_user_row_update('profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_parent->>'full_name', v_profile->>'full_name'),
      'email', v_primary_email
    ));

    perform public.admin_apply_user_row_update('parent_profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_profile->>'full_name', v_parent->>'full_name'),
      'contact_email', v_primary_email,
      'contact_phone', v_primary_phone
    ));

    if nullif(trim(coalesce(v_primary_email, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_email', lower(trim(v_primary_email)), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    if nullif(trim(coalesce(v_primary_phone, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_phone', trim(v_primary_phone), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    v_result := v_result || jsonb_build_object('parent_synced', true);
  end if;

  if v_is_referee then
    if nullif(trim(coalesce(v_primary_email, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_email', lower(trim(v_primary_email)), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    if nullif(trim(coalesce(v_primary_phone, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'player_phone', trim(v_primary_phone), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    perform public.admin_apply_user_row_update('profiles', _target_user_id, jsonb_build_object(
      'email', v_primary_email
    ));

    v_result := v_result || jsonb_build_object('referee_synced', true);
  end if;

  if v_is_staff then
    perform public.admin_apply_user_row_update('staff_profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_profile->>'full_name', v_staff->>'full_name'),
      'team_organization_name', coalesce(v_profile->>'teams_currently_coaching', v_profile->>'scout_organization', v_staff->>'team_organization_name'),
      'city', coalesce(v_profile->>'coaching_location', v_staff->>'city'),
      'contact_email', v_primary_email,
      'contact_phone', v_primary_phone,
      'notable_achievements', coalesce(v_profile->>'coaching_accolades', v_profile->>'scouting_accolades', v_staff->>'notable_achievements'),
      'profile_image_url', coalesce(v_profile->>'avatar_url', v_staff->>'profile_image_url')
    ));

    perform public.admin_apply_user_row_update('profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_profile->>'full_name', v_staff->>'full_name'),
      'email', v_primary_email
    ));

    if nullif(trim(coalesce(v_primary_email, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'coach_email', lower(trim(v_primary_email)), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    if nullif(trim(coalesce(v_primary_phone, '')), '') is not null then
      insert into public.user_contacts(user_id, contact_type, value, visibility)
      values (_target_user_id, 'coach_phone', trim(v_primary_phone), 'public')
      on conflict (user_id, contact_type) do update
      set value = excluded.value, updated_at = now();
    end if;

    v_result := v_result || jsonb_build_object('staff_synced', true);
  end if;

  if v_is_team then
    v_team_name := coalesce(v_team_profile->>'club_name', v_profile->>'club_name', v_profile->>'team_name', v_profile->>'full_name');
    v_team_logo := coalesce(v_team_profile->>'logo_url', v_profile->>'avatar_url');

    perform public.admin_apply_user_row_update('profiles', _target_user_id, jsonb_build_object(
      'full_name', coalesce(v_profile->>'full_name', v_team_name),
      'club_name', v_team_name,
      'team_name', v_team_name,
      'avatar_url', coalesce(v_profile->>'avatar_url', v_team_logo),
      'email', v_primary_email
    ));

    perform public.admin_apply_user_row_update('team_profiles', _target_user_id, jsonb_build_object(
      'club_name', v_team_name,
      'logo_url', v_team_logo,
      'contact_email', v_primary_email,
      'contact_phone', v_primary_phone
    ));

    v_team_id := nullif(v_team_profile->>'team_id', '')::uuid;
    if v_team_id is null then
      select t.id into v_team_id
      from public.teams t
      where t.owner_user_id = _target_user_id
      order by t.created_at asc nulls last
      limit 1;
    end if;

    if v_team_id is not null then
      update public.teams
      set name = coalesce(nullif(trim(v_team_name), ''), name),
          logo_url = coalesce(nullif(trim(v_team_logo), ''), logo_url),
          contact_email = v_primary_email,
          contact_phone = v_primary_phone,
          owner_user_id = coalesce(owner_user_id, _target_user_id),
          updated_at = now()
      where id = v_team_id;

      update public.team_profiles
      set team_id = v_team_id,
          updated_at = now()
      where user_id = _target_user_id
        and team_id is distinct from v_team_id;
    end if;

    v_result := v_result || jsonb_build_object('team_synced', true, 'team_id', v_team_id);
  end if;

  return v_result || jsonb_build_object(
    'target_user_id', _target_user_id,
    'source_table', _source_table,
    'source_changes', coalesce(_source_changes, '{}'::jsonb)
  );
end;
$$;

create or replace function public.admin_patch_account_record(
  _target_user_id uuid,
  _table_name text,
  _changes jsonb,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
  v_allowed_tables text[] := array['profiles','player_profiles','staff_profiles','parent_profiles','team_profiles'];
  v_applied jsonb := '{}'::jsonb;
  v_sync jsonb := '{}'::jsonb;
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_patch_account_record');
  perform public.admin_repair_account_records(_target_user_id);

  if not (_table_name = any(v_allowed_tables)) then
    raise exception 'That account record cannot be edited here.';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_before using _target_user_id;

  if v_before is null then
    raise exception 'Account record not found for table %. The account could not be repaired automatically.', _table_name;
  end if;

  for v_key in select jsonb_object_keys(coalesce(_changes, '{}'::jsonb))
  loop
    if v_key = any(array['id','user_id','created_at']) then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = _table_name
        and column_name = v_key
    ) then
      continue;
    end if;

    execute format(
      'update public.%1$I t
       set %2$I = r.%2$I
       from (select * from jsonb_populate_record(null::public.%1$I, $1)) r
       where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;

    v_applied := v_applied || jsonb_build_object(v_key, _changes->v_key);
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = _table_name
      and column_name = 'updated_at'
  ) then
    execute format('update public.%I set updated_at = now() where user_id = $1', _table_name)
    using _target_user_id;
  end if;

  v_sync := public.admin_sync_account_source_of_truth(_target_user_id, _table_name, v_applied);

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_after using _target_user_id;

  perform public.admin_write_audit(
    'account_record_updated',
    _table_name,
    coalesce(v_after->>'id', _target_user_id::text),
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object('applied', v_applied, 'sync', v_sync)
  );

  return v_after || jsonb_build_object('_sync', v_sync);
end;
$$;

create or replace function public.admin_set_contact(
  _target_user_id uuid,
  _contact_type text,
  _value text,
  _visibility text default 'public',
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_sync jsonb := '{}'::jsonb;
  v_clean_value text := nullif(trim(coalesce(_value, '')), '');
  v_visibility text := case
    when _visibility in ('public', 'restricted', 'private') then _visibility
    else 'public'
  end;
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_set_contact');

  if _contact_type not in (
    'player_email',
    'player_phone',
    'coach_email',
    'coach_phone',
    'instagram',
    'tiktok',
    'youtube',
    'website'
  ) then
    raise exception 'Unsupported contact type: %', _contact_type;
  end if;

  select to_jsonb(x) into v_before
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  if v_clean_value is null then
    delete from public.user_contacts x
    where x.user_id = _target_user_id
      and x.contact_type = _contact_type;
  else
    insert into public.user_contacts(user_id, contact_type, value, visibility)
    values (_target_user_id, _contact_type, v_clean_value, v_visibility)
    on conflict (user_id, contact_type) do update
    set value = excluded.value,
        visibility = excluded.visibility,
        updated_at = now();
  end if;

  select to_jsonb(x) into v_after
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  v_sync := public.admin_sync_account_source_of_truth(
    _target_user_id,
    'user_contacts',
    jsonb_build_object(_contact_type, v_clean_value)
  );

  perform public.admin_write_audit(
    'private_contact_updated',
    'user_contacts',
    coalesce(v_after->>'id', v_before->>'id', _target_user_id::text || ':' || _contact_type),
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object(
      'contact_type', _contact_type,
      'value_present', v_clean_value is not null,
      'visibility', v_visibility,
      'sync', v_sync
    )
  );

  return coalesce(v_after, jsonb_build_object(
    'user_id', _target_user_id,
    'contact_type', _contact_type,
    'deleted', true
  )) || jsonb_build_object('_sync', v_sync);
end;
$$;

grant execute on function public.admin_apply_user_row_update(text, uuid, jsonb) to authenticated;
grant execute on function public.admin_sync_account_source_of_truth(uuid, text, jsonb) to authenticated;
revoke all on function public.admin_patch_account_record(uuid, text, jsonb, text) from public;
revoke all on function public.admin_set_contact(uuid, text, text, text, text) from public;
grant execute on function public.admin_patch_account_record(uuid, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_contact(uuid, text, text, text, text) to authenticated;
