alter table public.profiles
  add column if not exists coaching_role_type text,
  add column if not exists teams_currently_coaching text,
  add column if not exists past_coaching_experience text,
  add column if not exists coaching_licenses text[],
  add column if not exists coaching_accolades text,
  add column if not exists coaching_location text,
  add column if not exists scout_role_title text,
  add column if not exists scout_organization text,
  add column if not exists scouting_licenses text[],
  add column if not exists scouting_experience text,
  add column if not exists scouting_regions text,
  add column if not exists scouting_age_groups text[],
  add column if not exists scouting_positions text[],
  add column if not exists scouting_accolades text;

create table if not exists public.coach_staff_team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  staff_role text,
  status text not null default 'approved' check (status in ('pending', 'approved', 'accepted', 'rejected', 'removed', 'left')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, coach_user_id)
);

create table if not exists public.coach_staff_team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  staff_role text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(team_id, coach_user_id, status)
);

create table if not exists public.coach_staff_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  coach_user_id uuid not null references auth.users(id) on delete cascade,
  staff_role text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(team_id, coach_user_id, status)
);

alter table public.coach_staff_team_memberships enable row level security;
alter table public.coach_staff_team_invites enable row level security;
alter table public.coach_staff_join_requests enable row level security;

drop policy if exists "coach staff memberships readable" on public.coach_staff_team_memberships;
create policy "coach staff memberships readable"
  on public.coach_staff_team_memberships for select
  using (true);

drop policy if exists "coach staff memberships manageable" on public.coach_staff_team_memberships;
create policy "coach staff memberships manageable"
  on public.coach_staff_team_memberships for all
  using (
    coach_user_id = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_team_memberships.team_id
      and teams.owner_user_id = auth.uid()
    )
  )
  with check (
    coach_user_id = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_team_memberships.team_id
      and teams.owner_user_id = auth.uid()
    )
  );

drop policy if exists "coach staff invites readable" on public.coach_staff_team_invites;
create policy "coach staff invites readable"
  on public.coach_staff_team_invites for select
  using (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_team_invites.team_id
      and teams.owner_user_id = auth.uid()
    )
  );

drop policy if exists "coach staff invites manageable" on public.coach_staff_team_invites;
create policy "coach staff invites manageable"
  on public.coach_staff_team_invites for all
  using (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_team_invites.team_id
      and teams.owner_user_id = auth.uid()
    )
  )
  with check (
    coach_user_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_team_invites.team_id
      and teams.owner_user_id = auth.uid()
    )
  );

drop policy if exists "coach staff requests readable" on public.coach_staff_join_requests;
create policy "coach staff requests readable"
  on public.coach_staff_join_requests for select
  using (
    coach_user_id = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_join_requests.team_id
      and teams.owner_user_id = auth.uid()
    )
  );

drop policy if exists "coach staff requests manageable" on public.coach_staff_join_requests;
create policy "coach staff requests manageable"
  on public.coach_staff_join_requests for all
  using (
    coach_user_id = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_join_requests.team_id
      and teams.owner_user_id = auth.uid()
    )
  )
  with check (
    coach_user_id = auth.uid()
    or exists (
      select 1 from public.teams
      where teams.id = coach_staff_join_requests.team_id
      and teams.owner_user_id = auth.uid()
    )
  );
