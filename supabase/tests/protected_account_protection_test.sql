-- =============================================================================
-- TEST: Footy Status Official Admin permanent-protection guarantees.
-- =============================================================================
-- How to run: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- It runs entirely inside a transaction that is ROLLED BACK at the end, so it
-- creates and destroys only throwaway test rows and never touches real data or
-- the real protected account.
--
-- Every check RAISEs 'TEST FAILED ...' on failure; a clean run prints only
-- 'ALL PROTECTED-ACCOUNT TESTS PASSED'.
-- =============================================================================
begin;

do $$
declare
  v_normal_id  uuid := gen_random_uuid();
  v_protect_id uuid := gen_random_uuid();
  v_ok boolean;
  v_deleted int;
begin
  -- --- Fixtures: two throwaway auth users -----------------------------------
  -- Inserting into auth.users fires the existing on_auth_user_created trigger,
  -- which auto-creates the matching public.profiles rows (account_role /
  -- account_category default to 'player'), so we do NOT insert profiles here.
  insert into auth.users (id, email, created_at)
    values (v_normal_id,  'test-normal-'  || v_normal_id  || '@example.test', now()),
           (v_protect_id, 'test-protect-' || v_protect_id || '@example.test', now());

  -- Make the snapshot deterministic regardless of trigger defaults.
  update public.profiles set account_role = 'player', account_category = 'player'
    where user_id in (v_normal_id, v_protect_id);

  -- Mark the second user as protected (registry INSERT is permitted).
  insert into public.protected_accounts (user_id, official_email, protected_role, protected_account_category)
    values (v_protect_id, 'test-protect@example.test', 'player', 'player');

  -- ==========================================================================
  -- (1) A normal user CAN still be deleted through the intended workflow.
  -- ==========================================================================
  delete from public.profiles where user_id = v_normal_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'TEST FAILED (1): normal profile was not deletable'; end if;
  delete from auth.users where id = v_normal_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'TEST FAILED (1): normal auth user was not deletable'; end if;

  -- ==========================================================================
  -- (4) Direct deletion of the protected PUBLIC PROFILE fails.
  -- ==========================================================================
  begin
    delete from public.profiles where user_id = v_protect_id;
    raise exception 'TEST FAILED (4): protected profile was deleted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;  -- re-raise our own failure
  end;
  if not exists (select 1 from public.profiles where user_id = v_protect_id) then
    raise exception 'TEST FAILED (4): protected profile row is gone';
  end if;

  -- ==========================================================================
  -- (5) Direct deletion of the protected auth.users row fails.
  -- ==========================================================================
  begin
    delete from auth.users where id = v_protect_id;
    raise exception 'TEST FAILED (5): protected auth user was deleted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
  if not exists (select 1 from auth.users where id = v_protect_id) then
    raise exception 'TEST FAILED (5): protected auth user row is gone';
  end if;

  -- ==========================================================================
  -- (2)/(3)/(6) The shared assert rejects the protected user (this is what
  --      delete_my_account, admin flows, and bulk deletion all call first).
  -- ==========================================================================
  begin
    perform public.assert_user_can_be_deleted(v_protect_id);
    raise exception 'TEST FAILED (2/3/6): assert_user_can_be_deleted allowed protected user';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
  -- ...but ALLOWS an ordinary user id (no exception expected).
  perform public.assert_user_can_be_deleted(gen_random_uuid());

  -- ==========================================================================
  -- (7) Changing the protected user's EMAIL does not remove protection.
  -- ==========================================================================
  update auth.users set email = 'changed-' || v_protect_id || '@example.test' where id = v_protect_id;
  select public.is_account_protected(v_protect_id) into v_ok;
  if not v_ok then raise exception 'TEST FAILED (7): protection lost after email change'; end if;

  -- ==========================================================================
  -- (8) Changing the protected user's USERNAME/profile email does not remove it.
  -- ==========================================================================
  update public.profiles set email = 'changed-username@example.test' where user_id = v_protect_id;
  select public.is_account_protected(v_protect_id) into v_ok;
  if not v_ok then raise exception 'TEST FAILED (8): protection lost after username/profile change'; end if;

  -- ==========================================================================
  -- (9) The protection registry row cannot be modified or deleted.
  -- ==========================================================================
  begin
    update public.protected_accounts set official_email = 'x@x.test' where user_id = v_protect_id;
    raise exception 'TEST FAILED (9): registry row was updatable';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
  begin
    delete from public.protected_accounts where user_id = v_protect_id;
    raise exception 'TEST FAILED (9): registry row was deletable';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;

  -- ==========================================================================
  -- (bonus) The protected profile cannot be demoted out of its admin role.
  -- ==========================================================================
  begin
    update public.profiles set account_role = 'scout' where user_id = v_protect_id;
    raise exception 'TEST FAILED (role-freeze): protected role was changed';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;

  raise notice 'ALL PROTECTED-ACCOUNT TESTS PASSED';
end $$;

rollback;
