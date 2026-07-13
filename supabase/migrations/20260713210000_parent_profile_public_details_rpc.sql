-- =============================================================================
-- Parent profile read-only details RPC
-- =============================================================================
-- Public parent profile pages should show the real saved parent profile details
-- to authenticated viewers, while edits remain restricted to the parent owner
-- and the protected Footy Status Admin through existing edit/admin paths.
-- =============================================================================

create or replace function public.get_parent_profile_details(_parent_user_id uuid)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  relationship_to_player text,
  contact_email text,
  contact_phone text,
  emergency_contact text,
  child_full_name text,
  child_where_plays text,
  parent_notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pp.id,
    pp.user_id,
    coalesce(nullif(trim(pp.full_name), ''), nullif(trim(prof.full_name), ''), 'Parent') as full_name,
    pp.relationship_to_player,
    pp.contact_email,
    pp.contact_phone,
    pp.emergency_contact,
    pp.child_full_name,
    pp.child_where_plays,
    pp.parent_notes
  from public.parent_profiles pp
  left join public.profiles prof on prof.user_id = pp.user_id
  where pp.user_id = _parent_user_id
    and (
      auth.uid() is not null
      or public.is_footy_status_admin()
      or public.is_footy_status_global_admin()
    )

  union all

  select
    null::uuid as id,
    prof.user_id,
    coalesce(nullif(trim(prof.full_name), ''), 'Parent') as full_name,
    null::text as relationship_to_player,
    prof.email as contact_email,
    null::text as contact_phone,
    null::text as emergency_contact,
    null::text as child_full_name,
    null::text as child_where_plays,
    null::text as parent_notes
  from public.profiles prof
  where prof.user_id = _parent_user_id
    and (
      lower(coalesce(prof.account_category::text, '')) = 'parent'
      or lower(coalesce(prof.account_type::text, '')) = 'parent'
      or lower(coalesce(prof.account_role::text, '')) = 'parent'
      or lower(coalesce(prof.role::text, '')) = 'parent'
    )
    and not exists (
      select 1
      from public.parent_profiles pp
      where pp.user_id = prof.user_id
    )
    and (
      auth.uid() is not null
      or public.is_footy_status_admin()
      or public.is_footy_status_global_admin()
    )
  limit 1;
$$;

grant execute on function public.get_parent_profile_details(uuid) to authenticated;

comment on function public.get_parent_profile_details(uuid) is
  'Read-only parent profile details for parent profile pages. Edits still go through owner/admin update paths.';
