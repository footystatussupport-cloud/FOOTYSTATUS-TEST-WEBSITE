import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const PlayerGenderCompletionGate = () => {
  const { user, profile, loading } = useAuth();
  const { toast } = useToast();
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [completedLocally, setCompletedLocally] = useState(false);
  const requiresChoice =
    !loading &&
    !!user &&
    profile?.account_role === "player" &&
    !profile.player_gender &&
    !completedLocally;

  useEffect(() => {
    if (!requiresChoice) setGender("");
  }, [requiresChoice]);

  const saveGender = async () => {
    if (gender !== "boy" && gender !== "girl") {
      toast({ title: "Select Boy or Girl", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await (supabase as any).rpc("set_own_player_gender", {
      _player_gender: gender,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Could not save your selection", description: error.message, variant: "destructive" });
      return;
    }

    setCompletedLocally(true);
    window.location.reload();
  };

  return (
    <Dialog open={requiresChoice}>
      <DialogContent
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Complete your player account</DialogTitle>
          <DialogDescription>This one-time selection is required before continuing.</DialogDescription>
        </DialogHeader>
        <Select value={gender} onValueChange={setGender}>
          <SelectTrigger>
            <SelectValue placeholder="What is your gender?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="boy">Boy</SelectItem>
            <SelectItem value="girl">Girl</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button className="w-full" onClick={saveGender} disabled={saving || !gender}>
            {saving ? "Saving..." : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlayerGenderCompletionGate;
