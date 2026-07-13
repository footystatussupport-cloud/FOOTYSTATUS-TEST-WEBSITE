import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

const ADMIN_DESKTOP_CLASS = "footy-status-admin-desktop";

const AdminDesktopDisplayMode = () => {
  const { user } = useAuth();
  const enabled = isFootyStatusSuperAdminEmail(user?.email);

  useEffect(() => {
    document.documentElement.classList.toggle(ADMIN_DESKTOP_CLASS, enabled);
    document.body.classList.toggle(ADMIN_DESKTOP_CLASS, enabled);

    return () => {
      document.documentElement.classList.remove(ADMIN_DESKTOP_CLASS);
      document.body.classList.remove(ADMIN_DESKTOP_CLASS);
    };
  }, [enabled]);

  return null;
};

export default AdminDesktopDisplayMode;
