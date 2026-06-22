import { useEffect, useState } from "react";
import { AlertTriangle, Eye, ShieldAlert, Trash2, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type ReportStatus = "pending" | "dismissed" | "actioned" | "resolved";
interface ContentReportReview {
  id: string;
  report_status: ReportStatus;
  report_reason: string;
  report_message: string;
  reported_clip_id: string | null;
  reporter_account_id: string;
  reported_account_id: string;
  clip_title: string | null;
  clip_caption: string | null;
  clip_video_url: string | null;
  reporter_name: string | null;
  reported_name: string | null;
  created_at: string;
  reviewed_at: string | null;
  resolution_note: string | null;
  active_strike_count: number;
}
interface StrikeHistoryItem {
  id: string;
  related_report_id: string | null;
  reason: string;
  action_taken: string;
  created_at: string;
  removed_at: string | null;
  removal_reason: string | null;
}
type PendingAction = { type: "dismiss" | "strike_delete" | "ban_3" | "ban_6" | "remove_strike"; strikeId?: string } | null;
const reasonLabels: Record<string, string> = {
  inappropriate: "Inappropriate Content",
  harassment: "Harassment or Abuse",
  copyright: "Copyright / Stolen Content",
  spam: "Misleading or Spam",
};

const ReportContentReview = () => {
  const { toast } = useToast();
  const [reports, setReports] = useState<ContentReportReview[]>([]);
  const [selected, setSelected] = useState<ContentReportReview | null>(null);
  const [strikes, setStrikes] = useState<StrikeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const loadReports = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_content_report_reviews");
    if (error) toast({ title: "Reports could not be loaded", description: error.message, variant: "destructive" });
    setReports((data || []) as ContentReportReview[]);
    setLoading(false);
  };

  const loadStrikes = async (accountId: string) => {
    const { data } = await (supabase as any).rpc("get_account_strike_history", { _account_id: accountId });
    setStrikes((data || []) as StrikeHistoryItem[]);
  };

  useEffect(() => { loadReports(); }, []);
  useEffect(() => { if (selected) loadStrikes(selected.reported_account_id); else setStrikes([]); }, [selected?.id]);

  const runAction = async () => {
    if (!selected || !pendingAction) return;
    setWorking(true);
    try {
      if (pendingAction.type === "remove_strike" && pendingAction.strikeId) {
        const { error } = await (supabase as any).rpc("remove_account_strike", {
          _strike_id: pendingAction.strikeId,
          _reason: "Removed by Footy Status Official during report review",
        });
        if (error) throw error;
        toast({ title: "Strike removed" });
        await loadStrikes(selected.reported_account_id);
      } else {
        const action = pendingAction.type === "dismiss" ? "dismiss" : pendingAction.type === "strike_delete" ? "strike_delete" : "temporary_ban";
        const months = pendingAction.type === "ban_3" ? 3 : pendingAction.type === "ban_6" ? 6 : null;
        const { error } = await (supabase as any).rpc("review_content_report", {
          _report_id: selected.id,
          _action: action,
          _ban_months: months,
          _note: action === "dismiss" ? "Dismissed by Footy Status Official" : null,
        });
        if (error) throw error;
        toast({ title: action === "dismiss" ? "Report dismissed" : action === "strike_delete" ? "Strike added and video removed" : `${months}-month ban applied` });
        await loadReports();
        setSelected(null);
      }
    } catch (error: any) {
      toast({ title: "Action failed", description: error.message, variant: "destructive" });
    } finally {
      setWorking(false);
      setPendingAction(null);
    }
  };

  const pendingCount = reports.filter((report) => report.report_status === "pending").length;
  const confirmationText = pendingAction?.type === "dismiss"
    ? "Dismiss this report without taking action against the clip or account?"
    : pendingAction?.type === "strike_delete"
      ? "Add a strike to the reported account and permanently remove this video from Footy Status?"
      : pendingAction?.type === "remove_strike"
        ? "Remove this strike from the account's active strike total?"
        : `Temporarily ban this account for ${pendingAction?.type === "ban_6" ? 6 : 3} months?`;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-navy">Report Content Review</h3>
          <p className="text-sm text-muted-foreground">Review reported Next Up clips and account moderation history.</p>
        </div>
        <Badge variant={pendingCount ? "destructive" : "secondary"}>{pendingCount} pending</Badge>
      </div>
      <div className="space-y-3">
        {loading ? <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Loading reports…</div> : null}
        {!loading && reports.length === 0 ? <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">No content reports have been submitted.</div> : null}
        {reports.map((report) => (
          <button key={report.id} type="button" onClick={() => setSelected(report)} className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-accent">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{report.clip_title || "Removed clip"}</p>
                <p className="mt-1 text-sm text-muted-foreground">Reported account: {report.reported_name || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{reasonLabels[report.report_reason] || report.report_reason} · {new Date(report.created_at).toLocaleString()}</p>
              </div>
              <Badge variant={report.report_status === "pending" ? "destructive" : "secondary"} className="capitalize">{report.report_status}</Badge>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {selected ? <>
            <DialogHeader>
              <DialogTitle>Content Report Review</DialogTitle>
              <DialogDescription>Submitted {new Date(selected.created_at).toLocaleString()}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {selected.clip_video_url ? <video src={selected.clip_video_url} controls playsInline className="max-h-[50dvh] w-full rounded-xl bg-black object-contain" /> : <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">The reported video has been removed.</div>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Reason</p><p className="font-medium">{reasonLabels[selected.report_reason] || selected.report_reason}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Status</p><p className="font-medium capitalize">{selected.report_status}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Reporter</p><p className="font-medium">{selected.reporter_name || "Unknown"}</p><p className="break-all text-xs text-muted-foreground">{selected.reporter_account_id}</p></div>
                <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Reported account</p><p className="font-medium">{selected.reported_name || "Unknown"}</p><p className="break-all text-xs text-muted-foreground">{selected.reported_account_id}</p></div>
              </div>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Tell us more</p><p className="mt-1 whitespace-pre-wrap text-sm">{selected.report_message || "No additional message."}</p></div>
              {selected.clip_caption ? <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Clip caption</p><p className="mt-1 text-sm">{selected.clip_caption}</p></div> : null}
              {selected.resolution_note ? <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Resolution</p><p className="mt-1 text-sm">{selected.resolution_note}</p></div> : null}

              <div>
                <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">Strike history</h4><Badge variant={selected.active_strike_count >= 2 ? "destructive" : "secondary"}>{selected.active_strike_count} active</Badge></div>
                {selected.active_strike_count === 2 ? <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">Warning status: Footy Status should contact or call this user.</div> : null}
                <div className="space-y-2">
                  {strikes.length === 0 ? <p className="text-sm text-muted-foreground">No strike history.</p> : strikes.map((strike) => <div key={strike.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex justify-between gap-3"><div><p className="font-medium">{strike.reason}</p><p className="text-xs text-muted-foreground">{new Date(strike.created_at).toLocaleString()} · {strike.action_taken}</p>{strike.removed_at ? <p className="mt-1 text-xs text-muted-foreground">Removed: {strike.removal_reason}</p> : null}</div>{!strike.removed_at ? <Button size="sm" variant="outline" onClick={() => setPendingAction({ type: "remove_strike", strikeId: strike.id })}>Remove</Button> : null}</div></div>)}
                </div>
              </div>

              {selected.report_status === "pending" ? <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => setPendingAction({ type: "dismiss" })}><Eye className="mr-2 h-4 w-4" />Dismiss Report</Button>
                <Button variant="destructive" onClick={() => setPendingAction({ type: "strike_delete" })}><Trash2 className="mr-2 h-4 w-4" />Strike + Delete Video</Button>
                <Button variant="outline" onClick={() => setPendingAction({ type: "ban_3" })}><UserX className="mr-2 h-4 w-4" />Ban 3 Months</Button>
                <Button variant="outline" onClick={() => setPendingAction({ type: "ban_6" })}><ShieldAlert className="mr-2 h-4 w-4" />Ban 6 Months</Button>
              </div> : null}
            </div>
          </> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>{confirmationText}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel><AlertDialogAction onClick={runAction} disabled={working}>{working ? "Working…" : "Confirm"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default ReportContentReview;