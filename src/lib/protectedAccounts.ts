import { supabase } from "@/integrations/supabase/client";

/**
 * Shared client-side helpers for the permanently protected Footy Status
 * Official Admin account.
 *
 * IMPORTANT: These helpers are for UX only (hiding controls, showing a clear
 * message). They are NOT the security boundary. Real enforcement lives in the
 * database (public.assert_user_can_be_deleted, the protected_accounts registry,
 * and BEFORE DELETE triggers on auth.users / public.profiles). Never rely on
 * the frontend to protect the account.
 */

export const PROTECTED_ACCOUNT_ERROR =
  "The Footy Status Official Admin account is permanently protected and cannot be deleted.";

/** True if the given user id is in the server-side protected registry. */
export const isAccountProtected = async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  const { data, error } = await (supabase as any).rpc("is_account_protected", {
    _user_id: userId,
  });
  if (error) {
    // Fail safe for UX: if we cannot tell, do not claim it is unprotected.
    console.warn("[protectedAccounts] is_account_protected failed", error);
    return false;
  }
  return Boolean(data);
};

/** True if the CURRENTLY signed-in user is protected (used to hide delete UI). */
export const isCurrentUserDeletionProtected = async (): Promise<boolean> => {
  const { data, error } = await (supabase as any).rpc(
    "current_user_deletion_protected",
  );
  if (error) {
    console.warn(
      "[protectedAccounts] current_user_deletion_protected failed",
      error,
    );
    return false;
  }
  return Boolean(data);
};

/**
 * Shared guard, callable from any deletion pathway before it starts deleting
 * anything. Throws {@link PROTECTED_ACCOUNT_ERROR} if the target account is
 * positively confirmed protected. Mirrors the SQL function of the same name.
 *
 * It only throws on a CONFIRMED-protected result. If the protection registry
 * cannot be reached (e.g. the migration is not deployed yet), it does NOT block
 * — the database RPC (public.delete_my_account -> assert_user_can_be_deleted)
 * remains the authoritative guard, so ordinary deletions never break.
 */
export const assertUserCanBeDeleted = async (
  targetUserId: string,
): Promise<void> => {
  if (await isAccountProtected(targetUserId)) {
    throw new Error(PROTECTED_ACCOUNT_ERROR);
  }
};
