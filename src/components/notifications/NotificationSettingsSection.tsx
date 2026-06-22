import { Bell, Mail, Smartphone, Users, Shield, Megaphone, Volume2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";

const notificationSettings = [
  {
    id: "pushNotifications",
    label: "Push Notifications",
    description: "Receive notification alerts on this device.",
    icon: Bell,
  },
  {
    id: "inAppNotifications",
    label: "In-App Notifications",
    description: "Show updates inside the Footy app.",
    icon: Smartphone,
  },
  {
    id: "emailNotifications",
    label: "Email Notifications",
    description: "Receive email updates for important activity.",
    icon: Mail,
  },
  {
    id: "messageNotifications",
    label: "Team Invites & Requests",
    description: "Get alerts for team invites, joins, and roster actions.",
    icon: Users,
  },
  {
    id: "matchAlerts",
    label: "Match & Activity Updates",
    description: "Be notified about match alerts and team activity.",
    icon: Shield,
  },
  {
    id: "clipNotifications",
    label: "Club News / Clip Updates",
    description: "Receive club news, content, and update alerts.",
    icon: Megaphone,
  },
  {
    id: "soundEffects",
    label: "Sound Alerts",
    description: "Play a sound for supported notification events.",
    icon: Volume2,
  },
  {
    id: "vibration",
    label: "Vibration",
    description: "Use haptics for supported notification events.",
    icon: Smartphone,
  },
  {
    id: "emailDigest",
    label: "Weekly Email Digest",
    description: "Receive a weekly roundup of your account activity.",
    icon: Mail,
  },
] as const;

const NotificationSettingsSection = () => {
  const { settings, updateSetting, loading } = useSettings();

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-navy mb-2">Notifications</h2>
      <div className="bg-card border border-border rounded-xl px-4">
        {notificationSettings.map((item, index) => {
          const Icon = item.icon;
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between py-4 gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <div className="text-muted-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor={item.id} className="text-base font-medium cursor-pointer">
                      {item.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <Switch
                  id={item.id}
                  checked={settings[item.id]}
                  onCheckedChange={(checked) => updateSetting(item.id, checked)}
                  disabled={loading}
                />
              </div>
              {index < notificationSettings.length - 1 ? <Separator /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default NotificationSettingsSection;
