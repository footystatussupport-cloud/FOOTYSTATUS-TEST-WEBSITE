import { useEffect, useRef, useState } from "react";
import { Briefcase, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatRoleDisplayLabel } from "@/lib/coachStaffTeams";

export interface LinkedCoachSummary {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  coaching_role_type: string | null;
}

interface CoachSelectorProps {
  /** Linked coach account id (source of truth). */
  headCoachUserId?: string | null;
  /** Manually typed coach name (fallback for coaches without an account). */
  coachName?: string;
  onSelectCoach: (coach: LinkedCoachSummary | null) => void;
  onCoachNameChange: (name: string) => void;
  disabled?: boolean;
}

/**
 * Searchable linked-coach selector: search real Coach accounts by display
 * name or username, link the selected account by ID, and keep a manual text
 * fallback only for coaches who do not have an account yet.
 */
const CoachSelector = ({ headCoachUserId, coachName, onSelectCoach, onCoachNameChange, disabled }: CoachSelectorProps) => {
  const [selectedCoach, setSelectedCoach] = useState<LinkedCoachSummary | null>(null);
  const [results, setResults] = useState<LinkedCoachSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const lastLoadedId = useRef<string | null>(null);

  // Load the linked coach's details whenever a saved link is present, so the
  // avatar / username / coach type still show after refresh and re-login.
  useEffect(() => {
    if (!headCoachUserId) {
      setSelectedCoach(null);
      lastLoadedId.current = null;
      return;
    }
    if (lastLoadedId.current === headCoachUserId && selectedCoach) return;

    let cancelled = false;
    (supabase as any)
      .from("profiles")
      .select("user_id, full_name, username, avatar_url, coaching_role_type")
      .eq("user_id", headCoachUserId)
      .maybeSingle()
      .then(({ data }: { data: LinkedCoachSummary | null }) => {
        if (cancelled) return;
        lastLoadedId.current = headCoachUserId;
        setSelectedCoach(data || null);
      });

    return () => {
      cancelled = true;
    };
  }, [headCoachUserId, selectedCoach]);

  useEffect(() => {
    const query = (coachName || "").trim();
    if (headCoachUserId || query.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const usernameQuery = query.replace(/^@/, "");
      const { data } = await (supabase as any)
        .from("profiles")
        .select("user_id, full_name, username, avatar_url, coaching_role_type, account_role, account_category")
        .eq("account_category", "team_staff")
        .not("account_role", "in", '("team_club","school_team","scout")')
        .or(`full_name.ilike.%${query}%,username.ilike.%${usernameQuery}%`)
        .limit(6);

      if (cancelled) return;
      setResults((data || []) as LinkedCoachSummary[]);
      setSearching(false);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [coachName, headCoachUserId]);

  const handleSelect = (coach: LinkedCoachSummary) => {
    setSelectedCoach(coach);
    lastLoadedId.current = coach.user_id;
    setResults([]);
    onSelectCoach(coach);
  };

  const handleRemove = () => {
    setSelectedCoach(null);
    lastLoadedId.current = null;
    onSelectCoach(null);
  };

  if (headCoachUserId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
        <a
          href={`/coach/${headCoachUserId}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
            {selectedCoach?.avatar_url ? (
              <img src={selectedCoach.avatar_url} alt={selectedCoach.full_name || "Coach"} className="h-full w-full object-cover" />
            ) : (
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{selectedCoach?.full_name || coachName || "Linked coach"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[selectedCoach?.username ? `@${selectedCoach.username}` : null, formatRoleDisplayLabel(selectedCoach?.coaching_role_type, "Coach")]
                .filter(Boolean)
                .join(" — ")}
            </p>
          </div>
        </a>
        <Button type="button" size="icon" variant="ghost" onClick={handleRemove} disabled={disabled} aria-label="Remove head coach">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={coachName || ""}
          onChange={(e) => onCoachNameChange(e.target.value)}
          placeholder="Search coach by name or @username"
          className="pl-9"
          disabled={disabled}
        />
      </div>
      {searching ? <p className="text-xs text-muted-foreground">Searching coaches…</p> : null}
      {results.length ? (
        <div className="space-y-1 rounded-lg border border-border p-1">
          {results.map((coach) => (
            <button
              key={coach.user_id}
              type="button"
              onClick={() => handleSelect(coach)}
              disabled={disabled}
              className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-muted"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                {coach.avatar_url ? (
                  <img src={coach.avatar_url} alt={coach.full_name || "Coach"} className="h-full w-full object-cover" />
                ) : (
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{coach.full_name || "Coach"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[coach.username ? `@${coach.username}` : null, formatRoleDisplayLabel(coach.coaching_role_type, "Coach")]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : null}
      {(coachName || "").trim().length >= 2 && !searching && !results.length ? (
        <p className="text-xs text-muted-foreground">
          No coach account found. The typed name will be saved so you can invite them later.
        </p>
      ) : null}
    </div>
  );
};

export default CoachSelector;
