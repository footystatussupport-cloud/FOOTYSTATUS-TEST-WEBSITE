create or replace function public.release_incomplete_signup_username(_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text;
  released_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  normalized_username := public.normalize_username(_username);

  if normalized_username = '' then
    return false;
  end if;

  update public.profiles p
  set
    username = public.generate_unique_username('incomplete_' || left(p.user_id::text, 8), p.user_id),
    username_last_changed_at = null
  where lower(p.username) = lower(normalized_username)
    and p.user_id is distinct from auth.uid()
    and (
      p.account_category is null
      or p.account_type is null
      or p.account_role is null
      or not exists (select 1 from public.player_profiles pp where pp.user_id = p.user_id)
        and coalesce(p.account_role, p.account_type, p.role) = 'player'
      or not exists (select 1 from public.parent_profiles par where par.user_id = p.user_id)
        and coalesce(p.account_role, p.account_type, p.role) = 'parent'
      or not exists (select 1 from public.staff_profiles sp where sp.user_id = p.user_id)
        and coalesce(p.account_category, '') = 'team_staff'
        and coalesce(p.account_role, p.account_type, p.role) not in ('team_club', 'school_team')
      or not exists (select 1 from public.team_profiles tp where tp.user_id = p.user_id)
        and coalesce(p.account_role, p.account_type, p.role) in ('team_club', 'school_team', 'team')
      or (
        coalesce(p.account_role, p.account_type, p.role) = 'referee'
        and (
          p.referee_certification_level is null
          or p.referee_certifying_organization is null
          or p.referee_years_experience is null
        )
      )
    );

  get diagnostics released_count = row_count;
  return released_count > 0;
end;
$$;

grant execute on function public.release_incomplete_signup_username(text) to authenticated;
