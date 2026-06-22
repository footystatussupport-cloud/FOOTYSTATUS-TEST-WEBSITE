import { useState, useEffect, createContext, useContext, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export interface UserSettings {
  // Appearance
  darkMode: boolean;
  compactView: boolean;
  showAnimations: boolean;
  // Notifications
  pushNotifications: boolean;
  matchAlerts: boolean;
  goalNotifications: boolean;
  clipNotifications: boolean;
  messageNotifications: boolean;
  emailDigest: boolean;
  // Privacy
  profilePublic: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  allowTagging: boolean;
  showInSearch: boolean;
  // Content & Playback
  autoplayVideos: boolean;
  hdVideoWifi: boolean;
  showScoreSpoilers: boolean;
  liveCommentary: boolean;
  // Accessibility
  largeText: boolean;
  reducedMotion: boolean;
  screenReaderOptimized: boolean;
  highContrast: boolean;
  // Data & Storage
  dataSaver: boolean;
  offlineMode: boolean;
  autoDownloadClips: boolean;
  // Sound & Haptics
  soundEffects: boolean;
  vibration: boolean;
  // Language & Region
  language: string;
  timezone: string;
  dateFormat: string;
  // Privacy & Security (detailed)
  profileVisibility: string;
  showContactInfo: string;
  showActivityStatus: boolean;
  allowDirectMessages: string;
  allowProfileViews: boolean;
  showProfileViewers: boolean;
  // Notification preferences (granular)
  inAppNotifications: boolean;
  emailNotifications: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const defaultSettings: UserSettings = {
  darkMode: false,
  compactView: false,
  showAnimations: true,
  pushNotifications: true,
  matchAlerts: true,
  goalNotifications: true,
  clipNotifications: true,
  messageNotifications: true,
  emailDigest: false,
  profilePublic: true,
  showOnlineStatus: true,
  showLastSeen: true,
  allowTagging: true,
  showInSearch: true,
  autoplayVideos: true,
  hdVideoWifi: true,
  showScoreSpoilers: true,
  liveCommentary: true,
  largeText: false,
  reducedMotion: false,
  screenReaderOptimized: false,
  highContrast: false,
  dataSaver: false,
  offlineMode: false,
  autoDownloadClips: false,
  soundEffects: true,
  vibration: true,
  language: "en",
  timezone: "auto",
  dateFormat: "mdy",
  profileVisibility: "public",
  showContactInfo: "everyone",
  showActivityStatus: true,
  allowDirectMessages: "everyone",
  allowProfileViews: true,
  showProfileViewers: true,
  inAppNotifications: true,
  emailNotifications: false,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

// Map camelCase keys to snake_case DB columns
const toSnakeCase = (key: string) =>
  key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

const toDbRecord = (settings: Partial<UserSettings>) => {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    record[toSnakeCase(key)] = value;
  }
  return record;
};

const fromDbRecord = (row: Record<string, unknown>): UserSettings => {
  const s = { ...defaultSettings };
  const snakeToKey: Record<string, keyof UserSettings> = {};
  for (const key of Object.keys(defaultSettings) as (keyof UserSettings)[]) {
    snakeToKey[toSnakeCase(key)] = key;
  }
  for (const [col, val] of Object.entries(row)) {
    const k = snakeToKey[col];
    if (k !== undefined && val !== null && val !== undefined) {
      (s as any)[k] = val;
    }
  }
  return s;
};

interface SettingsContextType {
  settings: UserSettings;
  loading: boolean;
  updateSetting: (key: keyof UserSettings, value: boolean | string) => void;
  updateSettings: (partial: Partial<UserSettings>) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  loading: true,
  updateSetting: () => {},
  updateSettings: () => {},
});

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  // Load settings from Supabase
  useEffect(() => {
    if (!user) {
      // Logged-out pages must never inherit the previous account's appearance.
      setSettings({ ...defaultSettings });
      document.documentElement.classList.remove(
        "dark",
        "compact-view",
        "no-animations",
        "large-text",
        "high-contrast",
        "sr-optimized"
      );
      localStorage.removeItem("footystatus_settings");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      // Reset the previous account's appearance while this account loads.
      setSettings({ ...defaultSettings });
      document.documentElement.classList.remove(
        "dark",
        "compact-view",
        "no-animations",
        "large-text",
        "high-contrast",
        "sr-optimized"
      );
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to load settings:", error);
        setLoading(false);
        return;
      }

      if (data) {
        setSettings(fromDbRecord(data as Record<string, unknown>));
      } else {
        // Create default settings row
        await supabase.from("user_settings").insert({ user_id: user.id });
        setSettings({ ...defaultSettings });
      }
      setLoading(false);
    };
    load();
  }, [user?.id]);

  // Apply settings to DOM
  useEffect(() => {
    const root = document.documentElement;

    // Dark mode
    if (user && settings.darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Compact view
    if (settings.compactView) {
      root.classList.add("compact-view");
    } else {
      root.classList.remove("compact-view");
    }

    // Animations / reduced motion
    if (!settings.showAnimations || settings.reducedMotion) {
      root.classList.add("no-animations");
    } else {
      root.classList.remove("no-animations");
    }

    // Large text
    if (settings.largeText) {
      root.classList.add("large-text");
    } else {
      root.classList.remove("large-text");
    }

    // High contrast
    if (settings.highContrast) {
      root.classList.add("high-contrast");
    } else {
      root.classList.remove("high-contrast");
    }

    // Screen reader optimized
    if (settings.screenReaderOptimized) {
      root.classList.add("sr-optimized");
    } else {
      root.classList.remove("sr-optimized");
    }

    if (user) {
      localStorage.setItem(`footystatus_settings:${user.id}`, JSON.stringify(settings));
    }
  }, [settings, user?.id]);

  const saveToDb = useCallback(
    async (partial: Partial<UserSettings>) => {
      if (!user) return;
      const { error } = await supabase
        .from("user_settings")
        .update(toDbRecord(partial))
        .eq("user_id", user.id);

      if (error) {
        console.error("Failed to save settings:", error);
        toast({
          title: "Error saving settings",
          description: "Your changes could not be saved. Please try again.",
          variant: "destructive",
        });
        // Rollback: reload from DB
        const { data } = await supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        if (data) {
          setSettings(fromDbRecord(data as Record<string, unknown>));
        }
      }
    },
    [user]
  );

  const updateSetting = useCallback(
    (key: keyof UserSettings, value: boolean | string) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      saveToDb({ [key]: value });
    },
    [saveToDb]
  );

  const updateSettings = useCallback(
    (partial: Partial<UserSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }));
      saveToDb(partial);
    },
    [saveToDb]
  );

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
