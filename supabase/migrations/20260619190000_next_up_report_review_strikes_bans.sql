-- Next Up content reporting, Official review, strikes, audit history, and temporary bans.

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  report_status text not null default 'pending'
    check (report_status in ('pending', 'dismissed', 'actioned', 'resolved')),
  report_reason text not null
    check (report_reason in ('inappropriate', 'harassment', 'copyright', 'spam')),
  report_message text not null default '' check (char_length(report_message) <= 200),
  reported_clip_id uuid references public.clips(id) on delete set null,
  reporter_account_id uuid not null references auth.users(id) on delete cascade,
  reported_account_id uuid not null references auth.users(id) on delete cascade,
  clip_title_snapshot text,
  clip_caption_snapshot text,
  clip_video_url_snapshot text,
  reporter_name_snapshot text,
  reported_name_snapshot text,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_content_reports_status_created
on public.content_reports(report_status, created_at desc);

create index if not exists idx_content_reports_reported_account
on public.content_reports(reported_account_id, created_at desc);

create table if not exists public.account_strikes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  related_report_id uuid references public.content_reports(id) on delete set null,
  reason text not null,
  action_taken text not null default 'strike_added',
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by_user_id uuid references auth.users(id) on delete set null,
  removal_reason text
);

create index if not exists idx_account_strikes_active
on public.account_strikes(account_id, created_at desc)
where removed_at is null;

create table if not exists public.temporary_bans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  related_report_id uuid references public.content_reports(id) on delete set null,
  ban_start_at timestamptz not null default now(),
  ban_end_at timestamptz not null,
  ban_reason text not null,
  ban_months integer not null check (ban_months in (3, 6)),
  automatic_from_three_strikes boolean not null default false,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  constraint temporary_bans_valid_dates check (ban_end_at > ban_start_at)
);

create unique index if not exists idx_temporary_bans_one_active
on public.temporary_bans(account_id)
where ended_at is null;

