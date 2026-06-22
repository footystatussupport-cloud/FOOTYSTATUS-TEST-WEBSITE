create or replace function public.soft_delete_club_cascade(_club_id uuid, _reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_team_id uuid;
  v_owner_user_id uuid;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the official Footy Status account can delete a club';
  end if;

  select primary_team_id, owner_user_id
    into v_primary_team_id, v_owner_user_id
  from public.clubs
  where id = _club_id;

  if v_primary_team_id is null and v_owner_user_id is null then
    raise exception 'Club not found';
  end if;

  update public.clubs
  set is_active = false,
      deleted_at = now(),
      deleted_by = auth.uid()
  where id = _club_id;

  update public.teams
  set is_active = false,
      deleted_at = now(),
      deleted_by = auth.uid(),
      approval_status = 'deleted'
  where id = v_primary_team_id
     or owner_user_id = v_owner_user_id;

  update public.team_profiles
  set team_id = null
  where club_id = _club_id
     or team_id = v_primary_team_id
     or user_id = v_owner_user_id;

  update public.club_teams
  set status = 'archived',
      is_active = false
  where club_id = _club_id
     or team_id = v_primary_team_id
     or parent_team_id = v_primary_team_id;

  update public.player_team_memberships
  set status = 'removed'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  update public.coach_staff_team_memberships
  set status = 'removed'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  update public.team_join_requests
  set status = 'cancelled'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  update public.team_player_invites
  set status = 'cancelled'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  update public.coach_staff_join_requests
  set status = 'cancelled'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  update public.coach_staff_team_invites
  set status = 'cancelled'
  where team_id = v_primary_team_id
     or club_team_id in (
      select id from public.club_teams where club_id = _club_id
    );

  if to_regclass('public.club_news_posts') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'club_news_posts' and column_name = 'is_active'
    ) then
      update public.club_news_posts
      set is_active = false
      where club_id = _club_id
         or team_id = v_primary_team_id;
    end if;
  end if;

  perform public.log_global_admin_action(
    'delete_club_cascade',
    'clubs',
    _club_id::text,
    jsonb_build_object(
      'club_id', _club_id,
      'primary_team_id', v_primary_team_id,
      'owner_user_id', v_owner_user_id,
      'reason', _reason
    )
  );
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

  if _action = 'delete_club_cascade' then
    perform public.soft_delete_club_cascade((_payload ->> 'club_id')::uuid, _payload ->> 'reason');
    return jsonb_build_object('ok', true);
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

    update public.teams
    set league_id = v_league_id
    where id = v_team_id;

    perform public.log_global_admin_action(_action, 'league_teams', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'remove_team_from_league' then
    v_team_id := (_payload ->> 'team_id')::uuid;
    v_league_id := (_payload ->> 'league_id')::uuid;

    delete from public.league_teams
    where league_id = v_league_id
      and team_id = v_team_id;

    update public.teams
    set league_id = null
    where id = v_team_id
      and league_id = v_league_id;

    perform public.log_global_admin_action(_action, 'league_teams', v_team_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  if _action = 'soft_delete_record' then
    v_table := _payload ->> 'table';
    v_target_id := (_payload ->> 'id')::uuid;

    if v_table = 'clubs' then
      perform public.soft_delete_club_cascade(v_target_id, _payload ->> 'reason');
      return jsonb_build_object('ok', true);
    end if;

    if v_table not in ('teams', 'leagues') then
      raise exception 'This table cannot be deleted through this action';
    end if;

    execute format(
      'update public.%I set is_active = false, deleted_at = now(), deleted_by = auth.uid() where id = $1',
      v_table
    )
    using v_target_id;

    perform public.log_global_admin_action(_action, v_table, v_target_id::text, _payload);
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'Unknown global admin action: %', _action;
end;
$$;

grant execute on function public.soft_delete_club_cascade(uuid, text) to authenticated;
grant execute on function public.perform_global_admin_action(text, jsonb) to authenticated;
