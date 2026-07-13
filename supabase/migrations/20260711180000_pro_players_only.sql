-- =============================================================================
-- Footy Status Pro is a PLAYER-ONLY subscription product
-- =============================================================================
-- Only accounts classified as a player (boy or girl) may hold or purchase Pro.
-- Every other account type — current or future — is automatically ineligible.
--
-- Enforcement layers (defense in depth):
--   1. A BEFORE INSERT/UPDATE trigger on public.profiles that strips any paid
--      tier from a non-player row. This is the universal backstop: it covers the
--      purchase RPC, the admin console, direct client updates, subscription
--      restoration, and renewals — no pathway can leave a non-player on Pro.
--   2. upgrade_to_pro() explicitly rejects non-players (and cross-account calls)
--      with a clear error.
--   3. A one-time cleanup that downgrades any non-player that already holds Pro
--      (from earlier bugs/testing), recording the prior state for audit.
-- Safe to run more than once.
-- =============================================================================

-- Eligibility helper: is this account a player?
create or replace function public.account_is_pro_eligible(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = _user_id
      and (
        lower(coalesce(p.account_role, '')) = 'player'
        or lower(coalesce(p.account_category, '')) = 'player'
        or lower(coalesce(p.role::text, '')) = 'player'
      )
  );
$$;

grant execute on function public.account_is_pro_eligible(uuid) to authenticated;

-- 1) Universal backstop trigger — non-players can never hold a paid tier.
create or replace function public.tg_enforce_pro_player_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_player boolean;
begin
  v_is_player := (
    lower(coalesce(new.account_role, '')) = 'player'
    or lower(coalesce(new.account_category, '')) = 'player'
    or lower(coalesce(new.role::text, '')) = 'player'
  );

  if not v_is_player
     and (coalesce(new.account_tier, 'free') <> 'free' or coalesce(new.is_pro, false)) then
    new.account_tier := 'free';
    new.is_pro := false;
    new.pro_expires_at := null;
    -- pro_started_at is intentionally preserved as historical/audit record.
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_pro_player_only on public.profiles;
create trigger enforce_pro_player_only
  before insert or update on public.profiles
  for each row execute function public.tg_enforce_pro_player_only();

-- 2) Self-serve purchase RPC: reject non-players and cross-account calls.
create or replace function public.upgrade_to_pro(_user_id uuid, _plan_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if _user_id is null or _user_id <> auth.uid() then
    raise exception 'You can only upgrade your own account.';
  end if;

  if not public.account_is_pro_eligible(_user_id) then
    raise exception 'Footy Status Pro is only available for player accounts.';
  end if;

  if _plan_type = 'lifetime' then
    update public.profiles
    set account_tier = 'pro_lifetime',
        is_pro = true,
        pro_started_at = now(),
        pro_expires_at = null,
        updated_at = now()
    where user_id = _user_id;
  elsif _plan_type = 'annual' then
    update public.profiles
    set account_tier = 'pro_annual',
        is_pro = true,
        pro_started_at = now(),
        pro_expires_at = now() + interval '1 year',
        updated_at = now()
    where user_id = _user_id;
  else
    raise exception 'Unknown Pro plan type: %', _plan_type;
  end if;

  perform public.restore_pro_clips(_user_id);
end;
$$;

grant execute on function public.upgrade_to_pro(uuid, text) to authenticated;

-- 3) One-time cleanup of any non-player that already holds Pro. Record the
--    previous state in the admin audit log first (payment/audit history), then
--    downgrade. The trigger above prevents this from recurring.
insert into public.admin_audit_log (
  admin_user_id, action, affected_table, affected_id, target_account_id, before_data, after_data
)
select
  null, 'pro_revoked_non_player', 'profiles', p.user_id::text, p.user_id,
  jsonb_build_object(
    'account_tier', p.account_tier,
    'is_pro', p.is_pro,
    'pro_started_at', p.pro_started_at,
    'pro_expires_at', p.pro_expires_at,
    'account_role', p.account_role,
    'account_category', p.account_category
  ),
  jsonb_build_object('account_tier', 'free', 'is_pro', false)
from public.profiles p
where (coalesce(p.account_tier, 'free') <> 'free' or coalesce(p.is_pro, false))
  and not (
    lower(coalesce(p.account_role, '')) = 'player'
    or lower(coalesce(p.account_category, '')) = 'player'
    or lower(coalesce(p.role::text, '')) = 'player'
  );

update public.profiles p
set account_tier = 'free',
    is_pro = false,
    pro_expires_at = null,
    updated_at = now()
where (coalesce(p.account_tier, 'free') <> 'free' or coalesce(p.is_pro, false))
  and not (
    lower(coalesce(p.account_role, '')) = 'player'
    or lower(coalesce(p.account_category, '')) = 'player'
    or lower(coalesce(p.role::text, '')) = 'player'
  );
