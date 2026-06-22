import { Bell, CheckCircle2, Heart, Megaphone, Shield, UserPlus, Users, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppNotification, formatRelativeTime } from "@/lib/notifications";

interface NotificationListItemProps {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDelete?: (notification: AppNotification) => void;
  renderActions?: (notification: AppNotification) => React.ReactNode;
}

const getNotificationIcon = (type: string) => {
  if (type.includes("invite")) return Users;
  if (type.includes("join")) return Shield;
  if (type.includes("approved")) return CheckCircle2;
  if (type.includes("rejected") || type.includes("declined")) return XCircle;
  if (type.includes("liked") || type.includes("comment")) return Heart;
  if (type.includes("news") || type.includes("update")) return Megaphone;
  if (type.includes("follow") || type.includes("profile")) return UserPlus;
  return Bell;
};

const NotificationListItem = ({ notification, onOpen, onDelete, renderActions }: NotificationListItemProps) => {
  const Icon = getNotificationIcon(notification.type);
  const actions = renderActions?.(notification);

  return (
    <div
      className={`rounded-xl border px-3 py-3 transition-colors ${
        notification.is_read ? "border-border bg-card" : "border-primary/20 bg-primary/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(notification)} className="flex flex-1 items-start gap-3 text-left">
          <div
            className={`mt-0.5 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              notification.is_read ? "bg-muted" : "bg-primary/10"
            }`}
          >
            <Icon className={`h-4.5 w-4.5 ${notification.is_read ? "text-muted-foreground" : "text-primary"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={`text-sm font-semibold ${notification.is_read ? "text-foreground" : "text-primary"}`}>
                {notification.title}
              </p>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(notification.created_at)}
              </span>
            </div>
            {notification.body ? (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
            ) : null}
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {!notification.is_read ? <span className="w-2 h-2 rounded-full bg-primary" /> : null}
          {onDelete ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => onDelete(notification)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {actions ? <div className="mt-3 border-t border-border pt-3">{actions}</div> : null}
    </div>
  );
};

export default NotificationListItem;
