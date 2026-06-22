import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Play, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logo from "@/assets/footystatus-logo.png";

interface SharedClip {
  id: string;
  title: string;
  caption?: string | null;
  description?: string | null;
  video_url: string;
  thumbnail_url?: string | null;
  user_id?: string | null;
  player_id?: string | null;
  player_name: string;
}

const ClipSharePage = () => {
  const { clipId } = useParams();
  const navigate = useNavigate();
  const [clip, setClip] = useState<SharedClip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadClip = async () => {
      if (!clipId) return;
      setLoading(true);
      const { data: clipRow } = await supabase
        .from("clips")
        .select("id, title, caption, description, video_url, thumbnail_url, user_id, player_id")
        .eq("id", clipId)
        .eq("review_status", "approved")
        .maybeSingle();

      if (!clipRow) {
        setLoading(false);
        return;
      }

      let playerName = "Footy Status Player";
      if (clipRow.player_id) {
        const { data: playerProfile } = await supabase
          .from("player_profiles")
          .select("full_name")
          .eq("id", clipRow.player_id)
          .maybeSingle();
        if (playerProfile?.full_name) playerName = playerProfile.full_name;
      } else if (clipRow.user_id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, username")
          .eq("user_id", clipRow.user_id)
          .maybeSingle();
        playerName = profile?.full_name || profile?.username || playerName;
      }

      setClip({ ...clipRow, player_name: playerName } as SharedClip);
      setLoading(false);
    };

    loadClip();
  }, [clipId]);

  const openInApp = () => {
    if (!clipId) return;
    window.location.href = `footystatus://clip/${clipId}`;
    window.setTimeout(() => {
      navigate(`/?tab=next-up&clip=${clipId}`);
    }, 900);
  };

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background text-muted-foreground">Loading clip…</div>;
  }

  if (!clip) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Play className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-bold">This clip is not available.</h1>
        <Button onClick={() => navigate("/")}>Open Footy Status</Button>
      </div>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6">
      <div className="mx-auto max-w-md">
        <img src={logo} alt="Footy Status" className="mx-auto mb-5 h-20 w-auto object-contain" />
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="aspect-[9/16] max-h-[68dvh] bg-black">
            <video
              src={clip.video_url}
              poster={clip.thumbnail_url || undefined}
              controls
              playsInline
              className="h-full w-full object-contain"
            />
          </div>
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-white">
                <User className="h-4 w-4" />
              </span>
              <span className="font-semibold text-foreground">{clip.player_name}</span>
            </div>
            <h1 className="text-lg font-bold text-foreground">{clip.title}</h1>
            {clip.caption || clip.description ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{clip.caption || clip.description}</p>
            ) : null}
            <Button onClick={openInApp} className="mt-4 w-full">Open in App</Button>
            <Button variant="outline" onClick={() => navigate(`/?tab=next-up&clip=${clip.id}`)} className="mt-2 w-full">
              Continue in Browser
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ClipSharePage;
