-- Parents can link to any player account regardless of the player's age, and
-- linked parent contact information on a player profile follows the player's
-- contact privacy setting (everyone / staff_only / private) exactly like the
-- player's own contact information.

-- 1) Remove the ages 6-13 restriction from parent link requests.
create or replace function public.request_parent_player_link(
  _player_user_id uuid,
  _relationship text default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles;
  player_row public.player_profiles;
  active_link_count integer;
  link_id uuid;
begin
  select * into parent_row
  from public.parent_profiles
  where user_id = auth.uid();

  if parent_row.id is null then
    raise exception 'Only parent accounts can request parent-player links';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = _player_user_id;

  if player_row.id is null then
    raise exception 'Player profile not found';
  end if;

  if exists (
    select 1
    from public.parent_player_links ppl
    where ppl.parent_profile_id = parent_row.id
      and ppl.player_profile_id = player_row.id
      and ppl.status in ('pending', 'approved')
  ) then
    raise exception 'This parent connection already exists';
  end if;

  select count(*)
  into active_link_count
  from public.parent_player_links ppl
  where ppl.player_profile_id = player_row.id
    and ppl.status in ('pending', 'approved');

  if active_link_count >= 2 then
    raise exception 'This player already has two parent connection slots in use';
  end if;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    relationship_to_player,
    notes,
    removed_at,
    removed_by_user_id,
    denied_at,
    updated_at
  )
  values (
    parent_row.id,
    player_row.id,
    'pending',
    auth.uid(),
    nullif(trim(coalesce(_relationship, parent_row.relationship_to_player, '')), ''),
    nullif(trim(coalesce(_notes, '')), ''),
    null,
    null,
    null,
    now()
  )
  on conflict (parent_profile_id, player_profile_id) do update set
    status = 'pending',
    requested_by_user_id = auth.uid(),
    relationship_to_player = excluded.relationship_to_player,
    notes = excluded.notes,
    removed_at = null,
    removed_by_user_id = null,
    denied_at = null,
    updated_at = now()
  returning id into link_id;

  perform public.create_notification(
    player_row.user_id,
    auth.uid(),
    'parent_link_requested',
    'Parent connection request',
    coalesce(parent_row.full_name, 'A parent account') || ' requested to be linked as your parent or guardian.',
    'parent_player_link',
    link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', link_id, 'parent_user_id', parent_row.user_id),
    'parent_link_requested:' || link_id
  );

  return link_id;
end;
$$;

-- 2) Remove the age restriction from link reviews.
create or replace function public.review_parent_player_link(
  _link_id uuid,
  _approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  player_row public.player_profiles;
  parent_row public.parent_profiles;
  approved_count integer;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null or link_row.status <> 'pending' then
    raise exception 'Pending parent connection not found';
  end if;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  select * into parent_row
  from public.parent_profiles
  where id = link_row.parent_profile_id;

  if player_row.user_id <> auth.uid()
     and not public.is_footy_status_admin() then
    raise exception 'Only the player or Footy Status admin can review a pending request';
  end if;

  if _approve then
    select count(*) into approved_count
    from public.parent_player_links
    where player_profile_id = player_row.id
      and status = 'approved'
      and id <> _link_id;

    if approved_count >= 2 then
      raise exception 'This player already has two approved parent accounts';
    end if;
  end if;

  update public.parent_player_links
  set status = case when _approve then 'approved' else 'denied' end,
      approved_by_user_id = case when _approve then auth.uid() else null end,
      approved_at = case when _approve then now() else null end,
      denied_at = case when _approve then null else now() end,
      updated_at = now()
  where id = _link_id;

  perform public.create_notification(
    parent_row.user_id,
    player_row.user_id,
    case when _approve then 'parent_link_approved' else 'parent_link_denied' end,
    case when _approve then 'Parent connection approved' else 'Parent connection declined' end,
    case
      when _approve then coalesce(player_row.full_name, 'The player') || ' approved your parent connection.'
      else coalesce(player_row.full_name, 'The player') || ' declined your parent connection request.'
    end,
    'parent_player_link',
    _link_id,
    null,
    null,
    null,
    '/profile',
    jsonb_build_object('link_id', _link_id, 'player_profile_id', player_row.id),
    'parent_link_reviewed:' || _link_id || ':' || case when _approve then 'approved' else 'denied' end
  );
end;
$$;

-- 3) Notification fan-out follows approved links for players of any age.
create or replace function public.fan_out_child_notification_to_parents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_link record;
  child_profile public.player_profiles;
