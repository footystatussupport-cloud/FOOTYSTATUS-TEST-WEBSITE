-- Footy Status Official master admin console.
-- Every read/write RPC below is protected by is_footy_status_global_admin().

alter table public.admin_audit_log
  add column if not exists target_account_id uuid references auth.users(id) on delete set null,
  add column if not exists reason text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb;

alter table public.player_statistics
  add column if not exists clean_sheets integer not null default 0,
  add column if not exists yellow_cards integer not null default 0,
  add column if not exists red_cards integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

delete from public.player_statistics a
using public.player_statistics b
where a.player_id = b.player_id
  and a.season = b.season
  and a.id < b.id;

create unique index if not exists idx_player_statistics_player_season
on public.player_statistics(player_id, season);

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
  if _reason is not null and length(trim(_reason)) < 3 then
    raise exception 'Enter an audit reason of at least 3 characters.';
  end if;
end;
$$;

create or replace function public.admin_write_audit(
  _action text,
  _table text,
  _affected_id text,
  _target_account_id uuid,
  _reason text,
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
    auth.uid(), _action, _table, _affected_id, coalesce(_payload, '{}'::jsonb),
    _target_account_id, trim(_reason), _before, _after
  );
end;
$$;

create or replace function public.admin_search_accounts(_query text default '', _limit integer default 30)
returns table (
  user_id uuid, display_name text, username text, email text, account_role text,
  avatar_url text, account_tier text, pro_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();
  return query
  select p.user_id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.club_name), ''), nullif(trim(p.username), ''), p.email, 'Footy Status account'),
         p.username, p.email, coalesce(p.account_role, p.account_category, 'user'),
         p.avatar_url, p.account_tier, p.pro_expires_at
  from public.profiles p
  where coalesce(_query, '') = ''
     or p.full_name ilike '%' || _query || '%'
     or p.username ilike '%' || _query || '%'
     or p.email ilike '%' || _query || '%'
     or p.club_name ilike '%' || _query || '%'
     or p.user_id::text = trim(_query)
  order by p.updated_at desc nulls last, p.created_at desc
  limit least(greatest(coalesce(_limit, 30), 1), 100);
end;
$$;

create or replace function public.admin_search_teams(_query text default '', _limit integer default 30)
returns table (
  team_id uuid, team_name text, club_team_id uuid, daughter_team_name text,
  team_kind text, gender text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();
  return query
  select t.id, t.name, ct.id, concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, '')),
         case when ct.id is null then 'mother_team' else 'daughter_team' end,
         ct.gender
  from public.teams t
  left join public.club_teams ct on ct.team_id = t.id
  where coalesce(_query, '') = ''
     or t.name ilike '%' || _query || '%'
     or concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, '')) ilike '%' || _query || '%'
     or t.id::text = trim(_query)
     or ct.id::text = trim(_query)
  order by t.name, concat_ws(' - ', nullif(ct.age_group, ''), nullif(ct.league_name, '')) nulls first
  limit least(greatest(coalesce(_limit, 30), 1), 100);
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
begin
  perform public.admin_assert_official();
  select jsonb_build_object(
    'profile', (select to_jsonb(x) from public.profiles x where x.user_id = _target_user_id limit 1),
    'player_profile', (select to_jsonb(x) from public.player_profiles x where x.user_id = _target_user_id limit 1),
    'staff_profile', (select to_jsonb(x) from public.staff_profiles x where x.user_id = _target_user_id limit 1),
    'parent_profile', (select to_jsonb(x) from public.parent_profiles x where x.user_id = _target_user_id limit 1),
    'team_profile', (select to_jsonb(x) from public.team_profiles x where x.user_id = _target_user_id limit 1),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x) order by x.contact_type) from public.user_contacts x where x.user_id = _target_user_id), '[]'::jsonb),
    'clips', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.clips x
      left join public.player_profiles pp on pp.id = x.player_id
      where coalesce(x.user_id, pp.user_id) = _target_user_id), '[]'::jsonb),
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
  _target_user_id uuid, _table_name text, _changes jsonb, _reason text
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
  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_before using _target_user_id;
  if v_before is null then raise exception 'Account record not found.'; end if;

  for v_key in select jsonb_object_keys(_changes)
  loop
    if v_key = any(array['id','user_id','created_at']) then continue; end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = _table_name and column_name = v_key
    ) then raise exception 'Unknown field: %', v_key; end if;
    execute format(
      'update public.%1$I t set %2$I = r.%2$I from (select * from jsonb_populate_record(null::public.%1$I, $1)) r where t.user_id = $2',
      _table_name, v_key
    ) using _changes, _target_user_id;
  end loop;

  execute format('select to_jsonb(t) from public.%I t where t.user_id = $1 limit 1', _table_name)
    into v_after using _target_user_id;
  perform public.admin_write_audit('account_record_updated', _table_name, coalesce(v_after->>'id', _target_user_id::text), _target_user_id, _reason, v_before, v_after, _changes);
  return v_after;
