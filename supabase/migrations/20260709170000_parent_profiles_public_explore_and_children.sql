-- Parent accounts must behave like real Footy Status profiles:
-- searchable in Explore, openable through /parent/:userId, and able to show
-- approved linked children to other authenticated accounts while still
-- respecting boy/girl player visibility rules.

-- 1) Backfill existing parent profile rows into the main profiles table so
--    Explore/search can find parent accounts by name and username.
--    Do this as UPDATE-then-INSERT instead of UPSERT because the username
--    trigger runs before ON CONFLICT and can falsely treat the existing row's
--    own username as "already taken."
update public.profiles prof
set
  account_category = 'parent',
  account_role = 'parent',
  role = 'parent',
  username = coalesce(nullif(prof.username, ''), 'parent_' || left(replace(prof.user_id::text, '-', ''), 13)),
  full_name = coalesce(nullif(prof.full_name, ''), pp.full_name),
  email = coalesce(prof.email, pp.contact_email),
  updated_at = now()
from public.parent_profiles pp
where pp.user_id = prof.user_id
  and pp.user_id is not null;

insert into public.profiles (
  user_id,
  email,
  full_name,
  username,
  account_category,
  account_role,
  role,
  updated_at
)
select
  pp.user_id,
  pp.contact_email,
  pp.full_name,
  'parent_' || left(replace(pp.user_id::text, '-', ''), 13),
  'parent',
  'parent',
  'parent',
  now()
from public.parent_profiles pp
where pp.user_id is not null
  and not exists (
    select 1
    from public.profiles prof
    where prof.user_id = pp.user_id
  );

-- 2) Keep future parent profile rows synced into profiles immediately.
create or replace function public.sync_parent_profile_explore_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  update public.profiles
  set
    account_category = 'parent',
    account_role = 'parent',
    role = 'parent',
    username = coalesce(nullif(public.profiles.username, ''), 'parent_' || left(replace(new.user_id::text, '-', ''), 13)),
    full_name = coalesce(nullif(public.profiles.full_name, ''), new.full_name),
    email = coalesce(public.profiles.email, new.contact_email),
    updated_at = now()
  where user_id = new.user_id;

  if found then
    return new;
  end if;

  insert into public.profiles (
    user_id,
    email,
    full_name,
    username,
    account_category,
    account_role,
    role,
    updated_at
  )
  values (
    new.user_id,
    new.contact_email,
    new.full_name,
    'parent_' || left(replace(new.user_id::text, '-', ''), 13),
    'parent',
    'parent',
    'parent',
    now()
  );

  return new;
end;
$$;

drop trigger if exists sync_parent_profile_explore_identity_trigger on public.parent_profiles;
create trigger sync_parent_profile_explore_identity_trigger
after insert or update of user_id, full_name, contact_email
on public.parent_profiles
for each row
execute function public.sync_parent_profile_explore_identity();

-- 3) Public parent profiles should show approved linked children to viewers who
--    are allowed to see those player profiles. Parent/admin still see pending
--    links for management.
drop function if exists public.get_parent_linked_children(uuid);

create or replace function public.get_parent_linked_children(_parent_user_id uuid)
returns table (
  link_id uuid,
  status text,
  relationship_to_player text,
  notes text,
  created_at timestamptz,
  approved_at timestamptz,
  player_profile_id uuid,
  player_user_id uuid,
  player_full_name text,
  player_username text,
  player_avatar_url text,
  player_team text,
  player_team_name text,
  player_position text,
  player_age_birth_year text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id as link_id,
    ppl.status,
    coalesce(ppl.relationship_to_player, par.relationship_to_player) as relationship_to_player,
    coalesce(ppl.notes, par.parent_notes) as notes,
    ppl.created_at,
    ppl.approved_at,
    pl.id as player_profile_id,
    pl.user_id as player_user_id,
    coalesce(pl.full_name, prof.full_name) as player_full_name,
    prof.username as player_username,
    coalesce(prof.avatar_url, pl.profile_image_url) as player_avatar_url,
    pl.team as player_team,
    prof.team_name as player_team_name,
    pl.position as player_position,
    prof.age_birth_year as player_age_birth_year
  from public.parent_player_links ppl
  join public.parent_profiles par on par.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  left join public.profiles prof on prof.user_id = pl.user_id
  where par.user_id = _parent_user_id
    and ppl.status <> 'removed'
    and (
      (
        ppl.status = 'approved'
        and public.can_view_player_profile(pl.id)
      )
      or (
        ppl.status = 'pending'
        and (
          auth.uid() = _parent_user_id
          or public.is_footy_status_admin()
          or public.is_footy_status_global_admin()
        )
      )
    )
  order by
    case ppl.status when 'pending' then 0 else 1 end,
    ppl.created_at desc;
$$;

grant execute on function public.sync_parent_profile_explore_identity() to authenticated;
grant execute on function public.get_parent_linked_children(uuid) to authenticated;

comment on function public.get_parent_linked_children(uuid) is
  'Public parent profile linked children. Shows approved children to viewers allowed by can_view_player_profile; parent/admin also see pending links.';
