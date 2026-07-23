-- =============================================================================
-- Fix Coach/Staff -> Mother Club + Daughter Team linking
-- =============================================================================
-- SYMPTOM
--   A coach requests to join a mother club (optionally naming daughter teams),
--   the club accepts, the request status changes -- but the coach never appears
--   in the club's Coaching Staff / Team Staff section, the club never appears on
--   the coach's profile, and daughter-team assignments never show up.
--
-- EXACT CAUSE  (a stale unique constraint that was never actually dropped)
--   public.coach_staff_team_memberships was created with:
--       unique(team_id, coach_user_id, status)
--   Postgres auto-named that constraint
--       coach_staff_team_memberships_team_id_coach_user_id_STATUS_key
--   The later cleanup migration (20260615114000) intended to remove it, but
--   dropped the wrong name:
--       drop constraint if exists coach_staff_team_memberships_team_id_coach_user_id_key
--   (no "_status_"), so "if exists" silently matched nothing and the real
--   constraint survived. It correctly dropped the equivalent constraints on
--   coach_staff_team_invites and coach_staff_join_requests, which is why only
--   memberships are broken.
--
--   That surviving constraint allows a coach only ONE membership row per
--   (team_id, coach_user_id, status). But this system models the relationships
--   as one row per team + sub-team:
--       club_team_id IS NULL  -> mother-club staff membership
--       club_team_id = <id>   -> that daughter team's staff assignment
--   So the moment review_coach_staff_join_request() tries to write a mother
--   membership AND a daughter assignment (or two daughter assignments), the
--   second insert violates the stale constraint. That violation is NOT the
--   constraint named in the statement's ON CONFLICT clause
--   (coach_staff_memberships_team_subteam_user_key), so it is raised instead of
--   being merged -- and because the whole RPC is one transaction, EVERY insert
--   plus the status update rolls back. The relationships are never created.
--
-- FIX
--   1. Drop the stale constraint by its REAL name (and defensively by any other
--      unique constraint on exactly (team_id, coach_user_id, status)), so a
--      coach can hold one mother-club membership plus many daughter-team
--      assignments -- which is what the correct constraint,
--      coach_staff_memberships_team_subteam_user_key
--      UNIQUE NULLS NOT DISTINCT (team_id, club_team_id, coach_user_id),
--      already enforces (one row per coach per sub-team, no duplicates).
--   2. Guarantee that correct constraint exists.
--   3. Always create the mother-club staff membership on approval -- even when
--      the coach requested specific daughter teams. Previously the mother row
--      was only written for a "general club role" request, so a coach who asked
--      for a daughter team was never registered as club staff.
--
-- NOT CHANGED (verified correct before writing this migration):
--   * Tables/relationships -- coach_staff_team_memberships already IS the
--     source-of-truth link table with unique IDs (no teams_coached text is used
--     for linking), so no duplicate relationship system is introduced.
--   * Atomicity -- review_coach_staff_join_request is one plpgsql function, so
--     a failure rolls back the memberships AND the status: the request stays
--     pending and no partial link is left behind.
--   * Permission -- it requires is_team_manager_for(team_id, auth.uid()) or the
--     Footy Status admin, and submit_coach_club_link_request validates that every
--     requested daughter team belongs to that club, so a club cannot link a
--     coach to another club's daughter team and a coach cannot self-approve.
--   * Read access -- policy "coach staff memberships readable" (SELECT USING
--     true) already lets public profile pages display approved relationships.
--   * Daughter-team isolation -- fetchCoachStaffForClubTeam filters on the exact
--     club_team_id, so mother-club staff never leak onto every daughter team.
--
-- Safe to run repeatedly (idempotent). Deletes no rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the stale (team_id, coach_user_id, status) unique constraint.
--    Done by catalog lookup so the exact auto-generated name is matched even if
--    it differs from the expected one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'coach_staff_team_memberships'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by att.attname)
        from unnest(con.conkey) as k(attnum)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      ) = array['coach_user_id', 'status', 'team_id']
  loop
    execute format('alter table public.coach_staff_team_memberships drop constraint %I', v_conname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Guarantee the correct per-sub-team unique constraint exists. NULLS NOT
--    DISTINCT so the mother row (club_team_id IS NULL) is de-duplicated too,
--    which is what makes the ON CONFLICT upserts idempotent against repeated
--    clicks / network retries.
-- ---------------------------------------------------------------------------
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
end $$;

-- ---------------------------------------------------------------------------
-- 3. Always register the coach as mother-club staff on approval, then add each
--    requested daughter-team assignment.
-- ---------------------------------------------------------------------------
create or replace function public.review_coach_staff_join_request(
  _request_id uuid,
  _approve boolean
)
returns public.coach_staff_join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.coach_staff_join_requests;
  assignment jsonb;
  target_status text := case when _approve then 'approved' else 'rejected' end;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select *
  into request_row
  from public.coach_staff_join_requests
  where id = _request_id
  for update;

  if request_row.id is null or request_row.status <> 'pending' then
    raise exception 'Request not found or already handled';
  end if;

  if not public.is_team_manager_for(request_row.team_id, auth.uid())
     and not public.is_footy_status_global_admin() then
    raise exception 'You do not have permission to review this request';
  end if;

  if _approve then
    -- Mother-club staff membership is ALWAYS created (club_team_id is null),
    -- so an accepted coach appears in the club's staff section even when they
    -- also asked for specific daughter teams.
    insert into public.coach_staff_team_memberships (
      team_id, club_team_id, league_id, age_group,
      coach_user_id, staff_role, status, approved_at, updated_at
    )
    values (
      request_row.team_id,
      null,
      request_row.league_id,
      request_row.age_group,
      request_row.coach_user_id,
      coalesce(nullif(request_row.staff_role, ''), 'Coach'),
      'approved',
      now(),
      now()
    )
    on conflict on constraint coach_staff_memberships_team_subteam_user_key
    do update set
      staff_role = excluded.staff_role,
      status = 'approved',
      approved_at = now(),
      updated_at = now();

    -- One assignment row per requested daughter team.
    for assignment in
      select value from jsonb_array_elements(coalesce(request_row.requested_assignments, '[]'::jsonb))
    loop
      insert into public.coach_staff_team_memberships (
        team_id, club_team_id, league_id, age_group,
        coach_user_id, staff_role, status, approved_at, updated_at
      )
      values (
        request_row.team_id,
        (assignment->>'club_team_id')::uuid,
        nullif(assignment->>'league_id', '')::uuid,
        assignment->>'age_group',
        request_row.coach_user_id,
        assignment->>'role',
        'approved',
        now(),
        now()
      )
      on conflict on constraint coach_staff_memberships_team_subteam_user_key
      do update set
        league_id = excluded.league_id,
        age_group = excluded.age_group,
        staff_role = excluded.staff_role,
        status = 'approved',
        approved_at = now(),
        updated_at = now();
    end loop;
  end if;

  delete from public.coach_staff_join_requests r
  where r.id <> request_row.id
    and r.team_id = request_row.team_id
    and r.club_team_id is not distinct from request_row.club_team_id
    and r.coach_user_id = request_row.coach_user_id
    and r.status = target_status;

  update public.coach_staff_join_requests
  set status = target_status,
      reviewed_at = now()
  where id = request_row.id
  returning * into request_row;

  return request_row;
end;
$$;

grant execute on function public.review_coach_staff_join_request(uuid, boolean) to authenticated;

-- =============================================================================
-- ROLLBACK (not recommended -- re-adding the stale constraint reintroduces the
-- bug):
--   alter table public.coach_staff_team_memberships
--     add constraint coach_staff_team_memberships_team_id_coach_user_id_status_key
--     unique (team_id, coach_user_id, status);
--   -- and restore the previous function body from
--   -- 20260708100000_fix_coach_staff_request_review_lifecycle.sql
-- =============================================================================
