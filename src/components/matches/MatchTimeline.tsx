import { useMemo, useState } from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchEventRecord } from "@/lib/matches";

/**
 * Compact, collapsible, chronological match-event timeline.
 *
 * - Collapsed by default: a clean one-line summary with event-count chips.
 * - Expands (click / tap) to show every event in match order, grouped by
 *   minute, with home vs away clearly distinguished. Collapses again on click.
 * - Supports added time (e.g. 45+2') read from event.metadata.added_time.
 * - Never hides data: grouping is presentation only; assists are shown attached
 *   to their goal, everything else is listed.
 *
 * Admin edit/add lives elsewhere (MatchDetails admin panel); this component only
 * renders viewing + the existing per-event delete / claim-assist actions.
 */

type Tone = "goal" | "danger" | "warning" | "info" | "sub" | "phase" | "muted";

const EVENT_META: Record<string, { icon: string; label: string; tone: Tone }> = {
  goal: { icon: "⚽", label: "Goal", tone: "goal" },
  own_goal: { icon: "⚽", label: "Own Goal", tone: "danger" },
  assist: { icon: "🅰️", label: "Assist", tone: "muted" },
  yellow_card: { icon: "🟨", label: "Yellow Card", tone: "warning" },
  red_card: { icon: "🟥", label: "Red Card", tone: "danger" },
  second_yellow: { icon: "🟨", label: "Second Yellow", tone: "danger" },
  sub_in: { icon: "🔺", label: "Sub On", tone: "sub" },
  sub_out: { icon: "🔻", label: "Sub Off", tone: "sub" },
  substitution: { icon: "🔁", label: "Substitution", tone: "sub" },
  penalty_scored: { icon: "⚽", label: "Penalty Scored", tone: "goal" },
  penalty_missed: { icon: "❌", label: "Penalty Missed", tone: "danger" },
  penalty_awarded: { icon: "🎯", label: "Penalty Awarded", tone: "info" },
  penalty: { icon: "🎯", label: "Penalty", tone: "info" },
  injury: { icon: "🩹", label: "Injury", tone: "warning" },
  var: { icon: "📺", label: "VAR Decision", tone: "info" },
  half_time: { icon: "⏸️", label: "Half-time", tone: "phase" },
  full_time: { icon: "⏱️", label: "Full-time", tone: "phase" },
  kickoff: { icon: "▶️", label: "Kickoff", tone: "phase" },
  added_time: { icon: "➕", label: "Added Time", tone: "phase" },
  other: { icon: "📌", label: "Match Update", tone: "muted" },
};

const humanize = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const metaFor = (type: string) =>
  EVENT_META[type] || { icon: "•", label: humanize(type), tone: "muted" as Tone };

// Event types that represent a whole-match phase (no team / player) and render
// as a full-width divider rather than a home/away row.
const PHASE_TYPES = new Set(["kickoff", "half_time", "full_time", "added_time"]);
// Stat-only rows that are not timeline "moments".
const HIDDEN_FROM_TIMELINE = new Set(["assist", "minutes_played"]);

const PHASE_SORT: Record<string, number> = {
  kickoff: -1,
  half_time: 45.5,
  full_time: 100000,
};

