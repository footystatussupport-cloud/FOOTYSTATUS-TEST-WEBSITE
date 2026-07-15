-- =============================================================================
-- League profile pictures (admin-only)
-- =============================================================================
-- Adds a logo_url field to leagues and a dedicated public-read `league-logos`
-- storage bucket whose writes are restricted to the official Footy Status Admin.
--
-- The leagues table itself already restricts INSERT/UPDATE/DELETE to match
-- admins (20260330151500), so saving logo_url is already backend-protected. The
-- storage policies below make the actual image files admin-write / public-read,
-- so no other account can upload/replace/delete a league image even by calling
-- storage directly. Images are foldered by league id: `<league_id>/<file>`.
-- Safe to run more than once.
-- =============================================================================

alter table public.leagues
  add column if not exists logo_url text;

-- Public bucket for league logos.
insert into storage.buckets (id, name, public)
select 'league-logos', 'league-logos', true
where not exists (select 1 from storage.buckets where id = 'league-logos');

-- Anyone may view league logos.
drop policy if exists "Anyone can view league logos" on storage.objects;
create policy "Anyone can view league logos"
on storage.objects
for select
using (bucket_id = 'league-logos');

-- Only the official Footy Status Admin may upload league logos.
drop policy if exists "Footy Status admin can upload league logos" on storage.objects;
create policy "Footy Status admin can upload league logos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'league-logos'
  and public.is_footy_status_global_admin()
);

-- Only the official Footy Status Admin may replace league logos.
drop policy if exists "Footy Status admin can update league logos" on storage.objects;
create policy "Footy Status admin can update league logos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'league-logos'
  and public.is_footy_status_global_admin()
)
with check (
  bucket_id = 'league-logos'
  and public.is_footy_status_global_admin()
);

-- Only the official Footy Status Admin may delete league logos.
drop policy if exists "Footy Status admin can delete league logos" on storage.objects;
create policy "Footy Status admin can delete league logos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'league-logos'
  and public.is_footy_status_global_admin()
);
