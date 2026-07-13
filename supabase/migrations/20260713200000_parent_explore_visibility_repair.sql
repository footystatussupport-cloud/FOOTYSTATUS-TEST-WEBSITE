-- =============================================================================
-- Parent Explore visibility repair
-- =============================================================================
-- Parent accounts are standalone Footy Status profiles. They must appear in
-- Explore/search immediately after Google or email signup, even before a child
-- is linked. This migration repairs existing parent accounts and hardens the
-- future parent-profile sync trigger.
-- =============================================================================

-- 1) Repair existing parent-specific rows into the main searchable profiles row.
update public.profiles prof
set
  account_category = 'parent',
  account_type = 'parent',
  account_role = 'parent',
  role = 'parent',
  username = coalesce(
    nullif(trim(prof.username), ''),
    public.generate_unique_username(
      coalesce(
        nullif(trim(pp.full_name), ''),
        split_part(coalesce(pp.contact_email, prof.email, ''), '@', 1),
        'parent'
      ),
      prof.user_id
    )
  ),
  full_name = coalesce(nullif(trim(prof.full_name), ''), nullif(trim(pp.full_name), ''), 'Parent'),
  email = coalesce(nullif(trim(prof.email), ''), nullif(trim(pp.contact_email), '')),
  updated_at = now()
from public.parent_profiles pp
where pp.user_id = prof.user_id
  and pp.user_id is not null;

-- 2) If a parent_profiles row exists but the main profile row is missing, create
--    the main profile row with a safe generated username.
insert into public.profiles (
  user_id,
  email,
  full_name,
  username,
  account_category,
  account_type,
  account_role,
  role,
  updated_at
)
select
  pp.user_id,
  nullif(trim(pp.contact_email), ''),
  coalesce(nullif(trim(pp.full_name), ''), 'Parent'),
  public.generate_unique_username(
    coalesce(
      nullif(trim(pp.full_name), ''),
      split_part(coalesce(pp.contact_email, ''), '@', 1),
      'parent'
    ),
    pp.user_id
  ),
  'parent',
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

-- 3) If the main profile says parent but the parent_profiles row is missing,
--    create the role-specific parent row so parent profiles open correctly.
insert into public.parent_profiles (
  user_id,
  full_name,
  contact_email,
  contact_phone,
  relationship_to_player,
  updated_at
)
select
  prof.user_id,
  coalesce(nullif(trim(prof.full_name), ''), 'Parent'),
  nullif(trim(prof.email), ''),
  null,
  null,
  now()
from public.profiles prof
where prof.user_id is not null
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
  );

-- 4) Normalize any parent main profile rows that still have partial role fields.
update public.profiles
set
  account_category = 'parent',
  account_type = 'parent',
  account_role = 'parent',
  role = 'parent',
  username = coalesce(
    nullif(trim(username), ''),
    public.generate_unique_username(
      coalesce(
        nullif(trim(full_name), ''),
        split_part(coalesce(email, ''), '@', 1),
        'parent'
      ),
      user_id
    )
  ),
  full_name = coalesce(nullif(trim(full_name), ''), 'Parent'),
  updated_at = now()
where user_id is not null
  and (
    lower(coalesce(account_category::text, '')) = 'parent'
    or lower(coalesce(account_type::text, '')) = 'parent'
    or lower(coalesce(account_role::text, '')) = 'parent'
    or lower(coalesce(role::text, '')) = 'parent'
  );

-- 5) Keep future parent profile rows synced into the Explore/search source.
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
    account_type = 'parent',
    account_role = 'parent',
    role = 'parent',
    username = coalesce(
      nullif(trim(public.profiles.username), ''),
      public.generate_unique_username(
        coalesce(
          nullif(trim(new.full_name), ''),
          split_part(coalesce(new.contact_email, public.profiles.email, ''), '@', 1),
          'parent'
        ),
        new.user_id
      )
    ),
    full_name = coalesce(nullif(trim(public.profiles.full_name), ''), nullif(trim(new.full_name), ''), 'Parent'),
    email = coalesce(nullif(trim(public.profiles.email), ''), nullif(trim(new.contact_email), '')),
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
    account_type,
    account_role,
    role,
    updated_at
  )
  values (
    new.user_id,
    nullif(trim(new.contact_email), ''),
    coalesce(nullif(trim(new.full_name), ''), 'Parent'),
    public.generate_unique_username(
      coalesce(
        nullif(trim(new.full_name), ''),
        split_part(coalesce(new.contact_email, ''), '@', 1),
        'parent'
      ),
      new.user_id
    ),
    'parent',
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

grant execute on function public.sync_parent_profile_explore_identity() to authenticated;

comment on function public.sync_parent_profile_explore_identity() is
  'Keeps parent accounts visible as standalone searchable Explore profiles for Google/email signup and future edits.';
