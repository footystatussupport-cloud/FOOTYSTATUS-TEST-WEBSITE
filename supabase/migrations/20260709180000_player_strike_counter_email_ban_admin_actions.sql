-- Player strike counter, 3-month automatic bans, banned-email enforcement,
-- and Footy Status Official video moderation actions.

-- 1) Keep a ban email snapshot on temporary_bans and create an independent
--    email-ban table so a banned email remains blocked even if the account is
--    later removed.
alter table public.temporary_bans
  add column if not exists banned_email text;

update public.temporary_bans tb
set banned_email = lower(nullif(trim(coalesce(p.email, au.email)), ''))
from auth.users au
left join public.profiles p on p.user_id = au.id
where au.id = tb.account_id
  and tb.banned_email is null;

create index if not exists idx_temporary_bans_banned_email_active
on public.temporary_bans (lower(banned_email))
where ended_at is null and banned_email is not null;

create table if not exists public.account_email_bans (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  account_id uuid,
  related_ban_id uuid,
  related_report_id uuid,
  ban_start_at timestamptz not null default now(),
  ban_end_at timestamptz not null,
  ban_reason text not null,
  ban_months integer not null check (ban_months in (3, 6)),
  automatic_from_three_strikes boolean not null default false,
  admin_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  constraint account_email_bans_valid_dates check (ban_end_at > ban_start_at)
);

create unique index if not exists idx_account_email_bans_one_active_email
on public.account_email_bans (lower(email))
where ended_at is null;

alter table public.account_email_bans enable row level security;

drop policy if exists "Official account manages email bans" on public.account_email_bans;
create policy "Official account manages email bans"
on public.account_email_bans for all to authenticated
using (public.is_footy_status_global_admin())
with check (public.is_footy_status_global_admin());

insert into public.account_email_bans (
  email, account_id, related_ban_id, related_report_id, ban_start_at, ban_end_at,
  ban_reason, ban_months, automatic_from_three_strikes, admin_user_id, created_at,
  ended_at, end_reason
)
select distinct on (lower(tb.banned_email))
  lower(tb.banned_email),
  tb.account_id,
  tb.id,
  tb.related_report_id,
  tb.ban_start_at,
  tb.ban_end_at,
  tb.ban_reason,
  tb.ban_months,
  tb.automatic_from_three_strikes,
  tb.admin_user_id,
  tb.created_at,
  tb.ended_at,
  tb.end_reason
from public.temporary_bans tb
where tb.banned_email is not null
  and tb.ended_at is null
on conflict do nothing;

-- 2) Helper functions for player-only strikes and active email bans.
create or replace function public.is_player_account_for_strikes(_account_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = _account_id
      and lower(coalesce(p.account_role, p.account_type, p.role::text, '')) = 'player'
  );
$$;

create or replace function public.get_account_active_strike_count(_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view strikes.';
  end if;

  if auth.uid() <> _account_id and not public.is_footy_status_global_admin() then
    raise exception 'You can only view your own strike count.';
  end if;

  select count(*)::integer into v_count
  from public.account_strikes s
  where s.account_id = _account_id
    and s.removed_at is null;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.get_email_ban_status(_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(coalesce(_email, '')), ''));
  v_ban public.account_email_bans;
begin
  if v_email is null then
    return jsonb_build_object('banned', false);
  end if;

  update public.account_email_bans
  set ended_at = now(), end_reason = coalesce(end_reason, 'Ban expired')
  where lower(email) = v_email
    and ended_at is null
    and ban_end_at <= now();

  select * into v_ban
  from public.account_email_bans
  where lower(email) = v_email
    and ended_at is null
    and ban_end_at > now()
  order by ban_end_at desc
  limit 1;

  if v_ban.id is null then
    return jsonb_build_object('banned', false);
  end if;

  return jsonb_build_object(
    'banned', true,
    'ban_id', v_ban.id,
    'account_id', v_ban.account_id,
    'ban_start_at', v_ban.ban_start_at,
    'ban_end_at', v_ban.ban_end_at,
    'ban_reason', v_ban.ban_reason,
    'ban_months', v_ban.ban_months
  );
end;
$$;

create or replace function public.prevent_active_banned_email_profile_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(coalesce(new.email, '')), ''));
  v_ban public.account_email_bans;
