create or replace function public.remove_referee_match_assignment(
  _claim_id uuid,
  _match_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.referee_match_claims;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  select *
  into claim_row
  from public.referee_match_claims
  where id = _claim_id
    and (_match_id is null or match_id = _match_id)
  limit 1;

  if claim_row.id is null then
    raise exception 'Referee assignment not found.';
  end if;

  if claim_row.referee_user_id <> v_user_id
     and not public.is_footy_status_admin() then
    raise exception 'Only the linked referee or Footy Status admin can remove this assignment.';
  end if;

  delete from public.referee_match_claims
  where id = claim_row.id;

  return true;
end;
$$;

grant execute on function public.remove_referee_match_assignment(uuid, uuid) to authenticated;
