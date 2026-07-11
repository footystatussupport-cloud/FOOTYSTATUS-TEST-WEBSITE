import { useEffect, useState } from "react";
import { Ban, Check, RefreshCw, RotateCcw, ShieldAlert, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ReviewClip = {
  clip_id: string;
  player_user_id: string;
  player_profile_id: string | null;
  player_name: string;
  player_username: string | null;
  player_gender: string | null;
  account_role: string | null;
  title: string;
  caption: string | null;
  video_url: string;
  thumbnail_url: string | null;
  uploaded_at: string;
  review_status: "pending_review" | "needs_revision";
  revision_note: string | null;
  active_strike_count: number;
};

const formatPlayerGender = (gender?: string | null) => {
  const normalized = String(gender || "").trim().toLowerCase();
  if (normalized === "boy" || normalized === "boys" || normalized === "male") return "Boy";
  if (normalized === "girl" || normalized === "girls" || normalized === "female") return "Girl";
  return "Gender not set";
};

const formatAccountType = (role?: string | null) => {
  const normalized = String(role || "player").trim().toLowerCase();
  if (!normalized || normalized === "player") return "Player";
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const NextUpClipReviewBank = () => {
  const { toast } = useToast();
  const [clips, setClips] = useState<ReviewClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [revisionClip, setRevisionClip] = useState<ReviewClip | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [rejectClip, setRejectClip] = useState<ReviewClip | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectDecision, setRejectDecision] = useState<"reject" | "reject_strike">("reject");

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_pending_clip_reviews");
    setLoading(false);
    if (error) {
      toast({ title: "Review bank could not be loaded", description: error.message, variant: "destructive" });
      return;
    }
    setClips(data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (clip: ReviewClip, decision: "approve" | "revise" | "reject" | "reject_strike", note?: string) => {
    setWorkingId(clip.clip_id);
    const { error } = await (supabase as any).rpc("review_next_up_clip", {
      _clip_id: clip.clip_id,
      _decision: decision,
      _note: note || null,
    });
    setWorkingId(null);
    if (error) {
      toast({ title: "Review action failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title:
        decision === "approve"
          ? "Clip approved and published"
          : decision === "revise"
            ? "Revision request sent"
            : decision === "reject_strike"
              ? "Clip rejected and strike added"
              : "Clip rejected",
      description:
        decision === "approve"
          ? "The player has been notified and the clip is now live."
          : decision === "revise"
            ? "The clip stays hidden until the player resubmits."
            : decision === "reject_strike"
              ? "The clip was removed, the player was notified, and a strike was added."
              : "The clip was removed and the player was told why.",
    });
    setRevisionClip(null);
    setRevisionNote("");
    setRejectClip(null);
    setRejectNote("");
    setRejectDecision("reject");
    await load();
  };

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-blue-600 p-2 text-white">
            <Video className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-foreground">Next Up Clip Review</h3>
            <p className="text-sm text-muted-foreground">{clips.length} clip{clips.length === 1 ? "" : "s"} awaiting review</p>
          </div>
        </div>
        <Button size="icon" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading pending clips...</p>
      ) : clips.length === 0 ? (
        <div className="rounded-xl bg-muted p-6 text-center text-sm text-muted-foreground">No clips are waiting for review.</div>
      ) : (
        <div className="space-y-4">
          {clips.map((clip) => (
            <article key={clip.clip_id} className="overflow-hidden rounded-xl border border-border">
              <video src={clip.video_url} poster={clip.thumbnail_url || undefined} controls className="aspect-video w-full bg-black object-contain" />
              <div className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {clip.player_profile_id ? (
                      <a
                        href={`/player/${clip.player_profile_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold hover:underline"
                      >
                        {clip.player_name}
                      </a>
                    ) : (
                      <p className="font-semibold">{clip.player_name}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {clip.player_username ? `@${clip.player_username}` : "No username"} · {formatAccountType(clip.account_role)} · {formatPlayerGender(clip.player_gender)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      Current strikes: <span className={Number(clip.active_strike_count || 0) >= 2 ? "text-destructive" : "text-foreground"}>{Math.min(3, Number(clip.active_strike_count || 0))}/3</span>
                    </p>
                  </div>
                  <Badge variant="secondary">Pending Review</Badge>
                </div>
                <div>
                  <p className="font-medium">{clip.title}</p>
                  {clip.caption ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{clip.caption}</p> : null}
                  <p className="mt-2 text-xs text-muted-foreground">Uploaded {new Date(clip.uploaded_at).toLocaleString()}</p>
                </div>
                {clip.revision_note ? (
                  <div className="rounded-lg bg-muted p-3 text-sm">
                    <strong>Previous revision note:</strong> {clip.revision_note}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button className="flex-1" disabled={workingId === clip.clip_id} onClick={() => decide(clip, "approve")}>
                    <Check className="mr-2 h-4 w-4" />Accept
                  </Button>
                  <Button className="flex-1" variant="outline" disabled={workingId === clip.clip_id} onClick={() => { setRevisionClip(clip); setRevisionNote(clip.revision_note || ""); }}>
                    <RotateCcw className="mr-2 h-4 w-4" />Revise
                  </Button>
                  <Button className="flex-1" variant="destructive" disabled={workingId === clip.clip_id} onClick={() => { setRejectClip(clip); setRejectNote(""); setRejectDecision("reject"); }}>
                    <Ban className="mr-2 h-4 w-4" />Reject
                  </Button>
                  <Button className="flex-1" variant="destructive" disabled={workingId === clip.clip_id} onClick={() => { setRejectClip(clip); setRejectNote(""); setRejectDecision("reject_strike"); }}>
                    <ShieldAlert className="mr-2 h-4 w-4" />Reject + Strike
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(revisionClip)} onOpenChange={(open) => !open && setRevisionClip(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a revision</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Message to the player</Label>
            <Textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="Explain clearly what the player should change before submitting again." maxLength={500} />
            <p className="text-right text-xs text-muted-foreground">{revisionNote.length}/500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionClip(null)}>Cancel</Button>
            <Button disabled={revisionNote.trim().length < 3 || workingId === revisionClip?.clip_id} onClick={() => revisionClip && decide(revisionClip, "revise", revisionNote)}>Send Revision Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rejectClip)} onOpenChange={(open) => !open && setRejectClip(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{rejectDecision === "reject_strike" ? "Reject and strike this clip" : "Reject this clip"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason sent to the player</Label>
            <Textarea value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} placeholder="Explain exactly why this clip is being rejected — the guideline or requirement it failed and anything the player should know. The clip will be permanently removed." maxLength={500} />
            <p className="text-right text-xs text-muted-foreground">{rejectNote.length}/500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectClip(null)}>Cancel</Button>
            <Button variant="destructive" disabled={rejectNote.trim().length < 3 || workingId === rejectClip?.clip_id} onClick={() => rejectClip && decide(rejectClip, rejectDecision, rejectNote)}>
              {rejectDecision === "reject_strike" ? "Reject + Add Strike" : "Reject Clip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default NextUpClipReviewBank;