create table if not exists public.content_report_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.content_reports(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action_type text not null
    check (action_type in ('dismissed', 'strike_and_clip_deleted', 'temporary_ban', 'resolved', 'strike_removed')),
  target_account_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.content_reports enable row level security;
alter table public.account_strikes enable row level security;
alter table public.temporary_bans enable row level security;
alter table public.content_report_actions enable row level security;

drop policy if exists "Reporters can create reports" on public.content_reports;


drop policy if exists "Official account reviews reports" on public.content_reports;
create policy "Official account reviews reports"
on public.content_reports for all to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

drop policy if exists "Official account views strikes" on public.account_strikes;
create policy "Official account views strikes"
on public.account_strikes for all to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

drop policy if exists "Account views own bans or Official reviews bans" on public.temporary_bans;
create policy "Account views own bans or Official reviews bans"
on public.temporary_bans for select to authenticated
using (account_id = auth.uid() or public.is_footy_status_global_admin());

drop policy if exists "Official account manages bans" on public.temporary_bans;
create policy "Official account manages bans"
on public.temporary_bans for all to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

drop policy if exists "Official account views report actions" on public.content_report_actions;
create policy "Official account views report actions"
on public.content_report_actions for all to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

create or replace function public.submit_content_report(
  _clip_id uuid,
  _report_reason text,
  _report_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip public.clips;
  v_reported_account_id uuid;
  v_report_id uuid;
  v_reporter_name text;
  v_reported_name text;
  v_official_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to report content.';
  end if;

  if _report_reason not in ('inappropriate', 'harassment', 'copyright', 'spam') then
    raise exception 'Choose a valid report reason.';
  end if;

  if char_length(coalesce(_report_message, '')) > 200 then
    raise exception 'Tell us more must be 200 characters or fewer.';
  end if;

  select * into v_clip from public.clips where id = _clip_id;
  if v_clip.id is null then
    raise exception 'Clip not found.';
  end if;

  select coalesce(v_clip.user_id, pp.user_id)
  into v_reported_account_id
  from public.player_profiles pp
  where pp.id = v_clip.player_id;

  v_reported_account_id := coalesce(v_reported_account_id, v_clip.user_id);
  if v_reported_account_id is null then
    raise exception 'Reported account could not be identified.';
  end if;

  select coalesce(nullif(trim(full_name), ''), nullif(trim(username), ''), 'Footy Status user')
  into v_reporter_name
  from public.profiles where user_id = auth.uid();

  select coalesce(nullif(trim(full_name), ''), nullif(trim(username), ''), 'Footy Status user')
  into v_reported_name
  from public.profiles where user_id = v_reported_account_id;

  insert into public.content_reports (
    report_reason, report_message, reported_clip_id,
    reporter_account_id, reported_account_id,
    clip_title_snapshot, clip_caption_snapshot, clip_video_url_snapshot,
    reporter_name_snapshot, reported_name_snapshot
  )
  values (
    _report_reason, trim(coalesce(_report_message, '')), v_clip.id,
    auth.uid(), v_reported_account_id,
    v_clip.title, coalesce(v_clip.caption, v_clip.description), v_clip.video_url,
    coalesce(v_reporter_name, 'Footy Status user'),
    coalesce(v_reported_name, 'Footy Status user')
  )
  returning id into v_report_id;

  select user_id into v_official_user_id
  from public.global_admin_users
  where lower(email) = 'footystatussupport@gmail.com'
  limit 1;

  if v_official_user_id is not null then
    perform public.create_notification(
      _user_id := v_official_user_id,
      _actor_user_id := auth.uid(),
      _type := 'content_report_submitted',
      _title := 'New Next Up clip report',
      _body := coalesce(v_reported_name, 'A player') || ' has a clip awaiting review.',
      _entity_type := 'content_report',
      _entity_id := v_report_id,
      _link_path := '/profile',
      _metadata := jsonb_build_object('report_id', v_report_id),
      _dedupe_key := 'content_report:' || v_report_id::text
    );
  end if;

  return v_report_id;
end;
$$;

create or replace function public.get_content_report_reviews()
returns table (
  id uuid,
  report_status text,
  report_reason text,
  report_message text,
  reported_clip_id uuid,
  reporter_account_id uuid,
  reported_account_id uuid,
  clip_title text,
  clip_caption text,
  clip_video_url text,
  reporter_name text,
  reported_name text,
  created_at timestamptz,
  reviewed_at timestamptz,
  resolution_note text,
  active_strike_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can review reports.';
  end if;

  return query
  select
    cr.id, cr.report_status, cr.report_reason, cr.report_message,
    cr.reported_clip_id, cr.reporter_account_id, cr.reported_account_id,
    coalesce(c.title, cr.clip_title_snapshot),
    coalesce(c.caption, c.description, cr.clip_caption_snapshot),
    coalesce(c.video_url, cr.clip_video_url_snapshot),
    coalesce(rp.full_name, rp.username, cr.reporter_name_snapshot),
    coalesce(tp.full_name, tp.username, cr.reported_name_snapshot),
    cr.created_at, cr.reviewed_at, cr.resolution_note,
    (select count(*)::integer from public.account_strikes s
     where s.account_id = cr.reported_account_id and s.removed_at is null)
  from public.content_reports cr
  left join public.clips c on c.id = cr.reported_clip_id
  left join public.profiles rp on rp.user_id = cr.reporter_account_id
  left join public.profiles tp on tp.user_id = cr.reported_account_id
  order by case when cr.report_status = 'pending' then 0 else 1 end, cr.created_at desc;
end;
$$;

create or replace function public.get_account_strike_history(_account_id uuid)
returns table (
  id uuid,
  related_report_id uuid,
  reason text,
  action_taken text,
  created_at timestamptz,
  removed_at timestamptz,
  removal_reason text,
  admin_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can view strike history.';
  end if;

  return query
  select s.id, s.related_report_id, s.reason, s.action_taken,
         s.created_at, s.removed_at, s.removal_reason, s.admin_user_id
  from public.account_strikes s
  where s.account_id = _account_id
  order by s.created_at desc;
end;
$$;

create or replace function public.create_temporary_ban(
  _account_id uuid,
  _months integer,
  _reason text,
  _report_id uuid default null,
  _automatic boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ban_id uuid;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can ban accounts.';
  end if;
  if _months not in (3, 6) then raise exception 'Ban must be 3 or 6 months.'; end if;
  if _account_id = auth.uid() then raise exception 'The Official account cannot ban itself.'; end if;

  update public.temporary_bans
  set ended_at = now(), end_reason = 'Replaced by a new ban'
  where account_id = _account_id and ended_at is null;

  insert into public.temporary_bans (
    account_id, related_report_id, ban_end_at, ban_reason,
    ban_months, automatic_from_three_strikes, admin_user_id
  )
  values (
    _account_id, _report_id, now() + make_interval(months => _months),
    coalesce(nullif(trim(_reason), ''), 'Temporary Footy Status suspension'),
    _months, _automatic, auth.uid()
  )
  returning id into v_ban_id;

  return v_ban_id;
end;
$$;

create or replace function public.review_content_report(
  _report_id uuid,
  _action text,
  _ban_months integer default null,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.content_reports;
  v_strike_count integer;
  v_ban_id uuid;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can perform report actions.';
  end if;

  select * into v_report from public.content_reports where id = _report_id for update;
  if v_report.id is null then raise exception 'Report not found.'; end if;

  if _action = 'dismiss' then
    update public.content_reports
    set report_status = 'dismissed', reviewed_by_user_id = auth.uid(),
        reviewed_at = now(), resolution_note = coalesce(_note, 'Dismissed without action'),
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'dismissed', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, '')));

  elsif _action = 'strike_delete' then
    insert into public.account_strikes(account_id, related_report_id, reason, action_taken, admin_user_id)
    values (v_report.reported_account_id, _report_id,
            coalesce(nullif(trim(_note), ''), v_report.report_reason),
            'strike_added_and_reported_clip_deleted', auth.uid());

    if v_report.reported_clip_id is not null then
      delete from public.clips where id = v_report.reported_clip_id;
    end if;

    update public.content_reports
    set report_status = 'actioned', reviewed_by_user_id = auth.uid(),
        reviewed_at = now(), resolution_note = 'Strike added and reported clip deleted',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'strike_and_clip_deleted', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, '')));

    select count(*)::integer into v_strike_count
    from public.account_strikes
    where account_id = v_report.reported_account_id and removed_at is null;

    if v_strike_count >= 3 then
      v_ban_id := public.create_temporary_ban(
        v_report.reported_account_id, 3,
        'Automatic 3-month ban after reaching 3 active strikes',
        _report_id, true
      );
    end if;

  elsif _action = 'temporary_ban' then
    v_ban_id := public.create_temporary_ban(
      v_report.reported_account_id, _ban_months,
      coalesce(nullif(trim(_note), ''), 'Temporary ban from content report review'),
      _report_id, false
    );

    update public.content_reports
    set report_status = 'resolved', reviewed_by_user_id = auth.uid(),
        reviewed_at = now(), resolution_note = _ban_months || '-month temporary ban',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'temporary_ban', v_report.reported_account_id,
            jsonb_build_object('months', _ban_months, 'ban_id', v_ban_id, 'note', coalesce(_note, '')));
  else
    raise exception 'Unsupported report action.';
  end if;

  return jsonb_build_object('ok', true, 'ban_id', v_ban_id);
