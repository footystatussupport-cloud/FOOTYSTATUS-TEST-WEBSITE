import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell } from "lucide-react";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import NotificationList from "@/components/notifications/NotificationList";
import {
  AppNotification,
  deleteNotification,
  fetchNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from "@/lib/notifications";
import { PendingTeamInviteSummary, fetchPendingTeamInvitesForUser, formatTeamLeagueLine } from "@/lib/teamMemberships";
import { useAuth } from "@/hooks/useAuth";
import { reviewCoachStaffJoinRequest } from "@/lib/coachStaffTeams";
import { fetchLinkedParentsForPlayer, reviewParentPlayerLink } from "@/lib/parentLinks";
import { useRegisterRefresh } from "@/hooks/usePullToRefresh";

const PAGE_SIZE = 25;

const NotificationsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingTeamInviteSummary[]>([]);
  // Invitation currently being accepted/declined (blocks duplicate submissions).
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadNotifications = async () => {
    if (!user) {
      setNotifications([]);
      return;
    }

    try {
      setNotifications(await fetchNotificationsForUser(user.id));
    } catch {
      setNotifications([]);
    }
  };

  const loadPendingInvites = async () => {
    if (!user) {
      setPendingInvites([]);
      return;
    }

    try {
      setPendingInvites(await fetchPendingTeamInvitesForUser(user.id));
    } catch {
      setPendingInvites([]);
    }
  };

  useEffect(() => {
    loadNotifications();
    loadPendingInvites();

    if (!user) return;
    const notificationChannel = subscribeToNotifications(user.id, loadNotifications);
    const inviteChannel = supabase
      .channel(`notifications-team-invites-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_player_invites", filter: `player_user_id=eq.${user.id}` }, loadPendingInvites)
      .subscribe();

    return () => {
      notificationChannel.unsubscribe();
      inviteChannel.unsubscribe();
    };
  }, [user?.id]);

  useRegisterRefresh(async () => {
    await Promise.all([loadNotifications(), loadPendingInvites()]);
  });

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.is_read).length,
    [notifications]
  );

  const visibleNotifications = notifications.slice(0, visibleCount);
  const canLoadMore = visibleCount < notifications.length;

  const handleOpenNotification = async (notification: AppNotification) => {
    if (!user) return;

    if (!notification.is_read) {
      const previousNotifications = notifications;
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item
        )
      );
      try {
        await markNotificationRead(notification.id, user.id);
      } catch (error: any) {
        setNotifications(previousNotifications);
        toast({ title: "Could not mark notification as read", description: error.message, variant: "destructive" });
        return;
      }
    }

    // Deep-link the parent link request tile straight to the review section on
    // the player's profile so tapping the tile (not the buttons) still lands them
    // where they can accept or decline.
    if (notification.type === "parent_link_requested") {
      navigate("/profile?focus=parent-links");
      return;
    }

    if (notification.link_path) {
      navigate(notification.link_path);
    }
  };

  const handleDeleteNotification = async (notification: AppNotification) => {
    if (!user) return;

    const previousNotifications = notifications;
    setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
    try {
      await deleteNotification(notification.id, user.id);
    } catch (error: any) {
      setNotifications(previousNotifications);
      toast({ title: "Notification was not deleted", description: error.message, variant: "destructive" });
    }
  };

  const handleCoachStaffRequestNotification = async (notification: AppNotification, approve: boolean) => {
    if (!user) return;
    const requestId = typeof notification.metadata?.request_id === "string" ? notification.metadata.request_id : notification.entity_id;
    if (!requestId) {
      toast({ title: "Request missing", description: "This notification is missing its request details.", variant: "destructive" });
      return;
    }

    const { data: request, error: requestError } = await (supabase as any)
      .from("coach_staff_join_requests")
      .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, requested_assignments, general_club_role, request_kind")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError || !request) {
      toast({ title: "Request not found", description: requestError?.message || "This request may have already been handled.", variant: "destructive" });
      await markNotificationRead(notification.id, user.id);
      await loadNotifications();
      return;
    }

    if (request.status !== "pending") {
      toast({ title: "Already handled", description: "This request is no longer pending." });
      await markNotificationRead(notification.id, user.id);
      await loadNotifications();
      return;
    }

    const { error } = await reviewCoachStaffJoinRequest(request, approve);
    if (error) {
      console.error("Footy Status coach/staff link review failed", { requestId: request?.id, approve, error });
      toast({
        title: "Update failed",
        description: "We couldn't complete the coach-to-team link. Please try again.",
        variant: "destructive",
      });
      return;
    }

    await markNotificationRead(notification.id, user.id);
    toast({ title: approve ? "Staff request approved" : "Staff request denied" });
    await Promise.all([loadNotifications(), loadPendingInvites()]);
  };

  const handlePlayerJoinRequestNotification = async (notification: AppNotification, approve: boolean) => {
    if (!user) return;
    const requestId = typeof notification.metadata?.request_id === "string" ? notification.metadata.request_id : notification.entity_id;
    if (!requestId) {
      toast({ title: "Request missing", description: "This notification is missing its request details.", variant: "destructive" });
      return;
    }

    // Do not pre-read team_join_requests here. The direct read can be blocked by
    // RLS for school/daughter-team requests even while the request is still
    // pending, causing a false "request not found" message. The SECURITY
    // DEFINER review RPC below is the single source of truth used by both the
    // notification buttons and the Pending Daughter Team Requests list.
    const { error } = await (supabase as any).rpc("review_team_join_request", {
      _request_id: requestId,
      _approve: approve,
    });
    if (error) {
      // Full database error for debugging only — never surface raw SQL to users.
      console.error("Footy Status join request review failed", { requestId, approve, error });
      toast({
        title: "Update failed",
        description: approve
          ? "We couldn't add this player to the team. Please try again."
          : "We couldn't decline this request. Please try again.",
        variant: "destructive",
      });
      return;
    }

    await markNotificationRead(notification.id, user.id);
    toast({ title: approve ? "Player Added" : "Request declined" });
    await Promise.all([loadNotifications(), loadPendingInvites()]);
  };

  const handleParentLinkRequestNotification = async (notification: AppNotification, approve: boolean) => {
    if (!user) return;

    const storedLinkId =
      typeof notification.metadata?.link_id === "string" ? notification.metadata.link_id : notification.entity_id;
    const parentUserId =
      typeof notification.metadata?.parent_user_id === "string" ? notification.metadata.parent_user_id : null;

    // Resolve the CURRENT pending parent link from the same authoritative source
    // the profile tile uses, so Accept/Decline always targets the real pending
    // record even when the notification's stored id is stale (e.g. a request
    // created before this fix, or an id that no longer matches). This keeps the
    // notification action and the pending connection tied to the same record.
    let linkId = storedLinkId;
    try {
      const linkedParents = await fetchLinkedParentsForPlayer(user.id);
      const pending = linkedParents.filter((p) => p.status === "pending");
      const match =
        pending.find((p) => p.link_id === storedLinkId) ||
        (parentUserId ? pending.find((p) => p.parent_user_id === parentUserId) : undefined) ||
        (pending.length === 1 ? pending[0] : undefined);
      if (match) linkId = match.link_id;
    } catch {
      /* fall back to the notification's stored id */
    }

    if (!linkId) {
      toast({ title: "Request missing", description: "This notification is missing its request details.", variant: "destructive" });
      return;
    }

    const { error } = await reviewParentPlayerLink(linkId, approve);
    if (error) {
      // The pending link may already have been handled elsewhere.
      await markNotificationRead(notification.id, user.id);
      await loadNotifications();
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }

    await markNotificationRead(notification.id, user.id);
    toast({ title: approve ? "Parent connection approved" : "Parent connection declined" });
    await loadNotifications();
  };

  const renderNotificationActions = (notification: AppNotification) => {
    if (notification.type === "parent_link_requested") {
      return (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => handleParentLinkRequestNotification(notification, true)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleParentLinkRequestNotification(notification, false)}>
            Decline
          </Button>
        </div>
      );
    }
    if (notification.type === "coach_staff_join_requested") {
      return (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => handleCoachStaffRequestNotification(notification, true)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCoachStaffRequestNotification(notification, false)}>
            Deny
          </Button>
        </div>
      );
    }
    if (notification.type === "team_join_requested") {
      return (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => handlePlayerJoinRequestNotification(notification, true)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => handlePlayerJoinRequestNotification(notification, false)}>
            Decline
          </Button>
        </div>
      );
    }
    return null;
  };

  const handleRespondInvite = async (inviteId: string, accept: boolean) => {
    if (!user) return;
    // Block duplicate submissions while the link is being established.
    if (respondingInviteId) return;

    const invitedTeamName =
      pendingInvites.find((invite: any) => invite.id === inviteId)?.team_name || "that team";

    setRespondingInviteId(inviteId);
    const { error } = await (supabase as any).rpc("respond_team_player_invite", {
      _invite_id: inviteId,
      _accept: accept,
    });

    if (error) {
      console.error("Footy Status team invite response failed", { inviteId, accept, error });
      toast({
        title: "Invite update failed",
        description: accept
          ? "We couldn't accept this team invitation. Please try again."
          : "We couldn't decline this team invitation. Please try again.",
        variant: "destructive",
      });
      setRespondingInviteId(null);
      return;
    }

    toast(
      accept
        ? { title: "Team Linked", description: `You are now linked to ${invitedTeamName}.` }
        : { title: "Invite declined" }
    );
    await Promise.all([loadPendingInvites(), loadNotifications()]);
    setRespondingInviteId(null);
  };

  const handleMarkAllRead = async () => {
    if (!user || !unreadCount) return;

    const previousNotifications = notifications;
    setNotifications((prev) =>
      prev.map((item) => ({
        ...item,
        is_read: true,
        read_at: item.read_at || new Date().toISOString(),
      }))
    );
    try {
      await markAllNotificationsRead(user.id);
    } catch (error: any) {
      setNotifications(previousNotifications);
      toast({ title: "Could not mark notifications as read", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <Header />

      <div className="px-4 py-6">
        <Link to="/" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>

        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All the activity and interactions your account has received.
            </p>
          </div>
          {unreadCount > 0 ? (
            <Button variant="outline" size="sm" className="shrink-0" onClick={handleMarkAllRead}>
              Mark all as read
            </Button>
          ) : null}
        </div>

        {pendingInvites.length > 0 ? (
          <div className="mb-5 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div>
              <h2 className="text-sm font-bold tracking-wide text-navy">Pending Team Invites</h2>
              <p className="mt-1 text-sm text-muted-foreground">These invites can be accepted or declined right here.</p>
            </div>
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="rounded-lg border border-primary/20 bg-background px-3 py-3">
                <p className="font-medium text-foreground">{formatTeamLeagueLine(invite.team_name, invite.age_group, invite.league_name)}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleRespondInvite(invite.id, true)}
                    disabled={respondingInviteId !== null}
                  >
                    {respondingInviteId === invite.id ? "Linking..." : "Accept"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleRespondInvite(invite.id, false)}
                    disabled={respondingInviteId !== null}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <NotificationList
          notifications={visibleNotifications}
          onOpen={handleOpenNotification}
          onDelete={handleDeleteNotification}
          renderActions={renderNotificationActions}
          emptyTitle="No notifications yet"
          emptyDescription="When your account gets invites, approvals, likes, or other updates, they’ll show here."
        />

        {canLoadMore ? (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}>
              Load more
            </Button>
          </div>
        ) : null}

        {!notifications.length ? (
          <div className="mt-6 rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground flex items-center gap-3">
            <Bell className="h-4 w-4 shrink-0" />
            Notification preferences now live in Settings instead of the Other tab.
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default NotificationsPage;
