import { useEffect, useState } from "react";
import { Bell, MapPin, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import ClubNewsComposer from "@/components/club-news/ClubNewsComposer";
import { supabase } from "@/integrations/supabase/client";
import { AppNotification, fetchNotificationsForUser, markNotificationRead, subscribeToNotifications } from "@/lib/notifications";
import { PendingTeamInviteSummary, fetchPendingTeamInvitesForUser, formatTeamLeagueLine } from "@/lib/teamMemberships";
import ClubNewsCardFeed from "@/components/club-news/ClubNewsCardFeed";
import { ClubNewsPostSummary, fetchManagedClubContext, fetchNearbyClubNews, getCachedViewerCoordinates } from "@/lib/clubNews";
import { reviewCoachStaffJoinRequest } from "@/lib/coachStaffTeams";

const HomeTab = () => {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingTeamInviteSummary[]>([]);
  const [newsPosts, setNewsPosts] = useState<ClubNewsPostSummary[]>([]);
  const [locationReady, setLocationReady] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [managedClubContext, setManagedClubContext] = useState<{
    clubId: string;
    teamId: string;
    clubName: string;
    city: string | null;
  } | null>(null);

  const canPostClubNews = profile?.account_role === "team_club" && !!managedClubContext && !!user?.id;

  const loadNearbyPosts = async () => {
    const coords = await getCachedViewerCoordinates();
    if (!coords) {
      setNewsPosts([]);
      setLocationReady(false);
      return;
    }

    try {
      const posts = await fetchNearbyClubNews(coords, 20);
      setNewsPosts(posts);
    } catch {
      setNewsPosts([]);
    } finally {
      setLocationReady(true);
    }
  };

  const handleOpenNotification = async (notification: AppNotification) => {
    if (!user) return;

    if (!notification.is_read) {
      const previousNotifications = notifications;
      setNotifications((prev) =>
        prev.map((item) => (item.id === notification.id ? { ...item, is_read: true, read_at: new Date().toISOString() } : item))
      );
      try {
        await markNotificationRead(notification.id, user.id);
      } catch (error: any) {
        setNotifications(previousNotifications);
        toast({ title: "Could not open notification", description: error.message, variant: "destructive" });
        return;
      }
    }

    navigate(notification.link_path || "/notifications");
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

  const handleRespondInvite = async (inviteId: string, accept: boolean) => {
    if (!user) return;

    const { error } = await (supabase as any).rpc("respond_team_player_invite", {
      _invite_id: inviteId,
      _accept: accept,
    });

    if (error) {
      toast({ title: "Invite update failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: accept ? "Invite accepted" : "Invite declined" });
    await Promise.all([loadPendingInvites(), fetchNotifications()]);
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
      await fetchNotifications();
      return;
    }

    if (request.status !== "pending") {
      toast({ title: "Already handled", description: "This request is no longer pending." });
      await markNotificationRead(notification.id, user.id);
      await fetchNotifications();
      return;
    }

    const { error } = await reviewCoachStaffJoinRequest(request, approve);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }

    await markNotificationRead(notification.id, user.id);
    toast({ title: approve ? "Staff request approved" : "Staff request denied" });
    await fetchNotifications();
  };

  const fetchNotifications = async () => {
    if (!user) {
      setNotifications([]);
      return;
    }

    try {
      const notificationRows = await fetchNotificationsForUser(user.id, 3);
      setNotifications(notificationRows);
    } catch {
      setNotifications([]);
    }
  };

  useEffect(() => {
    fetchNotifications();
    loadPendingInvites();

    if (!user) return;
    const notificationChannel = subscribeToNotifications(user.id, fetchNotifications);
    const inviteChannel = supabase
      .channel(`team-invites-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_player_invites", filter: `player_user_id=eq.${user.id}` }, loadPendingInvites)
      .subscribe();

    return () => {
      notificationChannel.unsubscribe();
      inviteChannel.unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    loadNearbyPosts();
  }, []);

  useEffect(() => {
    const loadManagedClubContext = async () => {
      if (!user?.id || profile?.account_role !== "team_club") {
        setManagedClubContext(null);
        return;
      }

      try {
        const context = await fetchManagedClubContext(user.id);
        setManagedClubContext(context);
      } catch {
        setManagedClubContext(null);
      }
    };

    loadManagedClubContext();
  }, [profile?.account_role, user?.id]);

  return (
    <div className="px-4 py-6">
      {pendingInvites.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold tracking-wide text-navy">TEAM INVITES</h2>
          </div>
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">Pending invite</p>
                <p className="mt-2 font-semibold text-foreground">{formatTeamLeagueLine(invite.team_name, invite.age_group, invite.league_name)}</p>
                <p className="mt-1 text-sm text-muted-foreground">You can accept or decline this team invite right here.</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => handleRespondInvite(invite.id, true)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => handleRespondInvite(invite.id, false)}>
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold tracking-wide text-navy">NOTIFICATIONS</h2>
          {notifications.length > 0 ? (
            <button className="text-xs font-medium text-navy hover:underline" onClick={() => navigate("/notifications")}>
              View All
            </button>
          ) : null}
        </div>
        {notifications.length > 0 ? (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div key={notification.id} className="w-full bg-card border border-border rounded-xl px-3 py-2.5 hover:border-accent transition-colors">
                <button
                  onClick={() => handleOpenNotification(notification)}
                  className="w-full flex items-center gap-3 text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 self-center">
                    <Bell className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">{notification.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words line-clamp-2">{notification.body}</p>
                  </div>
                </button>
                {notification.type === "coach_staff_join_requested" ? (
                  <div className="mt-3 flex gap-2 border-t border-border pt-3">
                    <Button size="sm" className="flex-1" onClick={() => handleCoachStaffRequestNotification(notification, true)}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCoachStaffRequestNotification(notification, false)}>
                      Deny
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-4 text-center text-muted-foreground text-sm">
            No new notifications right now.
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold tracking-wide text-navy">NEWS / UPDATES</h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Within 500 miles</span>
            {canPostClubNews ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-full"
                onClick={() => setComposerOpen(true)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {newsPosts.length > 0 ? (
          <div className="space-y-3">
            {newsPosts.map((post) => (
              <ClubNewsCardFeed
                key={post.id}
                post={post}
                onClick={() => navigate(`/club-news/${post.id}`)}
                onOpenClubProfile={() => navigate(`/team/${post.team_id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl px-4 py-5 text-center">
            <MapPin className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {locationReady
                ? "No nearby club posts yet."
                : "Enable location on this device to see club news within 500 miles."}
            </p>
          </div>
        )}
      </section>

      {managedClubContext && user?.id ? (
        <ClubNewsComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          clubId={managedClubContext.clubId}
          teamId={managedClubContext.teamId}
          clubName={managedClubContext.clubName}
          userId={user.id}
          city={managedClubContext.city}
          onSaved={() => {
            setComposerOpen(false);
            loadNearbyPosts();
          }}
        />
      ) : null}
    </div>
  );
};

export default HomeTab;
