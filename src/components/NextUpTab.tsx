import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { Heart, Share2, Eye, Play, EyeOff, Flag, User, Volume2, VolumeX, MessageCircle, Copy, Send, MoreHorizontal, Link2, Download, Ban, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchLikedClipIds, recordClipView, toggleClipLike } from "@/lib/clipInteractions";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import ProBadge from "@/components/ProBadge";
import { getIsPro } from "@/lib/subscriptions";

interface Clip {
  id: string;
  player_id: string | null;
  user_id: string | null;
  title: string;
  caption?: string | null;
  video_url: string;
  thumbnail_url: string | null;
  description: string | null;
  views_count: number | null;
  likes_count: number | null;
  hide_likes: boolean | null;
  comments_enabled: boolean | null;
  created_at: string;
  visibility: string;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
  playback_volume?: number | null;
  fit_mode?: "cover" | "contain" | null;
  review_status?: string | null;
  player_profile?: {
    id: string;
    user_id: string;
    full_name: string;
    team: string | null;
    profile_image_url: string | null;
    subscription?: any;
  } | null;
  player?: {
    name: string;
    club: string;
    profile_image_url: string | null;
  } | null;
}

const isRealNextUpClip = (clip: Clip) =>
  Boolean(
    clip.id &&
    clip.video_url &&
    clip.visibility !== "inactive" &&
    (!clip.review_status || clip.review_status === "approved") &&
    clip.player_profile?.id
  );


const reportReasons = [
  { value: "inappropriate", label: "Inappropriate Content", description: "Nudity, profanity, hate symbols, offensive gestures" },
  { value: "harassment", label: "Harassment or Abuse", description: "Bullying, threats, racist or discriminatory behavior" },
  { value: "copyright", label: "Copyright / Stolen Content", description: "Not their clip, reposted without permission" },
  { value: "spam", label: "Misleading or Spam", description: "False information, spam, or scam content" },
];

type NextUpGenderPreference = "both" | "boy" | "girl";

const genderPreferenceLabels: Record<NextUpGenderPreference, string> = {
  both: "Both",
  boy: "Boys Only",
  girl: "Girls Only",
};

const canUseScoutingGenderFilter = (profile?: {
  account_category?: string | null;
  account_role?: string | null;
  account_type?: string | null;
  role?: string | null;
} | null) => {
  const role = profile?.account_role || profile?.account_type || profile?.role;
  return Boolean(
    role &&
      ["scout", "team_staff", "head_coach_assistant", "coach", "trainer", "academy_director", "team_club", "school_team"].includes(role)
  );
};

