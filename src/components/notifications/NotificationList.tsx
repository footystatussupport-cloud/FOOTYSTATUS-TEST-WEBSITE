import { BellOff } from "lucide-react";
import { AppNotification } from "@/lib/notifications";
import NotificationListItem from "@/components/notifications/NotificationListItem";

interface NotificationListProps {
  notifications: AppNotification[];
  onOpen: (notification: AppNotification) => void;
  onDelete?: (notification: AppNotification) => void;
  renderActions?: (notification: AppNotification) => React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

const NotificationList = ({
  notifications,
  onOpen,
  onDelete,
  renderActions,
  emptyTitle = "No notifications yet",
  emptyDescription = "You're all caught up for now.",
}: NotificationListProps) => {
  if (!notifications.length) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <BellOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <h3 className="text-base font-semibold">{emptyTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notifications.map((notification) => (
        <NotificationListItem
          key={notification.id}
          notification={notification}
          onOpen={onOpen}
          onDelete={onDelete}
          renderActions={renderActions}
        />
      ))}
    </div>
  );
};

export default NotificationList;