const addedTimeOf = (event: MatchEventRecord): number => {
  const raw = event.metadata?.added_time ?? event.metadata?.added_time_minute ?? event.metadata?.stoppage;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Numeric sort key: base minute, with added time as a fractional tiebreaker so
// 45+2' sorts after 45' but before 46'.
const sortKey = (event: MatchEventRecord): number => {
  if (event.event_minute != null) return event.event_minute + addedTimeOf(event) / 100;
  return PHASE_SORT[event.event_type] ?? 99999;
};

const minuteLabel = (event: MatchEventRecord): string => {
  if (event.event_minute == null) return "";
  const added = addedTimeOf(event);
  return added > 0 ? `${event.event_minute}+${added}'` : `${event.event_minute}'`;
};

const descriptionOf = (event: MatchEventRecord): string | null => {
  const d = event.metadata?.description ?? event.metadata?.note ?? event.metadata?.detail;
  const s = typeof d === "string" ? d.trim() : "";
  return s.length ? s : null;
};

const toneClasses: Record<Tone, string> = {
  goal: "text-emerald-700 dark:text-emerald-400",
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-sky-600 dark:text-sky-400",
  sub: "text-indigo-600 dark:text-indigo-400",
  phase: "text-muted-foreground",
  muted: "text-foreground",
};

export interface MatchTimelineProps {
  events: MatchEventRecord[];
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  groupedAssistsByGoalId: Map<string, MatchEventRecord[]>;
  canManageMatch?: boolean;
  onDeleteEvent?: (eventId: string) => void;
  onEditEvent?: (event: MatchEventRecord) => void;
  canClaimAssist?: (event: MatchEventRecord) => boolean;
  onClaimAssist?: (eventId: string) => void;
}

interface TimelineGroup {
  key: string;
  label: string;
  isPhase: boolean;
  events: MatchEventRecord[];
}

const MatchTimeline = ({
  events,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  groupedAssistsByGoalId,
  canManageMatch = false,
  onDeleteEvent,
  onEditEvent,
  canClaimAssist,
  onClaimAssist,
}: MatchTimelineProps) => {
  const [expanded, setExpanded] = useState(false);

  const timelineEvents = useMemo(
    () =>
      events
        .filter((event) => event.status === "approved")
        .filter((event) => !HIDDEN_FROM_TIMELINE.has(event.event_type))
        .slice()
        .sort((a, b) => {
          const diff = sortKey(a) - sortKey(b);
          if (diff !== 0) return diff;
          return (a.created_at || "").localeCompare(b.created_at || "");
        }),
    [events],
  );

  // Group consecutive events that share the same minute label (e.g. three subs
  // at 70'). Phase events each stand on their own as a divider.
  const groups = useMemo<TimelineGroup[]>(() => {
    const out: TimelineGroup[] = [];
    for (const event of timelineEvents) {
      const isPhase = PHASE_TYPES.has(event.event_type);
      const label = minuteLabel(event);
      const last = out[out.length - 1];
      if (!isPhase && last && !last.isPhase && last.label === label && label !== "") {
        last.events.push(event);
      } else {
        out.push({ key: `${event.id}`, label, isPhase, events: [event] });
      }
    }
    return out;
  }, [timelineEvents]);

  // Collapsed summary chips: count by broad category.
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of timelineEvents) {
      const key = metaFor(event.event_type).icon;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries());
  }, [timelineEvents]);

  const total = timelineEvents.length;

  const teamSide = (teamId: string | null): "home" | "away" | null => {
    if (teamId && teamId === homeTeamId) return "home";
    if (teamId && teamId === awayTeamId) return "away";
    return null;
  };

  const renderEventRow = (event: MatchEventRecord) => {
    const meta = metaFor(event.event_type);
    const side = teamSide(event.team_id);
    const teamName = side === "home" ? homeTeamName : side === "away" ? awayTeamName : null;
    const attachedAssists = groupedAssistsByGoalId.get(event.id) || [];
    const description = descriptionOf(event);
    const showClaim = canClaimAssist?.(event) && onClaimAssist;

    return (
      <div
        key={event.id}
        className={[
          "flex items-start gap-2 rounded-lg border-l-4 bg-muted/40 px-3 py-2",
          side === "home"
            ? "border-l-navy"
            : side === "away"
              ? "border-l-amber-500"
              : "border-l-border",
        ].join(" ")}
      >
        <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className={`font-semibold ${toneClasses[meta.tone]}`}>{meta.label}</span>
            {event.event_type === "substitution" ? (
              <span className="min-w-0 break-words font-medium text-foreground">
                ▲ {event.metadata?.player_in_name || "—"} · ▼ {event.metadata?.player_out_name || "—"}
              </span>
            ) : (
              <span className="min-w-0 break-words font-medium text-foreground">
                {event.player_name || (event.jersey_number ? `#${event.jersey_number}` : "—")}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {teamName ? (
              <>
                <span
                  className={`mr-1 inline-block rounded px-1 text-[10px] font-bold uppercase tracking-wide ${
                    side === "home" ? "bg-navy/10 text-navy" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {side === "home" ? "Home" : "Away"}
                </span>
                {teamName}
              </>
            ) : (
              "—"
            )}
          </p>
          {attachedAssists.length ? (
            <p className="mt-1 break-words text-xs text-muted-foreground">
              Assist: {attachedAssists.map((a) => a.player_name || `#${a.jersey_number || "—"}`).join(", ")}
            </p>
          ) : null}
          {description ? (
            <p className="mt-1 break-words text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showClaim ? (
            <Button size="sm" variant="outline" onClick={() => onClaimAssist?.(event.id)}>
              Claim Assist
            </Button>
          ) : null}
          {canManageMatch && onEditEvent ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onEditEvent(event)}
              aria-label="Edit event"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {canManageMatch && onDeleteEvent ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDeleteEvent(event.id)}
              aria-label="Delete event"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Header / collapsed summary — the whole bar toggles the timeline. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-wide text-navy">MATCH TIMELINE</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {total === 0 ? (
                <span className="text-xs text-muted-foreground">No official events yet</span>
              ) : expanded ? (
                <span className="text-xs text-muted-foreground">Tap to collapse</span>
              ) : (
                <>
                  {summary.map(([icon, count]) => (
                    <span
                      key={icon}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                      <span aria-hidden>{icon}</span>
                      {count}
                    </span>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {total} event{total === 1 ? "" : "s"} · tap to view
                  </span>
                </>
              )}
            </div>
          </div>
          {total > 0 ? (
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            />
          ) : null}
        </button>

        {/* Expanded chronological, grouped view. */}
        {expanded && total > 0 ? (
          <div className="space-y-3 border-t border-border px-3 py-4 sm:px-4">
            {groups.map((group) =>
              group.isPhase ? (
                <div key={group.key} className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                    <span aria-hidden>{metaFor(group.events[0].event_type).icon}</span>
                    {metaFor(group.events[0].event_type).label}
                    {group.label ? <span className="opacity-70">{group.label}</span> : null}
                  </span>
                  {canManageMatch && (onEditEvent || onDeleteEvent) ? (
                    <div className="flex items-center">
                      {onEditEvent ? (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEditEvent(group.events[0])} aria-label="Edit event">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {onDeleteEvent ? (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onDeleteEvent(group.events[0].id)} aria-label="Delete event">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : (
                <div key={group.key} className="flex gap-3">
                  <div className="shrink-0 pt-2">
                    <span className="inline-block min-w-[44px] rounded-md bg-navy/10 px-2 py-1 text-center text-sm font-bold text-navy">
                      {group.label || "—"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {group.events.map((event) => renderEventRow(event))}
                  </div>
                </div>
              ),
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default MatchTimeline;
