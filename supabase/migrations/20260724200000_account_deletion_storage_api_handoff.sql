-- =============================================================================
-- Permanent account deletion: Storage API handoff
-- =============================================================================
-- Supabase protects storage.objects from direct SQL DELETEs because removing
-- only its database metadata can orphan the physical object. Account database
-- and Auth deletion remains one transaction in admin_delete_account; a trusted
-- Edge Function obtains this manifest before that transaction, then removes the
-- files through the supported Storage API.
-- =============================================================================

-- Compatibility no-op: delete_account_app_data calls this function. Physical
-- storage deletion is performed by admin-delete-account after the database/Auth
-- transaction commits. Never write directly to storage.objects here.
create or replace function public.delete_account_storage_objects(
  _target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

revoke all on function public.delete_account_storage_objects(uuid)
  from public, anon, authenticated;

-- Read-only manifest for the trusted Edge Function. Only the authenticated
-- Footy Status Official Admin can obtain it.
create or replace function public.admin_account_storage_manifest(
  _target_user_id uuid,
  _reason text default null
)
returns table (
  bucket_id text,
  object_name text
)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  perform public.admin_assert_official(_reason);

  if _target_user_id is null then
    raise exception 'Target account is required.';
  end if;

  perform public.assert_user_can_be_deleted(_target_user_id);

  return query
  select distinct
    o.bucket_id::text,
    o.name::text
  from storage.objects o
  where o.owner::text = _target_user_id::text
     or o.name like _target_user_id::text || '/%'
     or o.name like '%/' || _target_user_id::text || '/%'
     or o.name like '%/' || _target_user_id::text || '-%'
     or o.name like '%/' || _target_user_id::text || '_%'
  order by 1, 2;
end;
$$;

revoke all on function public.admin_account_storage_manifest(uuid, text)
  from public, anon;
grant execute on function public.admin_account_storage_manifest(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
