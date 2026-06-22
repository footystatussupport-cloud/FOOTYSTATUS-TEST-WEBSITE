import { Clock3, MapPin, Shield } from "lucide-react";
import { MatchFeedItem, formatMatchDateTime, getEffectiveMatchStatus, getMatchStatusLabel } from "@/lib/matches";

interface MatchCardProps {
  match: MatchFeedItem;
}

const TeamLogo = ({ src, name }: { src?: string | null; name: string }) => (
  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-red-light shadow-sm">
    {src ? (
      <img src={src} alt={name} className="h-full w-full object-cover" />
    ) : (
      <Shield className="h-5 w-5 text-white" />
    )}
  </div>
);

const MatchCard = ({ match }: MatchCardProps) => {
  const effectiveStatus = getEffectiveMatchStatus(match);
  const scoreLabel =
    effectiveStatus === "scheduled" || effectiveStatus === "postponed" || effectiveStatus === "cancelled"
      ? "vs"
      : `${match.home_score ?? 0} - ${match.away_score ?? 0}`;
  const leagueContext = [match.age_group, match.region, match.division || match.tier].filter(Boolean).join(" - ");
  const locationLabel = [match.venue, match.venue_address].filter(Boolean).join(" - ");

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-navy">{match.league_name || "League Match"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{leagueContext || match.season || "Fixture"}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            effectiveStatus === "live"
              ? "bg-red-100 text-red-700"
              : effectiveStatus === "over"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {getMatchStatusLabel(match)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamLogo src={match.home_team_logo_url} name={match.home_team_name} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{match.home_team_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">Home</p>
          </div>
        </div>

        <div className="shrink-0 rounded-lg bg-muted px-3 py-2 text-center">
          <p className="text-lg font-bold text-foreground">{scoreLabel}</p>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 text-right">
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{match.away_team_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">Away</p>
          </div>
          <TeamLogo src={match.away_team_logo_url} name={match.away_team_name} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          {formatMatchDateTime(match.scheduled_at)}
        </span>
        {locationLabel ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {locationLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default MatchCard;