begin
  if v_email is null then
    return new;
  end if;

  update public.account_email_bans
  set ended_at = now(), end_reason = coalesce(end_reason, 'Ban expired')
  where lower(email) = v_email
    and ended_at is null
    and ban_end_at <= now();

  select * into v_ban
  from public.account_email_bans
  where lower(email) = v_email
    and ended_at is null
    and ban_end_at > now()
    and account_id is distinct from new.user_id
  order by ban_end_at desc
  limit 1;

  if v_ban.id is not null then
    raise exception 'This email is temporarily banned from Footy Status until %.', v_ban.ban_end_at::date;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_active_banned_email_profile_use_trigger on public.profiles;
create trigger prevent_active_banned_email_profile_use_trigger
before insert or update of email, user_id on public.profiles
for each row execute function public.prevent_active_banned_email_profile_use();

-- 3) Replace create_temporary_ban so every account ban also stores an email ban.
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
  v_email text;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can ban accounts.';
  end if;
  if _months not in (3, 6) then
    raise exception 'Ban must be 3 or 6 months.';
  end if;
  if _account_id = auth.uid() then
    raise exception 'The Official account cannot ban itself.';
  end if;

  select lower(nullif(trim(coalesce(p.email, au.email)), '')) into v_email
  from auth.users au
  left join public.profiles p on p.user_id = au.id
  where au.id = _account_id
  limit 1;

  update public.temporary_bans
  set ended_at = now(), end_reason = 'Replaced by a new ban'
  where account_id = _account_id
    and ended_at is null;

  if v_email is not null then
    update public.account_email_bans
    set ended_at = now(), end_reason = 'Replaced by a new ban'
    where ended_at is null
      and (account_id = _account_id or lower(email) = v_email);
  else
    update public.account_email_bans
    set ended_at = now(), end_reason = 'Replaced by a new ban'
    where ended_at is null
      and account_id = _account_id;
  end if;

  insert into public.temporary_bans (
    account_id, related_report_id, ban_end_at, ban_reason,
    ban_months, automatic_from_three_strikes, admin_user_id, banned_email
  )
  values (
    _account_id, _report_id, now() + make_interval(months => _months),
    coalesce(nullif(trim(_reason), ''), 'Temporary Footy Status suspension'),
    _months, _automatic, auth.uid(), v_email
  )
  returning id into v_ban_id;

  if v_email is not null then
    insert into public.account_email_bans (
      email, account_id, related_ban_id, related_report_id, ban_end_at,
      ban_reason, ban_months, automatic_from_three_strikes, admin_user_id
    )
    values (
      v_email, _account_id, v_ban_id, _report_id, now() + make_interval(months => _months),
      coalesce(nullif(trim(_reason), ''), 'Temporary Footy Status suspension'),
      _months, _automatic, auth.uid()
    );
  end if;

  return v_ban_id;
end;
$$;

create or replace function public.issue_player_account_strike(
  _target_user_id uuid,
  _reason text,
  _report_id uuid default null,
  _action_taken text default 'strike_added'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can add strikes.';
  end if;

  if not public.is_player_account_for_strikes(_target_user_id) then
    raise exception 'Strikes can only be given to player accounts.';
  end if;

  insert into public.account_strikes(account_id, related_report_id, reason, action_taken, admin_user_id)
  values (
    _target_user_id,
    _report_id,
    coalesce(nullif(trim(_reason), ''), 'Footy Status content violation'),
    coalesce(nullif(trim(_action_taken), ''), 'strike_added'),
    auth.uid()
  )
  returning id into v_id;

  select count(*)::integer into v_count
  from public.account_strikes
  where account_id = _target_user_id
    and removed_at is null;

  if v_count >= 3 then
    perform public.create_temporary_ban(
      _target_user_id,
      3,
      'Automatic 3-month ban after reaching 3 active strikes',
      _report_id,
      true
    );
  end if;

  return v_id;
end;
$$;

-- 4) Keep email bans synced when automatic bans expire after being served.
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
  if auth.uid() is null then
    return jsonb_build_object('banned', false, 'strike_count', 0);
  end if;
  if public.is_footy_status_global_admin() then
    return jsonb_build_object('banned', false, 'strike_count', 0);
  end if;

  select * into v_ban
  from public.temporary_bans
  where account_id = auth.uid()
    and ended_at is null
  order by created_at desc
  limit 1;

  if v_ban.id is not null and v_ban.ban_end_at <= now() then
    update public.temporary_bans
    set ended_at = now(), end_reason = 'Ban served in full'
    where id = v_ban.id;

    update public.account_email_bans
    set ended_at = now(), end_reason = 'Ban served in full'
    where related_ban_id = v_ban.id
      and ended_at is null;

    if v_ban.automatic_from_three_strikes then
      select array_agg(id order by created_at desc) into v_strike_ids
      from public.account_strikes
      where account_id = auth.uid()
        and removed_at is null;

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
  where account_id = auth.uid()
    and removed_at is null;

  if v_ban.id is not null then
    return jsonb_build_object(
      'banned', true,
      'strike_count', v_strike_count,
      'ban_id', v_ban.id,
      'ban_start_at', v_ban.ban_start_at,
      'ban_end_at', v_ban.ban_end_at,
      'ban_reason', v_ban.ban_reason
    );
  end if;

  return jsonb_build_object(
    'banned', false,
    'strike_count', v_strike_count,
    'warning', case
      when v_strike_count = 2 then 'Footy Status will contact or call you regarding your account strikes.'
      else null
    end
  );