end;
$$;

create or replace function public.admin_set_contact(
  _target_user_id uuid, _contact_type text, _value text, _visibility text, _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.admin_assert_official(_reason);
  select to_jsonb(x) into v_before from public.user_contacts x where x.user_id = _target_user_id and x.contact_type = _contact_type;
  insert into public.user_contacts(user_id, contact_type, value, visibility)
  values (_target_user_id, _contact_type, _value, _visibility)
  on conflict (user_id, contact_type) do update
  set value = excluded.value, visibility = excluded.visibility, updated_at = now();
  select to_jsonb(x) into v_after from public.user_contacts x where x.user_id = _target_user_id and x.contact_type = _contact_type;
  perform public.admin_write_audit('private_contact_updated', 'user_contacts', v_after->>'id', _target_user_id, _reason, v_before, v_after);
  return v_after;
end;
$$;

create or replace function public.admin_set_pro_status(
  _target_user_id uuid, _plan text, _expires_at timestamptz default null, _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_before jsonb; v_after jsonb;
begin
  perform public.admin_assert_official(_reason);
  if _plan not in ('free','pro_annual','pro_lifetime') then raise exception 'Invalid Pro plan.'; end if;
  select to_jsonb(p) into v_before from public.profiles p where p.user_id = _target_user_id;
  update public.profiles set
    account_tier = _plan,
    is_pro = (_plan <> 'free'),
    pro_started_at = case when _plan = 'free' then null else coalesce(pro_started_at, now()) end,
    pro_expires_at = case when _plan = 'pro_annual' then coalesce(_expires_at, now() + interval '1 year') else null end,
    updated_at = now()
  where user_id = _target_user_id;
  if _plan = 'free' then perform public.apply_free_clip_visibility(_target_user_id);
  else perform public.restore_pro_clips(_target_user_id); end if;
  select to_jsonb(p) into v_after from public.profiles p where p.user_id = _target_user_id;
  perform public.admin_write_audit('pro_status_changed', 'profiles', _target_user_id::text, _target_user_id, _reason, v_before, v_after);
  return v_after;
end;
$$;

create or replace function public.admin_upsert_player_statistics(
  _target_user_id uuid, _season text, _statistics jsonb, _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_player_id uuid; v_before jsonb; v_after jsonb;
begin
  perform public.admin_assert_official(_reason);
  select id into v_player_id from public.players where user_id = _target_user_id limit 1;
  if v_player_id is null then raise exception 'Player record not found.'; end if;
  select to_jsonb(s) into v_before from public.player_statistics s where s.player_id = v_player_id and s.season = _season;
  insert into public.player_statistics(player_id, season, appearances, starts, goals, assists, mvp_matches, clean_sheets, yellow_cards, red_cards)
  values (v_player_id, trim(_season), coalesce((_statistics->>'appearances')::int,0), coalesce((_statistics->>'starts')::int,0),
    coalesce((_statistics->>'goals')::int,0), coalesce((_statistics->>'assists')::int,0),
    coalesce((_statistics->>'mvp_matches')::int,0), coalesce((_statistics->>'clean_sheets')::int,0),
    coalesce((_statistics->>'yellow_cards')::int,0), coalesce((_statistics->>'red_cards')::int,0))
  on conflict (player_id, season) do update set
    appearances=excluded.appearances, starts=excluded.starts, goals=excluded.goals, assists=excluded.assists,
    mvp_matches=excluded.mvp_matches, clean_sheets=excluded.clean_sheets,
    yellow_cards=excluded.yellow_cards, red_cards=excluded.red_cards, updated_at=now();
  select to_jsonb(s) into v_after from public.player_statistics s where s.player_id = v_player_id and s.season = _season;
  perform public.admin_write_audit('player_statistics_updated', 'player_statistics', v_after->>'id', _target_user_id, _reason, v_before, v_after);
  return v_after;
end;
$$;

create or replace function public.admin_delete_clip(_clip_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before jsonb; v_target uuid;
begin
  perform public.admin_assert_official(_reason);
  select to_jsonb(c), coalesce(c.user_id, pp.user_id) into v_before, v_target
  from public.clips c left join public.player_profiles pp on pp.id = c.player_id where c.id = _clip_id;
  if v_before is null then raise exception 'Clip not found.'; end if;
  delete from public.clips where id = _clip_id;
  perform public.admin_write_audit('next_up_clip_deleted', 'clips', _clip_id::text, v_target, _reason, v_before, null);
end;
$$;

create or replace function public.admin_add_strike(_target_user_id uuid, _reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_count integer;
begin
  perform public.admin_assert_official(_reason);
  insert into public.account_strikes(account_id, reason, action_taken, admin_user_id)
  values (_target_user_id, trim(_reason), 'manual_admin_strike', auth.uid()) returning id into v_id;
  select count(*) into v_count from public.account_strikes where account_id = _target_user_id and removed_at is null;
  if v_count >= 3 then
    perform public.create_temporary_ban(_target_user_id, 3, 'Automatic 3-month ban after three strikes', null, true);
  end if;
  perform public.admin_write_audit('strike_added', 'account_strikes', v_id::text, _target_user_id, _reason, null, jsonb_build_object('strike_id',v_id,'active_count',v_count));
  return v_id;
end;
$$;

create or replace function public.admin_link_player_to_team(
  _target_user_id uuid, _team_id uuid, _club_team_id uuid default null,
  _age_group text default null, _reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_profile_id uuid; v_id uuid;
begin
  perform public.admin_assert_official(_reason);
  select id into v_profile_id from public.player_profiles where user_id = _target_user_id limit 1;
  if v_profile_id is null then raise exception 'Player profile not found.'; end if;
  select id into v_id from public.player_team_memberships
  where player_user_id = _target_user_id and team_id = _team_id and club_team_id is not distinct from _club_team_id limit 1;
  if v_id is null then
    insert into public.player_team_memberships(player_profile_id, player_user_id, team_id, club_team_id, age_group, status, joined_via, approved_at, approved_by)
    values(v_profile_id, _target_user_id, _team_id, _club_team_id, _age_group, 'approved', 'admin_add', now(), auth.uid())
    returning id into v_id;
  else
    update public.player_team_memberships set status='approved', age_group=coalesce(_age_group,age_group), approved_at=now(), approved_by=auth.uid(), updated_at=now() where id=v_id;
  end if;
  perform public.admin_write_audit('player_linked_to_team', 'player_team_memberships', v_id::text, _target_user_id, _reason, null, jsonb_build_object('team_id',_team_id,'club_team_id',_club_team_id));
  return v_id;
end;
$$;

create or replace function public.admin_link_coach_to_team(
  _target_user_id uuid, _team_id uuid, _club_team_id uuid default null,
  _staff_role text default 'coach', _reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public.admin_assert_official(_reason);
  select id into v_id from public.coach_staff_team_memberships where team_id=_team_id and coach_user_id=_target_user_id limit 1;
  if v_id is null then
    insert into public.coach_staff_team_memberships(team_id, coach_user_id, club_team_id, staff_role, status, approved_at)
    values(_team_id,_target_user_id,_club_team_id,_staff_role,'approved',now()) returning id into v_id;
  else
    update public.coach_staff_team_memberships set club_team_id=_club_team_id, staff_role=_staff_role, status='approved', approved_at=now(), updated_at=now() where id=v_id;
  end if;
  perform public.admin_write_audit('coach_linked_to_team', 'coach_staff_team_memberships', v_id::text, _target_user_id, _reason, null, jsonb_build_object('team_id',_team_id,'club_team_id',_club_team_id,'staff_role',_staff_role));
  return v_id;
end;
$$;

create or replace function public.admin_remove_team_link(_link_type text, _membership_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before jsonb; v_target uuid;
begin
  perform public.admin_assert_official(_reason);
  if _link_type = 'player' then
    select to_jsonb(m),m.player_user_id into v_before,v_target from public.player_team_memberships m where id=_membership_id;
    update public.player_team_memberships set status='revoked',updated_at=now() where id=_membership_id;
  elsif _link_type = 'coach' then
    select to_jsonb(m),m.coach_user_id into v_before,v_target from public.coach_staff_team_memberships m where id=_membership_id;
    update public.coach_staff_team_memberships set status='removed',updated_at=now() where id=_membership_id;
  else raise exception 'Invalid link type.'; end if;
  perform public.admin_write_audit('team_link_removed', case when _link_type='player' then 'player_team_memberships' else 'coach_staff_team_memberships' end, _membership_id::text, v_target, _reason, v_before, null);
end;
$$;

create or replace function public.admin_manage_parent_link(
  _parent_user_id uuid, _player_user_id uuid, _mode text,
  _relationship text default 'Parent / Guardian', _notes text default null, _reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_parent_id uuid; v_player_id uuid; v_id uuid; v_status text;
begin
  perform public.admin_assert_official(_reason);
  if _mode not in ('direct','invite','remove') then raise exception 'Invalid parent-link action.'; end if;
  select id into v_parent_id from public.parent_profiles where user_id=_parent_user_id limit 1;
  select id into v_player_id from public.player_profiles where user_id=_player_user_id limit 1;
  if v_parent_id is null or v_player_id is null then raise exception 'Parent or player profile not found.'; end if;
  select id into v_id from public.parent_player_links where parent_profile_id=v_parent_id and player_profile_id=v_player_id limit 1;
  v_status := case when _mode='direct' then 'approved' when _mode='invite' then 'pending' else 'removed' end;
  if v_id is null then
    insert into public.parent_player_links(parent_profile_id,player_profile_id,status,relationship_to_player,notes,requested_by_user_id,approved_by_user_id,approved_at)
    values(v_parent_id,v_player_id,v_status,_relationship,_notes,auth.uid(),case when v_status='approved' then auth.uid() end,case when v_status='approved' then now() end)
    returning id into v_id;
  else
    update public.parent_player_links set status=v_status,relationship_to_player=_relationship,notes=_notes,
      requested_by_user_id=auth.uid(),approved_by_user_id=case when v_status='approved' then auth.uid() end,
      approved_at=case when v_status='approved' then now() end,
      removed_at=case when v_status='removed' then now() end,
      removed_by_user_id=case when v_status='removed' then auth.uid() end,
      updated_at=now() where id=v_id;
  end if;
  perform public.admin_write_audit('parent_link_'||_mode, 'parent_player_links', v_id::text, _player_user_id, _reason, null, jsonb_build_object('parent_user_id',_parent_user_id,'player_user_id',_player_user_id,'status',v_status));
  return v_id;
end;
$$;

create or replace function public.admin_get_audit_log(_target_user_id uuid default null, _limit integer default 100)
returns setof public.admin_audit_log
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();
  return query select * from public.admin_audit_log a
  where _target_user_id is null or a.target_account_id = _target_user_id
  order by a.created_at desc limit least(greatest(coalesce(_limit,100),1),500);
end;
$$;

revoke all on function public.admin_search_accounts(text,integer) from public;
revoke all on function public.admin_search_teams(text,integer) from public;
revoke all on function public.admin_get_account_bundle(uuid) from public;
revoke all on function public.admin_patch_account_record(uuid,text,jsonb,text) from public;
revoke all on function public.admin_set_contact(uuid,text,text,text,text) from public;
revoke all on function public.admin_set_pro_status(uuid,text,timestamptz,text) from public;
revoke all on function public.admin_upsert_player_statistics(uuid,text,jsonb,text) from public;
revoke all on function public.admin_delete_clip(uuid,text) from public;
revoke all on function public.admin_add_strike(uuid,text) from public;
revoke all on function public.admin_link_player_to_team(uuid,uuid,uuid,text,text) from public;
revoke all on function public.admin_link_coach_to_team(uuid,uuid,uuid,text,text) from public;
revoke all on function public.admin_remove_team_link(text,uuid,text) from public;
revoke all on function public.admin_manage_parent_link(uuid,uuid,text,text,text,text) from public;
revoke all on function public.admin_get_audit_log(uuid,integer) from public;

grant execute on function public.admin_search_accounts(text,integer) to authenticated;
grant execute on function public.admin_search_teams(text,integer) to authenticated;
grant execute on function public.admin_get_account_bundle(uuid) to authenticated;
grant execute on function public.admin_patch_account_record(uuid,text,jsonb,text) to authenticated;
grant execute on function public.admin_set_contact(uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_set_pro_status(uuid,text,timestamptz,text) to authenticated;
grant execute on function public.admin_upsert_player_statistics(uuid,text,jsonb,text) to authenticated;
grant execute on function public.admin_delete_clip(uuid,text) to authenticated;
grant execute on function public.admin_add_strike(uuid,text) to authenticated;
grant execute on function public.admin_link_player_to_team(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.admin_link_coach_to_team(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.admin_remove_team_link(text,uuid,text) to authenticated;
grant execute on function public.admin_manage_parent_link(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_get_audit_log(uuid,integer) to authenticated;

