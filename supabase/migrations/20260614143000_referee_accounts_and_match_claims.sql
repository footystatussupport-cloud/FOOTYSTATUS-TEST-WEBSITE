alter table public.profiles
  add column if not exists referee_certification_level text,
  add column if not exists referee_license_number text,
  add column if not exists referee_certifying_organization text,
  add column if not exists referee_years_experience integer,
  add column if not exists referee_main_experience text,
  add column if not exists referee_assistant_experience text,
  add column if not exists referee_leagues_tournaments text,
  add column if not exists referee_availability text,
  add column if not exists referee_certification_proof_url text,
  add column if not exists referee_accolades text,
  add column if not exists referee_profile_public boolean not null default false;

create table if not exists public.referee_match_claims (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  referee_user_id uuid not null references public.profiles(user_id) on delete cascade,
  referee_type text not null check (referee_type in ('main_referee', 'assistant_referee', 'fourth_official', 'other')),
  show_name_publicly boolean not null default false,
  proof_url text,
  proof_file_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  review_notes text,
  reviewed_by uuid references public.profiles(user_id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, referee_user_id)
);

create index if not exists referee_match_claims_match_id_idx on public.referee_match_claims(match_id);
create index if not exists referee_match_claims_referee_user_id_idx on public.referee_match_claims(referee_user_id);
create index if not exists referee_match_claims_status_idx on public.referee_match_claims(status);

alter table public.referee_match_claims enable row level security;

create or replace function public.is_footy_status_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com';
$$;

drop policy if exists "referee claims visible to approved public owner and admins" on public.referee_match_claims;
drop policy if exists "referee claims visible to owner and admins" on public.referee_match_claims;
create policy "referee claims visible to owner and admins"
on public.referee_match_claims
for select
using (
  referee_user_id = auth.uid()
  or public.is_footy_status_admin()
);

create or replace function public.get_public_referee_match_assignments(_match_id uuid)
returns table (
  id uuid,
  match_id uuid,
  referee_user_id uuid,
  referee_type text,
  show_name_publicly boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  referee_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.match_id,
    c.referee_user_id,
    c.referee_type,
    c.show_name_publicly,
    c.status,
    c.created_at,
    c.updated_at,
    case when c.show_name_publicly then p.full_name else null end as referee_name
  from public.referee_match_claims c
  left join public.profiles p on p.user_id = c.referee_user_id
  where c.match_id = _match_id
    and c.status = 'approved';
$$;

drop policy if exists "referees can submit own match claims" on public.referee_match_claims;
create policy "referees can submit own match claims"
on public.referee_match_claims
for insert
with check (
  referee_user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and (p.account_category = 'referee' or p.account_role = 'referee' or p.role = 'referee')
  )
);

drop policy if exists "referees can update own claims and admins can review" on public.referee_match_claims;
create policy "referees can update own claims and admins can review"
on public.referee_match_claims
for update
using (
  referee_user_id = auth.uid()
  or public.is_footy_status_admin()
)
with check (
  referee_user_id = auth.uid()
  or public.is_footy_status_admin()
);

insert into storage.buckets (id, name, public)
select 'referee-proof', 'referee-proof', false
where not exists (
  select 1 from storage.buckets where id = 'referee-proof'
);

drop policy if exists "referees can upload own referee proof" on storage.objects;
create policy "referees can upload own referee proof"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'referee-proof'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "referees and admins can read referee proof" on storage.objects;
create policy "referees and admins can read referee proof"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'referee-proof'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_footy_status_admin()
  )
);

drop policy if exists "referees can update own referee proof" on storage.objects;
create policy "referees can update own referee proof"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'referee-proof'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'referee-proof'
  and (storage.foldername(name))[1] = auth.uid()::text
);
