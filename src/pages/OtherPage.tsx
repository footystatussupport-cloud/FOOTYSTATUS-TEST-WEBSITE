import { useEffect, useState } from "react";
import { User, Settings, Info, HelpCircle, Shield, LogOut, ChevronRight, Trophy, Crown, BarChart3 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { fetchMatchAdminContext } from "@/lib/matches";
import { FOOTY_STATUS_SUPER_ADMIN_EMAIL } from "@/lib/superAdmin";
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
  { icon: Crown, label: "FootyStatus Pro", path: "/pro", description: "Upgrade clips, analytics, and visibility" },
  { icon: BarChart3, label: "Profile Analytics", path: "/analytics", description: "See who is viewing your profile" },
  { icon: Settings, label: "Settings", path: "/settings", description: "App preferences and notification controls" },
  { icon: Shield, label: "Privacy & Security", path: "/privacy", description: "Privacy settings" },
  { icon: HelpCircle, label: "Help & Support", path: "/support", description: "Get help" },
  { icon: Info, label: "About", path: "/about", description: "About FootyStatus" },
];

const OtherPage = () => {
  const navigate = useNavigate();
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showLeagueOperations, setShowLeagueOperations] = useState(false);

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
            {menuItems.map(({ icon: Icon, label, path, description }) => (
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
            onClick={() => setShowLogoutDialog(true)}
            className="flex items-center gap-4 p-4 w-full mt-6 text-accent hover:bg-accent/10 rounded-xl transition-colors"
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
