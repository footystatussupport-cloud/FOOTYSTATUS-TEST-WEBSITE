alter table public.coach_staff_team_memberships
  drop constraint if exists coach_staff_team_memberships_team_id_coach_user_id_key;

alter table public.coach_staff_team_invites
  drop constraint if exists coach_staff_team_invites_team_id_coach_user_id_status_key;

alter table public.coach_staff_join_requests
  drop constraint if exists coach_staff_join_requests_team_id_coach_user_id_status_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_staff_memberships_team_subteam_user_key'
  ) then
    alter table public.coach_staff_team_memberships
      add constraint coach_staff_memberships_team_subteam_user_key
      unique nulls not distinct (team_id, club_team_id, coach_user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_staff_invites_team_subteam_user_status_key'
  ) then
    alter table public.coach_staff_team_invites
      add constraint coach_staff_invites_team_subteam_user_status_key
      unique nulls not distinct (team_id, club_team_id, coach_user_id, status);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_staff_requests_team_subteam_user_status_key'
  ) then
    alter table public.coach_staff_join_requests
      add constraint coach_staff_requests_team_subteam_user_status_key
      unique nulls not distinct (team_id, club_team_id, coach_user_id, status);
  end if;
end $$;

drop policy if exists "coach staff requests insert own" on public.coach_staff_join_requests;
create policy "coach staff requests insert own"
  on public.coach_staff_join_requests for insert
  to authenticated
  with check (coach_user_id = auth.uid());

drop policy if exists "coach staff requests update own or team owner" on public.coach_staff_join_requests;
create policy "coach staff requests update own or team owner"
  on public.coach_staff_join_requests for update
  to authenticated
  using (
    coach_user_id = auth.uid()
    or exists (
      select 1
      from public.teams
      where teams.id = coach_staff_join_requests.team_id
      and teams.owner_user_id = auth.uid()
    )
  )
  with check (
    coach_user_id = auth.uid()
    or exists (
      select 1
      from public.teams
      where teams.id = coach_staff_join_requests.team_id
      and teams.owner_user_id = auth.uid()
    )
  );

drop policy if exists "coach staff memberships insert by coach or team owner" on public.coach_staff_team_memberships;
create policy "coach staff memberships insert by coach or team owner"
  on public.coach_staff_team_memberships for insert
  to authenticated
  with check (
    coach_user_id = auth.uid()
    or exists (
      select 1
      from public.teams
      where teams.id = coach_staff_team_memberships.team_id
      and teams.owner_user_id = auth.uid()
    )
  );
