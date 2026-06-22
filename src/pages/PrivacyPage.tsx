import { Link } from "react-router-dom";
import { ArrowLeft, Shield, Eye, Users, MessageSquare, AtSign, UserX } from "lucide-react";
import Header from "@/components/Header";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";

const PrivacyPage = () => {
  const { settings, updateSetting, loading } = useSettings();
  const { blockedUsers, unblockUser, loading: blockedLoading } = useBlockedUsers();

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
                onValueChange={(value) => updateSetting('showContactInfo', value)}
                disabled={loading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="staff_only">Staff Only</SelectItem>
                  <SelectItem value="connections">Connections</SelectItem>
                  <SelectItem value="nobody">Nobody</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Interactions */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Interactions</h2>
          <div className="bg-card border border-border rounded-xl px-4">
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3 flex-1">
                <AtSign className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <Label htmlFor="tagging" className="text-base font-medium cursor-pointer">
                    Allow Tagging
                  </Label>
                  <p className="text-sm text-muted-foreground">Let others tag you in posts and clips</p>
                </div>
              </div>
              <Switch
                id="tagging"
                checked={settings.allowTagging}
                onCheckedChange={(checked) => updateSetting('allowTagging', checked)}
                disabled={loading}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3 flex-1">
                <MessageSquare className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-base font-medium">Who can message me</Label>
                  <p className="text-sm text-muted-foreground">Control who can send you messages</p>
                </div>
              </div>
              <Select
                value={settings.allowDirectMessages}
                onValueChange={(value) => updateSetting('allowDirectMessages', value)}
                disabled={loading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="staff">Staff Only</SelectItem>
                  <SelectItem value="connections">Connections</SelectItem>
                  <SelectItem value="nobody">Nobody</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Profile Views */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Profile Views</h2>
          <div className="bg-card border border-border rounded-xl px-4">
            <div className="flex items-start gap-3 py-4">
              <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <p className="text-base font-medium">Profiles can always be opened</p>
                <p className="text-sm text-muted-foreground">
                  Since every Footy profile is public, anyone on the app can view it. You can still control whether profile viewers are shown below.
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-4">
              <div className="flex-1">
                <Label htmlFor="showViewers" className="text-base font-medium cursor-pointer">
                  Show Who Viewed My Profile
                </Label>
                <p className="text-sm text-muted-foreground">See who has viewed your profile</p>
              </div>
              <Switch
                id="showViewers"
                checked={settings.showProfileViewers}
                onCheckedChange={(checked) => updateSetting('showProfileViewers', checked)}
                disabled={loading}
              />
            </div>
          </div>
        </section>

        {/* Blocked Users */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Blocked Users</h2>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <UserX className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">Manage Blocked Users</p>
                <p className="text-sm text-muted-foreground">
                  {blockedLoading
                    ? "Loading..."
                    : blockedUsers.length === 0 
                      ? "You haven't blocked anyone" 
                      : `${blockedUsers.length} blocked user(s)`}
                </p>
              </div>
            </div>
            {blockedUsers.length > 0 && (
              <div className="space-y-2 mt-2">
                {blockedUsers.map((bu) => (
                  <div key={bu.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div>
                      <p className="text-sm font-medium">{bu.full_name || bu.email || "Unknown User"}</p>
                      <p className="text-xs text-muted-foreground">Blocked {new Date(bu.created_at).toLocaleDateString()}</p>
                    </div>
                    <button
                      className="text-sm text-primary hover:underline"
                      onClick={() => unblockUser(bu.blocked_user_id)}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default PrivacyPage;
