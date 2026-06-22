import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/footystatus-logo.png";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";
import NotificationBell from "@/components/notifications/NotificationBell";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Header = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

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

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "global" });
    Object.keys(localStorage)
      .filter((key) => key.startsWith("sb-") || key.includes("supabase"))
      .forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem("footystatus_signup_flow");
    setUser(null);
    setAvatarUrl(null);
    setShowLogoutDialog(false);
    navigate("/");
  };

  const isFootyStatusHQ = isFootyStatusSuperAdminEmail(user?.email);

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <img src={logo} alt="FootyStatus" className="h-28 w-auto object-contain" />
        <div className="flex items-center justify-end gap-2.5">
          {user ? (
            <>
              <NotificationBell userId={user.id} />
              <button
                onClick={() => navigate("/profile")}
                className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ${isFootyStatusHQ ? "bg-navy ring-2 ring-navy ring-offset-2 ring-offset-background" : "bg-navy"}`}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="h-5 w-5 text-white" />
                )}
              </button>
              <Button
                variant="outline"
                className="h-10 rounded-full border-2 border-foreground px-4 font-semibold"
                onClick={() => setShowLogoutDialog(true)}
              >
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="rounded-full px-5 font-semibold border-2 border-foreground" onClick={() => navigate("/auth")}>
                Login
              </Button>
              <Button className="rounded-full px-5 font-semibold bg-navy hover:bg-navy-light border-2 border-navy" onClick={() => navigate("/auth?mode=signup")}>
                Sign Up
              </Button>
            </>
          )}
        </div>
      </header>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
            <AlertDialogDescription>You will need to sign in again to access your account.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>Logout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Header;
