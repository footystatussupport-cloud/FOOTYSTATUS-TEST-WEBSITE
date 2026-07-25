-- =============================================================================
-- Fix: Footy Status Official admin plan changes did not actually apply.
-- =============================================================================
-- WHAT WAS BROKEN
--   Migration 20260720200000 added the guard trigger
--   public.tg_guard_subscription_columns() on public.profiles. It silently
--   REVERTS any escalation of the subscription columns (account_tier / is_pro /
--   pro_expires_at) unless the transaction first sets the in-transaction flag
--   app.pro_change_authorized = 'on'. Only two pathways are supposed to set it:
--   the verified-purchase RPC and the admin tool.
--
--   But public.admin_set_pro_status (added earlier, in 20260712100000) was never
--   updated to set that flag. So when the Footy Status Admin changed a Player
--   from Free -> Yearly / One-Time:
--     1. admin_set_pro_status ran UPDATE public.profiles ...
--     2. the guard trigger saw an un-authorized escalation and reverted
--        account_tier / is_pro / pro_expires_at back to their old (Free) values.
--     3. the RPC still returned without error, so the admin UI showed success.
--   => "success message, but the Player's account never actually changed."
--   (Downgrades to Free already worked, because de-escalation is always allowed.)
--
-- THE FIX
--   Redefine admin_set_pro_status to set app.pro_change_authorized = 'on' for its
--   own transaction (exactly the pattern apply_verified_pro_purchase uses) so the
--   guard trigger permits the admin's tier change. profiles.account_tier /
--   is_pro / pro_expires_at stay the single source of truth the whole app reads
--   through getIsPro(); the write now genuinely persists and propagates app-wide.
--
-- APPLE IN-APP PURCHASE SAFETY
--   An admin grant is an ADMINISTRATIVE entitlement override, not a store
--   purchase. This function therefore NEVER fabricates an Apple/Google receipt or
--   transaction id: it marks the origin (pro_platform = 'admin',
--   pro_verification_status = 'admin_override') and leaves
--   pro_original_transaction_id / pro_current_transaction_id untouched, so a real
--   App Store subscription's records are always preserved. Effective Pro is
--   resolved from account_tier / is_pro, i.e. validStoreEntitlement OR
--   validAdminOverride. Changing a Player back to Free clears the admin-granted
--   override but preserves any genuine store transaction records.
--
-- Safe to run repeatedly (idempotent).
-- =============================================================================

create or replace function public.admin_set_pro_status(
  _target_user_id uuid,
  _plan text,
  _expires_at timestamptz default null,
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
  v_plan text;
  v_was_admin_override boolean;
begin
  perform public.admin_assert_official(_reason);

  v_plan := lower(trim(coalesce(_plan, 'free')));
  v_plan := replace(v_plan, '-', '_');

  v_plan := case
    when v_plan in ('free', 'off', 'none') then 'free'
    when v_plan in ('pro_annual', 'annual', 'year', 'yearly') then 'pro_annual'
    when v_plan in ('pro_lifetime', 'lifetime', 'one_time', 'onetime', 'one_time_pro') then 'pro_lifetime'
    else null
  end;

  if v_plan is null then
    raise exception 'Invalid Footy Status plan. Use free, pro_annual, or pro_lifetime.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = _target_user_id
      and (
        lower(coalesce(p.account_role, '')) = 'player'
        or lower(coalesce(p.account_type, '')) = 'player'
        or lower(coalesce(p.account_category, '')) = 'player'
        or lower(coalesce(p.role, '')) = 'player'
      )
  ) then
    raise exception 'Footy Status plan changes are only available for player accounts.';
  end if;

  select to_jsonb(p) into v_before
  from public.profiles p
  where p.user_id = _target_user_id;

  if v_before is null then
    raise exception 'Profile record not found.';
  end if;

  -- Was the account's current Pro state an admin override (vs. a real store
  -- purchase)? Used so a downgrade to Free only clears an admin-granted override
  -- and never wipes a genuine App Store subscription's records.
  v_was_admin_override := coalesce(v_before->>'pro_verification_status', '') = 'admin_override';

  -- Authorize the subscription-column change for THIS admin transaction only, so
  -- the guard trigger (tg_guard_subscription_columns) permits the tier change.
  -- Without this the trigger silently reverts admin upgrades (the bug this fixes).
  -- is_local = true keeps the flag scoped to this transaction.
  perform set_config('app.pro_change_authorized', 'on', true);

  update public.profiles
  set
    account_tier = v_plan,
    is_pro = (v_plan <> 'free'),
    pro_started_at = case
      when v_plan = 'free' then null
      else coalesce(pro_started_at, now())
    end,
    pro_expires_at = case
      when v_plan = 'pro_annual' then coalesce(_expires_at, now() + interval '1 year')
      else null  -- lifetime never expires; free has no expiry
    end,
    -- Mark the ORIGIN of the entitlement without fabricating a store receipt.
    pro_platform = case
      when v_plan = 'free' then
        case when v_was_admin_override then null else pro_platform end
      else 'admin'
    end,
    pro_purchase_date = case
      when v_plan = 'free' then
        case when v_was_admin_override then null else pro_purchase_date end
      else coalesce(pro_purchase_date, now())
    end,
    pro_renewal_status = case
      when v_plan = 'free' then
        case when v_was_admin_override then null else pro_renewal_status end
      else 'admin_override'
    end,
    pro_verification_status = case
      when v_plan = 'free' then
        case when v_was_admin_override then null else pro_verification_status end
      else 'admin_override'
    end,
    -- pro_original_transaction_id / pro_current_transaction_id are intentionally
    -- left untouched: admin actions must never create or destroy real Apple /
    -- Google transaction records.
    updated_at = now()
  where user_id = _target_user_id;

  -- Content is preserved on every direction. Downgrades keep the earliest 3
  -- clips active and mark the rest inactive (never delete, trim, or re-encode);
  -- upgrades restore any clips that were hidden while on Free.
  if v_plan = 'free' then
    perform public.apply_free_clip_visibility(_target_user_id);
  else
    perform public.restore_pro_clips(_target_user_id);
  end if;

  select to_jsonb(p) into v_after
  from public.profiles p
  where p.user_id = _target_user_id;

  perform public.admin_write_audit(
    'pro_status_changed',
    'profiles',
    _target_user_id::text,
    _target_user_id,
    _reason,
    v_before,
    v_after,
    jsonb_build_object(
      'previous_plan', coalesce(v_before->>'account_tier', 'free'),
      'new_plan', v_plan,
      'manual_admin_override', true
    )
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_pro_status(uuid, text, timestamptz, text) from public;
grant execute on function public.admin_set_pro_status(uuid, text, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
