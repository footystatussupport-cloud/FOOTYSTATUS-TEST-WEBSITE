import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Heart, Play, Eye, User } from "lucide-react";
import Header from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyLikedClips, type LikedClip } from "@/lib/clipInteractions";
import { useRegisterRefresh } from "@/hooks/usePullToRefresh";

const formatLikedDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
};

const LikedVideosPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [clips, setClips] = useState<LikedClip[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLikedClips = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      setClips(await fetchMyLikedClips());
    } catch (error) {
      console.warn("Could not load liked videos", error);
      setClips([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) {
      navigate("/auth");
      return;
    }
    loadLikedClips();
  }, [authLoading, user?.id, navigate, loadLikedClips]);

  useRegisterRefresh(loadLikedClips);

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
        <Header />
        <div className="px-4 py-6">
          <Link to="/other" className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            ← Back to More Options
          </Link>

          <div className="mb-6">
            <h1 className="text-xl font-bold text-foreground">Liked Videos</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your favorite Next Up clips, all in one place.</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-xl border border-border bg-muted/40" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <div className="mt-10 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                <Heart className="h-8 w-8 text-accent" />
              </div>
              <p className="text-base font-semibold text-foreground">No Liked Videos Yet</p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                Videos you like in Next Up will appear here so you can easily find them again.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.map((clip) => (
                <button
                  key={clip.id}
                  onClick={() => navigate(`/?tab=next-up&clip=${clip.id}`)}
                  className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:border-navy hover:shadow-md"
                >
                  <div className="relative aspect-[3/4] w-full bg-muted">
                    {clip.thumbnail_url ? (
                      <img src={clip.thumbnail_url} alt={clip.caption || clip.title || "Clip"} className="h-full w-full object-cover" />
                    ) : clip.video_url ? (
                      <video src={clip.video_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy to-primary">
                        <Play className="h-8 w-8 text-white/80" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-white">
                          <Heart className="h-3.5 w-3.5 fill-accent text-accent" /> {clip.likes_count ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-white/80">
                          <Eye className="h-3.5 w-3.5" /> {clip.views_count ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow">
                        <Play className="h-5 w-5 text-navy" />
                      </span>
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy">
                        {clip.player_avatar_url ? (
                          <img src={clip.player_avatar_url} alt={clip.player_name} className="h-full w-full object-cover" />
                        ) : (
                          <User className="h-3.5 w-3.5 text-white" />
                        )}
                      </span>
                      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{clip.player_name}</span>
                    </div>
                    {clip.caption || clip.title ? (
                      <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{clip.caption || clip.title}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">Liked {formatLikedDate(clip.liked_at)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LikedVideosPage;
