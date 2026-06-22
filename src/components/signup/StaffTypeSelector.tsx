import { useState } from "react";
import { Building2, Users, Search, GraduationCap, School } from "lucide-react";
import { Button } from "@/components/ui/button";

type StaffType = 'team_club' | 'school_team' | 'head_coach_assistant' | 'academy_director' | 'scout';

interface StaffTypeSelectorProps {
  onSelect: (type: StaffType) => void;
  onBack: () => void;
}

const StaffTypeSelector = ({ onSelect, onBack }: StaffTypeSelectorProps) => {
  const [teamForkOpen, setTeamForkOpen] = useState(false);

  if (teamForkOpen) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground">Select team type</h2>
          <p className="text-muted-foreground mt-2">Choose the team account you want to create.</p>
        </div>

        <div className="space-y-3">
          <Button
            variant="outline"
            className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
            onClick={() => onSelect("team_club")}
          >
            <Building2 className="h-5 w-5 shrink-0 text-navy" />
            <div className="min-w-0 text-left">
              <p className="font-semibold text-foreground">Club Team</p>
              <p className="text-xs text-muted-foreground">Age groups, leagues, rosters, invitations, and team management.</p>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
            onClick={() => onSelect("school_team")}
          >
            <School className="h-5 w-5 shrink-0 text-navy" />
            <div className="min-w-0 text-left">
              <p className="font-semibold text-foreground">School Team</p>
              <p className="text-xs text-muted-foreground">School level, conference, coaches, roster, matches, and team management.</p>
            </div>
          </Button>
        </div>

        <Button variant="ghost" className="w-full" onClick={() => setTeamForkOpen(false)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">Select your role</h2>
        <p className="text-muted-foreground mt-2">Which best describes you?</p>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => setTeamForkOpen(true)}
        >
          <Building2 className="h-5 w-5 shrink-0 text-navy" />
          <div className="min-w-0 text-left">
            <p className="font-semibold text-foreground">Team / Club</p>
            <p className="text-xs text-muted-foreground">Register a club team with age groups, leagues, rosters, and team management.</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect('head_coach_assistant')}
        >
          <Users className="h-5 w-5 shrink-0 text-navy" />
          <div className="min-w-0 text-left">
            <p className="font-semibold text-foreground">Head Coach / Assistant Coach / Trainer</p>
            <p className="text-xs text-muted-foreground">Coaches and training staff</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect('academy_director')}
        >
          <GraduationCap className="h-5 w-5 shrink-0 text-navy" />
          <div className="min-w-0 text-left">
            <p className="font-semibold text-foreground">Team Staff</p>
            <p className="text-xs text-muted-foreground">Directors, managers, admins, operations, media, and team staff</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto min-h-16 w-full justify-start gap-4 whitespace-normal border-2 px-6 py-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect('scout')}
        >
          <Search className="h-5 w-5 shrink-0 text-navy" />
          <div className="min-w-0 text-left">
            <p className="font-semibold text-foreground">Scout</p>
            <p className="text-xs text-muted-foreground">Talent identification profile</p>
          </div>
        </Button>

      </div>

      <Button
        variant="ghost"
        className="w-full"
        onClick={onBack}
      >
        Back
      </Button>
    </div>
  );
};

export default StaffTypeSelector;
