import { ShieldCheck, User, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type AccountType = "player" | "team_staff" | "parent" | "referee";

interface AccountTypeSelectorProps {
  onSelect: (type: AccountType) => void;
}

const AccountTypeSelector = ({ onSelect }: AccountTypeSelectorProps) => {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">What type of account?</h2>
        <p className="text-muted-foreground mt-2">Choose your profile type to get started</p>
      </div>

      <div className="space-y-3">
        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-4 whitespace-normal border-2 p-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect("player")}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy to-primary">
            <User className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">Player</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Build your player profile, post clips, show stats, and connect with teams.</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-4 whitespace-normal border-2 p-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect("team_staff")}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">Team / Staff</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Create a team, coach, scout, or staff account and manage team connections.</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-4 whitespace-normal border-2 p-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect("referee")}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-red-600">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">Referee</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Submit certifications, request match assignments, and track referee history.</p>
          </div>
        </Button>

        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-4 whitespace-normal border-2 p-4 text-left hover:border-navy hover:bg-navy/5"
          onClick={() => onSelect("parent")}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600">
            <Users className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-sm font-semibold text-foreground">Parent</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">Link to your child's player profile and manage private contact details.</p>
          </div>
        </Button>
      </div>
    </div>
  );
};

export default AccountTypeSelector;