begin
  if coalesce((new.metadata ->> 'parent_copy')::boolean, false) then
    return new;
  end if;

  select * into child_profile
  from public.player_profiles
  where user_id = new.user_id;

  if child_profile.id is null then
    return new;
  end if;

  for parent_link in
    select ppl.id as link_id, pp.user_id as parent_user_id
    from public.parent_player_links ppl
    join public.parent_profiles pp on pp.id = ppl.parent_profile_id
    where ppl.player_profile_id = child_profile.id
      and ppl.status = 'approved'
  loop
    perform public.create_notification(
      parent_link.parent_user_id,
      new.actor_user_id,
      'child_' || new.type,
      new.title,
      replace(
        replace(new.body, ' your ', ' your child''s '),
        'You ',
        'Your child '
      ),
      new.entity_type,
      new.entity_id,
      new.team_id,
      new.club_team_id,
      new.clip_id,
      coalesce(new.link_path, '/player/' || child_profile.id),
      coalesce(new.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'parent_copy', true,
          'child_user_id', child_profile.user_id,
          'child_player_profile_id', child_profile.id,
          'source_notification_id', new.id,
          'parent_link_id', parent_link.link_id
        ),
      'parent_copy:' || new.id || ':' || parent_link.parent_user_id,
      child_profile.user_id
    );
  end loop;

  return new;
end;
$$;

-- 4) Linked parent contact info on a player profile now follows the player's
--    contact privacy setting, exactly like the player's own contact info.
--    The linked parent can always see their own connection details.
create or replace function public.user_can_view_parent_contacts(_player_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_view_contact_info(_player_user_id)
    or exists (
      select 1
      from public.parent_player_links ppl
      join public.parent_profiles pp on pp.id = ppl.parent_profile_id
      join public.player_profiles pl on pl.id = ppl.player_profile_id
      where pl.user_id = _player_user_id
        and pp.user_id = auth.uid()
        and ppl.status = 'approved'
    );
$$;

comment on function public.user_can_view_parent_contacts(uuid) is
  'Linked parent contact info follows the player''s contact privacy setting (everyone / staff_only / private); the linked parent always sees their own details.';

-- 5) Existing accounts: make sure contact info typed during player/parent
--    signup exists in user_contacts so it can appear in the profile contact
--    section (visibility derived from each account's privacy setting).
insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_email', lower(trim(pp.contact_email)),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.player_profiles pp
left join public.user_settings us on us.user_id = pp.user_id
where pp.user_id is not null and nullif(trim(pp.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select pp.user_id, 'player_phone', trim(pp.contact_phone),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.player_profiles pp
left join public.user_settings us on us.user_id = pp.user_id
where pp.user_id is not null and nullif(trim(pp.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select par.user_id, 'player_email', lower(trim(par.contact_email)),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.parent_profiles par
left join public.user_settings us on us.user_id = par.user_id
where par.user_id is not null and nullif(trim(par.contact_email), '') is not null
on conflict (user_id, contact_type) do nothing;

insert into public.user_contacts (user_id, contact_type, value, visibility)
select par.user_id, 'player_phone', trim(par.contact_phone),
  case coalesce(us.show_contact_info, 'staff_only')
    when 'everyone' then 'public'
    when 'staff_only' then 'restricted'
    else 'private'
  end
from public.parent_profiles par
left join public.user_settings us on us.user_id = par.user_id
where par.user_id is not null and nullif(trim(par.contact_phone), '') is not null
on conflict (user_id, contact_type) do nothing;
