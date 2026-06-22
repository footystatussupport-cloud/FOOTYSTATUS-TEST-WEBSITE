import { useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

interface ModerationStatus {
  banned: boolean;
  strike_count: number;
  warning?: string | null;
  ban_end_at?: string | null;
  ban_reason?: string | null;
}
const formatRemaining = (endAt?: string | null) => {
  if (!endAt) return "";
  const seconds = Math.max(0, Math.floor((new Date(endAt).getTime() - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`;
};

const AccountModerationGate = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user || isFootyStatusSuperAdminEmail(user.email)) { setStatus(null); return; }
    let active = true;
    const load = async () => {
      const { data } = await (supabase as any).rpc("get_my_moderation_status");
      if (active && data) setStatus(data as ModerationStatus);
    };
    load();
    const timer = window.setInterval(() => { setTick((value) => value + 1); load(); }, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, user?.email]);

  useEffect(() => {
    if (!status?.banned) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [status?.banned]);

  const remaining = useMemo(() => formatRemaining(status?.ban_end_at), [status?.ban_end_at, tick]);
  if (loading || !user || !status) return <>{children}</>;

  if (status.banned) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5">
      <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-6 text-center shadow-lg">
        <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
        <h1 className="mt-4 text-2xl font-bold">Account Temporarily Banned</h1>
        <p className="mt-2 text-sm text-muted-foreground">{status.ban_reason || "This account is temporarily unavailable."}</p>
        <div className="mt-5 rounded-xl bg-muted p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Time remaining</p><p className="mt-1 text-xl font-bold text-foreground">{remaining}</p></div>
        <p className="mt-4 text-xs text-muted-foreground">Your account will automatically become available when the full ban period ends.</p>
        <Button variant="outline" className="mt-5 w-full" onClick={() => supabase.auth.signOut({ scope: "global" })}>Sign Out</Button>
      </div>
    </div>;
  }

  return <>
    {status.strike_count >= 2 && status.warning ? <div className="sticky top-0 z-[100] border-b border-destructive/30 bg-destructive px-4 py-2 text-center text-xs font-medium text-white">{status.warning}</div> : null}
    {children}
  </>;
};
export default AccountModerationGate;