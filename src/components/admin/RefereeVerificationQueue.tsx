import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, ExternalLink, RefreshCcw, ShieldQuestion, User, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  RefereeVerificationApplication,
  fetchRefereeVerificationQueue,
  getRefereeProofSignedUrl,
  refereeVerificationLabel,
  reviewRefereeVerification,
} from "@/lib/referees";

const RefereeVerificationQueue = () => {
  const { toast } = useToast();
  const [applications, setApplications] = useState<RefereeVerificationApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingUserId, setActingUserId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchRefereeVerificationQueue();
    setLoading(false);
    if (error) {
      toast({ title: "Could not load referee verifications", description: error.message, variant: "destructive" });
      return;
    }
    setApplications(data);
  }, [toast]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleOpenProof = async (application: RefereeVerificationApplication) => {
    if (!application.certification_proof_url) {
      toast({ title: "No certification uploaded", description: "This referee has not uploaded a document yet.", variant: "destructive" });
      return;
    }
    const signedUrl = await getRefereeProofSignedUrl(application.certification_proof_url);
    if (!signedUrl) {
      toast({ title: "Could not open document", description: "The certification file could not be loaded.", variant: "destructive" });
      return;
    }
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleReview = async (
    application: RefereeVerificationApplication,
    action: "verify" | "request_revision" | "reject"
  ) => {
    const note = (notes[application.user_id] || "").trim();

    if (action === "request_revision" && !note) {
      toast({
        title: "Add a note first",
        description: "Tell the referee exactly what needs to be corrected before requesting a revision.",
        variant: "destructive",
      });
      return;
    }

    if (action === "verify" && !window.confirm(`Verify ${application.full_name || "this referee"} as a Footy Status Verified Referee?`)) return;
    if (action === "reject" && !window.confirm(`Reject the verification request from ${application.full_name || "this referee"}?`)) return;

    setActingUserId(application.user_id);
    const { error } = await reviewRefereeVerification({
      refereeUserId: application.user_id,
      action,
      note: note || null,
    });
    setActingUserId(null);

    if (error) {
      toast({ title: "Verification action failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title:
        action === "verify"
          ? "Referee verified"
          : action === "request_revision"
            ? "Revision requested"
            : "Verification rejected",
      description: "The referee has been notified.",
    });
    setNotes((current) => ({ ...current, [application.user_id]: "" }));
    await loadQueue();
  };

  return (
    <section className="mb-6 rounded-2xl border border-navy/30 bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-navy p-2 text-white"><ShieldQuestion className="h-5 w-5" /></span>
          <div>
            <h3 className="font-semibold text-foreground">Pending Referee Verifications</h3>
            <p className="text-sm text-muted-foreground">
              Every new referee application appears here automatically until it is reviewed.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={loadQueue} disabled={loading}>
          <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading referee applications…</p>
      ) : applications.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No referee applications are waiting for review.
        </p>
      ) : (
        <div className="space-y-4">
          {applications.map((application) => (
            <div key={application.user_id} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                  {application.avatar_url ? (
                    <img src={application.avatar_url} alt={application.full_name || "Referee"} className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{application.full_name || "Unnamed referee"}</p>
                    {application.username ? <p className="text-sm text-muted-foreground">@{application.username}</p> : null}
                    <Badge variant={application.verification_status === "revision_requested" ? "outline" : "secondary"}>
                      {refereeVerificationLabel(application.verification_status)}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
                    <p><strong>Email:</strong> {application.email || "Not set"}</p>
                    <p><strong>Phone:</strong> {application.phone || "Not set"}</p>
                    <p><strong>Location:</strong> {application.location || "Not set"}</p>
                    <p><strong>Organization:</strong> {application.certifying_organization || "Not set"}</p>
                    <p><strong>Certification level:</strong> {application.certification_level || "Not set"}</p>
                    <p><strong>License #:</strong> {application.license_number || "Not set"}</p>
                    <p><strong>Experience:</strong> {application.years_experience ?? 0} years</p>
                    <p><strong>Availability:</strong> {application.availability || "Not set"}</p>
                    {application.leagues_tournaments ? (
                      <p className="sm:col-span-2"><strong>Leagues / tournaments:</strong> {application.leagues_tournaments}</p>
                    ) : null}
                    {application.main_experience ? (
                      <p className="sm:col-span-2"><strong>Main referee experience:</strong> {application.main_experience}</p>
                    ) : null}
                    {application.assistant_experience ? (
                      <p className="sm:col-span-2"><strong>Assistant experience:</strong> {application.assistant_experience}</p>
                    ) : null}
                    {application.accolades ? (
                      <p className="sm:col-span-2"><strong>Accolades:</strong> {application.accolades}</p>
                    ) : null}
                    {application.bio ? (
                      <p className="sm:col-span-2"><strong>Bio:</strong> {application.bio}</p>
                    ) : null}
                    <p className="sm:col-span-2">
                      <strong>Submitted:</strong>{" "}
                      {application.submitted_at ? new Date(application.submitted_at).toLocaleString() : "Unknown"}
                    </p>
                  </div>

                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={() => handleOpenProof(application)}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {application.certification_proof_url ? "View certification document" : "No document uploaded"}
                    </Button>
                  </div>

                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={notes[application.user_id] || ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [application.user_id]: event.target.value }))}
                      placeholder="Note to the referee (required for revision requests, optional for rejections)"
                      className="min-h-16 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleReview(application, "verify")}
                        disabled={actingUserId === application.user_id}
                      >
                        <BadgeCheck className="mr-2 h-4 w-4" /> Verify Referee
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReview(application, "request_revision")}
                        disabled={actingUserId === application.user_id}
                      >
                        Request Revision
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReview(application, "reject")}
                        disabled={actingUserId === application.user_id}
                      >
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default RefereeVerificationQueue;
