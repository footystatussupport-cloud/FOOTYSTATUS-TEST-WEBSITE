alter table public.global_admin_users
  drop constraint if exists global_admin_users_official_email_check;

alter table public.global_admin_users
  add constraint global_admin_users_official_email_check
  check (lower(email) = 'footystatussupport@gmail.com');

delete from public.global_admin_users
where lower(email) <> 'footystatussupport@gmail.com';

insert into public.global_admin_users (user_id, email)
select user_id, lower(email)
from public.profiles
where lower(coalesce(email, '')) = 'footystatussupport@gmail.com'
on conflict (user_id) do update set email = excluded.email;

create or replace function public.is_footy_status_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com'
    and exists (
      select 1
      from public.global_admin_users gau
      where gau.user_id = auth.uid()
        and gau.role = 'footy_status_admin'
        and lower(gau.email) = 'footystatussupport@gmail.com'
    );
$$;

create or replace function public.seed_official_footy_status_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.global_admin_users (user_id, email)
  select user_id, lower(email)
  from public.profiles
  where user_id = auth.uid()
    and lower(coalesce(email, auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com'
  on conflict (user_id) do update set email = excluded.email;

  if not exists (select 1 from public.global_admin_users where user_id = auth.uid()) then
    raise exception 'Only the official Footy Status support account can become global admin';
  end if;
end;
$$;
