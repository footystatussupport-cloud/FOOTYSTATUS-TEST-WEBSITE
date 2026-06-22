-- Support direct Official-account administration from any viewed profile.

create or replace function public.admin_set_account_active(
  _target_user_id uuid,
  _active boolean,
  _reason text
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

  if _target_user_id = auth.uid() then
    raise exception 'The Footy Status Official account cannot disable itself.';
  end if;

  select to_jsonb(p) into v_before
  from public.profiles p
  where p.user_id = _target_user_id;

  if v_before is null then
    raise exception 'Account not found.';
  end if;

  update public.profiles
  set
    is_active = _active,
    deleted_at = case when _active then null else now() end,
    deleted_by = case when _active then null else auth.uid() end,
    updated_at = now()
  where user_id = _target_user_id;

  select to_jsonb(p) into v_after
  from public.profiles p
  where p.user_id = _target_user_id;

  perform public.admin_write_audit(
    case when _active then 'account_reactivated' else 'account_disabled' end,
    'profiles',
    _target_user_id::text,
    _target_user_id,
    _reason,
    v_before,
    v_after
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_account_active(uuid, boolean, text) from public;
grant execute on function public.admin_set_account_active(uuid, boolean, text) to authenticated;
