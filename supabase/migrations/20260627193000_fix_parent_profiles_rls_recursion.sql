-- Fix parent profile edit/save failures caused by recursive RLS policy checks.
-- The old parent_profiles SELECT policy looked through parent_player_links, while
-- parent_player_links policies looked back through parent_profiles. Supabase/Postgres
-- can detect that as infinite recursion when parent records are read during updates.

alter table if exists public.parent_profiles enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'parent_profiles'
  loop
    execute format('drop policy if exists %I on public.parent_profiles', policy_row.policyname);
  end loop;
end $$;

create policy "Parent profiles safe public read"
on public.parent_profiles
for select
to authenticated
using (true);

create policy "Parent profiles owner or official insert"
on public.parent_profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  or public.is_footy_status_global_admin()
  or public.is_footy_status_admin()
);

create policy "Parent profiles owner or official update"
on public.parent_profiles
for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_footy_status_global_admin()
  or public.is_footy_status_admin()
)
with check (
  user_id = auth.uid()
  or public.is_footy_status_global_admin()
  or public.is_footy_status_admin()
);

create policy "Parent profiles owner or official delete"
on public.parent_profiles
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_footy_status_global_admin()
  or public.is_footy_status_admin()
);

-- Keep service-role/backend maintenance unrestricted.
create policy "Parent profiles service role full access"
on public.parent_profiles
for all
to service_role
using (true)
with check (true);
