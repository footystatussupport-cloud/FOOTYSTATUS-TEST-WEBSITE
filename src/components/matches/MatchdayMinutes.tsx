import { useMemo, useState } from "react";
import { Flag, LogIn, LogOut, Stethoscope, SquareStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { addMatchEvent, type MatchEventRecord } from "@/lib/matches";
import type { TeamRosterPlayer } from "@/lib/teamMemberships";

/**
 * Live matchday participation tracker. Records the starting lineup, subs, red
 * cards, injuries and the final whistle as match_events, so the existing minutes
 * engine (compute_and_store_match_minutes) and the substitution-rules trigger do
 * the calculation and validation. Minutes shown here are a live client-side
 * preview using the same interval algorithm; the database holds the source of
 * truth after each event is saved.
 */

type PlayerState = {
  onField: boolean;
  started: boolean;
  sentOff: boolean;
  injured: boolean;
  minutes: number;
};

const relevantForPlayer = (e: MatchEventRecord, pid: string) =>
  e.status === "approved" &&
  (e.player_profile_id === pid ||
    (e.event_type === "substitution" &&
      (e.metadata?.player_in_profile_id === pid || e.metadata?.player_out_profile_id === pid)));

const isStartSignal = (e: MatchEventRecord) =>
  e.event_type === "lineup_start" ||
  (e.event_type === "minutes_played" && Boolean(e.metadata?.started));

// Mirror of the SQL interval algorithm, closing open intervals at `clock`.
const derive = (events: MatchEventRecord[], pid: string, clock: number): PlayerState => {
  const mine = events
    .filter((e) => relevantForPlayer(e, pid))
    .slice()
    .sort((a, b) => (a.event_minute ?? 0) - (b.event_minute ?? 0) || (a.created_at || "").localeCompare(b.created_at || ""));

  let onField = false, started = false, sentOff = false, injured = false, terminated = false;
  let open: number | null = null, total = 0;

  if (mine.some(isStartSignal)) { started = true; onField = true; open = 0; }

  for (const e of mine) {
    if (terminated) continue;
    const m = e.event_minute ?? 0;
    const isIn = e.event_type === "sub_in" || (e.event_type === "substitution" && e.metadata?.player_in_profile_id === pid);
    const isOut = e.event_type === "sub_out" || (e.event_type === "substitution" && e.metadata?.player_out_profile_id === pid);
    if (isIn) { if (open === null) open = m; onField = true; }
    else if (isOut) { if (open !== null) { total += Math.max(m - open, 0); open = null; } onField = false; }
    else if (e.event_type === "injury") { if (open !== null) { total += Math.max(m - open, 0); open = null; } onField = false; injured = true; }
    else if (e.event_type === "red_card") { if (open !== null) { total += Math.max(m - open, 0); open = null; } onField = false; sentOff = true; terminated = true; }
  }
  if (open !== null && !terminated) total += Math.max(clock - open, 0);
  return { onField, started, sentOff, injured, minutes: Math.min(Math.max(total, 0), clock) };
};

export interface MatchdayMinutesProps {
  matchId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeRoster: TeamRosterPlayer[];
  awayRoster: TeamRosterPlayer[];
  events: MatchEventRecord[];
  durationMinutes?: number | null;
  onChanged: () => Promise<void> | void;
}

const MatchdayMinutes = ({
  matchId,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  homeRoster,
  awayRoster,
  events,
  durationMinutes,
  onChanged,
}: MatchdayMinutesProps) => {
  const { toast } = useToast();
  const duration = durationMinutes || 90;
  const [teamId, setTeamId] = useState<string>(homeTeamId || "");
  const [minute, setMinute] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const roster = teamId === homeTeamId ? homeRoster : teamId === awayTeamId ? awayRoster : [];
  const hasAnyEvents = events.some((e) => e.status === "approved" && e.team_id === teamId);
  const clock = minute.trim() && Number.isFinite(Number(minute)) ? Number(minute) : duration;

  const players = useMemo(
    () =>
      roster.map((p) => ({
        player: p,
        state: derive(events, p.player_profile_id, clock),
      })),
    [roster, events, clock],
  );

  const starting = players.filter((p) => p.state.started);
  const onField = players.filter((p) => p.state.onField);
  const bench = players.filter((p) => !p.state.onField && !p.state.sentOff && !p.state.injured);
  const subbedOut = players.filter((p) => !p.state.onField && !p.state.sentOff && !p.state.injured && p.state.minutes > 0);
  const sentOff = players.filter((p) => p.state.sentOff);
  const injured = players.filter((p) => p.state.injured);

  const requireMinute = (): number | null => {
    const n = Number(minute);
    if (!minute.trim() || !Number.isInteger(n) || n < 0 || n > duration) {
      toast({ title: "Enter a valid match minute", description: `A whole number between 0 and ${duration}.`, variant: "destructive" });
      return null;
    }
    return n;
  };

  const record = async (payload: Parameters<typeof addMatchEvent>[0], successTitle: string) => {
    if (busy) return;
    setBusy(true);
    const { error } = await addMatchEvent(payload);
    setBusy(false);
    if (error) {
      // Surfaces rules-trigger rejections (e.g. sub limit reached) verbatim.
      toast({ title: "Action blocked", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: successTitle });
    await onChanged();
  };

  const setStarter = (pid: string, jersey: string | null) =>
    record(
      { matchId, teamId, eventType: "minutes_played", playerProfileId: pid, jerseyNumber: jersey, minute: 0, metadata: { started: true } },
      "Added to starting lineup",
    );

  const subOff = (pid: string, jersey: string | null) => {
    const m = requireMinute(); if (m === null) return;
    record({ matchId, teamId, eventType: "sub_out", playerProfileId: pid, jerseyNumber: jersey, minute: m }, "Substituted off");
  };
  const subOn = (pid: string, jersey: string | null) => {
    const m = requireMinute(); if (m === null) return;
    record({ matchId, teamId, eventType: "sub_in", playerProfileId: pid, jerseyNumber: jersey, minute: m }, "Substituted on");
  };
  const redCard = (pid: string, jersey: string | null) => {
    const m = requireMinute(); if (m === null) return;
    record({ matchId, teamId, eventType: "red_card", playerProfileId: pid, jerseyNumber: jersey, minute: m }, "Red card recorded");
  };
  const injury = (pid: string, jersey: string | null) => {
    const m = requireMinute(); if (m === null) return;
    record({ matchId, teamId, eventType: "injury", playerProfileId: pid, jerseyNumber: jersey, minute: m }, "Injury recorded");
  };
  const finalWhistle = () =>
    record({ matchId, teamId: teamId || null as any, eventType: "full_time", playerProfileId: null, minute: duration }, "Final whistle — minutes calculated");

  const Row = ({ p, actions }: { p: { player: TeamRosterPlayer; state: PlayerState }; actions: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {p.player.player_name}{p.player.player_jersey_number ? ` · #${p.player.player_jersey_number}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">{p.state.minutes}′ played</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</div>
    </div>
  );

  const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title} · {count}</p>
      {count ? <div className="space-y-2">{children}</div> : <p className="text-xs text-muted-foreground/70">None</p>}
    </div>
  );

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-wide text-navy">MATCHDAY · MINUTES PLAYED</h2>
        <Button size="sm" variant="outline" onClick={finalWhistle} disabled={busy}>
          <Flag className="mr-1 h-4 w-4" /> Final Whistle
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Team</Label>
          <select
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            {homeTeamId ? <option value={homeTeamId}>{homeTeamName || "Home"} (Home)</option> : null}
            {awayTeamId ? <option value={awayTeamId}>{awayTeamName || "Away"} (Away)</option> : null}
          </select>
        </div>
        <div>
          <Label>Current minute</Label>
          <Input value={minute} onChange={(e) => setMinute(e.target.value)} placeholder={String(duration)} inputMode="numeric" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Set the current minute, then tap an action. Match length: {duration}′.
      </p>

      {!hasAnyEvents ? (
        <Section title="Select Starting Lineup" count={roster.length}>
          {players.map((p) => (
            <Row
              key={p.player.player_profile_id}
              p={p}
              actions={
                p.state.started ? (
                  <span className="rounded bg-navy/10 px-2 py-1 text-xs font-semibold text-navy">Starter</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setStarter(p.player.player_profile_id, p.player.player_jersey_number)}>
                    <LogIn className="mr-1 h-3.5 w-3.5" /> Starter
                  </Button>
                )
              }
            />
          ))}
        </Section>
      ) : (
        <div className="space-y-4">
          <Section title="On Field" count={onField.length}>
            {onField.map((p) => (
              <Row
                key={p.player.player_profile_id}
                p={p}
                actions={
                  <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => subOff(p.player.player_profile_id, p.player.player_jersey_number)}>
                      <LogOut className="mr-1 h-3.5 w-3.5" /> Off
                    </Button>
                    <Button size="sm" variant="ghost" className="text-amber-600" disabled={busy} onClick={() => injury(p.player.player_profile_id, p.player.player_jersey_number)}>
                      <Stethoscope className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => redCard(p.player.player_profile_id, p.player.player_jersey_number)}>
                      <SquareStack className="h-3.5 w-3.5" />
                    </Button>
                  </>
                }
              />
            ))}
          </Section>

          <Section title="Bench / Available" count={bench.length}>
            {bench.map((p) => (
              <Row
                key={p.player.player_profile_id}
                p={p}
                actions={
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => subOn(p.player.player_profile_id, p.player.player_jersey_number)}>
                    <LogIn className="mr-1 h-3.5 w-3.5" /> {p.state.minutes > 0 ? "Re-enter" : "On"}
                  </Button>
                }
              />
            ))}
          </Section>

          <Section title="Substituted Out" count={subbedOut.length}>
            {subbedOut.map((p) => <Row key={p.player.player_profile_id} p={p} actions={null} />)}
          </Section>
          <Section title="Sent Off" count={sentOff.length}>
            {sentOff.map((p) => <Row key={p.player.player_profile_id} p={p} actions={<span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">Red</span>} />)}
          </Section>
          <Section title="Injured" count={injured.length}>
            {injured.map((p) => <Row key={p.player.player_profile_id} p={p} actions={<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">Injured</span>} />)}
          </Section>

          <Section title="Minutes Played" count={players.filter((p) => p.state.minutes > 0).length}>
            {players.filter((p) => p.state.minutes > 0).sort((a, b) => b.state.minutes - a.state.minutes).map((p) => (
              <Row key={p.player.player_profile_id} p={p} actions={<span className="text-sm font-bold text-navy">{p.state.minutes}′</span>} />
            ))}
          </Section>
        </div>
      )}
    </section>
  );
};

export default MatchdayMinutes;
