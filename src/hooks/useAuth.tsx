import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: {
    user_id: string | null;
    account_category: string | null;
    account_role: string | null;
    role: string | null;
    player_gender: "boy" | "girl" | null;
  } | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async (nextUser: User | null) => {
      if (!nextUser) {
        setProfile(null);
        return;
      }

      const { data } = await (supabase as any)
        .from("profiles")
        .select("user_id, account_category, account_role, role")
        .eq("user_id", nextUser.id)
        .maybeSingle();

      const resolvedAccountRole =
        data?.account_role ||
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

      setProfile(
        data
          ? {
              user_id: data.user_id,
              account_category:
                data.account_category ||
                (data.role === "player" ? "player" : data.role === "parent" ? "parent" : data.role === "referee" ? "referee" : "team_staff"),
              account_role: resolvedAccountRole,
              role: data.role,
              player_gender: playerProfile?.player_gender || null,
            }
          : null
      );
    };

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

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
