-- Footy Status Official admin account control repairs.
-- Fixes "Player record not found" by resolving/repairing the viewed player's
-- player_profiles row and legacy players row before admin edits/stat updates.
-- Also makes ordinary admin edits allow an optional audit note instead of
-- requiring a typed reason every time.

create or replace function public.admin_assert_official(_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can perform this action.';
  end if;

  -- Blank notes are allowed for ordinary support edits. Serious moderation
  -- actions can still require a reason in their own caller/UI.
  if nullif(trim(coalesce(_reason, '')), '') is not null
     and length(trim(_reason)) < 3 then
    raise exception 'Enter an audit reason of at least 3 characters.';
  end if;
end;
$$;

create or replace function public.admin_write_audit(
  _action text,
  _table text,
  _affected_id text,
  _target_account_id uuid,
  _reason text default null,
  _before jsonb default null,
  _after jsonb default null,
  _payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official(_reason);

  insert into public.admin_audit_log (
    admin_user_id, action, affected_table, affected_id, payload,
    target_account_id, reason, before_data, after_data
  ) values (
    auth.uid(),
    _action,
    _table,
    _affected_id,
    coalesce(_payload, '{}'::jsonb),
    _target_account_id,
    nullif(trim(coalesce(_reason, '')), ''),
    _before,
    _after
  );
end;
$$;

create or replace function public.admin_is_player_account(_target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();

  return exists (
    select 1
    from public.profiles p
    where p.user_id = _target_user_id
      and lower(coalesce(to_jsonb(p)->>'account_role', to_jsonb(p)->>'account_type', to_jsonb(p)->>'role', '')) = 'player'
  )
  or exists (
    select 1 from public.player_profiles pp where pp.user_id = _target_user_id
  )
  or exists (
    select 1 from public.players pl where pl.user_id = _target_user_id
  );
end;
$$;

create or replace function public.admin_resolve_player_profile(_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_json jsonb;
  v_player_profile_id uuid;
begin
  perform public.admin_assert_official();

  select to_jsonb(p) into v_profile_json
  from public.profiles p
  where p.user_id = _target_user_id
  limit 1;

  if v_profile_json is null then
    raise exception 'Account profile not found for %.', _target_user_id;
  end if;

  if not public.admin_is_player_account(_target_user_id) then
    raise exception 'The selected account is not a player account.';
  end if;

  select id into v_player_profile_id
  from public.player_profiles
  where user_id = _target_user_id
  limit 1;

  if v_player_profile_id is null then
    insert into public.player_profiles (
      user_id,
      full_name,
      team,
      position,
      height,
      weight,
      contact_email,
      contact_phone,
      school_grade,
      preferred_foot,
      profile_image_url,
      jersey_number,
      player_gender
    )
    values (
      _target_user_id,
      coalesce(nullif(trim(v_profile_json->>'full_name'), ''), nullif(trim(v_profile_json->>'username'), ''), v_profile_json->>'email', 'Player'),
      nullif(trim(coalesce(v_profile_json->>'team_name', v_profile_json->>'club_name', '')), ''),
      nullif(trim(coalesce(v_profile_json->>'position', '')), ''),
      nullif(trim(coalesce(v_profile_json->>'height', '')), ''),
      nullif(trim(coalesce(v_profile_json->>'weight', '')), ''),
      nullif(trim(coalesce(v_profile_json->>'email', '')), ''),
      null,
      null,
      null,
      nullif(trim(coalesce(v_profile_json->>'avatar_url', '')), ''),
      null,
      null
    )
    on conflict (user_id) do update
      set full_name = coalesce(nullif(trim(public.player_profiles.full_name), ''), excluded.full_name),
          updated_at = now()
    returning id into v_player_profile_id;

    perform public.admin_write_audit(
      'player_profile_repaired',
      'player_profiles',
      v_player_profile_id::text,
      _target_user_id,
      null,
      null,
      (select to_jsonb(pp) from public.player_profiles pp where pp.id = v_player_profile_id),
      jsonb_build_object('repair_reason', 'Missing player_profiles row repaired for admin editing')
    );
  end if;

  return v_player_profile_id;
end;
$$;

create or replace function public.admin_resolve_legacy_player(_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_json jsonb;
  v_player_profile public.player_profiles;
  v_player_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  perform public.admin_assert_official();
  perform public.admin_resolve_player_profile(_target_user_id);

  select to_jsonb(p) into v_profile_json
  from public.profiles p
  where p.user_id = _target_user_id
  limit 1;

  select * into v_player_profile
  from public.player_profiles
  where user_id = _target_user_id
  limit 1;

  select id into v_player_id
  from public.players
  where user_id = _target_user_id
  order by created_at asc
  limit 1;

  if v_player_id is null then
    insert into public.players (
      user_id,
      name,
      club,
      league,
      position,
      height,
      weight,
      contact_email,
      contact_phone,
      profile_image_url,
      jersey_number,
      player_gender
    )
    values (
      _target_user_id,
      coalesce(nullif(trim(v_player_profile.full_name), ''), nullif(trim(v_profile_json->>'full_name'), ''), nullif(trim(v_profile_json->>'username'), ''), v_profile_json->>'email', 'Player'),
      coalesce(nullif(trim(v_player_profile.team), ''), nullif(trim(v_profile_json->>'team_name'), ''), nullif(trim(v_profile_json->>'club_name'), ''), ''),
      '',
      nullif(trim(coalesce(v_player_profile.position, v_profile_json->>'position', '')), ''),
      nullif(trim(coalesce(v_player_profile.height, v_profile_json->>'height', '')), ''),
      nullif(trim(coalesce(v_player_profile.weight, v_profile_json->>'weight', '')), ''),
      nullif(trim(coalesce(v_player_profile.contact_email, v_profile_json->>'email', '')), ''),
      nullif(trim(coalesce(v_player_profile.contact_phone, '')), ''),
      nullif(trim(coalesce(v_player_profile.profile_image_url, v_profile_json->>'avatar_url', '')), ''),
      nullif(trim(coalesce(v_player_profile.jersey_number, '')), ''),
      case
        when lower(coalesce(v_player_profile.player_gender, '')) in ('boy', 'girl')
          then lower(v_player_profile.player_gender)
        else null
      end
    )
    returning id into v_player_id;

    perform public.admin_write_audit(
      'legacy_player_record_repaired',
      'players',
      v_player_id::text,
      _target_user_id,
      null,
      null,
      (select to_jsonb(pl) from public.players pl where pl.id = v_player_id),
      jsonb_build_object('repair_reason', 'Missing legacy players row repaired for admin statistics editing')
    );
  else
    select to_jsonb(pl) into v_before
    from public.players pl
    where pl.id = v_player_id;

    update public.players
    set name = coalesce(nullif(trim(v_player_profile.full_name), ''), nullif(trim(v_profile_json->>'full_name'), ''), name),
        club = coalesce(nullif(trim(v_player_profile.team), ''), nullif(trim(v_profile_json->>'team_name'), ''), nullif(trim(v_profile_json->>'club_name'), ''), club, ''),
        position = coalesce(nullif(trim(v_player_profile.position), ''), nullif(trim(v_profile_json->>'position'), ''), position),
        height = coalesce(nullif(trim(v_player_profile.height), ''), nullif(trim(v_profile_json->>'height'), ''), height),
        weight = coalesce(nullif(trim(v_player_profile.weight), ''), nullif(trim(v_profile_json->>'weight'), ''), weight),
        contact_email = coalesce(nullif(trim(v_player_profile.contact_email), ''), nullif(trim(v_profile_json->>'email'), ''), contact_email),
        contact_phone = coalesce(nullif(trim(v_player_profile.contact_phone), ''), contact_phone),
        profile_image_url = coalesce(nullif(trim(v_player_profile.profile_image_url), ''), nullif(trim(v_profile_json->>'avatar_url'), ''), profile_image_url),
        jersey_number = coalesce(nullif(trim(v_player_profile.jersey_number), ''), jersey_number),
        player_gender = case
          when lower(coalesce(v_player_profile.player_gender, '')) in ('boy', 'girl')
            then lower(v_player_profile.player_gender)
          else player_gender
        end
    where id = v_player_id;

    select to_jsonb(pl) into v_after
    from public.players pl
    where pl.id = v_player_id;

    if v_before is distinct from v_after then
      perform public.admin_write_audit(
        'legacy_player_record_synced',
        'players',
        v_player_id::text,
        _target_user_id,
        null,
        v_before,
        v_after,
        jsonb_build_object('sync_reason', 'Admin player edit/stat save synced linked legacy player row')
      );
    end if;
  end if;

  return v_player_id;
end;
$$;

create or replace function public.admin_get_account_bundle(_target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_role text;
begin
  perform public.admin_assert_official();

  select lower(coalesce(to_jsonb(p)->>'account_role', to_jsonb(p)->>'account_type', to_jsonb(p)->>'role', ''))
    into v_role
  from public.profiles p
  where p.user_id = _target_user_id
  limit 1;

  if v_role = 'player'
     or exists (select 1 from public.player_profiles pp where pp.user_id = _target_user_id)
     or exists (select 1 from public.players pl where pl.user_id = _target_user_id) then
    perform public.admin_resolve_player_profile(_target_user_id);
    perform public.admin_resolve_legacy_player(_target_user_id);
  end if;

  select jsonb_build_object(
    'profile', (select to_jsonb(x) from public.profiles x where x.user_id = _target_user_id limit 1),
    'player_profile', (select to_jsonb(x) from public.player_profiles x where x.user_id = _target_user_id limit 1),
    'legacy_player', (select to_jsonb(x) from public.players x where x.user_id = _target_user_id order by x.created_at asc limit 1),
    'staff_profile', (select to_jsonb(x) from public.staff_profiles x where x.user_id = _target_user_id limit 1),
    'parent_profile', (select to_jsonb(x) from public.parent_profiles x where x.user_id = _target_user_id limit 1),
    'team_profile', (select to_jsonb(x) from public.team_profiles x where x.user_id = _target_user_id limit 1),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x) order by x.contact_type) from public.user_contacts x where x.user_id = _target_user_id), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.clips x
      left join public.player_profiles pp on pp.id = x.player_id
      left join public.players pl on pl.id = x.player_id
      where coalesce(x.user_id, pp.user_id, pl.user_id) = _target_user_id), '[]'::jsonb),
    'statistics', coalesce((select jsonb_agg(to_jsonb(s) order by s.season desc)
      from public.player_statistics s join public.players pl on pl.id = s.player_id
      where pl.user_id = _target_user_id), '[]'::jsonb),
    'player_team_links', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('team_name', t.name, 'daughter_team_name', concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, ''))))
      from public.player_team_memberships m
      left join public.teams t on t.id = m.team_id
      left join public.club_teams ct on ct.id = m.club_team_id
      where m.player_user_id = _target_user_id), '[]'::jsonb),
    'coach_team_links', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('team_name', t.name, 'daughter_team_name', concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, ''))))
      from public.coach_staff_team_memberships m
      left join public.teams t on t.id = m.team_id
      left join public.club_teams ct on ct.id = m.club_team_id
      where m.coach_user_id = _target_user_id), '[]'::jsonb),
    'parent_links', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'parent_user_id', par.user_id, 'player_user_id', pla.user_id,
        'parent_name', p1.full_name, 'player_name', p2.full_name))
      from public.parent_player_links l
      join public.parent_profiles par on par.id = l.parent_profile_id
      join public.player_profiles pla on pla.id = l.player_profile_id
      left join public.profiles p1 on p1.user_id = par.user_id
      left join public.profiles p2 on p2.user_id = pla.user_id
      where par.user_id = _target_user_id or pla.user_id = _target_user_id), '[]'::jsonb),
    'strikes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.account_strikes x where x.account_id = _target_user_id), '[]'::jsonb),
    'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.temporary_bans x where x.account_id = _target_user_id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
      (select * from public.admin_audit_log where target_account_id = _target_user_id order by created_at desc limit 50) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
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
begin
  perform public.admin_assert_official(_reason);

  if not (_table_name = any(v_allowed_tables)) then
    raise exception 'That account record cannot be edited here.';
  end if;

  if _table_name = 'player_profiles' then
    perform public.admin_resolve_player_profile(_target_user_id);
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_before using _target_user_id;

  if v_before is null then
    raise exception 'Account record not found for table %. The account may need a type-specific profile repair.', _table_name;
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
      raise exception 'Unknown field: %', v_key;
    end if;

    execute format(
      'update public.%1$I t set %2$I = r.%2$I from (select * from jsonb_populate_record(null::public.%1$I, $1)) r where t.user_id = $2',
      _table_name,
      v_key
    ) using _changes, _target_user_id;
  end loop;

  if _table_name = 'player_profiles' then
    perform public.admin_resolve_legacy_player(_target_user_id);
  end if;

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
    _changes
  );

  return v_after;