end;
$$;

create or replace function public.remove_account_strike(
  _strike_id uuid,
  _reason text default 'Removed by Footy Status Official'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_strike public.account_strikes;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can remove strikes.';
  end if;

  update public.account_strikes
  set removed_at = now(), removed_by_user_id = auth.uid(), removal_reason = _reason
  where id = _strike_id and removed_at is null
  returning * into v_strike;

  if v_strike.id is null then raise exception 'Active strike not found.'; end if;

  if v_strike.related_report_id is not null then
    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (v_strike.related_report_id, auth.uid(), 'strike_removed', v_strike.account_id,
            jsonb_build_object('strike_id', v_strike.id, 'reason', _reason));
  end if;
end;
$$;

create or replace function public.get_my_moderation_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ban public.temporary_bans;
  v_strike_count integer;
  v_strike_ids uuid[];
begin
  if auth.uid() is null then return jsonb_build_object('banned', false, 'strike_count', 0); end if;
  if public.is_footy_status_global_admin() then return jsonb_build_object('banned', false, 'strike_count', 0); end if;

  select * into v_ban
  from public.temporary_bans
  where account_id = auth.uid() and ended_at is null
  order by created_at desc limit 1;

  if v_ban.id is not null and v_ban.ban_end_at <= now() then
    update public.temporary_bans
    set ended_at = now(), end_reason = 'Ban served in full'
    where id = v_ban.id;

    if v_ban.automatic_from_three_strikes then
      select array_agg(id order by created_at desc) into v_strike_ids
      from public.account_strikes
      where account_id = auth.uid() and removed_at is null;

      if coalesce(array_length(v_strike_ids, 1), 0) > 1 then
        update public.account_strikes
        set removed_at = now(), removal_reason = 'Removed after completed automatic 3-month ban'
        where id = any(v_strike_ids[2:array_length(v_strike_ids, 1)]);
      end if;
    end if;
    v_ban.id := null;
  end if;

  select count(*)::integer into v_strike_count
  from public.account_strikes
  where account_id = auth.uid() and removed_at is null;

  if v_ban.id is not null then
    return jsonb_build_object(
      'banned', true, 'strike_count', v_strike_count,
      'ban_id', v_ban.id, 'ban_start_at', v_ban.ban_start_at,
      'ban_end_at', v_ban.ban_end_at, 'ban_reason', v_ban.ban_reason
    );
  end if;

  return jsonb_build_object(
    'banned', false,
    'strike_count', v_strike_count,
    'warning', case when v_strike_count = 2
      then 'Footy Status will contact or call you regarding your account strikes.'
      else null end
  );
end;
$$;

revoke all on function public.submit_content_report(uuid, text, text) from public;
revoke all on function public.get_content_report_reviews() from public;
revoke all on function public.get_account_strike_history(uuid) from public;
revoke all on function public.create_temporary_ban(uuid, integer, text, uuid, boolean) from public;
revoke all on function public.review_content_report(uuid, text, integer, text) from public;
revoke all on function public.remove_account_strike(uuid, text) from public;
revoke all on function public.get_my_moderation_status() from public;
grant execute on function public.submit_content_report(uuid, text, text) to authenticated;
grant execute on function public.get_content_report_reviews() to authenticated;
grant execute on function public.get_account_strike_history(uuid) to authenticated;
grant execute on function public.review_content_report(uuid, text, integer, text) to authenticated;
grant execute on function public.remove_account_strike(uuid, text) to authenticated;
grant execute on function public.get_my_moderation_status() to authenticated;

