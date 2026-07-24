import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import CoachSelector from "@/components/club/CoachSelector";
import type { OfferedClubTeam } from "@/components/club/ClubTeamsManager";
import { createDaughterTeam, formatTeamGender, normalizeTeamGender } from "@/lib/clubTeams";

const SCHOOL_LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "varsity", label: "Varsity" },
  { value: "junior_varsity", label: "Junior Varsity" },
  { value: "prep", label: "Prep" },
  { value: "middle_school", label: "Middle School" },
];

export const daughterTeamDisplayLabel = (team: Partial<OfferedClubTeam>, isSchool: boolean) => {
  if (isSchool && team.school_level) {
    const match = SCHOOL_LEVEL_OPTIONS.find((option) => option.value === team.school_level);
    if (match) return match.label;
  }
  return (
    [formatTeamGender(team.gender), team.age_group, team.league_name].filter(Boolean).join(" ") ||
    (isSchool ? "School Team" : "Club Team")
  );
};

interface DaughterTeamEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new team. */
  team: (OfferedClubTeam & { id?: string }) | null;
  isSchool: boolean;
  /** Parent (mother) team id, required for creating a new team. */
  parentTeamId?: string | null;
  onSaved: () => void | Promise<void>;
  /** Optional delete action for saved teams (archives the team). */
  onDelete?: (team: OfferedClubTeam & { id?: string }) => Promise<boolean> | boolean;
}

interface TeamFormState {
  age_group: string;
  league_name: string;
  gender: string;
  season: string;
  level: string;
  school_level: string;
  coach_name: string;
  head_coach_user_id: string | null;
}

const emptyForm = (): TeamFormState => ({
  age_group: "",
  league_name: "",
  gender: "",
  season: "",
  level: "",
  school_level: "",
  coach_name: "",
  head_coach_user_id: null,
});

/**
 * Team-scoped editor: saving updates only the selected daughter team, never
 * the school/club account or any sibling team.
 */