end;
$$;

-- 5) Admin actions for deleting, striking, and deleting+striking videos.
create or replace function public.admin_add_strike(_target_user_id uuid, _reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
begin
  perform public.admin_assert_official(_reason);

  v_id := public.issue_player_account_strike(
    _target_user_id,
    _reason,
    null,
    'manual_admin_strike'
  );

  select count(*)::integer into v_count
  from public.account_strikes
  where account_id = _target_user_id
    and removed_at is null;

  perform public.admin_write_audit(
    'strike_added',
    'account_strikes',
    v_id::text,
    _target_user_id,
    _reason,
    null,
    jsonb_build_object('strike_id', v_id, 'active_count', v_count)
  );

  return v_id;
end;
$$;

create or replace function public.admin_delete_clip_and_add_strike(_clip_id uuid, _reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_target uuid;
  v_strike_id uuid;
begin
  perform public.admin_assert_official(_reason);

  select to_jsonb(c), coalesce(c.user_id, pp.user_id, pl.user_id) into v_before, v_target
  from public.clips c
  left join public.player_profiles pp on pp.id = c.player_id
  left join public.players pl on pl.id = c.player_id
  where c.id = _clip_id;

  if v_before is null then
    raise exception 'Clip not found.';
  end if;
  if v_target is null then
    raise exception 'Could not identify the player who posted this clip.';
  end if;

  v_strike_id := public.issue_player_account_strike(
    v_target,
    coalesce(nullif(trim(_reason), ''), 'Video deleted and strike added by Footy Status Official'),
    null,
    'manual_admin_strike_and_clip_deleted'
  );

  delete from public.clips where id = _clip_id;

  perform public.admin_write_audit(
    'next_up_clip_deleted_and_strike_added',
    'clips',
    _clip_id::text,
    v_target,
    _reason,
    v_before,
    null,
    jsonb_build_object('clip_id', _clip_id, 'strike_id', v_strike_id)
  );

  return v_strike_id;
end;
$$;

-- 6) Report review supports delete only, strike only, and delete+strike.
alter table public.content_report_actions
  drop constraint if exists content_report_actions_action_type_check;

alter table public.content_report_actions
  add constraint content_report_actions_action_type_check
  check (action_type in (
    'dismissed',
    'clip_deleted',
    'strike_added',
    'strike_and_clip_deleted',
    'temporary_ban',
    'resolved',
    'strike_removed'
  ));

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
  v_strike_id uuid;
  v_strike_count integer;
  v_ban_id uuid;
begin
  if not public.is_footy_status_global_admin() then
    raise exception 'Only the Footy Status Official account can perform report actions.';
  end if;

  select * into v_report
  from public.content_reports
  where id = _report_id
  for update;

  if v_report.id is null then
    raise exception 'Report not found.';
  end if;

  if _action = 'dismiss' then
    update public.content_reports
    set report_status = 'dismissed',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        resolution_note = coalesce(_note, 'Dismissed without action'),
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'dismissed', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, '')));

  elsif _action = 'delete_clip' then
    if v_report.reported_clip_id is not null then
      delete from public.clips where id = v_report.reported_clip_id;
    end if;

    update public.content_reports
    set report_status = 'actioned',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        resolution_note = 'Reported clip deleted',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'clip_deleted', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, ''), 'clip_id', v_report.reported_clip_id));

  elsif _action = 'strike' then
    v_strike_id := public.issue_player_account_strike(
      v_report.reported_account_id,
      coalesce(nullif(trim(_note), ''), v_report.report_reason),
      _report_id,
      'strike_added_from_report_review'
    );

    update public.content_reports
    set report_status = 'actioned',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        resolution_note = 'Strike added',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'strike_added', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, ''), 'strike_id', v_strike_id));

  elsif _action = 'strike_delete' then
    v_strike_id := public.issue_player_account_strike(
      v_report.reported_account_id,
      coalesce(nullif(trim(_note), ''), v_report.report_reason),
      _report_id,
      'strike_added_and_reported_clip_deleted'
    );

    if v_report.reported_clip_id is not null then
      delete from public.clips where id = v_report.reported_clip_id;
    end if;

    update public.content_reports
    set report_status = 'actioned',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        resolution_note = 'Strike added and reported clip deleted',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'strike_and_clip_deleted', v_report.reported_account_id,
            jsonb_build_object('note', coalesce(_note, ''), 'strike_id', v_strike_id, 'clip_id', v_report.reported_clip_id));

  elsif _action = 'temporary_ban' then
    v_ban_id := public.create_temporary_ban(
      v_report.reported_account_id,
      _ban_months,
      coalesce(nullif(trim(_note), ''), 'Temporary ban from content report review'),
      _report_id,
      false
    );

    update public.content_reports
    set report_status = 'resolved',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now(),
        resolution_note = _ban_months || '-month temporary ban',
        updated_at = now()
    where id = _report_id;

    insert into public.content_report_actions(report_id, admin_user_id, action_type, target_account_id, details)
    values (_report_id, auth.uid(), 'temporary_ban', v_report.reported_account_id,
            jsonb_build_object('months', _ban_months, 'ban_id', v_ban_id, 'note', coalesce(_note, '')));
  else
    raise exception 'Unsupported report action.';
  end if;

  select count(*)::integer into v_strike_count
  from public.account_strikes
  where account_id = v_report.reported_account_id
    and removed_at is null;

  return jsonb_build_object(
    'ok', true,
    'ban_id', v_ban_id,
    'strike_id', v_strike_id,
    'active_strike_count', coalesce(v_strike_count, 0)
  );
