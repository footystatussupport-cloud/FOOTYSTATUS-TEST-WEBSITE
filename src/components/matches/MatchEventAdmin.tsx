import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { addMatchEvent, saveMatchEventsBatch, type BatchMatchEventInput, type MatchEventRecord } from "@/lib/matches";
import type { TeamRosterPlayer } from "@/lib/teamMemberships";

/**
 * Footy Status admin match-event controls: add many events before saving,
 * inline-edit an existing event, delete with confirm. Admin-gating is enforced
 * in the database (is_match_admin on every RPC); this UI is only shown to admins
 * and is not the security boundary.
 */

type FieldNeed = "team" | "player" | "assist" | "sub" | "minute" | "description";

interface TypeDef {
  value: string;
  label: string;
  needs: FieldNeed[];
  phase?: boolean;
}

const TYPE_DEFS: TypeDef[] = [
  { value: "goal", label: "Goal", needs: ["team", "player", "minute", "assist"] },
  { value: "own_goal", label: "Own Goal", needs: ["team", "player", "minute"] },
  { value: "penalty_scored", label: "Penalty Scored", needs: ["team", "player", "minute"] },
  { value: "penalty_missed", label: "Penalty Missed", needs: ["team", "player", "minute"] },
  { value: "penalty_awarded", label: "Penalty Awarded", needs: ["team", "minute", "description"] },
  { value: "yellow_card", label: "Yellow Card", needs: ["team", "player", "minute"] },
  { value: "second_yellow", label: "Second Yellow → Red", needs: ["team", "player", "minute"] },
  { value: "red_card", label: "Red Card", needs: ["team", "player", "minute"] },
  { value: "substitution", label: "Substitution", needs: ["team", "sub", "minute"] },
  { value: "injury", label: "Injury", needs: ["team", "player", "minute", "description"] },
  { value: "var", label: "VAR Decision", needs: ["team", "minute", "description"] },
  { value: "kickoff", label: "Kickoff", needs: [], phase: true },
  { value: "half_time", label: "Half-time", needs: [], phase: true },
  { value: "full_time", label: "Full-time", needs: [], phase: true },
  { value: "added_time", label: "Added Time", needs: ["minute"], phase: true },
  { value: "other", label: "Other Update", needs: ["minute", "description"] },
];

const defOf = (value: string) => TYPE_DEFS.find((t) => t.value === value) || TYPE_DEFS[0];

interface Draft {
  localId: string;
  eventId?: string | null;
  teamId: string;
  eventType: string;
  playerProfileId: string;
  jerseyNumber: string;
  minute: string;
  addedTime: string;
  assistProfileId: string;
  subInProfileId: string;
  subOutProfileId: string;
  description: string;
}

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const emptyDraft = (teamId: string): Draft => ({
  localId: uid(),
  eventId: null,
  teamId,
  eventType: "goal",
  playerProfileId: "",
  jerseyNumber: "",
  minute: "",
  addedTime: "",
  assistProfileId: "",
  subInProfileId: "",
  subOutProfileId: "",
  description: "",
});

const validate = (d: Draft): string[] => {
  const def = defOf(d.eventType);
  const errs: string[] = [];
  if (def.needs.includes("team") && !d.teamId) errs.push("Team is required");
  if (def.needs.includes("minute") && !d.minute.trim()) errs.push("Match minute is required");
  if (def.needs.includes("player") && !d.playerProfileId) errs.push("Player is required");
  if (def.value === "substitution") {
    if (!d.subInProfileId) errs.push("Player entering is required");
    if (!d.subOutProfileId) errs.push("Player leaving is required");
  }
  if (d.minute.trim() && !Number.isInteger(Number(d.minute))) errs.push("Minute must be a whole number");
  if (d.addedTime.trim() && !Number.isInteger(Number(d.addedTime))) errs.push("Added time must be a whole number");
  return errs;
};

const selectClass =
  "mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export interface MatchEventAdminProps {
  matchId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeRoster: TeamRosterPlayer[];
  awayRoster: TeamRosterPlayer[];
  editingEvent: MatchEventRecord | null;
  onClearEditing: () => void;
  onSaved: () => Promise<void> | void;
}