const DaughterTeamEditDialog = ({ open, onOpenChange, team, isSchool, parentTeamId, onSaved, onDelete }: DaughterTeamEditDialogProps) => {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [form, setForm] = useState<TeamFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isCreating = !team?.id;

  const handleDelete = async () => {
    if (!team?.id || !onDelete) return;
    const confirmed = await confirm({
      title: "Delete Team?",
      description: `Are you sure you want to delete ${daughterTeamDisplayLabel(team, isSchool)}? It will be removed from your teams list and Explore, but linked history will stay safe.`,
      confirmText: "Delete Team",
      destructive: true,
    });
    if (!confirmed) return;
    setDeleting(true);
    const removed = await onDelete(team);
    setDeleting(false);
    if (removed) onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;
    setForm({
      age_group: team?.age_group || "",
      league_name: team?.league_name || "",
      gender: normalizeTeamGender(team?.gender) || "",
      season: team?.season || "",
      level: team?.level || "",
      school_level: team?.school_level || "",
      coach_name: team?.coach_name || "",
      head_coach_user_id: team?.head_coach_user_id || null,
    });
  }, [open, team]);

  const update = (patch: Partial<TeamFormState>) => setForm((current) => ({ ...current, ...patch }));

  const handleSave = async () => {
    if (saving || deleting) return; // block duplicate submissions
    if (!form.age_group.trim() || !form.league_name.trim()) {
      toast({
        title: "Missing information",
        description: `Age group and ${isSchool ? "league / conference" : "league"} are required.`,
        variant: "destructive",
      });
      return;
    }
    if (!normalizeTeamGender(form.gender)) {
      toast({ title: "Missing information", description: "Choose Boys or Girls for this team.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (isCreating) {
        const { data: createdTeam, error } = await createDaughterTeam({
          parentTeamId: parentTeamId || null,
          ageGroup: form.age_group.trim(),
          leagueOrConference: form.league_name.trim(),
          schoolLevel: isSchool ? ((form.school_level || null) as any) : null,
          gender: normalizeTeamGender(form.gender)!,
          season: form.season.trim() || null,
          level: form.level.trim() || null,
        });
        if (error) throw error;

        if (createdTeam?.id && (form.head_coach_user_id || form.coach_name.trim())) {
          const { error: coachError } = await (supabase as any).rpc("update_daughter_team_details", {
            _club_team_id: createdTeam.id,
            _season: form.season.trim() || null,
            _level: form.level.trim() || null,
            _coach_name: form.coach_name.trim() || null,
            _head_coach_user_id: form.head_coach_user_id,
          });
          if (coachError) throw coachError;
        }
      } else {
        const { error } = await (supabase as any).rpc("update_daughter_team_details", {
          _club_team_id: team!.id,
          _age_group: form.age_group.trim(),
          _league_name: form.league_name.trim(),
          _gender: normalizeTeamGender(form.gender),
          _season: form.season.trim() || null,
          _level: form.level.trim() || null,
          _coach_name: form.coach_name.trim() || null,
          _head_coach_user_id: form.head_coach_user_id,
          _school_level: isSchool ? form.school_level || null : null,
        });
        if (error) throw error;
      }

      toast({
        title: isCreating ? "Team Created" : "Team Updated",
        description: isCreating
          ? "The new team was added."
          : "Your daughter team changes have been saved.",
      });
      onOpenChange(false);
      await onSaved();
    } catch (error: any) {
      // Full database error for debugging only — never surface raw SQL/column
      // details to the user.
      console.error("Footy Status daughter team save failed", {
        clubTeamId: team?.id ?? null,
        isCreating,
        error,
      });
      toast({
        title: "Could not save team",
        description: isCreating
          ? "We couldn't add this team. Please try again."
          : "We couldn't save your changes. Please try again.",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isCreating ? "Add Team" : `Editing: ${daughterTeamDisplayLabel(team || {}, isSchool)}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!isCreating ? (
            <p className="text-xs text-muted-foreground">
              Changes here apply only to this team. The {isSchool ? "school" : "club"} account and other teams are not
              affected.
            </p>
          ) : null}

          {isSchool ? (
            <div className="space-y-2">
              <Label>Team Level</Label>
              <Select value={form.school_level} onValueChange={(value) => update({ school_level: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Varsity, Junior Varsity, Prep, Middle School" />
                </SelectTrigger>
                <SelectContent>
                  {SCHOOL_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Age Group *</Label>
              <Input value={form.age_group} onChange={(e) => update({ age_group: e.target.value })} placeholder="U16" />
            </div>
            <div className="space-y-2">
              <Label>{isSchool ? "League / Conference *" : "League *"}</Label>
              <Input value={form.league_name} onChange={(e) => update({ league_name: e.target.value })} placeholder={isSchool ? "District 5" : "EDP"} />
            </div>
            <div className="space-y-2">
              <Label>Gender *</Label>
              <Select value={form.gender} onValueChange={(value) => update({ gender: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Boys or Girls" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boy">Boys</SelectItem>
                  <SelectItem value="girl">Girls</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Season</Label>
              <Input value={form.season} onChange={(e) => update({ season: e.target.value })} placeholder="2026-27" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Division / Level</Label>
            <Input value={form.level} onChange={(e) => update({ level: e.target.value })} placeholder={isSchool ? "Division 1" : "Premier"} />
          </div>

          <div className="space-y-2">
            <Label>Head Coach</Label>
            <CoachSelector
              headCoachUserId={form.head_coach_user_id}
              coachName={form.coach_name}
              onSelectCoach={(coach) =>
                update({
                  head_coach_user_id: coach?.user_id || null,
                  coach_name: coach?.full_name || (coach ? form.coach_name : ""),
                })
              }
              onCoachNameChange={(name) => update({ coach_name: name, head_coach_user_id: null })}
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {!isCreating && onDelete ? (
            <Button variant="destructive" onClick={handleDelete} disabled={saving || deleting}>
              {deleting ? "Deleting..." : "Delete Team"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? "Saving..." : isCreating ? "Add Team" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DaughterTeamEditDialog;