end;
$$;

-- 7) Next Up approval bank shows strike count and can reject+strike.
drop function if exists public.get_pending_clip_reviews();

create or replace function public.get_pending_clip_reviews()
returns table (
  clip_id uuid,
  player_user_id uuid,
  player_profile_id uuid,
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
  revision_note text,
  active_strike_count integer
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
    coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id),
    coalesce(pp_by_user.id, pp_by_id.id),
    coalesce(p.full_name, pp_by_user.full_name, pp_by_id.full_name, pl.name, 'Player'),
    p.username,
    coalesce(pp_by_user.player_gender, pp_by_id.player_gender, pl.player_gender),
    coalesce(p.account_role, p.account_type, p.role::text, 'player'),
    c.title,
    coalesce(c.caption, c.description),
    c.video_url,
    c.thumbnail_url,
    c.created_at,
    c.review_status,
    c.revision_note,
    (
      select count(*)::integer
      from public.account_strikes s
      where s.account_id = coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id)
        and s.removed_at is null
    )
  from public.clips c
  left join public.player_profiles pp_by_user
    on pp_by_user.user_id = c.user_id
  left join public.player_profiles pp_by_id
    on pp_by_id.id = c.player_id
  left join public.players pl
    on pl.id = c.player_id
  left join public.profiles p
    on p.user_id = coalesce(c.user_id, pp_by_user.user_id, pp_by_id.user_id, pl.user_id)
  where c.review_status = 'pending_review'
  order by coalesce(c.submitted_for_review_at, c.created_at) asc;
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
  v_note text := trim(coalesce(_note, ''));
  v_strike_id uuid;
