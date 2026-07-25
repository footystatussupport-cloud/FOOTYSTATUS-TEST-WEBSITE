import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/footystatus-logo.png";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

const Header = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) fetchAvatar(session.user.id);
      }
    );
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchAvatar(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchAvatar = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('avatar_url').eq('user_id', userId).single();
    if (data?.avatar_url) setAvatarUrl(data.avatar_url);
  };

  const isFootyStatusHQ = isFootyStatusSuperAdminEmail(user?.email);

  return (
    <header
      className="flex w-full max-w-full items-center justify-between gap-2 overflow-hidden border-b border-border bg-background px-2 pb-2 sm:px-3 sm:pb-2.5"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <img src={logo} alt="FootyStatus" className="block h-12 w-auto max-w-full object-contain sm:h-14" />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {user ? (
          <>
            <NotificationBell userId={user.id} />
            <button
              onClick={() => navigate("/profile")}
              className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${isFootyStatusHQ ? "bg-navy ring-2 ring-navy ring-offset-2 ring-offset-background" : "bg-navy"}`}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="h-5 w-5 text-white" />
              )}
            </button>
          </>
        ) : (
          <>
            <Button variant="outline" className="h-9 shrink-0 whitespace-nowrap rounded-full border-2 border-foreground px-4 text-sm font-semibold" onClick={() => navigate("/auth")}>
              Login
            </Button>
            <Button className="h-9 shrink-0 whitespace-nowrap rounded-full border-2 border-navy bg-navy px-4 text-sm font-semibold hover:bg-navy-light" onClick={() => navigate("/auth?mode=signup")}>
              Sign Up
            </Button>
          </>
        )}
      </div>
    </header>
  );
};

export default Header;
