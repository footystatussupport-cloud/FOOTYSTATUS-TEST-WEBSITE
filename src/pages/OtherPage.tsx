import { useEffect, useState } from "react";
import { User, Settings, Info, HelpCircle, Shield, LogOut, ChevronRight, Trophy, Crown, BarChart3, Heart, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { fetchMatchAdminContext } from "@/lib/matches";
import { isProEligible } from "@/lib/subscriptions";
import { FOOTY_STATUS_SUPER_ADMIN_EMAIL } from "@/lib/superAdmin";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
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

const menuItems = [
  { icon: User, label: "User Profile", path: "/profile", description: "View and edit your profile" },
  { icon: Heart, label: "Liked Videos", path: "/liked-videos", description: "Your favorite Next Up clips, all in one place" },
  { icon: Crown, label: "FootyStatus Pro", path: "/pro", description: "Upgrade clips, analytics, and visibility", playerOnly: true },
  { icon: BarChart3, label: "Profile Analytics", path: "/analytics", description: "See who is viewing your profile tiles", playerOnly: true },
  { icon: Settings, label: "Settings", path: "/settings", description: "App preferences and notification controls" },
  { icon: Shield, label: "Privacy & Security", path: "/privacy", description: "Privacy settings" },
  { icon: HelpCircle, label: "Help & Support", path: "/support", description: "Get help" },
  { icon: Info, label: "About", path: "/about", description: "About FootyStatus" },
];

const OtherPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, loading: authLoading } = useAuth();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [showLeagueOperations, setShowLeagueOperations] = useState(false);
  const showPlayerProOptions = !authLoading && isProEligible(profile);
  const visibleMenuItems = menuItems.filter((item) => !item.playerOnly || showPlayerProOptions);

  useEffect(() => {
    const loadAdminAccess = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        setShowLeagueOperations(false);
        return;
      }

      const adminContext = await fetchMatchAdminContext(session.user.id, session.user.email || null);
      setShowLeagueOperations(adminContext.isMatchAdmin);
    };

    loadAdminAccess();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "global" });
    Object.keys(localStorage)
      .filter((key) => key.startsWith("sb-") || key.includes("supabase"))
      .forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem("footystatus_signup_flow");
    navigate("/");
  };

  // Clear cached app data while keeping the user signed in (preserves the
  // Supabase auth tokens in local/session storage).
  const getAuthStorageEntries = (storage: Storage) =>
    Object.keys(storage)
      .filter((key) => {
        const normalizedKey = key.toLowerCase();
        return key.startsWith("sb-") || normalizedKey.includes("supabase");
      })
      .map((key) => [key, storage.getItem(key) ?? ""] as const);

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const localAuthEntries = getAuthStorageEntries(localStorage);
      const sessionAuthEntries = getAuthStorageEntries(sessionStorage);

      Object.keys(localStorage).forEach((key) => localStorage.removeItem(key));
      Object.keys(sessionStorage).forEach((key) => sessionStorage.removeItem(key));

      localAuthEntries.forEach(([key, value]) => localStorage.setItem(key, value));
      sessionAuthEntries.forEach(([key, value]) => sessionStorage.setItem(key, value));

      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      }

      await supabase.auth.getSession();

      toast({
        title: "Cache cleared",
        description: "Temporary app data was refreshed. You are still signed in.",
      });
    } catch (error) {
      console.error("Clear cache failed", error);
      toast({
        title: "Could not clear cache",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
        <Header />
        
        <div className="px-4 py-6">
          <Link 
            to="/"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            ← Back to Home
          </Link>
          
          <h1 className="text-xl font-bold mb-6">More Options</h1>

          {showLeagueOperations ? (
            <button
              onClick={() => navigate("/?tab=matches")}
              className="flex items-center justify-between p-4 mb-4 w-full bg-card border border-border rounded-xl hover:bg-muted transition-colors text-left"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                  <Trophy className="h-5 w-5 text-navy" />
                </div>
                <div>
                  <p className="font-medium">Footy Status HQ</p>
                  <p className="text-xs text-muted-foreground">Exclusive super-admin tools for {FOOTY_STATUS_SUPER_ADMIN_EMAIL}</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          ) : null}
          
          <div className="space-y-2">
            {visibleMenuItems.map(({ icon: Icon, label, path, description }) => (
              <Link
                key={label}
                to={path}
                className="flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                    <Icon className="h-5 w-5 text-navy" />
                  </div>
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </Link>
            ))}
          </div>

          <button
            onClick={handleClearCache}
            disabled={clearingCache}
            className="flex items-center gap-4 p-4 w-full mt-6 bg-card border border-border rounded-xl hover:bg-muted transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
              <RefreshCw className={`h-5 w-5 text-navy ${clearingCache ? "animate-spin" : ""}`} />
            </div>
            <div>
              <p className="font-medium">{clearingCache ? "Clearing..." : "Clear Cache"}</p>
              <p className="text-xs text-muted-foreground">Refresh app data and free up space — you stay signed in</p>
            </div>
          </button>

          <button
            onClick={() => setShowLogoutDialog(true)}
            className="flex items-center gap-4 p-4 w-full mt-2 text-accent hover:bg-accent/10 rounded-xl transition-colors"
          >
            <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center">
              <LogOut className="h-5 w-5" />
            </div>
            <span className="font-medium">Log Out</span>
          </button>
        </div>
      </div>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to access your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>Logout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OtherPage;
