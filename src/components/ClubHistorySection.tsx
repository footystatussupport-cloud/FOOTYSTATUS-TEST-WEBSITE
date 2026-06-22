import { type ReactNode, useState } from "react";
import { Shield, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ClubHistoryEntry {
  id: string;
  player_id?: string | null;
  player_profile_id?: string | null;
  team_id?: string | null;
  league_id?: string | null;
  club_name: string;
  linked_team_name?: string | null;
  level?: string | null;
  season?: string | null;
  years?: string | null;
  competition?: string | null;
  team_logo_url?: string | null;
  position_role?: string | null;
  notes?: string | null;
  stats_source?: "manual" | "verified" | string | null;
  goals?: number | null;
  assists?: number | null;
  appearances?: number | null;
  starts?: number | null;
  clean_sheets?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;
}

interface ClubHistorySectionProps {
  entries: ClubHistoryEntry[];
  canManage?: boolean;
  onAdd?: () => void;
  onEdit?: (entry: ClubHistoryEntry) => void;
  onOpenLinkedTeam?: (entry: ClubHistoryEntry) => void;
  action?: ReactNode;
}

const statValue = (value?: number | null) => value ?? 0;

const stats = [
  ["Goals", "goals"],
  ["Assists", "assists"],
  ["Apps", "appearances"],
  ["Starts", "starts"],
  ["Clean Sheets", "clean_sheets"],
  ["Yellow", "yellow_cards"],
  ["Red", "red_cards"],
] as const;

const ClubHistorySection = ({ entries, canManage = false, onAdd, onEdit, onOpenLinkedTeam, action }: ClubHistorySectionProps) => {
  const [unavailableEntryId, setUnavailableEntryId] = useState<string | null>(null);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">Club History</h2>
          <p className="text-xs text-muted-foreground">Teams represented by season</p>
        </div>
        <div className="flex items-center gap-2">
        {canManage && onAdd ? (
          <Button size="sm" variant="outline" onClick={onAdd}>
            Add Club
          </Button>
        ) : null}
        {action}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
          <Trophy className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No club history added yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const linked = Boolean(entry.team_id);
            const sourceLabel = linked ? "Verified from matches" : "Manual stats";

            return (
              <article key={entry.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-accent to-red-light shadow-sm"
                    onClick={() => {
                      if (linked && onOpenLinkedTeam) {
                        onOpenLinkedTeam(entry);
                        return;
                      }
                      setUnavailableEntryId(entry.id);
                    }}
                    aria-label={linked ? `Open ${entry.club_name}` : "Team profile unavailable"}
                  >
                    {entry.team_logo_url ? (
                      <img src={entry.team_logo_url} alt={entry.club_name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Shield className="h-6 w-6 text-white" />
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => {
                          if (linked && onOpenLinkedTeam) {
                            onOpenLinkedTeam(entry);
                            return;
                          }
                          setUnavailableEntryId(entry.id);
                        }}
                      >
                        <p className="truncate font-semibold text-foreground">{entry.club_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {[entry.season || entry.years, entry.competition, entry.position_role || entry.level].filter(Boolean).join(" - ")}
                        </p>
                      </button>
                      <Badge variant={linked ? "default" : "secondary"} className="shrink-0">
                        {sourceLabel}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-4 gap-x-3 gap-y-2 text-center">
                      {stats.map(([label, key]) => (
                        <div key={key} className="min-w-0">
                          <p className="text-base font-semibold tabular-nums text-foreground">{statValue(entry[key])}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{label}</p>
                        </div>
                      ))}
                    </div>

                    {entry.notes ? <p className="mt-3 text-sm text-muted-foreground">{entry.notes}</p> : null}

                    {unavailableEntryId === entry.id && !linked ? (
                      <div className="mt-3 rounded-lg border border-border bg-muted/60 p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Team profile unavailable</p>
                        <p>No linked team page is available for this manually entered club.</p>
                      </div>
                    ) : null}

                    {canManage && onEdit ? (
                      <Button size="sm" variant="ghost" className="mt-3 px-0" onClick={() => onEdit(entry)}>
                        Edit entry
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ClubHistorySection;
