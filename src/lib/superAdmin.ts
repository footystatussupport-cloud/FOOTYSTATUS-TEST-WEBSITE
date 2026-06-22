import { supabase } from "@/integrations/supabase/client";

export const FOOTY_STATUS_SUPER_ADMIN_EMAIL = "footystatussupport@gmail.com";

export const isFootyStatusSuperAdminEmail = (email?: string | null) =>
  (email || "").trim().toLowerCase() === FOOTY_STATUS_SUPER_ADMIN_EMAIL;

export const fetchIsFootyStatusGlobalAdmin = async () => {
  const { data, error } = await (supabase as any).rpc("is_footy_status_global_admin");
  if (error) {
    return false;
  }
  return Boolean(data);
};

export const ensureFootyStatusAdminSession = async () => {
  const { data: { session } } = await supabase.auth.refreshSession();
  const email = session?.user?.email;
  if (!isFootyStatusSuperAdminEmail(email)) {
    return { isAdmin: false, debug: null };
  }

  const seedResult = await (supabase as any).rpc("seed_official_footy_status_admin");
  if (seedResult.error) {
    console.warn("[Footy Status admin] Assignment repair failed", seedResult.error);
  }

  const { data: isAdmin, error } = await (supabase as any).rpc("is_footy_status_global_admin");
  const { data: debug } = await (supabase as any).rpc("debug_footy_status_admin_access");
  console.info("[Footy Status admin] Permission diagnostic", { email, isAdmin, error, debug });
  return { isAdmin: Boolean(isAdmin) && !error, debug };
};
export const callGlobalAdminAction = async (action: string, payload: Record<string, unknown> = {}) =>
  (supabase as any).rpc("perform_global_admin_action", {
    _action: action,
    _payload: payload,
  });
