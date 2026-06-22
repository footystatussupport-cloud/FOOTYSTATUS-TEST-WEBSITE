alter table public.team_player_invites
  drop constraint if exists team_player_invites_status_check;

alter table public.team_player_invites
  add constraint team_player_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired'));

alter table public.coach_staff_team_invites
  drop constraint if exists coach_staff_team_invites_status_check;

alter table public.coach_staff_team_invites
  add constraint coach_staff_team_invites_status_check
  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired'));