begin
  perform public.admin_assert_official(
    case
      when _decision = 'approve' then 'Next Up Clip approved'
      else coalesce(nullif(v_note, ''), 'Next Up Clip moderation')
    end
  );

  if _decision not in ('approve', 'revise', 'reject', 'reject_strike') then
    raise exception 'Choose Accept, Revise, Reject, or Reject + Strike.';
  end if;

  if _decision = 'revise' and length(v_note) < 3 then
    raise exception 'Write a revision note explaining what the player should change.';
  end if;

  if _decision in ('reject', 'reject_strike') and length(v_note) < 3 then
    raise exception 'Write a reason explaining why the clip was rejected.';
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

  if _decision in ('reject', 'reject_strike') then
    if _decision = 'reject_strike' then
      if v_owner_id is null then
        raise exception 'Could not identify the player who posted this clip.';
      end if;
      v_strike_id := public.issue_player_account_strike(
        v_owner_id,
        v_note,
        null,
        'clip_review_rejected_with_strike'
      );
    end if;

    if v_owner_id is not null then
      perform public.create_notification(
        _user_id := v_owner_id,
        _actor_user_id := auth.uid(),
        _type := case when _decision = 'reject_strike' then 'clip_rejected_strike' else 'clip_rejected' end,
        _title := case when _decision = 'reject_strike' then 'Next Up Clip rejected and strike added' else 'Next Up Clip rejected' end,
        _body := case
          when _decision = 'reject_strike' then 'Your Next Up Clip was rejected and one strike was added: ' || v_note
          else 'Your Next Up Clip was rejected and will not be posted: ' || v_note
        end,
        _entity_type := 'clip',
        _entity_id := null,
        _clip_id := null,
        _link_path := '/profile',
        _metadata := jsonb_build_object('clip_id', _clip_id, 'review_status', 'rejected', 'rejection_note', v_note, 'strike_id', v_strike_id),
        _dedupe_key := 'clip_review:' || _clip_id::text || ':' || _decision || ':' || extract(epoch from now())::bigint::text
      );
    end if;

    delete from public.clips where id = _clip_id;

    perform public.admin_write_audit(
      case when _decision = 'reject_strike' then 'next_up_clip_rejected_and_strike_added' else 'next_up_clip_rejected' end,
      'clips',
      _clip_id::text,
      v_owner_id,
      v_note,
      v_before,
      'null'::jsonb,
      jsonb_build_object('clip_id', _clip_id, 'decision', _decision, 'admin_note', v_note, 'strike_id', v_strike_id)
    );

    return jsonb_build_object('clip_id', _clip_id, 'decision', _decision, 'deleted', true, 'strike_id', v_strike_id);
  end if;

  update public.clips
  set review_status = case when _decision = 'approve' then 'approved' else 'needs_revision' end,
      revision_note = case when _decision = 'revise' then v_note else null end,
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
        else 'Your Next Up Clip was not posted yet. Footy Status requested a revision: ' || v_note
      end,
      _entity_type := 'clip',
      _entity_id := _clip_id,
      _clip_id := _clip_id,
      _link_path := '/profile',
      _metadata := jsonb_build_object('clip_id', _clip_id, 'review_status', case when _decision = 'approve' then 'approved' else 'needs_revision' end, 'revision_note', v_note),
      _dedupe_key := 'clip_review:' || _clip_id::text || ':' || extract(epoch from now())::bigint::text
    );
  end if;

  perform public.admin_write_audit(
    case when _decision = 'approve' then 'next_up_clip_approved' else 'next_up_clip_needs_revision' end,
    'clips',
    _clip_id::text,
    v_owner_id,
    case when _decision = 'approve' then 'Next Up Clip approved' else v_note end,
    v_before,
    v_after,
    jsonb_build_object('clip_id', _clip_id, 'decision', _decision, 'admin_note', _note)
  );

  return v_after;
end;
$$;

revoke all on function public.get_account_active_strike_count(uuid) from public;
revoke all on function public.get_email_ban_status(text) from public;
revoke all on function public.issue_player_account_strike(uuid, text, uuid, text) from public;
revoke all on function public.admin_delete_clip_and_add_strike(uuid, text) from public;
revoke all on function public.get_pending_clip_reviews() from public;
revoke all on function public.review_next_up_clip(uuid, text, text) from public;

grant execute on function public.get_account_active_strike_count(uuid) to authenticated;
grant execute on function public.get_email_ban_status(text) to anon, authenticated;
grant execute on function public.issue_player_account_strike(uuid, text, uuid, text) to authenticated;
grant execute on function public.admin_delete_clip_and_add_strike(uuid, text) to authenticated;
grant execute on function public.get_pending_clip_reviews() to authenticated;
grant execute on function public.review_next_up_clip(uuid, text, text) to authenticated;