end;
$$;

create or replace function public.admin_set_contact(
  _target_user_id uuid,
  _contact_type text,
  _value text,
  _visibility text,
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
begin
  perform public.admin_assert_official(_reason);

  select to_jsonb(x) into v_before
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  insert into public.user_contacts(user_id, contact_type, value, visibility)
  values (_target_user_id, _contact_type, coalesce(_value, ''), coalesce(_visibility, 'public'))
  on conflict (user_id, contact_type) do update
  set value = excluded.value,
      visibility = excluded.visibility,
      updated_at = now();

  select to_jsonb(x) into v_after
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  perform public.admin_write_audit(
    'private_contact_updated',
    'user_contacts',
    coalesce(v_after->>'id', _target_user_id::text || ':' || _contact_type),
    _target_user_id,
    _reason,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

create or replace function public.admin_upsert_player_statistics(
  _target_user_id uuid,
  _season text,
  _statistics jsonb,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_season text := coalesce(nullif(trim(_season), ''), extract(year from now())::text);
begin
  perform public.admin_assert_official(_reason);

  v_player_id := public.admin_resolve_legacy_player(_target_user_id);

  select to_jsonb(s) into v_before
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season;

  insert into public.player_statistics(
    player_id,
    season,
    appearances,
    starts,
    goals,
    assists,
    mvp_matches,
    clean_sheets,
    yellow_cards,
    red_cards
  )
  values (
    v_player_id,
    v_season,
    coalesce(nullif(_statistics->>'appearances', '')::int, 0),
    coalesce(nullif(_statistics->>'starts', '')::int, 0),
    coalesce(nullif(_statistics->>'goals', '')::int, 0),
    coalesce(nullif(_statistics->>'assists', '')::int, 0),
    coalesce(nullif(_statistics->>'mvp_matches', '')::int, 0),
    coalesce(nullif(_statistics->>'clean_sheets', '')::int, 0),
    coalesce(nullif(_statistics->>'yellow_cards', '')::int, 0),
    coalesce(nullif(_statistics->>'red_cards', '')::int, 0)
  )
  on conflict (player_id, season) do update set
    appearances = excluded.appearances,
    starts = excluded.starts,
    goals = excluded.goals,
    assists = excluded.assists,
    mvp_matches = excluded.mvp_matches,
    clean_sheets = excluded.clean_sheets,
    yellow_cards = excluded.yellow_cards,
    red_cards = excluded.red_cards,
    updated_at = now();

  select to_jsonb(s) into v_after
  from public.player_statistics s
  where s.player_id = v_player_id
    and s.season = v_season;

  perform public.admin_write_audit(
    'player_statistics_updated',
    'player_statistics',
    v_after->>'id',
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object('resolved_player_id', v_player_id, 'season', v_season)
  );

  return v_after;
end;
$$;

create or replace function public.admin_link_player_to_team(
  _target_user_id uuid,
  _team_id uuid,
  _club_team_id uuid default null,
  _age_group text default null,
  _reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_id uuid;
begin
  perform public.admin_assert_official(_reason);

  v_profile_id := public.admin_resolve_player_profile(_target_user_id);

  select id into v_id
  from public.player_team_memberships
  where player_user_id = _target_user_id
    and team_id = _team_id
    and club_team_id is not distinct from _club_team_id
  limit 1;

  if v_id is null then
    insert into public.player_team_memberships(
      player_profile_id,
      player_user_id,
      team_id,
      club_team_id,
      age_group,
      status,
      joined_via,
      approved_at,
      approved_by
    )
    values(
      v_profile_id,
      _target_user_id,
      _team_id,
      _club_team_id,
      _age_group,
      'approved',
      'admin_add',
      now(),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.player_team_memberships
    set player_profile_id = coalesce(player_profile_id, v_profile_id),
        status = 'approved',
        age_group = coalesce(_age_group, age_group),
        approved_at = now(),
        approved_by = auth.uid(),
        updated_at = now()
    where id = v_id;
  end if;

  perform public.admin_write_audit(
    'player_linked_to_team',
    'player_team_memberships',
    v_id::text,
    _target_user_id,
    _reason,
    null,
    jsonb_build_object('team_id', _team_id, 'club_team_id', _club_team_id)
  );

  return v_id;
end;
$$;

revoke all on function public.admin_is_player_account(uuid) from public;
revoke all on function public.admin_resolve_player_profile(uuid) from public;
revoke all on function public.admin_resolve_legacy_player(uuid) from public;
revoke all on function public.admin_get_account_bundle(uuid) from public;
revoke all on function public.admin_patch_account_record(uuid, text, jsonb, text) from public;
revoke all on function public.admin_set_contact(uuid, text, text, text, text) from public;
revoke all on function public.admin_upsert_player_statistics(uuid, text, jsonb, text) from public;
revoke all on function public.admin_link_player_to_team(uuid, uuid, uuid, text, text) from public;

grant execute on function public.admin_is_player_account(uuid) to authenticated;
grant execute on function public.admin_resolve_player_profile(uuid) to authenticated;
grant execute on function public.admin_resolve_legacy_player(uuid) to authenticated;
grant execute on function public.admin_get_account_bundle(uuid) to authenticated;
grant execute on function public.admin_patch_account_record(uuid, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_contact(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_upsert_player_statistics(uuid, text, jsonb, text) to authenticated;
grant execute on function public.admin_link_player_to_team(uuid, uuid, uuid, text, text) to authenticated;
