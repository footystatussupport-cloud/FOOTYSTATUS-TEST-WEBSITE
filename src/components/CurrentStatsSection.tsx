import type { ReactNode } from "react";
import { Clock3, Shield, Target, Trophy } from "lucide-react";

export interface CurrentStats {
  team_id?: string | null;
  team_name?: string | null;
  team_logo_url?: string | null;
  league_id?: string | null;
  league_name?: string | null;
  season?: string | null;
  goals?: number | null;
  assists?: number | null;
  appearances?: number | null;
  substitute_ins?: number | null;
  starts?: number | null;
  minutes_played?: number | null;
  clean_sheets?: number | null;
  chances_created?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;
}

interface CurrentStatsSectionProps {
  stats?: CurrentStats | null;
  headingLevel?: "h2" | "h3";
  action?: ReactNode;
}

const statValue = (value?: number | null) => value ?? 0;

const StatLine = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-lg font-semibold text-foreground tabular-nums">{value}</span>
  </div>
);

const CardIcon = ({ color }: { color: "yellow" | "red" }) => (
  <span
    className={`inline-block h-5 w-3.5 rounded-[2px] shadow-sm ring-1 ${
      color === "yellow" ? "bg-yellow-400 ring-yellow-600/30" : "bg-red-600 ring-red-900/20"
    }`}
    aria-hidden="true"
  />
);

const CurrentStatsSection = ({ stats, headingLevel = "h3", action }: CurrentStatsSectionProps) => {
  const Heading = headingLevel;
  const teamInitial = (stats?.team_name || "Team").trim().charAt(0).toUpperCase() || "T";
  const teamMeta = [stats?.league_name, stats?.season].filter(Boolean).join(" · ") || null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Heading className="text-lg font-semibold text-navy">Current Stats</Heading>
        <div className="flex items-center gap-2">
        {stats?.team_name || stats?.season ? (
          <span className="inline-flex max-w-[16rem] items-center gap-2 rounded-xl border border-red-200/80 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy shadow-sm dark:border-red-500/30 dark:bg-[#170b13] dark:text-white dark:shadow-black/20">
            {stats?.team_logo_url ? (
              <img src={stats.team_logo_url} alt={stats.team_name || "Team"} className="h-7 w-7 rounded-full border border-white/60 bg-white object-cover dark:border-red-300/30 dark:bg-muted" />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-navy text-[11px] font-bold text-white shadow-sm">
                {teamInitial}
              </span>
            )}
            <span className="min-w-0 leading-tight">
              <span className="block truncate">{stats.team_name || "Team Stats"}</span>
              {teamMeta ? <span className="block truncate text-[11px] font-medium text-muted-foreground dark:text-gray-300">{teamMeta}</span> : null}
            </span>
          </span>
        ) : null}
        {action}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border-2 border-navy/15 bg-card shadow-sm">
        <div className="h-1 bg-gradient-to-r from-red-600 via-white to-navy" />
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="bg-gradient-to-br from-white to-red-50/70 p-4 dark:from-[#5a0f1b] dark:via-[#6d1320] dark:to-[#8f1d2d]">
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-red-600 dark:text-red-100" />
              <p className="text-sm font-semibold text-navy">Attacking</p>
            </div>
            <div className="space-y-2">
              <StatLine label="Goals" value={statValue(stats?.goals)} />
              <StatLine label="Assists" value={statValue(stats?.assists)} />
              <StatLine label="Chances Created" value={statValue(stats?.chances_created)} />
            </div>
          </div>

          <div className="bg-gradient-to-br from-white to-blue-50/70 p-4 dark:from-card dark:to-muted">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-navy" />
              <p className="text-sm font-semibold text-navy">Playing Time</p>
            </div>
            <div className="space-y-2">
              <StatLine label="Appearances" value={statValue(stats?.appearances)} />
              <StatLine label="Substitute Ins" value={statValue(stats?.substitute_ins)} />
              <StatLine label="Starts" value={statValue(stats?.starts)} />
              <StatLine label="Minutes Played" value={statValue(stats?.minutes_played)} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="bg-gradient-to-br from-white to-blue-50/70 p-4 dark:from-card dark:to-muted">
            <div className="mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-navy" />
              <p className="text-sm font-semibold text-navy">Defensive</p>
            </div>
            <div className="space-y-2">
              <StatLine label="Clean Sheets" value={statValue(stats?.clean_sheets)} />
            </div>
          </div>

          <div className="bg-gradient-to-br from-white to-red-50/70 p-4 dark:from-[#5a0f1b] dark:via-[#6d1320] dark:to-[#8f1d2d]">
            <div className="mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-red-600 dark:text-red-100" />
              <p className="text-sm font-semibold text-navy">Discipline</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CardIcon color="yellow" />
                  Yellow Cards
                </span>
                <span className="text-lg font-semibold text-foreground tabular-nums">{statValue(stats?.yellow_cards)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CardIcon color="red" />
                  Red Cards
                </span>
                <span className="text-lg font-semibold text-foreground tabular-nums">{statValue(stats?.red_cards)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CurrentStatsSection;
