alter table public.leagues enable row level security;

drop policy if exists "Leagues viewable by everyone" on public.leagues;
create policy "Leagues viewable by everyone"
on public.leagues
for select
to public
using (true);

drop policy if exists "Match admins can insert leagues" on public.leagues;
create policy "Match admins can insert leagues"
on public.leagues
for insert
to authenticated
with check (
  public.is_match_admin(auth.uid())
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "Match admins can update leagues" on public.leagues;
create policy "Match admins can update leagues"
on public.leagues
for update
to authenticated
using (public.is_match_admin(auth.uid()))
with check (public.is_match_admin(auth.uid()));

drop policy if exists "Match admins can delete leagues" on public.leagues;
create policy "Match admins can delete leagues"
on public.leagues
for delete
to authenticated
using (public.is_match_admin(auth.uid()));
