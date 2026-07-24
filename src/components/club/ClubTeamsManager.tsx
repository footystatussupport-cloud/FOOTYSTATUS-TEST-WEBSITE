import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CoachSelector from "@/components/club/CoachSelector";
import { useConfirm } from "@/components/ConfirmDialog";

export interface OfferedClubTeam {
  id?: string;
  age_group: string;
  league_name: string;
  access_code_value?: string | null;
  access_code_last4?: string | null;
  access_code_updated_at?: string | null;
  gender?: "boy" | "girl" | "";
  season?: string;
  level?: string;
  coach_name?: string;
  /** Linked Coach account (source of truth when set). */
  head_coach_user_id?: string | null;
  status?: "active" | "inactive" | "archived";
  team_type?: "club" | "school";
  school_level?: "varsity" | "junior_varsity" | "prep" | "middle_school" | null;
}

interface ClubTeamsManagerProps {
  value: OfferedClubTeam[];
  onChange: (teams: OfferedClubTeam[]) => void;
  disabled?: boolean;
  onRemoveSavedTeam?: (team: OfferedClubTeam) => Promise<boolean> | boolean;
}

const emptyTeam = (): OfferedClubTeam => ({
  age_group: "",
  league_name: "",
  gender: "",
  season: "",
  level: "",
  coach_name: "",
  status: "active",
});

const buildCombinationKey = (team: OfferedClubTeam) =>
  [team.age_group, team.league_name, team.gender, team.season, team.level]
    .map((value) => (value || "").trim().toLowerCase())
    .join("|");

const ClubTeamsManager = ({ value, onChange, disabled, onRemoveSavedTeam }: ClubTeamsManagerProps) => {
  const confirm = useConfirm();
  const teams = value.length ? value : [emptyTeam()];
  const duplicateKeys = teams.reduce<Record<string, number>>((acc, team) => {
    const key = buildCombinationKey(team);
    if (key === "||||") return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const updateTeam = (index: number, patch: Partial<OfferedClubTeam>) => {
    onChange(
      teams.map((team, teamIndex) => (teamIndex === index ? { ...team, ...patch } : team))
    );
  };

  const addTeam = () => {
    onChange([...teams, emptyTeam()]);
  };

  const removeTeam = async (index: number) => {
    const team = teams[index];
    if (team?.id) {
      const confirmed = await confirm({
        title: "Delete Team?",
        description: "Are you sure you want to delete this daughter team? It will be removed from your teams list and Explore, but linked history will stay safe.",
        confirmText: "Delete Team",
        destructive: true,
      });
      if (!confirmed) return;
      const removed = onRemoveSavedTeam ? await onRemoveSavedTeam(team) : true;
      if (!removed) return;
    }

    if (teams.length === 1) {
      onChange([emptyTeam()]);
      return;
    }
    onChange(teams.filter((_, teamIndex) => teamIndex !== index));
  };

  return (
    <div className="space-y-3">
      {teams.map((team, index) => {
        const isDuplicate = duplicateKeys[buildCombinationKey(team)] > 1;
        return (
          <div key={`${team.id || "new"}-${index}`} className="rounded-lg border border-border p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Age Group</Label>
                <Input
                  value={team.age_group}
                  onChange={(e) => updateTeam(index, { age_group: e.target.value })}
                  placeholder="U14"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>League</Label>
                <Input
                  value={team.league_name}
                  onChange={(e) => updateTeam(index, { league_name: e.target.value })}
                  placeholder="EDP"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>What gender is this team? *</Label>
                <Select
                  value={team.gender || ""}
                  onValueChange={(gender) => updateTeam(index, { gender: gender as OfferedClubTeam["gender"] })}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose Boys or Girls" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boy">Boys</SelectItem>
                    <SelectItem value="girl">Girls</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Season</Label>
                <Input
                  value={team.season || ""}
                  onChange={(e) => updateTeam(index, { season: e.target.value })}
                  placeholder="2026-27"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label>Level</Label>
                <Input
                  value={team.level || ""}
                  onChange={(e) => updateTeam(index, { level: e.target.value })}
                  placeholder="Premier"
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Head Coach</Label>
              <CoachSelector
                headCoachUserId={team.head_coach_user_id}
                coachName={team.coach_name || ""}
                onSelectCoach={(coach) =>
                  updateTeam(index, {
                    head_coach_user_id: coach?.user_id || null,
                    coach_name: coach?.full_name || (coach ? team.coach_name : ""),
                  })
                }
                onCoachNameChange={(name) => updateTeam(index, { coach_name: name, head_coach_user_id: null })}
                disabled={disabled}
              />
            </div>

            {isDuplicate ? (
              <p className="text-sm text-destructive">
                This club already has that exact team combination. Please change one of the fields.
              </p>
            ) : null}

            <Button type="button" variant="outline" size="sm" onClick={() => removeTeam(index)} disabled={disabled}>
              {team.id ? "Delete Daughter Team" : "Remove Team"}
            </Button>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={addTeam} disabled={disabled}>
        Add Daughter Team
      </Button>
      <p className="text-xs text-muted-foreground">
        Available age groups and leagues update player enrollment later. Duplicate combinations are blocked.
      </p>
    </div>
  );
};

export default ClubTeamsManager;
