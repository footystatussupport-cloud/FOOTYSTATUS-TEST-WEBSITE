-- =============================================================================
-- Footy Status Official contact visibility + editing override
-- =============================================================================
-- Fixes:
--   * Official/Admin can always read contact information, regardless of privacy.
--   * Referee contact rows are available through the same shared contact source
--     used by players/parents, avoiding duplicate referee-specific fields.
--   * admin_set_contact deletes blank rows instead of storing empty duplicates.
--   * admin_set_contact mirrors email/phone changes back into role profile tables
--     when those tables have contact_email/contact_phone columns.
-- =============================================================================

-- Backfill existing referee emails from profiles into the shared personal
-- contact slot if a row is missing. Phone numbers can only be restored if they
-- already exist in user_contacts, because profiles does not store a phone field.
insert into public.user_contacts (user_id, contact_type, value, visibility)
select
  p.user_id,
  'player_email',
  lower(trim(p.email)),
  case coalesce(us.show_contact_info, 'everyone')
    when 'private' then 'private'
    when 'staff_only' then 'restricted'
    else 'public'
  end
from public.profiles p
left join public.user_settings us on us.user_id = p.user_id
where p.user_id is not null
  and nullif(trim(coalesce(p.email, '')), '') is not null
  and (
    coalesce(p.account_role::text, '') = 'referee'
    or coalesce(p.account_type::text, '') = 'referee'
    or coalesce(p.account_category::text, '') = 'referee'
    or coalesce(p.role::text, '') = 'referee'
  )
on conflict (user_id, contact_type) do update
set value = case
      when nullif(trim(coalesce(public.user_contacts.value, '')), '') is null
      then excluded.value
      else public.user_contacts.value
    end,
    visibility = coalesce(public.user_contacts.visibility, excluded.visibility),
    updated_at = now();

create or replace function public.can_view_contact_info(_target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visibility text;
begin
  if _target_user_id is null then
    return false;
  end if;

  -- The protected Footy Status Official account is the safety/support override.
  -- This must happen before ordinary privacy checks.
  if public.is_footy_status_global_admin() then
    return true;
  end if;

  if auth.uid() = _target_user_id then
    return true;
  end if;

  if public.is_public_team_contact_account(_target_user_id) then
    return true;
  end if;

  select coalesce(us.show_contact_info, 'everyone')
  into v_visibility
  from public.user_settings us
  where us.user_id = _target_user_id;

  v_visibility := coalesce(v_visibility, 'everyone');

  if v_visibility = 'everyone' then
    return true;
  end if;

  if v_visibility = 'staff_only' then
    return public.is_contact_privileged_viewer(auth.uid());
  end if;

  return false;
end;
$$;

create or replace function public.get_profile_contact_info(_target_user_id uuid)
returns table (
  id uuid,
  contact_type text,
  value text,
  visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select uc.id, uc.contact_type, uc.value, uc.visibility
  from public.user_contacts uc
  where uc.user_id = _target_user_id
    and nullif(trim(coalesce(uc.value, '')), '') is not null
    and public.can_view_contact_info(_target_user_id)
    and (
      public.is_footy_status_global_admin()
      or public.can_view_account_content(_target_user_id)
    )
  order by
    case uc.contact_type
      when 'player_email' then 1
      when 'player_phone' then 2
      when 'coach_email' then 3
      when 'coach_phone' then 4
      when 'instagram' then 5
      when 'website' then 6
      when 'tiktok' then 7
      when 'youtube' then 8
      else 99
    end,
    uc.contact_type;
$$;

create or replace function public.admin_set_contact(
  _target_user_id uuid,
  _contact_type text,
  _value text,
  _visibility text default 'public',
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_clean_value text := nullif(trim(coalesce(_value, '')), '');
  v_visibility text := case
    when _visibility in ('public', 'restricted', 'private') then _visibility
    else 'public'
  end;
begin
  perform public.admin_assert_official(_reason);
  perform public.assert_admin_edit_target_allowed(_target_user_id, 'admin_set_contact');

  if _contact_type not in (
    'player_email',
    'player_phone',
    'coach_email',
    'coach_phone',
    'instagram',
    'tiktok',
    'youtube',
    'website'
  ) then
    raise exception 'Unsupported contact type: %', _contact_type;
  end if;

  select to_jsonb(x) into v_before
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  if v_clean_value is null then
    delete from public.user_contacts x
    where x.user_id = _target_user_id
      and x.contact_type = _contact_type;
  else
    insert into public.user_contacts(user_id, contact_type, value, visibility)
    values (_target_user_id, _contact_type, v_clean_value, v_visibility)
    on conflict (user_id, contact_type) do update
    set value = excluded.value,
        visibility = excluded.visibility,
        updated_at = now();
  end if;

  -- Keep normal profile tables synchronized when they own matching columns.
  if _contact_type in ('player_email', 'coach_email') then
    update public.profiles
    set email = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;
  end if;

  if _contact_type = 'player_email' then
    update public.player_profiles
    set contact_email = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;

    update public.parent_profiles
    set contact_email = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;
  elsif _contact_type = 'player_phone' then
    update public.player_profiles
    set contact_phone = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;

    update public.parent_profiles
    set contact_phone = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;
  elsif _contact_type = 'coach_email' then
    update public.staff_profiles
    set contact_email = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;
  elsif _contact_type = 'coach_phone' then
    update public.staff_profiles
    set contact_phone = v_clean_value,
        updated_at = now()
    where user_id = _target_user_id;
  end if;

  select to_jsonb(x) into v_after
  from public.user_contacts x
  where x.user_id = _target_user_id
    and x.contact_type = _contact_type;

  perform public.admin_write_audit(
    'private_contact_updated',
    'user_contacts',
    coalesce(v_after->>'id', v_before->>'id', _target_user_id::text || ':' || _contact_type),
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object(
      'contact_type', _contact_type,
      'value_present', v_clean_value is not null,
      'visibility', v_visibility
    )
  );

  return coalesce(v_after, jsonb_build_object(
    'user_id', _target_user_id,
    'contact_type', _contact_type,
    'deleted', true
  ));
end;
$$;

alter table public.user_contacts enable row level security;

drop policy if exists "Contact privacy controls contact visibility" on public.user_contacts;
create policy "Contact privacy controls contact visibility"
on public.user_contacts
for select
to public
using (public.can_view_contact_info(user_id));

grant execute on function public.can_view_contact_info(uuid) to anon, authenticated;
grant execute on function public.get_profile_contact_info(uuid) to anon, authenticated;
revoke all on function public.admin_set_contact(uuid, text, text, text, text) from public;
grant execute on function public.admin_set_contact(uuid, text, text, text, text) to authenticated;
