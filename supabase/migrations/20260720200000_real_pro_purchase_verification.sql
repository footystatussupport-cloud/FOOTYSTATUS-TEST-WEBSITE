-- =============================================================================
-- Real Footy Status Pro purchases — remove the free-Pro bypass, add verified
-- store-purchase granting, and lock subscription columns server-side.
-- =============================================================================
-- WHAT THIS FIXES
--   * Removes public.upgrade_to_pro(uuid, text): a self-serve RPC that granted
--     Pro with NO payment (the server side of the "free Pro" bypass).
--   * Closes the direct-write hole: profiles RLS lets a player update their own
--     row, so a player could set account_tier/is_pro themselves. A new guard
--     trigger rejects ANY unauthorized escalation of the subscription columns;
--     only the verified-purchase RPC and the admin tool (which set an in-txn
--     authorization flag) may raise a tier. De-escalation to Free is always
--     allowed (expiry downgrades, the player-only backstop, admin).
--   * Adds monthly/yearly to the account_tier CHECK (annual/lifetime kept for
--     existing members; never sold by the new flow).
--   * Adds the subscription metadata the backend must own (platform, dates,
--     transaction ids, renewal + verification status).
--   * Adds public.apply_verified_pro_purchase(...): the ONLY grant path. It is
--     callable only by the service_role (used by the verify-pro-purchase Edge
--     Function AFTER it verifies the receipt with Apple/Google). Player-only,
--     idempotent by original transaction id, never downgrades a longer entitlement.
--
-- Safe to run repeatedly (idempotent). Grants Pro to nobody by itself.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove the free-Pro bypass RPC entirely.
-- ---------------------------------------------------------------------------
drop function if exists public.upgrade_to_pro(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. Extend the account_tier CHECK to include the new monthly/yearly tiers.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_account_tier_check;
alter table public.profiles
  add constraint profiles_account_tier_check
  check (account_tier in ('free', 'pro_monthly', 'pro_yearly', 'pro_annual', 'pro_lifetime'))
  not valid;
alter table public.profiles validate constraint profiles_account_tier_check;

-- ---------------------------------------------------------------------------
-- 3. Subscription metadata owned by the backend (single source of truth).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists pro_platform text,                 -- 'apple' | 'google'
  add column if not exists pro_purchase_date timestamptz,
  add column if not exists pro_renewal_status text,           -- 'auto_renew_on' | 'auto_renew_off' | 'cancelled' | 'expired'
  add column if not exists pro_original_transaction_id text,
  add column if not exists pro_current_transaction_id text,
  add column if not exists pro_verification_status text;       -- 'verified' | 'failed' | 'pending'

create unique index if not exists idx_profiles_pro_original_txn
  on public.profiles(pro_original_transaction_id)
  where pro_original_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Guard trigger: block unauthorized escalation of the subscription columns.
--    Only pathways that set app.pro_change_authorized = 'on' (the grant RPC and
--    the admin tool below) may raise a tier / extend expiry. Everything else —
--    a direct client update, a stray patch — has its subscription fields
--    reverted to the stored values. Losing Pro (-> free) is always permitted.
-- ---------------------------------------------------------------------------
create or replace function public.tg_guard_subscription_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorized boolean := coalesce(current_setting('app.pro_change_authorized', true), '') = 'on';
  v_escalates boolean;
begin
  if v_authorized then
    return new;  -- verified purchase / admin action
  end if;

  v_escalates :=
       (coalesce(new.is_pro, false) is true and coalesce(old.is_pro, false) is not true)
    or (new.account_tier is distinct from old.account_tier and coalesce(new.account_tier, 'free') <> 'free')
    or (
         new.pro_expires_at is distinct from old.pro_expires_at
         and new.pro_expires_at is not null
         and (old.pro_expires_at is null or new.pro_expires_at > old.pro_expires_at)
       );

  if v_escalates then
    -- Keep the stored subscription state; ignore the attempted upgrade.
    new.account_tier              := old.account_tier;
    new.is_pro                    := old.is_pro;
    new.pro_expires_at            := old.pro_expires_at;
    new.pro_started_at            := old.pro_started_at;
    new.pro_platform              := old.pro_platform;
    new.pro_purchase_date         := old.pro_purchase_date;
    new.pro_renewal_status        := old.pro_renewal_status;
    new.pro_original_transaction_id := old.pro_original_transaction_id;
    new.pro_current_transaction_id  := old.pro_current_transaction_id;
    new.pro_verification_status     := old.pro_verification_status;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_subscription_columns on public.profiles;
create trigger guard_subscription_columns
  before update on public.profiles
  for each row execute function public.tg_guard_subscription_columns();

-- ---------------------------------------------------------------------------
-- 5. The ONLY grant path: apply a verified store purchase. Called by the
--    verify-pro-purchase Edge Function with the service_role key, AFTER the
--    receipt has been verified with Apple / Google.
--      _plan: 'monthly' | 'yearly'
--    Player-only, idempotent by original transaction id, never shortens a
--    longer existing entitlement (so a stale restore can't downgrade).
-- ---------------------------------------------------------------------------
create or replace function public.apply_verified_pro_purchase(
  _user_id                  uuid,
  _plan                     text,
  _platform                 text,
  _expires_at               timestamptz,
  _original_transaction_id  text,
  _current_transaction_id   text default null,
  _renewal_status           text default 'auto_renew_on'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_expires timestamptz;
  v_existing_expires timestamptz;
begin
  if _user_id is null then
    raise exception 'A target account is required.';
  end if;

  -- Player-only product — refuse every other account type.
  if not public.account_is_pro_eligible(_user_id) then
    raise exception 'Footy Status Pro is only available for player accounts.';
  end if;

  v_tier := case _plan
    when 'monthly' then 'pro_monthly'
    when 'yearly'  then 'pro_yearly'
    else null
  end;
  if v_tier is null then
    raise exception 'Unknown Pro plan: %', _plan;
  end if;

  if _plan in ('monthly', 'yearly') and _expires_at is null then
    raise exception 'A subscription expiry is required for the % plan.', _plan;
  end if;

  -- Never shorten an existing, longer entitlement (idempotent restore safety).
  select pro_expires_at into v_existing_expires
  from public.profiles where user_id = _user_id;
  v_expires := greatest(_expires_at, coalesce(v_existing_expires, _expires_at));

  -- Authorize the subscription-column change for this transaction only.
  perform set_config('app.pro_change_authorized', 'on', true);

  update public.profiles
  set account_tier                = v_tier,
      is_pro                      = true,
      pro_started_at              = coalesce(pro_started_at, now()),
      pro_expires_at              = v_expires,
      pro_platform                = _platform,
      pro_purchase_date           = now(),
      pro_renewal_status          = coalesce(_renewal_status, 'auto_renew_on'),
      pro_original_transaction_id = coalesce(_original_transaction_id, pro_original_transaction_id),
      pro_current_transaction_id  = coalesce(_current_transaction_id, _original_transaction_id, pro_current_transaction_id),
      pro_verification_status     = 'verified',
      updated_at                  = now()
  where user_id = _user_id;

  -- Bring back any clips that were hidden while on Free, if the helper exists.
  if to_regprocedure('public.restore_pro_clips(uuid)') is not null then
    begin
      perform public.restore_pro_clips(_user_id);
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'user_id', _user_id,
    'tier', v_tier,
    'expires_at', v_expires
  );
end;
$$;

-- The grant path is service-role only — never reachable from the client.
revoke all on function public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Expiry sweep -> Free. Any time-limited tier past its expiry returns to
--    Free (lifetime excluded). Sets the authorization flag so the guard allows
--    the (de-escalating) write. Intended to be run on a schedule.
-- ---------------------------------------------------------------------------
create or replace function public.expire_lapsed_pro_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  perform set_config('app.pro_change_authorized', 'on', true);

  with lapsed as (
    update public.profiles
    set account_tier = 'free',
        is_pro = false,
        pro_renewal_status = 'expired',
        pro_verification_status = 'expired',
        updated_at = now()
    where account_tier in ('pro_monthly', 'pro_yearly', 'pro_annual')
      and pro_expires_at is not null
      and pro_expires_at < now()
    returning 1
  )
  select count(*) into v_count from lapsed;

  return v_count;
end;
$$;

revoke all on function public.expire_lapsed_pro_accounts() from public, anon, authenticated;
grant execute on function public.expire_lapsed_pro_accounts() to service_role;

-- =============================================================================
-- ROLLBACK (manual, if ever needed):
--   drop trigger if exists guard_subscription_columns on public.profiles;
--   drop function if exists public.tg_guard_subscription_columns();
--   drop function if exists public.apply_verified_pro_purchase(uuid, text, text, timestamptz, text, text, text);
--   drop function if exists public.expire_lapsed_pro_accounts();
--   -- (Recreating upgrade_to_pro would restore the free-Pro bypass — do not.)
-- =============================================================================
