-- =============================================================================
-- 5-digit team code: authoritative preview (with gender) + repeatable joining
-- =============================================================================
-- 1) NEW public.preview_club_team_by_access_code(text)
--    Returns the team name, age group, GENDER and league for a valid 5-digit
--    code, straight from the database records -- so the player never has to open
--    the team profile just to see the gender, and the client never supplies any
--    of these values.
--
--    Privacy: the function returns ZERO ROWS for anything the player may not
--    access (wrong gender, inactive team, unapproved parent, bad code, or a
--    non-player account). Returning no rows -- rather than an error naming the
--    team -- means restricted team details can never leak through the preview,
--    an error message, or a cached client response. The caller shows one
--    general message: "This team is not available for your account."
--
-- 2) join_club_team_with_access_code() now raises a clear, safe message when the
--    player is already on that roster, instead of silently returning the
--    existing membership (which made the UI claim a fresh join). No duplicate
--    membership is ever created. Eligibility failures are collapsed into the
--    same general message so a restricted team is never described.
--
-- Existing gender enforcement, RLS, approval, invite and roster rules are
-- unchanged -- this migration adds a read-only preview and improves messaging.
-- Safe to run more than once.
-- =============================================================================

create or replace function public.preview_club_team_by_access_code(_access_code text)
returns table (
  club_team_id uuid,
  team_id uuid,
  team_name text,
  age_group text,
  gender text,
  league_name text,
  already_member boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\D+', '', 'g');
  player_row public.player_profiles;
  club_team_row public.club_teams;
  team_row public.teams;
begin
  -- Every failure below returns no rows on purpose: never reveal that a code is
  -- valid for a team this account is not allowed to see.
  if auth.uid() is null then
    return;
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    return;
  end if;

  -- Gender comes from the authenticated player profile, never from the client.
  select *
  into player_row
  from public.player_profiles
  where user_id = auth.uid()
  limit 1;

  if player_row.id is null or player_row.player_gender is null then
    return;
  end if;

  select ct.*
  into club_team_row
  from public.club_teams ct
  where ct.status = 'active'
    and (
      ct.access_code_value = normalized_code
      or ct.access_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    )
  order by ct.access_code_updated_at desc nulls last, ct.created_at desc
  limit 1;

  if club_team_row.id is null then
    return;
  end if;

  -- Hard gender gate, mirroring assert_player_matches_daughter_team.
  if club_team_row.gender is null
     or club_team_row.gender is distinct from player_row.player_gender then
    return;
  end if;

  select *
  into team_row
  from public.teams
  where id = coalesce(club_team_row.parent_team_id, club_team_row.team_id)
  limit 1;

  if team_row.id is null
     or coalesce(team_row.approval_status, 'approved') <> 'approved' then
    return;
  end if;

  return query
  select
    club_team_row.id,
    team_row.id,
    team_row.name,
    club_team_row.age_group,
    club_team_row.gender,
    coalesce(
      nullif(trim(coalesce(club_team_row.league_name, '')), ''),
      (select l.name from public.leagues l where l.id = club_team_row.league_id limit 1)
    ),
    exists (
      select 1
      from public.player_team_memberships m
      where m.player_user_id = auth.uid()
        and m.team_id = team_row.id
        and m.club_team_id = club_team_row.id
        and m.status in ('accepted', 'approved')
    );
end;
$$;

revoke all on function public.preview_club_team_by_access_code(text) from public, anon;
grant execute on function public.preview_club_team_by_access_code(text) to authenticated;

comment on function public.preview_club_team_by_access_code(text) is
  'Authoritative 5-digit team-code preview (name, age group, gender, league). Returns no rows for any team the caller may not access.';

-- ---------------------------------------------------------------------------
-- Repeat-join messaging: no duplicate membership, and a clear reason.
-- Body is the existing function with two changes, marked inline.
-- ---------------------------------------------------------------------------
create or replace function public.join_club_team_with_access_code(_access_code text)
returns public.player_team_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(coalesce(_access_code, ''), '\D+', '', 'g');
  player_row public.player_profiles;
  club_team_row public.club_teams;
  club_row public.clubs;
  team_row public.teams;
  request_row public.team_join_requests;
  membership_row public.player_team_memberships;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if normalized_code !~ '^[0-9]{5}$' then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  select *
  into player_row
  from public.player_profiles
  where user_id = auth.uid()
  limit 1;

  if player_row.id is null then
    raise exception 'Only player accounts can join teams with an access code.';
  end if;

  select ct.*
  into club_team_row
  from public.club_teams ct
  where ct.status = 'active'
    and (
      ct.access_code_value = normalized_code
      or ct.access_code_hash = encode(extensions.digest(normalized_code, 'sha256'), 'hex')
    )
  order by ct.access_code_updated_at desc nulls last, ct.created_at desc
  limit 1;

  if club_team_row.id is null then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  select *
  into club_row
  from public.clubs
  where id = club_team_row.club_id
  limit 1;

  select *
  into team_row
  from public.teams
  where id = coalesce(club_team_row.parent_team_id, club_team_row.team_id)
  limit 1;

  if team_row.id is null or coalesce(team_row.approval_status, 'approved') <> 'approved' then
    raise exception 'Invalid access code. Please check the code and try again.';
  end if;

  perform public.assert_player_matches_daughter_team(club_team_row.id, player_row.id, auth.uid());

  select *
  into membership_row
  from public.player_team_memberships
  where player_user_id = auth.uid()
    and team_id = team_row.id
    and club_team_id = club_team_row.id
    and status in ('accepted', 'approved')
  order by approved_at desc nulls last, updated_at desc, created_at desc
  limit 1;

  -- CHANGE 1: entering the same code again must not look like a fresh join and
  -- must never create a second membership row.
  if membership_row.id is not null then
    raise exception 'You are already linked to this team.';
  end if;

  update public.team_join_requests
  set status = 'revoked',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where player_user_id = auth.uid()
    and status = 'pending';

  insert into public.team_join_requests (
    team_id,
    club_id,
    club_team_id,
    player_profile_id,
    player_user_id,
    league_id,
    age_group,
    access_code_last4,
    status,
    reviewed_by,
    reviewed_at
  )
  values (
    team_row.id,
    club_row.id,
    club_team_row.id,
    player_row.id,
    auth.uid(),
    club_team_row.league_id,
    club_team_row.age_group,
    right(normalized_code, 4),
    'approved',
    auth.uid(),
    now()
  )
  returning * into request_row;

  membership_row := public.sync_club_team_membership(
    player_row.id,
    auth.uid(),
    team_row.id,
    club_row.id,
    club_team_row.id,
    club_team_row.league_id,
    club_team_row.age_group,
    'approved',
    'code_join',
    auth.uid()
  );

  update public.team_player_invites
  set status = 'accepted',
      responded_at = now()
  where player_user_id = auth.uid()
    and team_id = team_row.id
    and club_team_id = club_team_row.id
    and status = 'pending';

  -- Unchanged from the existing implementation (existing invitation rules are
  -- preserved exactly; see the note in the summary about multi-team invites).
  update public.team_player_invites
  set status = 'revoked',
      responded_at = now()
  where player_user_id = auth.uid()
    and status = 'pending'
    and not (team_id = team_row.id and club_team_id = club_team_row.id);

  return membership_row;
exception
  when others then
    -- Pass the "already linked" message through untouched.
    if sqlerrm ilike '%already linked to this team%' then
      raise;
    end if;
    -- CHANGE 2: collapse eligibility/gender failures into one general message so
    -- a restricted team is never described to the player.
    if sqlerrm ilike '%not eligible%' then
      raise exception 'This team is not available for your account.';
    end if;
    raise;
end;
$$;

grant execute on function public.join_club_team_with_access_code(text) to authenticated;

notify pgrst, 'reload schema';
