import { Link } from "react-router-dom";
import { ArrowLeft, Shield, Eye } from "lucide-react";
import Header from "@/components/Header";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const PrivacyPage = () => {
  const { settings, updateSetting, loading } = useSettings();

  const handleContactVisibilityChange = async (value: string) => {
    const { error } = await (supabase as any).rpc("set_contact_info_visibility", {
      _visibility: value,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    updateSetting("showContactInfo", value);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="px-4 py-6 max-w-2xl mx-auto">
        <Link 
          to="/other"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Link>
        
        <h1 className="text-2xl font-bold mb-6">Privacy & Security</h1>

        {/* Profile Visibility */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Profile Visibility</h2>
          <div className="bg-card border border-border rounded-xl px-4">
            <div className="flex items-start gap-3 py-4">
              <Eye className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <p className="text-base font-medium">Profiles are public across Footy</p>
                <p className="text-sm text-muted-foreground">
                  Every account can be viewed and discovered in search. You can still control who sees your contact info below.
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3 flex-1">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-base font-medium">Who can see my contact info</Label>
                  <p className="text-sm text-muted-foreground">Phone and email visibility</p>
                </div>
              </div>
              <Select
                value={settings.showContactInfo}
                onValueChange={handleContactVisibilityChange}
                disabled={loading}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="staff_only">Teams / Coaches / Staff Only</SelectItem>
                  <SelectItem value="private">Only Me</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};

export default PrivacyPage;
