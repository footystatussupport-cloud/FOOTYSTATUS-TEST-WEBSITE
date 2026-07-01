import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const normalizeRole = (value?: string | null) => {
  if (!value) return null;
  const role = String(value).trim();
  if (role === "coach") return "head_coach_assistant";
  if (role === "team") return "team_club";
  if (role === "club") return "team_club";
  if (role === "school") return "school_team";
  return role;
};

// A profile is considered complete when it has all required fields set.
// Referee accounts also require referee-specific fields.
const isProfileComplete = (profile: any): boolean => {
  if (!profile) return false;
  const hasBase = Boolean(
    profile.username &&
    profile.account_role &&
    profile.account_type &&
    profile.account_category
  );
  if (!hasBase) return false;

  const role = normalizeRole(profile.account_role || profile.account_type || profile.role);
  if (role === "referee") {
    return Boolean(
      profile.referee_certification_level &&
      profile.referee_certifying_organization &&
      profile.referee_years_experience != null
    );
  }

  return true;
};

const SIGNUP_FLOW_STORAGE_KEY = "footystatus_signup_flow";

const getPendingSignupRole = (): string | null => {
  if (typeof window === "undefined") return null;
  const raw =
    window.localStorage.getItem(SIGNUP_FLOW_STORAGE_KEY) ||
    window.sessionStorage.getItem(SIGNUP_FLOW_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.pendingGoogleAuth ? normalizeRole(parsed.selectedRole) ?? parsed.accountType ?? "unknown" : null;
  } catch {
    return null;
  }
};

const OnboardingGate = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [checkPassedPath, setCheckPassedPath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const isAuthPage = location.pathname === "/auth";
  // Synchronous – computed every render so it never lags behind the current path
  const checkPassed = checkPassedPath === location.pathname;
  // Also synchronous – if localStorage says we're mid-signup, block immediately
  const pendingRole = !isAuthPage ? getPendingSignupRole() : null;

  useEffect(() => {
    if (loading) return;
    if (isAuthPage) {
      setCheckPassedPath(location.pathname);
      return;
    }
    if (!user) {
      setCheckPassedPath(location.pathname);
      return;
    }

    let active = true;

    const runCheck = async () => {
      setChecking(true);

      // If localStorage says the user is mid-Google-signup, send them to finish
      // it regardless of their profile state. This catches cases where Supabase
      // redirected OAuth back to "/" instead of "/auth?mode=signup".
      const pendingRole = getPendingSignupRole();
      if (pendingRole) {
        if (active) { navigate("/auth?mode=signup", { replace: true }); setChecking(false); }
        return; // pendingRole is already blocking render synchronously above
      }

      const onboardingComplete = user?.user_metadata?.onboarding_complete;

      // Fast path: flag is explicitly true — profile is complete, no DB query needed.
      if (onboardingComplete === true && !pendingRole) {
        if (active) { setCheckPassedPath(location.pathname); setChecking(false); }
        return;
      }

      // onboarding_complete is false or undefined.
      // false  → we set this explicitly when Google OAuth returned or email signUp ran.
      // undefined → legacy user who signed up before this flag existed.
      // Either way: query the DB to confirm completeness.
      // (Also handles the rare race condition where the flag update resolves after navigate("/").)
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select(
          "user_id, username, account_category, account_type, account_role, role, " +
          "referee_certification_level, referee_certifying_organization, referee_years_experience"
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.warn("OnboardingGate: could not verify profile, redirecting to signup", error);
        if (active) { navigate("/auth?mode=signup", { replace: true }); setChecking(false); }
        return;
      }

      if (!isProfileComplete(data)) {
        // Genuinely incomplete signup — block access.
        if (active) { navigate("/auth?mode=signup", { replace: true }); setChecking(false); }
        return;
      }

      // Profile is complete. Auto-upgrade the flag so future page loads skip the DB query.
      if (onboardingComplete !== true) {
        supabase.auth.updateUser({ data: { onboarding_complete: true } }).catch(() => {});
      }

      if (active) { setCheckPassedPath(location.pathname); setChecking(false); }
    };

    runCheck();

    return () => {
      active = false;
    };
  }, [
    loading,
    user?.id,
    user?.user_metadata?.onboarding_complete,
    location.pathname,
    navigate,
    isAuthPage,
  ]);

  // Block rendering synchronously when:
  // - a Google OAuth signup is in progress (pendingRole from localStorage)
  // - the gate check hasn't passed yet for this path
  if (!isAuthPage && (pendingRole || checking || (!checkPassed && Boolean(user) && !loading))) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-5">
        <div className="text-center text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
};

export default OnboardingGate;
