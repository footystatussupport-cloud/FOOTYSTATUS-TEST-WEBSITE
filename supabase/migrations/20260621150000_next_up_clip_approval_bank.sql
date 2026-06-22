-- Next Up Clip approval workflow.

alter table public.clips
  add column if not exists review_status text not null default 'approved',
  add column if not exists revision_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_for_review_at timestamptz;

alter table public.clips
  drop constraint if exists clips_review_status_check;

alter table public.clips
  add constraint clips_review_status_check
  check (review_status in ('pending_review', 'approved', 'needs_revision'));

update public.clips
set review_status = 'approved',
    reviewed_at = coalesce(reviewed_at, created_at)
where review_status is null;

create index if not exists idx_clips_review_bank
on public.clips(review_status, created_at desc);

create or replace function public.enforce_clip_review_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
    return new;
  end if;

  if public.is_footy_status_global_admin() then
    return new;
  end if;

  if new.review_status is distinct from old.review_status
     or new.revision_note is distinct from old.revision_note
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by then
    new.review_status := old.review_status;
    new.revision_note := old.revision_note;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;

  if old.review_status = 'needs_revision'
     and (
       new.video_url is distinct from old.video_url
       or new.title is distinct from old.title
       or new.caption is distinct from old.caption
       or new.description is distinct from old.description
     ) then
    new.review_status := 'pending_review';
    new.revision_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_for_review_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_clip_review_workflow_trigger on public.clips;
create trigger enforce_clip_review_workflow_trigger
before insert or update on public.clips
for each row execute function public.enforce_clip_review_workflow();

alter table public.clips enable row level security;

drop policy if exists "Clip review visibility" on public.clips;
create policy "Clip review visibility"
on public.clips
as restrictive
for select
to public
using (
  review_status = 'approved'
  or auth.uid() = user_id
  or public.is_footy_status_global_admin()
);

