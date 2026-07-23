import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Moon, Globe, Smartphone, Volume2, Download, Trash2, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, type UserSettings } from "@/hooks/useSettings";
import NotificationSettingsSection from "@/components/notifications/NotificationSettingsSection";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  assertUserCanBeDeleted,
  isCurrentUserDeletionProtected,
} from "@/lib/protectedAccounts";

interface SettingItem {
  id: keyof UserSettings;
  label: string;
  description: string;
  type: 'toggle' | 'select' | 'link';
  icon?: React.ReactNode;
  options?: { value: string; label: string }[];
  linkPath?: string;
}

// Extract a meaningful message from whatever the delete-account call throws.
// Supabase RPC errors are plain objects ({ message, details, hint, code }),
// not Error instances, so `error instanceof Error` alone loses the real cause.
const getDeleteAccountErrorMessage = (error: unknown): string => {
  const fallback = "Please try again. If this keeps happening, contact Footy Status support.";
  if (!error) return fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  if (typeof error === "object") {
    const supabaseError = error as { message?: string; details?: string; hint?: string };
    return supabaseError.message || supabaseError.details || supabaseError.hint || fallback;
  }
  return fallback;
};

const SettingsPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { settings, updateSetting, loading } = useSettings();
  const { user, profile, refreshProfile } = useAuth();
  const [deletingAccount, setDeletingAccount] = useState(false);
  // Server-authoritative: hide the Delete Account control for the permanently
  // protected Footy Status Official Admin account. Real enforcement is in the
  // database; this only prevents showing a button that would always fail.
  const [deletionProtected, setDeletionProtected] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setDeletionProtected(false);
      return;
    }
    isCurrentUserDeletionProtected()
      .then((protectedAccount) => {
        if (active) setDeletionProtected(protectedAccount);
      })
      .catch(() => {
        if (active) setDeletionProtected(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const role = profile?.account_role || profile?.account_type || profile?.role;
  const canUseNextUpGenderPreference = Boolean(
    role &&
      ["scout", "team_staff", "head_coach_assistant", "coach", "trainer", "academy_director", "team_club", "school_team"].includes(role)
  );

  const updateNextUpGenderPreference = async (value: "both" | "boy" | "girl") => {
    if (!user?.id) return;
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ next_up_gender_preference: value })
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Could not save preference", description: error.message, variant: "destructive" });
      return;
    }

    await refreshProfile();
    toast({ title: "Next Up preference saved", description: "Your scouting feed will use this filter." });
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete Account?\n\nThis action is permanent and cannot be undone. This will permanently delete your Footy Status account, profile, videos, and associated data."
    );

    if (!confirmed) {
      return;
    }

    setDeletingAccount(true);

    try {
      // Shared guard: refuse before any deletion begins if this account is the
      // permanently protected Footy Status Official Admin. The database enforces
      // the same rule; this gives a clear, immediate message.
      if (user?.id) {
        await assertUserCanBeDeleted(user.id);
      }

      const { error } = await (supabase as any).rpc("delete_my_account");

      if (error) {
        throw error;
      }

      // The auth user no longer exists server-side; clear every cached token and
      // local/session state so the deleted session can never be restored.
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      localStorage.clear();
      sessionStorage.clear();

      toast({
        title: "Account deleted",
        description: "Your Footy Status account has been permanently deleted.",
      });

      navigate("/auth", { replace: true });
    } catch (error) {
      console.error("Delete account failed", error);
      // Supabase returns a plain error object (PostgrestError), not an Error
      // instance, so surface its message/details directly instead of always
      // falling back to the generic text — otherwise the real backend cause
      // (e.g. a missing function or constraint) is hidden from the user and logs.
      const message = getDeleteAccountErrorMessage(error);
      toast({
        title: "Account could not be deleted",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDeletingAccount(false);
    }
  };

  const appearanceSettings: SettingItem[] = [
    { id: 'darkMode', label: 'Dark Mode', description: 'Switch between light and dark themes', type: 'toggle', icon: <Moon className="h-5 w-5" /> },
    { id: 'compactView', label: 'Compact View', description: 'Show more content with smaller cards', type: 'toggle' },
    { id: 'showAnimations', label: 'Show Animations', description: 'Enable smooth animations throughout the app', type: 'toggle' },
  ];

  const privacySettings: SettingItem[] = [
    { id: 'allowTagging', label: 'Allow Tagging', description: 'Let others tag you in posts and clips', type: 'toggle' },
  ];

  const contentSettings: SettingItem[] = [
    { id: 'autoplayVideos', label: 'Autoplay Videos', description: 'Automatically play clips as you scroll', type: 'toggle', icon: <Smartphone className="h-5 w-5" /> },
    { id: 'hdVideoWifi', label: 'HD Video on WiFi', description: 'Play high quality video when on WiFi', type: 'toggle' },
    { id: 'showScoreSpoilers', label: 'Show Score Spoilers', description: 'Display match scores immediately', type: 'toggle' },
    { id: 'liveCommentary', label: 'Live Commentary', description: 'Show live match commentary updates', type: 'toggle' },
  ];

  const accessibilitySettings: SettingItem[] = [
    { id: 'largeText', label: 'Large Text', description: 'Increase text size for better readability', type: 'toggle' },
    { id: 'reducedMotion', label: 'Reduced Motion', description: 'Minimize animations and motion effects', type: 'toggle' },
    { id: 'screenReaderOptimized', label: 'Screen Reader Optimized', description: 'Optimize for screen reader navigation', type: 'toggle' },
    { id: 'highContrast', label: 'High Contrast', description: 'Increase color contrast for better visibility', type: 'toggle' },
  ];

  const dataSettings: SettingItem[] = [
    { id: 'dataSaver', label: 'Data Saver', description: 'Reduce data usage by loading lower quality media', type: 'toggle', icon: <Download className="h-5 w-5" /> },
    { id: 'offlineMode', label: 'Offline Mode', description: 'Access downloaded content without internet', type: 'toggle' },
    { id: 'autoDownloadClips', label: 'Auto-Download Clips', description: 'Download clips on WiFi for offline viewing', type: 'toggle' },
  ];

  const soundSettings: SettingItem[] = [
    { id: 'soundEffects', label: 'Sound Effects', description: 'Play sounds for notifications and interactions', type: 'toggle', icon: <Volume2 className="h-5 w-5" /> },
    { id: 'vibration', label: 'Vibration', description: 'Haptic feedback for interactions', type: 'toggle' },
  ];

  const renderSettingItem = (item: SettingItem) => {
    if (item.type === 'toggle') {
      return (
        <div key={item.id} className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3 flex-1">
            {item.icon && <div className="text-muted-foreground">{item.icon}</div>}
            <div className="flex-1">
              <Label htmlFor={item.id} className="text-base font-medium cursor-pointer">
                {item.label}
              </Label>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          </div>
          <Switch
            id={item.id}
            checked={settings[item.id] as boolean}
            onCheckedChange={(checked) => updateSetting(item.id, checked)}
            disabled={loading}
          />
        </div>
      );
    }

    if (item.type === 'select' && item.options) {
      return (
        <div key={item.id} className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3 flex-1">
            {item.icon && <div className="text-muted-foreground">{item.icon}</div>}
            <div className="flex-1">
              <Label htmlFor={item.id} className="text-base font-medium">
                {item.label}
              </Label>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          </div>
          <Select
            value={settings[item.id] as string}
            onValueChange={(value) => updateSetting(item.id, value)}
            disabled={loading}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {item.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (item.type === 'link' && item.linkPath) {
      return (
        <Link key={item.id} to={item.linkPath} className="flex items-center justify-between py-4 hover:bg-muted/50 -mx-4 px-4 rounded-lg transition-colors">
          <div className="flex items-center gap-3 flex-1">
            {item.icon && <div className="text-muted-foreground">{item.icon}</div>}
            <div className="flex-1">
              <p className="text-base font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      );
    }

    return null;
  };

  const renderSection = (title: string, items: SettingItem[]) => (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-navy mb-2">{title}</h2>
      <div className="bg-card border border-border rounded-xl px-4">
        {items.map((item, index) => (
          <div key={item.id}>
            {renderSettingItem(item)}
            {index < items.length - 1 && <Separator />}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full max-w-md mx-auto border-x border-border bg-background overflow-x-hidden">
        <Header />

      <main className="px-4 py-6">
        <Link 
          to="/other"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Link>
        
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        {renderSection('Appearance', appearanceSettings)}
        <NotificationSettingsSection />
        {renderSection('Privacy', privacySettings)}
        {renderSection('Content & Playback', contentSettings)}
        {canUseNextUpGenderPreference ? (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-navy mb-2">Next Up Clips</h2>
            <div className="bg-card border border-border rounded-xl px-4">
              <div className="flex items-center justify-between py-4">
                <div className="flex-1">
                  <Label className="text-base font-medium">Next Up Clip Gender Preference</Label>
                  <p className="text-sm text-muted-foreground">Choose which player clips appear in your scouting feed</p>
                </div>
                <Select
                  value={profile?.next_up_gender_preference || "both"}
                  onValueChange={(value) => updateNextUpGenderPreference(value as "both" | "boy" | "girl")}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="girl">Girls Only</SelectItem>
                    <SelectItem value="boy">Boys Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        ) : null}
        {renderSection('Accessibility', accessibilitySettings)}
        {renderSection('Data & Storage', dataSettings)}
        {renderSection('Sound & Haptics', soundSettings)}

        {/* Language & Region Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Language & Region</h2>
          <div className="bg-card border border-border rounded-xl px-4">
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3 flex-1">
                <Globe className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-base font-medium">Language</Label>
                  <p className="text-sm text-muted-foreground">Choose your preferred language</p>
                </div>
              </div>
              <Select
                value={settings.language}
                onValueChange={(value) => updateSetting('language', value)}
                disabled={loading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="pt">Português</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-4">
              <div className="flex-1">
                <Label className="text-base font-medium">Timezone</Label>
                <p className="text-sm text-muted-foreground">Set your timezone for match times</p>
              </div>
              <Select
                value={settings.timezone}
                onValueChange={(value) => updateSetting('timezone', value)}
                disabled={loading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="utc">UTC</SelectItem>
                  <SelectItem value="est">EST</SelectItem>
                  <SelectItem value="pst">PST</SelectItem>
                  <SelectItem value="gmt">GMT</SelectItem>
                  <SelectItem value="cet">CET</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-4">
              <div className="flex-1">
                <Label className="text-base font-medium">Date Format</Label>
                <p className="text-sm text-muted-foreground">How dates are displayed</p>
              </div>
              <Select
                value={settings.dateFormat}
                onValueChange={(value) => updateSetting('dateFormat', value)}
                disabled={loading}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mdy">MM/DD/YYYY</SelectItem>
                  <SelectItem value="dmy">DD/MM/YYYY</SelectItem>
                  <SelectItem value="ymd">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        {!deletionProtected && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-destructive mb-2">Danger Zone</h2>
            <div className="bg-card border border-destructive/30 rounded-xl px-4">
              <div className="flex items-center justify-between py-4">
                <div className="flex items-center gap-3 flex-1">
                  <Trash2 className="h-5 w-5 text-destructive" />
                  <div className="flex-1">
                    <p className="text-base font-medium text-destructive">Delete Account</p>
                    <p className="text-sm text-muted-foreground">Permanently delete your account and all data</p>
                  </div>
                </div>
                <button
                  className="text-sm font-medium text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount}
                >
                  {deletingAccount ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      </div>
    </div>
  );
};

export default SettingsPage;
