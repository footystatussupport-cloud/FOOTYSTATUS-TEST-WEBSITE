import { supabase } from "@/integrations/supabase/client";

export interface AppNotification {
  id: string;
  user_id: string;
  actor_user_id: string | null;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  link_path: string | null;
  is_read: boolean;
  read_at: string | null;
  deleted_at?: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export const getNotificationUnreadBadge = (count: number) => {
  if (count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
};

export const formatRelativeTime = (dateString: string) => {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(dateString).toLocaleDateString();
};

export const fetchNotificationsForUser = async (userId: string, limit?: number) => {
  let query = (supabase as any)
    .from("notifications")
    .select("id, user_id, actor_user_id, type, title, body, entity_type, entity_id, link_path, is_read, read_at, deleted_at, created_at, metadata")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []) as AppNotification[];
};

export const fetchUnreadNotificationCount = async (userId: string) => {
  const { count, error } = await (supabase as any)
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }

  return count || 0;
};

export const markNotificationRead = async (notificationId: string, userId: string) => {
  const { error } = await (supabase as any).rpc("mark_notification_read", {
    _notification_id: notificationId,
  });

  if (error) {
    throw error;
  }
  notifyNotificationStateChanged(userId);
};

export const markAllNotificationsRead = async (userId: string) => {
  const { error } = await (supabase as any).rpc("mark_all_notifications_read");

  if (error) {
    throw error;
  }
  notifyNotificationStateChanged(userId);
};

export const deleteNotification = async (notificationId: string, userId: string) => {
  const { error } = await (supabase as any).rpc("delete_notification", {
    _notification_id: notificationId,
  });

  if (error) {
    throw error;
  }
  notifyNotificationStateChanged(userId);
};

export const NOTIFICATION_STATE_EVENT = "footystatus:notifications-changed";

export const notifyNotificationStateChanged = (userId: string) => {
  window.dispatchEvent(new CustomEvent(NOTIFICATION_STATE_EVENT, { detail: { userId } }));
};

export const subscribeToNotifications = (userId: string, onChange: () => void) =>
  supabase
    .channel(`notifications-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
