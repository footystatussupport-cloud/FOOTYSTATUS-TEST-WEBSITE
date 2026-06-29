import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: {
    user_id: string | null;
    account_category: string | null;
    account_type: string | null;
    account_role: string | null;
    role: string | null;
    player_gender: "boy" | "girl" | null;
  } | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => undefined,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (nextUser: User | null) => {
      if (!nextUser) {
        setProfile(null);
        return;
      }

      let { data, error } = await (supabase as any)
        .from("profiles")
        .select("user_id, account_category, account_type, account_role, role")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      if (error?.message?.includes("account_type")) {
        const fallback = await (supabase as any)
          .from("profiles")
          .select("user_id, account_category, account_role, role")
          .eq("user_id", nextUser.id)
          .maybeSingle();
        data = fallback.data ? { ...fallback.data, account_type: null } : null;
        error = fallback.error;
      }

      if (error) {
        console.warn("Could not load auth profile", error);
      }

      const resolvedAccountRole =
        data?.account_role ||
        data?.account_type ||
        (data?.role === "team"
          ? "team_club"
          : data?.role === "coach"
            ? "head_coach_assistant"
            : data?.role === "referee"
              ? "referee"
              : data?.role);
      const { data: playerProfile } = resolvedAccountRole === "player"
        ? await (supabase as any)
            .from("player_profiles")
            .select("player_gender")
            .eq("user_id", nextUser.id)
            .maybeSingle()
        : { data: null };

      const nextProfile =
        data
          ? {
              user_id: data.user_id,
              account_category:
                data.account_category ||
                (resolvedAccountRole === "player"
                  ? "player"
                  : resolvedAccountRole === "parent"
                    ? "parent"
                    : resolvedAccountRole === "referee"
                      ? "referee"
                      : "team_staff"),
              account_type: data.account_type || resolvedAccountRole,
              account_role: resolvedAccountRole,
              role: data.role,
              player_gender: playerProfile?.player_gender || null,
            }
          : null;

      console.info("Footy Status auth profile loaded", {
        authUserId: nextUser.id,
        accountCategory: nextProfile?.account_category || null,
        accountType: nextProfile?.account_type || null,
        accountRole: nextProfile?.account_role || null,
        legacyRole: nextProfile?.role || null,
      });

      setProfile(nextProfile);
  };

  const refreshProfile = async () => {
    await loadProfile(user);
  };

  useEffect(() => {
    const handleProfileRefresh = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        loadProfile(session?.user ?? null).finally(() => setLoading(false));
      });
    };

    window.addEventListener("footy-status-profile-refresh", handleProfileRefresh);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        loadProfile(session?.user ?? null).finally(() => setLoading(false));
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      loadProfile(session?.user ?? null).finally(() => setLoading(false));
    });

    return () => {
      window.removeEventListener("footy-status-profile-refresh", handleProfileRefresh);
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
