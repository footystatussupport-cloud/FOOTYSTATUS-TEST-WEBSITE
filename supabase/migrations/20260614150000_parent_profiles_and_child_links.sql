alter table public.parent_profiles
  add column if not exists emergency_contact text,
  add column if not exists child_full_name text,
  add column if not exists child_where_plays text,
  add column if not exists child_team text,
  add column if not exists child_league text,
  add column if not exists child_age_group text,
  add column if not exists parent_notes text;

alter table public.parent_player_links
  add column if not exists status text not null default 'pending',
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists denied_at timestamptz,
  add column if not exists relationship_to_player text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.parent_player_links
  drop constraint if exists parent_player_links_status_check;

alter table public.parent_player_links
  add constraint parent_player_links_status_check
  check (status in ('pending', 'approved', 'denied'));

create index if not exists parent_player_links_status_idx on public.parent_player_links(status);
create index if not exists parent_player_links_requested_by_idx on public.parent_player_links(requested_by_user_id);

create or replace function public.is_footy_status_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'footystatussupport@gmail.com';
$$;

create or replace function public.user_can_view_parent_contacts(_player_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() = _player_user_id
    or public.is_footy_status_admin()
    or exists (
      select 1
      from public.parent_player_links ppl
      join public.parent_profiles pp on pp.id = ppl.parent_profile_id
      join public.player_profiles pl on pl.id = ppl.player_profile_id
      where pl.user_id = _player_user_id
        and pp.user_id = auth.uid()
        and ppl.status = 'approved'
    )
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.player_user_id = _player_user_id
        and ptm.status in ('accepted', 'approved')
        and t.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.coach_staff_team_memberships cstm on cstm.team_id = ptm.team_id
      where ptm.player_user_id = _player_user_id
        and ptm.status in ('accepted', 'approved')
        and cstm.user_id = auth.uid()
        and cstm.status = 'approved'
    );
$$;

create or replace function public.request_parent_player_link(_player_user_id uuid, _relationship text default null, _notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_row public.parent_profiles;
  player_row public.player_profiles;
  link_id uuid;
begin
  select * into parent_row
  from public.parent_profiles
  where user_id = auth.uid();

  if parent_row.id is null then
    raise exception 'Only parent accounts can request parent-player links.';
  end if;

  select * into player_row
  from public.player_profiles
  where user_id = _player_user_id;

  if player_row.id is null then
    raise exception 'Player profile not found.';
  end if;

  insert into public.parent_player_links (
    parent_profile_id,
    player_profile_id,
    status,
    requested_by_user_id,
    relationship_to_player,
    notes
  )
  values (
    parent_row.id,
    player_row.id,
    'pending',
    auth.uid(),
    nullif(trim(coalesce(_relationship, parent_row.relationship_to_player, '')), ''),
    nullif(trim(coalesce(_notes, '')), '')
  )
  on conflict (parent_profile_id, player_profile_id) do update set
    status = case
      when public.parent_player_links.status = 'approved' then 'approved'
      else 'pending'
    end,
    requested_by_user_id = auth.uid(),
    relationship_to_player = excluded.relationship_to_player,
    notes = excluded.notes,
    denied_at = null,
    updated_at = now()
  returning id into link_id;

  return link_id;
end;
$$;

create or replace function public.review_parent_player_link(_link_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.parent_player_links;
  player_row public.player_profiles;
begin
  select * into link_row
  from public.parent_player_links
  where id = _link_id;

  if link_row.id is null then
    raise exception 'Parent link not found.';
  end if;

  select * into player_row
  from public.player_profiles
  where id = link_row.player_profile_id;

  if player_row.user_id <> auth.uid() and not public.is_footy_status_admin() then
    raise exception 'Only the player or Footy Status admin can approve this parent link.';
  end if;

  update public.parent_player_links
  set
    status = case when _approve then 'approved' else 'denied' end,
    approved_by_user_id = case when _approve then auth.uid() else null end,
    approved_at = case when _approve then now() else null end,
    denied_at = case when _approve then null else now() end,
    updated_at = now()
  where id = _link_id;
end;
$$;

create or replace function public.get_player_private_parent_contacts(_player_user_id uuid)
returns table (
  link_id uuid,
  parent_user_id uuid,
  parent_full_name text,
  contact_email text,
  contact_phone text,
  emergency_contact text,
  relationship_to_player text,
  notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ppl.id,
    pp.user_id,
    pp.full_name,
    pp.contact_email,
    pp.contact_phone,
    pp.emergency_contact,
    coalesce(ppl.relationship_to_player, pp.relationship_to_player),
    coalesce(ppl.notes, pp.parent_notes)
  from public.parent_player_links ppl
  join public.parent_profiles pp on pp.id = ppl.parent_profile_id
  join public.player_profiles pl on pl.id = ppl.player_profile_id
  where pl.user_id = _player_user_id
    and ppl.status = 'approved'
    and public.user_can_view_parent_contacts(_player_user_id);
$$;

drop policy if exists "Parent profiles are viewable by everyone" on public.parent_profiles;
drop policy if exists "Parent profiles private to owner linked player and admins" on public.parent_profiles;
create policy "Parent profiles private to owner linked player and admins"
on public.parent_profiles
for select
using (
  user_id = auth.uid()
  or public.is_footy_status_admin()
  or exists (
    select 1
    from public.parent_player_links ppl
    join public.player_profiles pl on pl.id = ppl.player_profile_id
    where ppl.parent_profile_id = parent_profiles.id
      and ppl.status = 'approved'
      and pl.user_id = auth.uid()
  )
);

drop policy if exists "Parent player links viewable by involved parties" on public.parent_player_links;
drop policy if exists "Parent player links visible to involved parties and admins" on public.parent_player_links;
create policy "Parent player links visible to involved parties and admins"
on public.parent_player_links
for select
using (
  public.is_footy_status_admin()
  or exists (
    select 1 from public.parent_profiles pp
    where pp.id = parent_profile_id and pp.user_id = auth.uid()
  )
  or exists (
    select 1 from public.player_profiles pl
    where pl.id = player_profile_id and pl.user_id = auth.uid()
  )
);

drop policy if exists "Parents can create links to players" on public.parent_player_links;
drop policy if exists "Parents can request links to players" on public.parent_player_links;
create policy "Parents can request links to players"
on public.parent_player_links
for insert
with check (
  exists (
    select 1 from public.parent_profiles pp
    where pp.id = parent_profile_id and pp.user_id = auth.uid()
  )
);

drop policy if exists "Players parents and admins can update parent links" on public.parent_player_links;
create policy "Players parents and admins can update parent links"
on public.parent_player_links
for update
using (
  public.is_footy_status_admin()
  or exists (
    select 1 from public.parent_profiles pp
    where pp.id = parent_profile_id and pp.user_id = auth.uid()
  )
  or exists (
    select 1 from public.player_profiles pl
    where pl.id = player_profile_id and pl.user_id = auth.uid()
  )
)
with check (
  public.is_footy_status_admin()
  or exists (
    select 1 from public.parent_profiles pp
    where pp.id = parent_profile_id and pp.user_id = auth.uid()
  )
  or exists (
    select 1 from public.player_profiles pl
    where pl.id = player_profile_id and pl.user_id = auth.uid()
  )
);
