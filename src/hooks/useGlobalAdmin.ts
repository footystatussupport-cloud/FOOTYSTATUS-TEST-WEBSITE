import { useEffect, useState } from "react";
import { fetchIsFootyStatusGlobalAdmin, isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const useGlobalAdmin = () => {
  const { user, profile } = useAuth();
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!user) {
        if (mounted) {
          setIsGlobalAdmin(false);
          setLoading(false);
        }
        return;
      }

      const officialEmail = isFootyStatusSuperAdminEmail(user.email || profile?.email);
      let backendAllowed = await fetchIsFootyStatusGlobalAdmin();

      if (!backendAllowed && officialEmail) {
        await (supabase as any).rpc("seed_official_footy_status_admin");
        backendAllowed = await fetchIsFootyStatusGlobalAdmin();
      }

      if (mounted) {
        setIsGlobalAdmin(backendAllowed);
        setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [user, profile?.email]);

  return { isGlobalAdmin, loading };
};
