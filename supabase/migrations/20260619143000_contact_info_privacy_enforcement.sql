-- Enforce profile contact privacy from one database-level source of truth.
-- Club and school/team accounts remain public by design.

alter table public.user_settings
  alter column show_contact_info set default 'everyone';

alter table public.user_settings
  drop constraint if exists user_settings_show_contact_info_check;

-- Rows created under the previous default should receive the new default.
update public.user_settings
set show_contact_info = 'everyone',
    updated_at = now()
where show_contact_info is null
   or show_contact_info not in ('everyone', 'staff_only', 'private')
   or (
     show_contact_info = 'staff_only'
     and abs(extract(epoch from (updated_at - created_at))) < 1
   );

alter table public.user_settings
  add constraint user_settings_show_contact_info_check
  check (show_contact_info in ('everyone', 'staff_only', 'private'));

-- Consolidate existing non-team contact fields into the protected contact table.
insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_email', trim(pp.contact_email), 'public'
from public.player_profiles pp
where pp.user_id is not null and nullif(trim(pp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_phone', trim(pp.contact_phone), 'public'
from public.player_profiles pp
where pp.user_id is not null and nullif(trim(pp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select sp.user_id, 'coach_email', trim(sp.contact_email), 'public'
from public.staff_profiles sp
where sp.user_id is not null and nullif(trim(sp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select sp.user_id, 'coach_phone', trim(sp.contact_phone), 'public'
from public.staff_profiles sp
where sp.user_id is not null and nullif(trim(sp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_email', trim(pp.contact_email), 'public'
from public.parent_profiles pp
where pp.user_id is not null and nullif(trim(pp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_phone', trim(pp.contact_phone), 'public'
from public.parent_profiles pp
where pp.user_id is not null and nullif(trim(pp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

create or replace function public.is_contact_privileged_viewer(_viewer_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles p
      where p.user_id = _viewer_user_id
        and (
          coalesce(p.account_role::text, '') in (
            'team_club',
            'head_coach_assistant',
            'trainer',
            'academy_director',
            'coach',
            'team',
            'staff'
          )
          or coalesce(p.role::text, '') in (
            'coach',
            'trainer',
            'academy_director',
            'team',
            'staff'
          )
        )
    ),
    false
  );
$$;

create or replace function public.is_public_team_contact_account(_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles p
      where p.user_id = _target_user_id
        and (
          coalesce(p.account_role::text, '') in ('team_club', 'team', 'school')
          or coalesce(p.role::text, '') in ('team', 'school')
        )
    )
    or exists (
      select 1
      from public.team_profiles tp
      where tp.user_id = _target_user_id
    ),
    false
  );
$$;

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

create or replace function public.set_contact_info_visibility(_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact_visibility text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if _visibility not in ('everyone', 'staff_only', 'private') then
    raise exception 'Invalid contact visibility option.';
  end if;

  insert into public.user_settings (user_id, show_contact_info)
  values (v_user_id, _visibility)
  on conflict (user_id)
  do update set
    show_contact_info = excluded.show_contact_info,
    updated_at = now();

  v_contact_visibility := case _visibility
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end;

  update public.user_contacts
  set visibility = v_contact_visibility,
      updated_at = now()
  where user_id = v_user_id;
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
    and public.can_view_contact_info(_target_user_id)
    and public.can_view_account_content(_target_user_id)
  order by uc.contact_type;
$$;

alter table public.user_contacts enable row level security;

drop policy if exists "Users can view own or public contacts" on public.user_contacts;
drop policy if exists "Users can view own or allowed contacts" on public.user_contacts;
drop policy if exists "Contact privacy controls contact visibility" on public.user_contacts;

create policy "Contact privacy controls contact visibility"
on public.user_contacts
for select
to public
using (public.can_view_contact_info(user_id));

-- Keep each stored row synchronized with its account-level setting.
update public.user_contacts uc
set visibility = case coalesce(us.show_contact_info, 'everyone')
  when 'everyone' then 'public'
  when 'staff_only' then 'restricted'
  else 'private'
end,
updated_at = now()
from public.user_settings us
where us.user_id = uc.user_id;

grant execute on function public.can_view_contact_info(uuid) to anon, authenticated;
grant execute on function public.get_profile_contact_info(uuid) to anon, authenticated;
grant execute on function public.set_contact_info_visibility(text) to authenticated;

comment on function public.can_view_contact_info(uuid) is
  'Returns whether the current viewer may see the target account contact information.';

comment on function public.get_profile_contact_info(uuid) is
  'Returns contact information only when both contact privacy and account visibility permit it.';