const NextUpTab = () => {
  const [searchParams] = useSearchParams();
  const [clips, setClips] = useState<Clip[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [likedClips, setLikedClips] = useState<Set<string>>(new Set());
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isCleanMode, setIsCleanMode] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCaughtUp, setIsCaughtUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const holdTimeoutRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const holdPausedRef = useRef(false);
  const pointerDownRef = useRef(false);
  const countedPlaybackRef = useRef<Record<string, boolean>>({});
  const loadingMoreRef = useRef(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const canFilterByGender = canUseScoutingGenderFilter(profile);
  const [genderPreference, setGenderPreference] = useState<NextUpGenderPreference>("both");
  const { settings } = useSettings();
  const clipIdFromUrl = searchParams.get("clip");
  const returnTo = searchParams.get("returnTo");
  const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : null;

  const enrichClips = useCallback(async (data: any[]): Promise<Clip[]> => {
    if (!data.length) return [];
    const playerIds = [...new Set(data.filter(c => c.player_id).map(c => c.player_id!))];
    const userIds = [...new Set(data.filter(c => c.user_id).map(c => c.user_id!))];
        
    const playerProfilesMap: Record<string, any> = {};
    if (playerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("player_profiles")
        .select("id, user_id, full_name, team, profile_image_url")
        .in("id", playerIds);
      if (profiles) profiles.forEach(p => { playerProfilesMap[p.id] = p; });
    }

    const playerProfilesByUserMap: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: profilesByUser } = await supabase
        .from("player_profiles")
        .select("id, user_id, full_name, team, profile_image_url")
        .in("user_id", userIds);
      if (profilesByUser) profilesByUser.forEach((profile) => {
        playerProfilesByUserMap[profile.user_id] = profile;
      });
    }

    const subscriptionsByUserId: Record<string, any> = {};
    if (userIds.length > 0) {
      const { data: subscriptionRows } = await (supabase as any)
        .from("profiles")
        .select("user_id, account_tier, pro_expires_at, pro_started_at, clip_deletions_used, is_pro")
        .in("user_id", userIds);
      (subscriptionRows || []).forEach((profile: any) => {
        subscriptionsByUserId[profile.user_id] = profile;
      });
    }

    const playersMap: Record<string, any> = {};
    if (playerIds.length > 0) {
      const { data: players } = await supabase
        .from("players")
        .select("id, name, club, profile_image_url")
        .in("id", playerIds);
      if (players) players.forEach(p => { playersMap[p.id] = p; });
    }

    return data.map((clip) => {
      const playerProfile =
        (clip.player_id ? playerProfilesMap[clip.player_id] || null : null) ||
        (clip.user_id ? playerProfilesByUserMap[clip.user_id] || null : null);
      const subscription = clip.user_id ? subscriptionsByUserId[clip.user_id] || null : null;
      return {
        ...clip,
        player_profile: playerProfile ? { ...playerProfile, subscription } : null,
        player: clip.player_id ? playersMap[clip.player_id] || null : null,
      } as Clip;
    });
  }, []);

  const loadMoreClips = useCallback(async (reset = false) => {
    if (!user) {
      setClips([]);
      setIsCaughtUp(false);
      setIsLoadingMore(false);
      return;
    }
    if (loadingMoreRef.current || (!reset && isCaughtUp)) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const { data, error } = await (supabase as any).rpc("get_next_up_feed", {
        _limit: 12,
        _gender_preference: canFilterByGender ? genderPreference : null,
      });
      if (error) throw error;
      let rawClips = data || [];
      if (reset && clipIdFromUrl) {
        const { data: requestedClip } = await supabase
          .from("clips")
          .select("*")
          .eq("id", clipIdFromUrl)
          .eq("review_status", "approved")
          .maybeSingle();
        if (requestedClip) {
          rawClips = [requestedClip, ...rawClips.filter((clip: any) => clip.id !== requestedClip.id)];
        }
      }
      let enriched = (await enrichClips(rawClips)).filter(isRealNextUpClip);
      if (enriched.length === 0 && reset && user?.id) {
        const { data: ownClips } = await supabase
          .from("clips")
          .select("*")
          .eq("user_id", user.id)
          .eq("review_status", "approved")
          .neq("visibility", "inactive")
          .order("created_at", { ascending: false });
        enriched = (await enrichClips(ownClips || [])).filter(isRealNextUpClip);
      }
      if (enriched.length === 0) {
        if (reset) {
          setClips([]);
          setCurrentIndex(0);
        } else {
          setIsCaughtUp(true);
        }
        return;
      }
      setIsCaughtUp(false);
      setClips((previous) => {
        const base = reset ? [] : previous;
        const known = new Set(base.map((clip) => clip.id));
        return [...base, ...enriched.filter((clip) => !known.has(clip.id))];
      });
      if (reset) setCurrentIndex(0);
    } catch (error) {
      console.error("Failed to load the Next Up feed", error);
      if (reset) {
        setClips([]);
        setIsCaughtUp(false);
      }
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [canFilterByGender, clipIdFromUrl, enrichClips, genderPreference, isCaughtUp, user]);

  useEffect(() => {
    const savedPreference = profile?.next_up_gender_preference;
    if (savedPreference === "boy" || savedPreference === "girl" || savedPreference === "both") {
      setGenderPreference(savedPreference);
    } else {
      setGenderPreference("both");
    }
  }, [profile?.next_up_gender_preference]);

  const updateGenderPreference = async (value: NextUpGenderPreference) => {
    setGenderPreference(value);
    setClips([]);
    setCurrentIndex(0);
    setIsCaughtUp(false);
    loadingMoreRef.current = false;

    const { error } = await (supabase as any)
      .from("profiles")
      .update({ next_up_gender_preference: value })
      .eq("user_id", user?.id);

    if (error) {
      toast({ title: "Could not save preference", description: error.message, variant: "destructive" });
      return;
    }

    await refreshProfile();
  };

  useEffect(() => {
    if (!user) {
      setClips([]);
      setCurrentIndex(0);
      setIsCaughtUp(false);
      return;
    }
    setIsCaughtUp(false);
    loadMoreClips(true);
  }, [genderPreference, user?.id, loadMoreClips]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("next-up-clips")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clips" }, () => setIsCaughtUp(false))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const getActiveVideo = () => {
    const activeClip = clips[currentIndex];
    if (!activeClip) return null;
    return videoRefs.current[activeClip.id] || null;
  };

  useEffect(() => {
    clips.forEach((clip, index) => {
      const video = videoRefs.current[clip.id];
      if (!video) return;
      video.muted = isMuted;
      if (index === currentIndex) {
        video.volume = getClipVolume(clip);
        const start = getClipStart(clip);
        if (video.currentTime < start) video.currentTime = start;
        video.play().catch(() => undefined);
      } else {
        video.pause();
        video.currentTime = 0;
        resetPlaybackCounter(clip.id);
      }
    });
  }, [clips, currentIndex, isMuted]);

  useEffect(() => {
    if (!clips.length || !clipIdFromUrl) return;
    const index = clips.findIndex((clip) => clip.id === clipIdFromUrl);
    if (index >= 0) {
      setCurrentIndex(index);
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-clip-id="${clipIdFromUrl}"]`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [clips, clipIdFromUrl]);

  useEffect(() => {
    if (!currentClip) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "next-up");
    url.searchParams.set("clip", currentClip.id);
    window.history.replaceState({}, "", url.toString());
  }, [currentIndex, clips]);

  useEffect(() => {
    const fetchLikes = async () => {
      if (!user) return;
      try {
        setLikedClips(await fetchLikedClipIds(user.id));
      } catch (error) {
        console.error("Failed to fetch liked clips", error);
      }
    };
    fetchLikes();
  }, [user]);

  useEffect(() => {
    setIsCleanMode(false);
  }, [currentIndex]);

  useEffect(() => {
    if (clips.length > 0 && currentIndex >= clips.length - 4) {
      loadMoreClips();
    }
  }, [currentIndex, clips.length, loadMoreClips]);

  useEffect(() => () => {
    clearHoldTimeout();
    if (scrollFrameRef.current) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
  }, []);

  const getPlayerName = (clip: Clip) => {
    return clip.player_profile?.full_name || clip.player?.name || "Unknown Player";
  };

  const getPlayerImage = (clip: Clip) => {
    return clip.player_profile?.profile_image_url || clip.player?.profile_image_url || null;
  };

  const getPlayerProfilePath = (clip: Clip) => {
    if (clip.player_profile?.id) {
      if (user && clip.user_id === user.id) return "/profile";
      return `/player/${clip.player_profile.id}`;
    }
    if (clip.player_id) return `/player/${clip.player_id}`;
    if (clip.user_id && user && clip.user_id === user.id) return "/profile";
    return null;
  };

  const isProClip = (clip: Clip) => getIsPro(clip.player_profile?.subscription);
  const getClipStart = (clip: Clip) => Number(clip.trim_start_seconds || 0);
  const getClipEnd = (clip: Clip) => Number(clip.trim_end_seconds || 0);
  const getClipVolume = (clip: Clip) => Math.max(0, Math.min(1, Number(clip.playback_volume ?? 1)));

  const handleLike = async (clipId: string) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to like clips.", variant: "destructive" });
      return;
    }
    try {
      const result = await toggleClipLike(clipId, user.id);
      setLikedClips((prev) => {
        const next = new Set(prev);
        if (result.liked) next.add(clipId);
        else next.delete(clipId);
        return next;
      });
      setClips((prev) =>
        prev.map((clip) => (clip.id === clipId ? { ...clip, likes_count: result.likesCount } : clip))
      );
    } catch (error: any) {
      toast({ title: "Like failed", description: error.message || "Could not update the like.", variant: "destructive" });
    }
  };

  const handleVideoPlay = async (clipId: string, event: any) => {
    const video = event.currentTarget as HTMLVideoElement;
    if (!user) return;
    const clip = clips.find((item) => item.id === clipId);
    if (clip?.user_id && clip.user_id === user.id) return;
    if (countedPlaybackRef.current[clipId]) return;
    if (video.currentTime > 0.35) return;

    countedPlaybackRef.current[clipId] = true;
    try {
      const nextViewsCount = await recordClipView(clipId);
      setClips((prev) =>
        prev.map((clip) => (clip.id === clipId ? { ...clip, views_count: nextViewsCount } : clip))
      );
    } catch (error) {
      countedPlaybackRef.current[clipId] = false;
      console.error("Failed to record clip view", error);
    }
  };

  const resetPlaybackCounter = (clipId: string) => {
    countedPlaybackRef.current[clipId] = false;
  };

  const getShareUrl = () => {
    if (!currentClip) return window.location.href;
    return `https://footystatus.app/clip/${currentClip.id}`;
  };

  const getShareText = () => {
    if (!currentClip) return "";
    return `${currentClip.title}${currentClip.caption || currentClip.description ? ` - ${currentClip.caption || currentClip.description}` : ""}`;
  };

  const handleShare = async () => {
    if (!currentClip) return;
    setShowShareDialog(true);
  };

  const recordShare = async (target: string) => {
    if (!currentClip || !user) return;
    const { error } = await (supabase as any).rpc("record_clip_share", {
      _clip_id: currentClip.id,
      _share_target: target,
    });
    if (error) console.warn("Clip share exposure could not be recorded", error);
  };

  const handleNativeShare = async () => {
    if (!currentClip) return;
    if (navigator.share) {
      await navigator.share({ title: currentClip.title, text: getShareText(), url: getShareUrl() });
      await recordShare("native");
      return;
    }
    await navigator.clipboard.writeText(getShareUrl());
    await recordShare("copy");
    toast({ title: "Link copied", description: "The clip link was copied to your clipboard." });
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(getShareUrl());
    await recordShare("copy");
    toast({ title: "Link copied", description: "The clip link was copied to your clipboard." });
    setShowShareDialog(false);
  };

  const openShareTarget = async (target: "sms" | "whatsapp" | "instagram" | "other") => {
    const shareUrl = encodeURIComponent(getShareUrl());
    const shareText = encodeURIComponent(getShareText());

    if (target === "other") {
      await handleNativeShare();
      return;
    }

    await recordShare(target);

    if (target === "sms") {
      window.location.href = `sms:&body=${shareText}%20${shareUrl}`;
      return;
    }

    if (target === "whatsapp") {
      window.open(`https://wa.me/?text=${shareText}%20${shareUrl}`, "_blank", "noopener,noreferrer");
      return;
    }

    if (target === "instagram") {
      if (navigator.share) {
        await navigator.share({ title: currentClip?.title || "Clip", text: getShareText(), url: getShareUrl() });
      } else {
        toast({
          title: "Use Other to share",
          description: "Instagram sharing works through your device share sheet here.",
        });
      }
    }
  };

  const handleNotInterested = () => {
    if (!currentClip) return;
    const removedIndex = currentIndex;
    setClips((previous) => previous.filter((clip) => clip.id !== currentClip.id));
    setCurrentIndex(Math.max(0, Math.min(removedIndex, clips.length - 2)));
    setShowShareDialog(false);
    toast({ title: "Clip hidden", description: "You wonâ€™t be shown this clip again." });
    loadMoreClips();
  };

  const handleSaveVideo = () => {
    if (!currentClip?.video_url) return;
    const link = document.createElement("a");
    link.href = currentClip.video_url;
    link.download = `${currentClip.title || "footy-status-clip"}.mp4`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
    setShowShareDialog(false);
  };

  const clearHoldTimeout = () => {
    if (holdTimeoutRef.current) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  const updateCurrentClipFromScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const nextIndex = Math.round(container.scrollTop / Math.max(container.clientHeight, 1));
    const boundedIndex = Math.min(Math.max(nextIndex, 0), Math.max(clips.length - 1, 0));
    setCurrentIndex((prev) => (prev === boundedIndex ? prev : boundedIndex));
  };

  const handleFeedScroll = () => {
    if (scrollFrameRef.current) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      updateCurrentClipFromScroll();
      scrollFrameRef.current = null;
    });
  };

  const handlePressStart = () => {
    pointerDownRef.current = true;
    clearHoldTimeout();
    holdTimeoutRef.current = window.setTimeout(() => {
      const activeVideo = getActiveVideo();
      if (pointerDownRef.current && activeVideo && !activeVideo.paused) {
        activeVideo.pause();
        holdPausedRef.current = true;
      }
    }, 220);
  };

  const handlePressEnd = () => {
    const wasHoldingPause = holdPausedRef.current;
    pointerDownRef.current = false;
    clearHoldTimeout();

    if (wasHoldingPause) {
      holdPausedRef.current = false;
      getActiveVideo()?.play().catch(() => undefined);
      return;
    }

    if (isCleanMode) {
      setIsCleanMode(false);
      return;
    }

    setIsMuted((prev) => !prev);
  };

  const handleReport = async () => {
    if (!reportReason) {
      toast({ title: "Please select a reason", description: "You must select a reason for reporting this clip.", variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to report a clip.", variant: "destructive" });
      return;
    }
    if (!currentClip) {
      toast({ title: "No clip selected", description: "There is no clip available to report.", variant: "destructive" });
      return;
    }
    if (reportDetails.length > 200) {
      toast({ title: "Message too long", description: "Tell us more must be 200 characters or fewer.", variant: "destructive" });
      return;
    }
    const { error } = await (supabase as any).rpc("submit_content_report", {
      _clip_id: currentClip.id,
      _report_reason: reportReason,
      _report_message: reportDetails.trim(),
    });
    if (error) {
      toast({ title: "Report could not be submitted", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Report submitted", description: "Thank you for helping keep our community safe. Footy Status will review it." });
    setShowReportDialog(false);
    setReportReason("");
    setReportDetails("");
  };

  const currentClip = clips[currentIndex];

  if (authLoading) {
    return (
      <div className="flex h-full min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <Play className="mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking your account...</p>
      </div>
    );
  }

  if (!user) {
    const redirectTo = encodeURIComponent(`/${window.location.search || "?tab=next-up"}`);
    return (
      <div className="flex h-full min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <Play className="mb-4 h-16 w-16 text-muted-foreground" />
        <h3 className="mb-2 text-xl font-bold text-foreground">Log in or sign up to watch Next Up Clips</h3>
        <p className="mb-5 max-w-xs text-sm text-muted-foreground">
          Next Up Clips are available after you join Footy Status.
        </p>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button onClick={() => navigate(`/auth?mode=login&redirectTo=${redirectTo}`)}>Log In</Button>
          <Button variant="outline" onClick={() => navigate(`/auth?mode=signup&redirectTo=${redirectTo}`)}>
            Create Account
          </Button>
        </div>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Play className="h-8 w-8 fill-current" />
        </div>
        <h3 className="mb-2 text-xl font-bold text-foreground">No New Next Up Clips</h3>
        <p className="max-w-xs text-sm text-muted-foreground">
          You&apos;re all caught up. Check back later for new player highlights.
        </p>
        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
          New clips will appear here after they are uploaded and approved.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5 rounded-full"
          disabled={isLoadingMore}
          onClick={() => loadMoreClips(true)}
        >
          {isLoadingMore ? "Checking..." : "Check for new clips"}
        </Button>
      </div>
    );
  }

  return (
    <div data-no-pull-refresh className="relative h-full min-h-0 overflow-hidden bg-background">
      {safeReturnTo ? (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/65"
          aria-label="Back to player profile"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : null}
      {canFilterByGender ? (
        <div className="absolute left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex justify-center">
          <div className="rounded-full border border-white/15 bg-black/55 px-3 py-2 text-white shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-2 text-xs">
              <span className="whitespace-nowrap text-white/80">Viewing:</span>
              <Select value={genderPreference} onValueChange={(value) => updateGenderPreference(value as NextUpGenderPreference)}>
                <SelectTrigger className="h-8 w-32 border-white/20 bg-white/10 text-xs text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="girl">Girls Only</SelectItem>
                  <SelectItem value="boy">Boys Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="relative h-full min-h-0 w-full overscroll-y-contain overflow-y-auto snap-y snap-mandatory hide-scrollbar"
        onScroll={handleFeedScroll}
      >
        {clips.map((clip, index) => {
          const clipCaption = clip.caption || clip.description;
          const isActive = index === currentIndex;

          return (
            <section
              key={clip.id}
              data-index={index}
              data-clip-id={clip.id}
              className="relative h-full min-h-full snap-start snap-always overflow-hidden"
            >
              <div
                className="absolute inset-0 bg-secondary cursor-pointer"
                onMouseDown={isActive ? handlePressStart : undefined}
                onMouseUp={isActive ? handlePressEnd : undefined}
                onMouseLeave={() => {
                  pointerDownRef.current = false;
                  if (holdPausedRef.current) {
                    holdPausedRef.current = false;
                    getActiveVideo()?.play().catch(() => undefined);
                  }
                  clearHoldTimeout();
                }}
                onTouchStart={isActive ? handlePressStart : undefined}
                onTouchEnd={isActive ? handlePressEnd : undefined}
                onTouchCancel={() => {
                  pointerDownRef.current = false;
                  if (holdPausedRef.current) {
                    holdPausedRef.current = false;
                    getActiveVideo()?.play().catch(() => undefined);
                  }
                  clearHoldTimeout();
                }}
              >
                <div
                  className={cn(
                    "absolute inset-0 transition-all duration-300 ease-out",
                    isActive ? "scale-100 opacity-100" : "scale-[0.96] opacity-70"
                  )}
                >
                  {clip.video_url ? (
                    <video
                      ref={(node) => {
                        videoRefs.current[clip.id] = node;
                      }}
                      key={clip.id}
                      src={clip.video_url}
                      className={`w-full h-full ${clip.fit_mode === "contain" ? "object-contain" : "object-cover"}`}
                      controls={false}
                      autoPlay={isActive && settings.autoplayVideos}
                      loop
                      playsInline
                      muted={isMuted}
                      preload="auto"
                      onPlay={(event) => handleVideoPlay(clip.id, event)}
                      onTimeUpdate={(event) => {
                        const end = getClipEnd(clip);
                        if (end && event.currentTarget.currentTime >= end) {
                          event.currentTarget.currentTime = getClipStart(clip);
                        }
                      }}
                      onEnded={() => resetPlaybackCounter(clip.id)}
                      onPause={() => {
                        const video = videoRefs.current[clip.id];
                        if (!video || video.currentTime <= 0.35) {
                          resetPlaybackCounter(clip.id);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-full w-full items-center justify-center",
                        index % 3 === 0 && "bg-gradient-to-br from-navy via-slate-800 to-emerald-900",
                        index % 3 === 1 && "bg-gradient-to-br from-violet-950 via-navy to-rose-900",
                        index % 3 === 2 && "bg-gradient-to-br from-slate-950 via-teal-900 to-navy"
                      )}
                    >
                      <div className="text-center text-white/80">
                        <Play className="mx-auto h-20 w-20 text-white/60" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pr-20 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-auto transition-all duration-200",
                  isCleanMode ? "opacity-0 translate-y-3 pointer-events-none" : "opacity-100 translate-y-0"
                )}
              >
                <button
                  onClick={() => {
                    const path = getPlayerProfilePath(clip);
                    if (path) navigate(path);
                  }}
                  className="block max-w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-white">{getPlayerName(clip)}</p>
                    {isProClip(clip) ? (
                      <ProBadge
                        iconOnly
                        className="border border-yellow-500 bg-white text-yellow-700 shadow-sm"
                      />
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 break-words text-sm font-medium text-white/90">{clip.title}</p>
                  {clipCaption ? <p className="mt-1 line-clamp-3 break-words text-sm text-white/80">{clipCaption}</p> : null}
                </button>
              </div>

              <div
                className={cn(
                  "absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 transition-all duration-200",
                  isCleanMode ? "opacity-0 translate-x-3 -translate-y-1/2 pointer-events-none" : "opacity-100 translate-x-0 -translate-y-1/2"
                )}
              >
                <button
                  onClick={() => {
                    const path = getPlayerProfilePath(clip);
                    if (path) navigate(path);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center overflow-hidden border border-white/20">
                    {getPlayerImage(clip) ? (
                      <img src={getPlayerImage(clip)!} alt={getPlayerName(clip)} className="w-full h-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-white" />
                    )}
                  </div>
                </button>
                <button onClick={() => handleLike(clip.id)} className="flex flex-col items-center gap-1">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", likedClips.has(clip.id) ? "bg-accent" : "bg-white/20 backdrop-blur-sm")}>
                    <Heart className={cn("h-4 w-4", likedClips.has(clip.id) ? "text-white fill-white" : "text-white")} />
                  </div>
                  {!clip.hide_likes && <span className="text-[10px] text-white">{(clip.likes_count || 0).toLocaleString()}</span>}
                  {clip.hide_likes && <EyeOff className="h-2.5 w-2.5 text-white/50" />}
                </button>
                <button
                  onClick={() => {
                    setCurrentIndex(index);
                    handleShare();
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"><Share2 className="h-4 w-4 text-white" /></div>
                  <span className="text-[10px] text-white">Share</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentIndex(index);
                    setIsMuted((prev) => !prev);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    {isMuted ? <VolumeX className="h-4 w-4 text-white" /> : <Volume2 className="h-4 w-4 text-white" />}
                  </div>
                  <span className="text-[10px] text-white">{isMuted ? "Unmute" : "Mute"}</span>
                </button>
                <button
                  onClick={() => {
                    setCurrentIndex(index);
                    setShowReportDialog(true);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"><Flag className="h-4 w-4 text-white" /></div>
                  <span className="text-[10px] text-white">Report</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCleanMode((prev) => !prev)}
                  className="flex flex-col items-center gap-1"
                  aria-label={isCleanMode ? "Show overlays" : "Hide overlays"}
                >
                  <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    {isCleanMode ? <Eye className="h-4 w-4 text-white" /> : <EyeOff className="h-4 w-4 text-white" />}
                  </div>
                  <span className="text-[10px] text-white">{isCleanMode ? "Show" : "Clear"}</span>
                </button>
              </div>
            </section>
          );
        })}

        {isCaughtUp ? (
          <section className="flex h-full min-h-full snap-start snap-always items-center justify-center bg-background px-6 text-center">
            <div>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Play className="h-8 w-8 fill-current" />
              </div>
              <h3 className="mb-2 text-xl font-bold text-foreground">No New Next Up Clips</h3>
              <p className="max-w-xs text-sm text-muted-foreground">
                You&apos;re all caught up. Check back later for new player highlights.
              </p>
              <p className="mt-2 max-w-xs text-xs text-muted-foreground">
                New clips will appear here after they are uploaded and approved.
              </p>
            </div>
          </section>
        ) : null}

      </div>

      {/* Report Dialog */}
      <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report Clip</DialogTitle>
            <DialogDescription>Help us understand what's wrong with this clip. Your report is anonymous.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <RadioGroup value={reportReason} onValueChange={setReportReason}>
              {reportReasons.map((reason) => (
                <div key={reason.value} className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value={reason.value} id={reason.value} className="mt-0.5" />
                  <Label htmlFor={reason.value} className="flex-1 cursor-pointer">
                    <span className="font-medium block">{reason.label}</span>
                    <span className="text-sm text-muted-foreground">{reason.description}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="details">Tell us more (optional)</Label>
                <span className="text-xs text-muted-foreground">{reportDetails.length}/200</span>
              </div>
              <Textarea
                id="details"
                placeholder="Provide any additional context..."
                value={reportDetails}
                maxLength={200}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 200))}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setShowReportDialog(false)}>Cancel</Button>
            <Button onClick={handleReport} className="bg-accent hover:bg-accent/90">Submit Report</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Clip</DialogTitle>
            <DialogDescription>Share this clip with a direct link or through your apps.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-4">
            <button onClick={handleCopyLink} className="rounded-lg border border-border p-3 text-sm">
              <Copy className="h-5 w-5 mx-auto mb-2" />
              Copy Link
            </button>
            <button onClick={() => openShareTarget("whatsapp")} className="rounded-lg border border-border p-3 text-sm">
              <Send className="h-5 w-5 mx-auto mb-2" />
              WhatsApp
            </button>
            <button onClick={() => openShareTarget("sms")} className="rounded-lg border border-border p-3 text-sm">
              <MessageCircle className="h-5 w-5 mx-auto mb-2" />
              Messages
            </button>
            <button onClick={() => openShareTarget("instagram")} className="rounded-lg border border-border p-3 text-sm">
              <Link2 className="h-5 w-5 mx-auto mb-2" />
              Instagram
            </button>
            <button
              onClick={() => {
                setShowShareDialog(false);
                setShowReportDialog(true);
              }}
              className="rounded-lg border border-border p-3 text-sm"
            >
              <Flag className="h-5 w-5 mx-auto mb-2" />
              Report
            </button>
            <button onClick={handleNotInterested} className="rounded-lg border border-border p-3 text-sm">
              <Ban className="h-5 w-5 mx-auto mb-2" />
              Not Interested
            </button>
            {currentClip?.video_url ? (
              <button onClick={handleSaveVideo} className="rounded-lg border border-border p-3 text-sm">
                <Download className="h-5 w-5 mx-auto mb-2" />
                Save Video
              </button>
            ) : null}
            <button onClick={() => openShareTarget("other")} className="rounded-lg border border-border p-3 text-sm font-medium">
              <MoreHorizontal className="h-5 w-5 mx-auto mb-2" />
              More / Share Anywhere
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NextUpTab;
