import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import NotificationBadge from "@/components/notifications/NotificationBadge";
import { fetchUnreadNotificationCount, NOTIFICATION_STATE_EVENT, subscribeToNotifications } from "@/lib/notifications";

interface NotificationBellProps {
  userId: string;
}

const NotificationBell = ({ userId }: NotificationBellProps) => {
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const loadUnreadCount = async () => {
      try {
        setUnreadCount(await fetchUnreadNotificationCount(userId));
      } catch {
        setUnreadCount(0);
      }
    };

    loadUnreadCount();
    const channel = subscribeToNotifications(userId, loadUnreadCount);
    const handleLocalChange = (event: Event) => {
      const changedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!changedUserId || changedUserId === userId) loadUnreadCount();
    };
    window.addEventListener(NOTIFICATION_STATE_EVENT, handleLocalChange);

    return () => {
      channel.unsubscribe();
      window.removeEventListener(NOTIFICATION_STATE_EVENT, handleLocalChange);
    };
  }, [userId]);

  return (
    <button
      type="button"
      onClick={() => navigate("/notifications")}
      className="relative w-9 h-9 rounded-full border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
      aria-label="Open notifications"
    >
      <Bell className={`h-4.5 w-4.5 ${unreadCount > 0 ? "text-primary" : "text-muted-foreground"}`} />
      <NotificationBadge count={unreadCount} />
    </button>
  );
};

export default NotificationBell;