create or replace function public.get_pending_clip_reviews()
returns table (
  clip_id uuid,
  player_user_id uuid,
  player_name text,
  player_username text,
  player_gender text,
  account_role text,
  title text,
  caption text,
  video_url text,
  thumbnail_url text,
  uploaded_at timestamptz,
  review_status text,
  revision_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_official();

  return query
  select
    c.id,
    coalesce(c.user_id, pp.user_id),
    coalesce(p.full_name, pp.full_name, pl.name, 'Player'),
    p.username,
    coalesce(pp.player_gender, pl.player_gender),
    coalesce(p.account_role, p.role::text, 'player'),
    c.title,
    coalesce(c.caption, c.description),
    c.video_url,
    c.thumbnail_url,
    c.created_at,
    c.review_status,
    c.revision_note
  from public.clips c
  left join public.player_profiles pp on pp.id = c.player_id
  left join public.players pl on pl.id = c.player_id
  left join public.profiles p on p.user_id = coalesce(c.user_id, pp.user_id, pl.user_id)
  where c.review_status in ('pending_review', 'needs_revision')
  order by
    case when c.review_status = 'pending_review' then 0 else 1 end,
    coalesce(c.submitted_for_review_at, c.created_at) asc;
end;
$$;

create or replace function public.review_next_up_clip(
  _clip_id uuid,
  _decision text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_owner_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  perform public.admin_assert_official(
    case
      when _decision = 'approve' then 'Next Up Clip approved'
      else coalesce(nullif(trim(_note), ''), 'Next Up Clip revision requested')
    end
  );

  if _decision not in ('approve', 'revise') then
    raise exception 'Choose Approve or Revise.';
  end if;

  if _decision = 'revise' and length(trim(coalesce(_note, ''))) < 3 then
    raise exception 'Write a revision note for the player.';
  end if;

  select * into v_clip
  from public.clips
  where id = _clip_id
  for update;

  if v_clip.id is null then
    raise exception 'Clip not found.';
  end if;

  v_before := to_jsonb(v_clip);

  v_owner_id := coalesce(
    v_clip.user_id,
    (select pp.user_id from public.player_profiles pp where pp.id = v_clip.player_id limit 1),
    (select pl.user_id from public.players pl where pl.id = v_clip.player_id limit 1)
  );

  update public.clips
  set review_status = case when _decision = 'approve' then 'approved' else 'needs_revision' end,
      revision_note = case when _decision = 'revise' then trim(_note) else null end,
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = _clip_id;

  select to_jsonb(c) into v_after from public.clips c where c.id = _clip_id;

  if v_owner_id is not null then
    perform public.create_notification(
      _user_id := v_owner_id,
      _actor_user_id := auth.uid(),
      _type := case when _decision = 'approve' then 'clip_approved' else 'clip_needs_revision' end,
      _title := case when _decision = 'approve' then 'Next Up Clip authorized' else 'Next Up Clip needs revision' end,
      _body := case
        when _decision = 'approve' then 'Your Next Up Clip was authorized and is now live.'
        else 'Your Next Up Clip was not posted yet. Footy Status requested a revision: ' || trim(_note)
      end,
      _entity_type := 'clip',
      _entity_id := _clip_id,
      _clip_id := _clip_id,
      _link_path := '/profile',
      _metadata := jsonb_build_object('clip_id', _clip_id, 'review_status', case when _decision = 'approve' then 'approved' else 'needs_revision' end, 'revision_note', _note),
      _dedupe_key := 'clip_review:' || _clip_id::text || ':' || extract(epoch from now())::bigint::text
    );
  end if;

  perform public.admin_write_audit(
    case when _decision = 'approve' then 'next_up_clip_approved' else 'next_up_clip_needs_revision' end,
    'clips',
    _clip_id::text,
    v_owner_id,
    case when _decision = 'approve' then 'Next Up Clip approved' else trim(_note) end,
    v_before,
    v_after,
    jsonb_build_object('clip_id', _clip_id, 'decision', _decision, 'admin_note', _note)
  );

  return v_after;
end;
$$;

revoke all on function public.get_pending_clip_reviews() from public;
revoke all on function public.review_next_up_clip(uuid, text, text) from public;
grant execute on function public.get_pending_clip_reviews() to authenticated;
grant execute on function public.review_next_up_clip(uuid, text, text) to authenticated;

create or replace function public.get_next_up_feed(_limit integer default 12)
returns setof public.clips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(_limit, 12), 30));
begin
  if v_user_id is null then
    return query
    select c.*
    from public.clips c
    left join public.player_profiles pp on pp.id = c.player_id
    where c.review_status = 'approved'
      and c.visibility = 'public'
      and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
    order by random()
    limit v_limit;
    return;
  end if;

  return query
  with eligible as (
    select
      c.id,
      (
        1.0 + least(coalesce(es.bonus_exposures_remaining, 0), 100)::numeric / 20.0
      ) * case when public.clip_owner_is_active_pro(c.id) then 1.5 else 1.0 end as exposure_weight
    from public.clips c
    left join public.player_profiles pp on pp.id = c.player_id
    left join public.clip_exposure_state es on es.clip_id = c.id
    where c.review_status = 'approved'
      and c.visibility in ('public', 'restricted')
      and coalesce(c.user_id, pp.user_id) is distinct from v_user_id
      and public.can_view_account_content(coalesce(c.user_id, pp.user_id))
      and not exists (
        select 1 from public.clip_feed_impressions fi
        where fi.user_id = v_user_id and fi.clip_id = c.id
      )
  ),
  selected as (
    select e.id,
      row_number() over (
        order by (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1))
      ) as feed_position
    from eligible e
    order by (-ln(greatest(random(), 0.000001)) / greatest(e.exposure_weight, 0.1))
    limit v_limit
  ),
  inserted as (
    insert into public.clip_feed_impressions (user_id, clip_id)
    select v_user_id, s.id from selected s
    on conflict (user_id, clip_id) do nothing
    returning clip_id
  )
  select c.*
  from selected s
  join inserted i on i.clip_id = s.id
  join public.clips c on c.id = s.id
  order by s.feed_position;
end;
$$;

grant execute on function public.get_next_up_feed(integer) to anon, authenticated;
