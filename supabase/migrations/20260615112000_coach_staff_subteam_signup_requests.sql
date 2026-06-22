alter table public.coach_staff_team_memberships
  add column if not exists club_team_id uuid references public.club_teams(id) on delete set null,
  add column if not exists league_id uuid references public.leagues(id) on delete set null,
  add column if not exists age_group text;

alter table public.coach_staff_team_invites
  add column if not exists club_team_id uuid references public.club_teams(id) on delete set null,
  add column if not exists league_id uuid references public.leagues(id) on delete set null,
  add column if not exists age_group text;

alter table public.coach_staff_join_requests
  add column if not exists club_team_id uuid references public.club_teams(id) on delete set null,
  add column if not exists league_id uuid references public.leagues(id) on delete set null,
  add column if not exists age_group text;