const MatchEventAdmin = ({
  matchId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  homeRoster,
  awayRoster,
  editingEvent,
  onClearEditing,
  onSaved,
}: MatchEventAdminProps) => {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(homeTeamId || ""));
  const [pending, setPending] = useState<Draft[]>([]);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [pendingErrors, setPendingErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);

  const isEditing = Boolean(draft.eventId);

  // Load an existing event into the form when the admin taps Edit in the timeline.
  useEffect(() => {
    if (!editingEvent) return;
    const md = editingEvent.metadata || {};
    setDraft({
      localId: uid(),
      eventId: editingEvent.id,
      teamId: editingEvent.team_id || "",
      eventType: editingEvent.event_type,
      playerProfileId: editingEvent.player_profile_id || "",
      jerseyNumber: editingEvent.jersey_number || "",
      minute: editingEvent.event_minute != null ? String(editingEvent.event_minute) : "",
      addedTime: md.added_time != null ? String(md.added_time) : "",
      assistProfileId: md.assist_profile_id || "",
      subInProfileId: md.player_in_profile_id || "",
      subOutProfileId: md.player_out_profile_id || "",
      description: md.description || md.note || "",
    });
    setDraftErrors([]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [editingEvent]);

  const rosterFor = (teamId: string): TeamRosterPlayer[] => {
    if (teamId && teamId === homeTeamId) return homeRoster;
    if (teamId && teamId === awayTeamId) return awayRoster;
    return [];
  };
  const findPlayer = (teamId: string, profileId: string) =>
    rosterFor(teamId).find((p) => p.player_profile_id === profileId);

  const def = defOf(draft.eventType);
  const draftRoster = rosterFor(draft.teamId);

  const setField = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const draftToPayload = (d: Draft): BatchMatchEventInput => {
    const dd = defOf(d.eventType);
    const meta: Record<string, any> = {};
    const added = Number(d.addedTime);
    if (Number.isFinite(added) && added > 0) meta.added_time = added;
    if (d.description.trim()) meta.description = d.description.trim();
    if (dd.value === "goal" && d.assistProfileId) {
      const a = findPlayer(d.teamId, d.assistProfileId);
      meta.assist_profile_id = d.assistProfileId;
      if (a?.player_name) meta.assist_name = a.player_name;
      if (a?.player_jersey_number) meta.assist_jersey = a.player_jersey_number;
    }
    if (dd.value === "substitution") {
      const pin = findPlayer(d.teamId, d.subInProfileId);
      const pout = findPlayer(d.teamId, d.subOutProfileId);
      meta.player_in_profile_id = d.subInProfileId;
      meta.player_in_name = pin?.player_name || null;
      meta.player_out_profile_id = d.subOutProfileId;
      meta.player_out_name = pout?.player_name || null;
    }
    const player = findPlayer(d.teamId, d.playerProfileId);
    return {
      team_id: d.teamId || null,
      event_type: d.eventType,
      player_profile_id: d.playerProfileId || null,
      jersey_number: d.jerseyNumber || player?.player_jersey_number || null,
      event_minute: d.minute.trim() ? Number(d.minute) : null,
      metadata: meta,
    };
  };

  const summarize = (d: Draft): string => {
    const dd = defOf(d.eventType);
    const parts: string[] = [];
    const min = d.minute.trim()
      ? `${d.minute}${Number(d.addedTime) > 0 ? `+${d.addedTime}` : ""}'`
      : dd.phase
        ? ""
        : "—'";
    if (min) parts.push(min);
    parts.push(dd.label);
    const side = d.teamId === homeTeamId ? homeTeamName : d.teamId === awayTeamId ? awayTeamName : null;
    if (side) parts.push(side);
    const p = findPlayer(d.teamId, d.playerProfileId);
    if (p) parts.push(p.player_name || "");
    if (dd.value === "substitution") {
      const pin = findPlayer(d.teamId, d.subInProfileId);
      const pout = findPlayer(d.teamId, d.subOutProfileId);
      parts.push(`In: ${pin?.player_name || "?"} / Out: ${pout?.player_name || "?"}`);
    }
    if (dd.value === "goal" && d.assistProfileId) {
      const a = findPlayer(d.teamId, d.assistProfileId);
      parts.push(`Assist: ${a?.player_name || "?"}`);
    }
    return parts.filter(Boolean).join(" — ");
  };

  const resetDraftKeepingContext = () =>
    setDraft((prev) => ({ ...emptyDraft(prev.teamId), eventType: prev.eventType }));

  const handleAddAnother = () => {
    const errs = validate(draft);
    setDraftErrors(errs);
    if (errs.length) return;
    setPending((prev) => [...prev, { ...draft, localId: uid() }]);
    resetDraftKeepingContext();
  };

  const handleEditPending = (localId: string) => {
    const target = pending.find((p) => p.localId === localId);
    if (!target) return;
    setPending((prev) => prev.filter((p) => p.localId !== localId));
    setDraft({ ...target });
    setDraftErrors([]);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleRemovePending = (localId: string) => {
    setPending((prev) => prev.filter((p) => p.localId !== localId));
    setPendingErrors((prev) => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  };

  const handleCancel = () => {
    setPending([]);
    setPendingErrors({});
    setDraftErrors([]);
    setDraft(emptyDraft(homeTeamId || ""));
    if (isEditing) onClearEditing();
  };

  // Save an inline edit of an existing event.
  const handleSaveEdit = async () => {
    if (saving) return;
    const errs = validate(draft);
    setDraftErrors(errs);
    if (errs.length) return;
    setSaving(true);
    const payload = draftToPayload(draft);
    const { error } = await addMatchEvent({
      eventId: draft.eventId,
      matchId,
      teamId: payload.team_id || "",
      eventType: payload.event_type,
      playerProfileId: payload.player_profile_id || null,
      jerseyNumber: payload.jersey_number || null,
      minute: payload.event_minute ?? null,
      metadata: payload.metadata || {},
      source: "manual_admin",
    });
    if (error) {
      toast({ title: "Could not save changes", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    toast({ title: "Event updated" });
    setSaving(false);
    setDraft(emptyDraft(homeTeamId || ""));
    onClearEditing();
    await onSaved();
  };

  // Save the whole batch in one transaction.
  const handleSaveAll = async () => {
    if (saving) return;
    // Fold a non-empty in-progress draft into the batch so nothing is lost.
    let batch = pending;
    const draftHasContent =
      draft.playerProfileId || draft.minute.trim() || draft.subInProfileId || draft.subOutProfileId || defOf(draft.eventType).phase;
    if (draftHasContent) {
      const errs = validate(draft);
      setDraftErrors(errs);
      if (errs.length) {
        toast({ title: "Fix the event you're editing first", description: errs.join(". "), variant: "destructive" });
        return;
      }
      batch = [...pending, { ...draft, localId: uid() }];
    }

    if (!batch.length) {
      toast({ title: "Nothing to save", description: "Add at least one event first.", variant: "destructive" });
      return;
    }

    // Validate every event; highlight the specific ones with problems.
    const errorMap: Record<string, string[]> = {};
    batch.forEach((d) => {
      const errs = validate(d);
      if (errs.length) errorMap[d.localId] = errs;
    });
    if (Object.keys(errorMap).length) {
      setPending(batch);
      setDraft(emptyDraft(draft.teamId));
      setPendingErrors(errorMap);
      toast({ title: "Some events need fixing", description: "Highlighted events are missing required details.", variant: "destructive" });
      return;
    }

    setSaving(true);
    setPendingErrors({});
    const { error } = await saveMatchEventsBatch(matchId, batch.map(draftToPayload));
    if (error) {
      // Preserve entries so the admin can retry; do not pretend it saved.
      setPending(batch);
      toast({ title: "Batch save failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    toast({ title: "Events saved", description: `${batch.length} event${batch.length === 1 ? "" : "s"} added.` });
    setPending([]);
    setDraft(emptyDraft(homeTeamId || ""));
    setSaving(false);
    await onSaved();
  };

  const teamOptions = useMemo(
    () =>
      [
        { id: homeTeamId, name: homeTeamName || "Home Team" },
        { id: awayTeamId, name: awayTeamName || "Away Team" },
      ].filter((t) => t.id),
    [homeTeamId, awayTeamId, homeTeamName, awayTeamName],
  );

  const PlayerSelect = ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  }) => (
    <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {draftRoster.map((p) => (
        <option key={p.player_profile_id} value={p.player_profile_id}>
          {p.player_name} {p.player_jersey_number ? `#${p.player_jersey_number}` : ""}
        </option>
      ))}
    </select>
  );

  return (
    <section ref={formRef} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-wide text-navy">
          {isEditing ? "EDIT MATCH EVENT" : "ADD MATCH EVENTS"}
        </h2>
        {isEditing ? (
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <X className="mr-1 h-4 w-4" /> Cancel edit
          </Button>
        ) : null}
      </div>

      {/* Draft form */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Event Type</Label>
          <select
            className={selectClass}
            value={draft.eventType}
            onChange={(e) => setField({ eventType: e.target.value })}
          >
            {TYPE_DEFS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {def.needs.includes("team") ? (
          <div>
            <Label>Team (Home / Away)</Label>
            <select
              className={selectClass}
              value={draft.teamId}
              onChange={(e) => setField({ teamId: e.target.value, playerProfileId: "", assistProfileId: "", subInProfileId: "", subOutProfileId: "" })}
            >
              <option value="">Choose team</option>
              {teamOptions.map((t) => (
                <option key={t.id as string} value={t.id as string}>
                  {t.name} {t.id === homeTeamId ? "(Home)" : "(Away)"}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div />
        )}

        {!def.phase || def.value === "added_time" ? (
          <>
            <div>
              <Label>Minute</Label>
              <Input
                value={draft.minute}
                onChange={(e) => setField({ minute: e.target.value })}
                placeholder="67"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label>Added time (+)</Label>
              <Input
                value={draft.addedTime}
                onChange={(e) => setField({ addedTime: e.target.value })}
                placeholder="2"
                inputMode="numeric"
              />
            </div>
          </>
        ) : null}

        {def.needs.includes("player") ? (
          <div className="col-span-2">
            <Label>Player</Label>
            <PlayerSelect
              value={draft.playerProfileId}
              placeholder={draft.teamId ? "Choose rostered player" : "Choose a team first"}
              onChange={(v) => {
                const sel = findPlayer(draft.teamId, v);
                setField({ playerProfileId: v, jerseyNumber: sel?.player_jersey_number || draft.jerseyNumber });
              }}
            />
          </div>
        ) : null}

        {def.needs.includes("assist") ? (
          <div className="col-span-2">
            <Label>Assisting Player (optional)</Label>
            <PlayerSelect
              value={draft.assistProfileId}
              placeholder="No assist"
              onChange={(v) => setField({ assistProfileId: v })}
            />
          </div>
        ) : null}

        {def.needs.includes("sub") ? (
          <>
            <div>
              <Label>Player Coming On</Label>
              <PlayerSelect
                value={draft.subInProfileId}
                placeholder={draft.teamId ? "Player entering" : "Choose a team first"}
                onChange={(v) => setField({ subInProfileId: v })}
              />
            </div>
            <div>
              <Label>Player Going Off</Label>
              <PlayerSelect
                value={draft.subOutProfileId}
                placeholder={draft.teamId ? "Player leaving" : "Choose a team first"}
                onChange={(v) => setField({ subOutProfileId: v })}
              />
            </div>
          </>
        ) : null}

        {def.needs.includes("description") ? (
          <div className="col-span-2">
            <Label>Description / details</Label>
            <Input
              value={draft.description}
              onChange={(e) => setField({ description: e.target.value })}
              placeholder="e.g. VAR overturned the offside call"
            />
          </div>
        ) : null}
      </div>

      {draftErrors.length ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {draftErrors.join(". ")}
        </div>
      ) : null}

      {/* Action buttons */}
      {isEditing ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSaveEdit} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleAddAnother} disabled={saving}>
            <Plus className="mr-1 h-4 w-4" /> Add Another Event
          </Button>
          <Button onClick={handleSaveAll} disabled={saving}>
            {saving ? "Saving..." : `Save All Events${pending.length ? ` (${pending.length})` : ""}`}
          </Button>
          {pending.length ? (
            <Button variant="ghost" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
          ) : null}
        </div>
      )}

      {/* Pending review list */}
      {!isEditing && pending.length ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {pending.length} event{pending.length === 1 ? "" : "s"} ready to save
          </p>
          {pending.map((p) => {
            const errs = pendingErrors[p.localId];
            return (
              <div
                key={p.localId}
                className={[
                  "flex items-start justify-between gap-2 rounded-md border px-3 py-2",
                  errs?.length ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-border bg-background",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <p className="break-words text-sm text-foreground">{summarize(p)}</p>
                  {errs?.length ? (
                    <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      Missing: {errs.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => handleEditPending(p.localId)} aria-label="Edit pending event">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleRemovePending(p.localId)} aria-label="Remove pending event">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default MatchEventAdmin;
