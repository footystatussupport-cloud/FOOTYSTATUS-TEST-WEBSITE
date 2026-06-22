create or replace function public.is_match_admin(_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $is_match_admin$
  select exists (
    select 1
    from auth.users u
    where u.id = _user_id
      and lower(coalesce(u.email, '')) = 'footystatussupport@gmail.com'
  );
$is_match_admin$;

grant execute on function public.is_match_admin(uuid) to authenticated;
