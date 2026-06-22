create or replace function public.leave_current_team()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_team_name text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select m.team_id, t.name
  into v_team_id, v_team_name
  from public.player_team_memberships m
  left join public.teams t on t.id = m.team_id
  where m.player_user_id = v_user_id
    and m.status in ('accepted', 'approved')
  order by m.approved_at desc nulls last, m.created_at desc
  limit 1;

  update public.player_team_memberships
  set status = 'revoked',
      updated_at = now()
  where player_user_id = v_user_id
    and status in ('accepted', 'approved', 'pending')
    and (v_team_id is null or team_id = v_team_id);

  update public.team_join_requests
  set status = 'revoked',
      reviewed_at = now()
  where player_user_id = v_user_id
    and status in ('approved', 'pending')
    and (v_team_id is null or team_id = v_team_id);

  update public.profiles
  set team_name = null,
      updated_at = now()
  where user_id = v_user_id;

  update public.player_profiles
  set team = null,
      updated_at = now()
  where user_id = v_user_id;

  update public.players
  set team_id = null,
      club = case when v_team_name is not null and club = v_team_name then null else club end
  where user_id = v_user_id
     or lower(coalesce(name, '')) = lower(coalesce((select full_name from public.profiles where user_id = v_user_id), ''));
end;
$$;

grant execute on function public.leave_current_team() to authenticated;
