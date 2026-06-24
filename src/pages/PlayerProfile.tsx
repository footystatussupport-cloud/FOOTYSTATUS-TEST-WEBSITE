import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, User, Mail, Phone, Trophy, Star, Shield, Link as LinkIcon, Video, Heart, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import Header from "@/components/Header";
import { fetchActiveMembershipForUser, formatTeamLeagueLine, ActiveMembership, LiveStandingSummary, getMembershipTeamDestination } from "@/lib/teamMemberships";
import ProBadge from "@/components/ProBadge";
import CurrentStatsSection, { CurrentStats } from "@/components/CurrentStatsSection";
import ClubHistorySection, { ClubHistoryEntry } from "@/components/ClubHistorySection";
import { getIsPro, recordProfileView } from "@/lib/subscriptions";
import { PrivateParentContact, fetchPrivateParentContactsForPlayer } from "@/lib/parentLinks";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";

interface Player {
  id: string;
  user_id: string | null;
  name: string;
  club: string;
  league: string;
  position: string | null;
  jersey_number: string | null;
  school_grade?: string | null;
  age_birth_year?: string | null;
  height: string | null;
  weight: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  profile_image_url: string | null;
  team_id: string | null;
  bio?: string | null;
  username?: string | null;
  subscription?: any;
}

interface ContactItem {
  id: string;
  contact_type: string;
  value: string;
  visibility: "public" | "restricted" | "private";
}

type PlayerStats = CurrentStats;

type ClubHistory = ClubHistoryEntry;

interface Team {
  id: string;
  name: string;
  league_id: string | null;
  logo_url?: string | null;
}

interface League {
  id: string;
  name: string;
}

interface PlayerClip {
  id: string;
  title: string;
  thumbnail_url: string | null;
  video_url: string;
  likes_count: number | null;
  views_count: number | null;
  created_at: string;
  duration: number | null;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
  playback_volume?: number | null;
  fit_mode?: "cover" | "contain" | null;
}

const CONTACT_LABELS: Record<string, string> = {
  player_email: "Player Email",
  player_phone: "Player Phone",
  coach_email: "Coach Email",
  coach_phone: "Coach Phone",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Website",
};

const CONTACT_DISPLAY_ORDER = [
  "player_email",
  "player_phone",
  "coach_email",
  "coach_phone",
  "instagram",
  "tiktok",
  "youtube",
  "website",
] as const;

const formatStandingSuffix = (position?: number | null) => {
  if (!position) return "-";
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return position + "th";
  switch (position % 10) {
    case 1:
      return position + "st";
    case 2:
      return position + "nd";
    case 3:
      return position + "rd";
    default:
      return position + "th";
  }
};

const PlayerProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [player, setPlayer] = useState<Player | null>(null);
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [clubHistory, setClubHistory] = useState<ClubHistory[]>([]);
  const [team, setTeam] = useState<Team | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [parentContacts, setParentContacts] = useState<PrivateParentContact[]>([]);
  const [activeMembership, setActiveMembership] = useState<ActiveMembership | null>(null);
  const [teamStanding] = useState<LiveStandingSummary | null>(null);
  const [linkedTeamLogoUrl, setLinkedTeamLogoUrl] = useState<string | null>(null);
  const [clips, setClips] = useState<PlayerClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const restoredScrollRef = useRef(false);

  const scrollStorageKey = id ? `footystatus:player-profile-scroll:${id}` : null;

  useEffect(() => {
    restoredScrollRef.current = false;
  }, [id]);

  useEffect(() => {
    const fetchPlayerData = async () => {
      if (!id) return;

      setLoading(true);
      const { data: canViewProfile, error: visibilityError } = await (supabase as any).rpc(
        "can_view_player_profile",
        { _target_player_profile_id: id }
      );

      if (visibilityError || canViewProfile !== true) {
        setPlayer(null);
        setStats([]);
        setClubHistory([]);
        setClips([]);
        setContacts([]);
        setParentContacts([]);
        setActiveMembership(null);
        setLoading(false);
        return;
      }

      const [publicProfileRes, playerRes, statsRes, historyRes] = await Promise.all([
        supabase.from("player_profiles_public").select("*").eq("id", id).maybeSingle(),
        supabase.from("players").select("*").eq("id", id).maybeSingle(),
        (supabase as any)
          .from("current_player_statistics")
          .select("team_id, team_name, team_logo_url, season, goals, assists, appearances, substitute_ins, starts, clean_sheets, yellow_cards, red_cards")
          .eq("player_profile_id", id)
          .order("team_name", { ascending: true }),
        (supabase as any)
          .from("player_club_history")
          .select("*")
          .eq("player_profile_id", id)
          .order("season", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      let viewedUserId: string | null = null;
      let resolvedMembership: ActiveMembership | null = null;
      let resolvedTeamLogoUrl: string | null = null;
      let resolvedStats = (statsRes.data || []) as PlayerStats[];
      let resolvedClubHistory = (historyRes.data || []) as ClubHistory[];

      if (publicProfileRes.data) {
        viewedUserId = publicProfileRes.data.user_id;
        resolvedMembership = publicProfileRes.data.user_id
          ? await fetchActiveMembershipForUser(publicProfileRes.data.user_id)
          : null;
        setActiveMembership(resolvedMembership);
        setPlayer({
          id: publicProfileRes.data.id,
          user_id: publicProfileRes.data.user_id,
          name: publicProfileRes.data.full_name || "Unknown Player",
          club: resolvedMembership?.team?.name || publicProfileRes.data.team_name || publicProfileRes.data.team || "",
          league: resolvedMembership?.league?.name || "",
          position: publicProfileRes.data.position,
          jersey_number: publicProfileRes.data.jersey_number || null,
          school_grade: publicProfileRes.data.school_grade || null,
          height: publicProfileRes.data.height,
          weight: publicProfileRes.data.weight,
          contact_email: null,
          contact_phone: null,
          profile_image_url: publicProfileRes.data.avatar_url || publicProfileRes.data.profile_image_url,
          team_id: null,
          bio: publicProfileRes.data.bio,
          username: publicProfileRes.data.username,
          age_birth_year: publicProfileRes.data.age_birth_year || null,
        });
      } else if (playerRes.data) {
        viewedUserId = playerRes.data.user_id || null;
        resolvedMembership = playerRes.data.user_id
          ? await fetchActiveMembershipForUser(playerRes.data.user_id)
          : null;
        setActiveMembership(resolvedMembership);
        setPlayer({ ...playerRes.data, user_id: null });

        // Fetch team and league data
        if (resolvedMembership?.team_id || playerRes.data.team_id) {
          const { data: teamData } = await supabase
            .from("teams")
            .select("*")
            .eq("id", resolvedMembership?.team_id || playerRes.data.team_id)
            .maybeSingle();

          if (teamData) {
            setTeam(teamData);
            if (teamData.league_id) {
              const { data: leagueData } = await supabase
                .from("leagues")
                .select("*")
                .eq("id", teamData.league_id)
                .maybeSingle();
              if (leagueData) setLeague(leagueData);
            }
          }
        }
      }

      if (viewedUserId) {
        const { data: viewedSubscription } = await (supabase as any)
          .from("profiles")
          .select("user_id, account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
          .eq("user_id", viewedUserId)
          .maybeSingle();
        setPlayer((prev) => (prev ? { ...prev, subscription: viewedSubscription } : prev));
        await recordProfileView(viewedUserId, user?.id);

        const { data: playerRecord } = await (supabase as any)
          .from("players")
          .select("id")
          .eq("user_id", viewedUserId)
          .maybeSingle();

        if (resolvedMembership?.team?.id) {
          const [{ data: teamProfile }, { data: teamRow }] = await Promise.all([
            (supabase as any)
              .from("team_profiles")
              .select("logo_url")
              .eq("team_id", resolvedMembership.team.id)
              .maybeSingle(),
            (supabase as any)
              .from("teams")
              .select("logo_url")
              .eq("id", resolvedMembership.team.id)
              .maybeSingle(),
          ]);
          resolvedTeamLogoUrl = teamProfile?.logo_url || teamRow?.logo_url || null;
        }

        if (playerRecord?.id) {
          const [{ data: statRows }, { data: historyRows }] = await Promise.all([
            (supabase as any)
              .from("current_player_statistics")
              .select("team_id, team_name, team_logo_url, season, goals, assists, appearances, substitute_ins, starts, clean_sheets, yellow_cards, red_cards")
              .eq("player_id", playerRecord.id)
              .order("team_name", { ascending: true }),
            (supabase as any)
              .from("player_club_history")
              .select("*")
              .eq("player_id", playerRecord.id)
              .order("season", { ascending: false })
              .order("created_at", { ascending: false }),
          ]);

          resolvedStats = (statRows || []) as PlayerStats[];
          if (historyRows) resolvedClubHistory = historyRows as ClubHistory[];
        }
      }

      setLinkedTeamLogoUrl(resolvedTeamLogoUrl);
      setStats(resolvedStats);
      setClubHistory(resolvedClubHistory);
      if (viewedUserId) {
        const { data: clipData } = await supabase
          .from("clips")
          .select("id, title, thumbnail_url, video_url, likes_count, views_count, created_at, duration, trim_start_seconds, trim_end_seconds, playback_volume, fit_mode")
          .eq("user_id", viewedUserId)
          .eq("review_status", "approved")
          .eq("visibility", "public")
          .order("created_at", { ascending: false });

        setClips((clipData || []) as PlayerClip[]);
      } else {
        setClips([]);
      }

      if (viewedUserId) {
        const { data: contactData } = await (supabase as any)
          .rpc("get_profile_contact_info", { _target_user_id: viewedUserId });

        setContacts((contactData || []) as ContactItem[]);
        const { data: privateParentContacts } = await fetchPrivateParentContactsForPlayer(viewedUserId);
        setParentContacts(privateParentContacts);
      } else {
        setContacts([]);
        setParentContacts([]);
      }
      setLoading(false);
    };

    fetchPlayerData();
  }, [id, reloadToken, user?.id, profile?.account_role, profile?.player_gender]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`player-profile-sync-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "player_statistics" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "club_history" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "assist_claims" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "league_standings" }, () => setReloadToken((value) => value + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "player_team_memberships" }, () => setReloadToken((value) => value + 1))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (loading || !scrollStorageKey || restoredScrollRef.current) return;

    const savedValue = sessionStorage.getItem(scrollStorageKey);
    if (!savedValue) return;

    try {
      const saved = JSON.parse(savedValue) as { scrollY?: number; savedAt?: number };
      if (!saved.savedAt || Date.now() - saved.savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(scrollStorageKey);
        return;
      }

      restoredScrollRef.current = true;
      const scrollY = Math.max(0, Number(saved.scrollY || 0));
      const restore = () => window.scrollTo({ top: scrollY, behavior: "auto" });

      restore();
      const timers = [
        window.setTimeout(restore, 100),
        window.setTimeout(restore, 350),
        window.setTimeout(() => {
          restore();
          sessionStorage.removeItem(scrollStorageKey);
        }, 800),
      ];

      return () => timers.forEach((timer) => window.clearTimeout(timer));
    } catch {
      sessionStorage.removeItem(scrollStorageKey);
    }
  }, [loading, scrollStorageKey, clips.length]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
          <Header />
          <div className="p-4">
            <Skeleton className="h-8 w-24 mb-6" />
            <Skeleton className="h-32 w-32 rounded-full mx-auto mb-4" />
            <Skeleton className="h-6 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen bg-background">
        <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
          <Header />
          <div className="p-4">
            <button onClick={() => navigate("/?tab=explore")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
              Back to Explore
            </button>
            <p className="text-center mt-12 text-muted-foreground">This profile is not available.</p>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = !!(user && player.user_id && user.id === player.user_id);
  if (isOwner) {
    return <Navigate to="/profile" replace />;
  }
  const orderedVisibleContacts = [...contacts].sort((a, b) => {
    const aIndex = CONTACT_DISPLAY_ORDER.indexOf(a.contact_type as (typeof CONTACT_DISPLAY_ORDER)[number]);
    const bIndex = CONTACT_DISPLAY_ORDER.indexOf(b.contact_type as (typeof CONTACT_DISPLAY_ORDER)[number]);
    const normalizedA = aIndex === -1 ? CONTACT_DISPLAY_ORDER.length : aIndex;
    const normalizedB = bIndex === -1 ? CONTACT_DISPLAY_ORDER.length : bIndex;
    return normalizedA - normalizedB;
  });
  const firstName = player.name.trim().split(/\s+/)[0] || "Player";
  const isProPlayer = getIsPro(player.subscription);
  const activeTeamSubtitle = activeMembership?.team
    ? [activeMembership.league?.name, activeMembership.age_group || activeMembership.team.age_group].filter(Boolean).join(" - ")
    : null;
  const detailValues = [player.club, player.position, player.school_grade, player.age_birth_year, player.height, player.weight]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const displayBio = player.bio && !detailValues.includes(player.bio.trim().toLowerCase()) ? player.bio : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        <header className="sticky top-0 bg-background border-b border-border px-4 py-3 z-10">
          <button 
            onClick={() => navigate("/?tab=explore")} 
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Explore
          </button>
        </header>

        <div className="w-full min-w-0 overflow-x-hidden p-4">
        {/* Profile Header */}
        <div className="relative flex flex-col items-center mb-8">
          <div className="absolute right-0 top-0">
            <InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="profile" label="Edit profile header" onChanged={() => setReloadToken((value) => value + 1)} />
          </div>
          <div className="w-28 h-28 rounded-full bg-foreground flex items-center justify-center overflow-hidden mb-4">
            {player.profile_image_url ? (
              <img src={player.profile_image_url} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <User className="h-14 w-14 text-background" />
            )}
          </div>
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
            <h1 className="col-start-2 max-w-[14rem] break-words text-center text-2xl font-bold text-foreground">{player.name}</h1>
            <div className="col-start-3 ml-2 justify-self-start">
              {isProPlayer ? (
                <ProBadge
                  iconOnly
                  showInfoBubble
                  className="border border-yellow-500 bg-white text-yellow-700 shadow-sm"
                />
              ) : null}
            </div>
          </div>
          <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold text-foreground">Player</span>
            {player.username ? <span className="break-all text-muted-foreground">@{player.username}</span> : null}
          </div>
          {displayBio && <p className="mx-auto mt-2 w-full max-w-xs break-words whitespace-pre-wrap text-center text-sm text-muted-foreground" style={{ textAlign: "center" }}>{displayBio}</p>}
        </div>

        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Details</h2><InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="profile" label="Edit player details" onChanged={() => setReloadToken((value) => value + 1)} /></div>
          <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
            {activeMembership?.team ? (
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Team</p>
                </div>
                <button
                  onClick={() => {
                    const destination = getMembershipTeamDestination(activeMembership);
                    if (destination) navigate(destination);
                  }}
                  className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden">
                    {linkedTeamLogoUrl ? (
                      <img src={linkedTeamLogoUrl} alt={activeMembership.team.name} className="w-full h-full object-cover" />
                    ) : (
                      <Shield className="h-6 w-6 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{activeMembership.team.name}</p>
                    {activeTeamSubtitle ? <p className="text-sm text-muted-foreground truncate">{activeTeamSubtitle}</p> : null}
                  </div>
                </button>
              </div>
            ) : player.club ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Team</p><p className="font-medium">{player.club}</p></div>
              </div>
            ) : null}
            {teamStanding ? (
              <div className="flex items-center gap-3 px-4 py-3">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">League Standing</p>
                  <p className="font-medium">{formatStandingSuffix(teamStanding.position)} • {teamStanding.points} pts</p>
                  <p className="text-xs text-muted-foreground">{teamStanding.wins}W – {teamStanding.draws}D – {teamStanding.losses}L</p>
                </div>
              </div>
            ) : null}
            {player.position && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Trophy className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Position</p><p className="font-medium">{player.position}</p></div>
              </div>
            )}
            {(activeMembership?.jersey_number || player.jersey_number) && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Jersey Number</p><p className="font-medium">{activeMembership?.jersey_number || player.jersey_number}</p></div>
              </div>
            )}
            {player.age_birth_year && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Star className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Birth Year</p><p className="font-medium">{player.age_birth_year}</p></div>
              </div>
            )}
            {player.school_grade && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Star className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Grade</p><p className="font-medium">{player.school_grade}</p></div>
              </div>
            )}
            {player.height && (
              <div className="flex items-center gap-3 px-4 py-3">
                <User className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Height</p><p className="font-medium">{player.height}</p></div>
              </div>
            )}
            {player.weight && (
              <div className="flex items-center gap-3 px-4 py-3">
                <User className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Weight</p><p className="font-medium">{player.weight}</p></div>
              </div>
            )}
          </div>
        </section>

        {stats.length > 0 ? (
          <div className="mb-6 space-y-4">
            {stats.map((teamStats, index) => (
              <CurrentStatsSection key={teamStats.team_id || `${teamStats.team_name || "team"}-${index}`} stats={teamStats} headingLevel="h2" action={<InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="stats" label="Edit player statistics" onChanged={() => setReloadToken((value) => value + 1)} />} />
            ))}
          </div>
        ) : null}

        {parentContacts.length > 0 && (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold tracking-wide">PRIVATE PARENT / CONTACT SECTION</h2><InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="parents" label="Manage parent links" onChanged={() => setReloadToken((value) => value + 1)} /></div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              {parentContacts.map((parentContact) => (
                <div key={parentContact.link_id} className="rounded-lg border border-border p-3">
                  <p className="font-medium text-foreground">{parentContact.parent_full_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{parentContact.relationship_to_player || "Parent / Guardian"}</p>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {parentContact.contact_phone ? <p>Phone: {parentContact.contact_phone}</p> : null}
                    {parentContact.contact_email ? <p>Email: {parentContact.contact_email}</p> : null}
                    {parentContact.emergency_contact ? <p>Emergency: {parentContact.emergency_contact}</p> : null}
                    {parentContact.notes ? <p>Notes: {parentContact.notes}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Contact Information */}
        {orderedVisibleContacts.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold tracking-wide">MY CONTACTS / LINKS</h2><InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="profile" label="Edit contact and social links" onChanged={() => setReloadToken((value) => value + 1)} /></div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              {orderedVisibleContacts.map((contact) => (
                <div key={contact.id} className="flex items-start gap-3 min-w-0">
                  {contact.contact_type.includes("phone") ? (
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                  ) : contact.contact_type.includes("email") ? (
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                  ) : (
                    <LinkIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{CONTACT_LABELS[contact.contact_type] || contact.contact_type}</p>
                    {contact.contact_type.includes("phone") ? (
                      <a href={`tel:${contact.value}`} className="text-sm text-navy hover:underline break-all min-w-0">
                        {contact.value}
                      </a>
                    ) : contact.contact_type.includes("email") ? (
                      <a href={`mailto:${contact.value}`} className="text-sm text-navy hover:underline break-all min-w-0">
                        {contact.value}
                      </a>
                    ) : (
                      <a
                        href={contact.value.startsWith("http") ? contact.value : `https://${contact.value}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-navy hover:underline break-all min-w-0"
                      >
                        {contact.value}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className={`${orderedVisibleContacts.length > 0 ? "mt-6" : ""}`}>
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold tracking-wide">{`${firstName}'s Next Up Clips`}</h2><InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="clips" label="Manage Next Up clips, strikes, and Pro" onChanged={() => setReloadToken((value) => value + 1)} /></div>
          {clips.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground">
              <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No public clips yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => {
                    if (scrollStorageKey) {
                      sessionStorage.setItem(
                        scrollStorageKey,
                        JSON.stringify({
                          scrollY: window.scrollY,
                          clipId: clip.id,
                          savedAt: Date.now(),
                        })
                      );
                    }
                    const params = new URLSearchParams({
                      tab: "next-up",
                      clip: clip.id,
                      returnTo: `/player/${id}`,
                    });
                    navigate(`/?${params.toString()}`);
                  }}
                  className="overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-accent"
                >
                  <div className="relative aspect-[4/5] bg-black">
                    <video
                      src={clip.video_url}
                      poster={clip.thumbnail_url || undefined}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden="true"
                      className={`w-full h-full ${clip.fit_mode === "contain" ? "object-contain" : "object-cover"}`}
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg">
                        <Video className="h-5 w-5" />
                      </span>
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    <p className="font-medium text-sm leading-tight">{clip.title}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" />
                        {(clip.likes_count || 0).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" />
                        {(clip.views_count || 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(clip.created_at).toLocaleDateString()}</span>
                      {clip.duration !== null ? <span>{clip.duration}s</span> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <ClubHistorySection
          entries={clubHistory}
          action={<InlineProfileAdminControls targetUserId={player.user_id} targetName={player.name} section="profile" label="Edit club history information" onChanged={() => setReloadToken((value) => value + 1)} />}
          onOpenLinkedTeam={(entry) => {
            if (!entry.team_id) return;
            const params = new URLSearchParams();
            if (entry.season) params.set("season", entry.season);
            if (entry.competition) params.set("competition", entry.competition);
            navigate(`/team/${entry.team_id}${params.toString() ? `?${params.toString()}` : ""}`);
          }}
        />
        </div>
      </div>
    </div>
  );
};

export default PlayerProfile;
