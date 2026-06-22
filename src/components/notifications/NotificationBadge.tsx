import { getNotificationUnreadBadge } from "@/lib/notifications";

interface NotificationBadgeProps {
  count: number;
}

const NotificationBadge = ({ count }: NotificationBadgeProps) => {
  const label = getNotificationUnreadBadge(count);

  if (!label) return null;

  return (
    <span className="absolute -right-1 -top-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold inline-flex items-center justify-center shadow-sm">
      {label}
    </span>
  );
};

export default NotificationBadge;
