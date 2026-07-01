import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/footystatus-logo.png";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import AccountTypeSelector from "@/components/signup/AccountTypeSelector";
import StaffTypeSelector from "@/components/signup/StaffTypeSelector";
import PlayerProfileForm from "@/components/signup/PlayerProfileForm";
import TeamProfileForm from "@/components/signup/TeamProfileForm";
import StaffProfileForm from "@/components/signup/StaffProfileForm";
import ParentProfileForm from "@/components/signup/ParentProfileForm";
import RefereeProfileForm from "@/components/signup/RefereeProfileForm";
import AuthMethodSelector from "@/components/signup/AuthMethodSelector";
import { buildAppUrl } from "@/lib/appOrigin";
import { isEmbeddedBrowser } from "@/lib/browserContext";
import { formatRoleDisplayLabel } from "@/lib/coachStaffTeams";
import { getUsernameErrorMessage, normalizeUsername, validateUsername } from "@/lib/usernames";
import { z } from "zod";

type SignupStep = 'account_type' | 'staff_type' | 'auth_method' | 'profile_form';
type AccountType = 'player' | 'team_staff' | 'parent' | 'referee';
type StaffType = 'team_club' | 'school_team' | 'head_coach_assistant' | 'scout' | 'academy_director';

const VALID_SIGNUP_ROLES = new Set([
  "player",
  "parent",
  "referee",
  "team_club",
  "school_team",
  "head_coach_assistant",
  "scout",
  "trainer",
  "academy_director",
  "footy_status_official",
]);

const emailPasswordSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address."),
});

const getAuthErrorMessage = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof (error as any)?.message === "string"
          ? (error as any).message
          : typeof (error as any)?.error_description === "string"
            ? (error as any).error_description
            : typeof (error as any)?.details === "string"
              ? (error as any).details
              : "Something went wrong. Please try again.";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("username already taken") || lowerMessage.includes("username is already taken")) {
    return "Username already taken. Please choose another.";
  }

  if (lowerMessage.includes("already") || lowerMessage.includes("registered") || lowerMessage.includes("exists")) {
    return "An account with this email already exists. Please sign in instead.";
  }

  if (lowerMessage.includes("password")) {
    return message;
  }

  return message;
};

const SIGNUP_FLOW_STORAGE_KEY = "footystatus_signup_flow";

const GOOGLE_SESSION_MISSING_MESSAGE = "Google sign-up did not finish correctly. Please go back, choose your account type, and continue with Google again.";

const clearStoredAuthSession = () => {
  Object.keys(localStorage)
    .filter((key) => key.startsWith("sb-") || key.includes("supabase"))
    .forEach((key) => localStorage.removeItem(key));
};

const splitCommaValues = (value?: string | null) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) || [];

const normalizeEmailValue = (value?: string | null) => String(value || "").trim().toLowerCase();

const getMissingTeamsColumnFromError = (error: any) => {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    message.match(/Could not find the '([^']+)' column of 'teams'/i)?.[1] ||
    message.match(/column "([^"]+)" of relation "teams" does not exist/i)?.[1] ||
    message.match(/column '([^']+)' of relation 'teams' does not exist/i)?.[1] ||
    null
  );
};

const stripMissingTeamsColumnsAndRetry = async (
  payload: Record<string, any>,
  runQuery: (nextPayload: Record<string, any>) => Promise<any>
) => {
  let nextPayload = { ...payload };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    console.info("Saving teams payload", {
      attempt: attempt + 1,
      payload: nextPayload,
      removedInvalidColumns: removedColumns,
    });
    const result = await runQuery(nextPayload);
    const missingColumn = getMissingTeamsColumnFromError(result.error);

    if (!missingColumn || !(missingColumn in nextPayload)) {
      return result;
    }

    console.warn("Removing invalid teams column and retrying", {
      missingColumn,
      originalError: result.error,
    });
    removedColumns.push(missingColumn);
    const { [missingColumn]: _removed, ...cleanPayload } = nextPayload;
    nextPayload = cleanPayload;
  }

  return runQuery(nextPayload);
};

const getMissingProfilesColumnFromError = (error: any) => {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    message.match(/Could not find the '([^']+)' column of 'profiles'/i)?.[1] ||
    message.match(/column "([^"]+)" of relation "profiles" does not exist/i)?.[1] ||
    message.match(/column '([^']+)' of relation 'profiles' does not exist/i)?.[1] ||
    null
  );
};

const stripMissingProfilesColumnsAndRetry = async (
  payload: Record<string, any>,
  runQuery: (nextPayload: Record<string, any>) => Promise<any>
) => {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await runQuery(nextPayload);
    const missingColumn = getMissingProfilesColumnFromError(result.error);

    if (!missingColumn || !(missingColumn in nextPayload)) {
      return result;
    }

    console.warn("Removing invalid profiles column and retrying", {
      missingColumn,
      originalError: result.error,
    });
    const { [missingColumn]: _removed, ...cleanPayload } = nextPayload;
    nextPayload = cleanPayload;
  }

  return runQuery(nextPayload);
};

const mapRoleForLegacyBackend = (role: string) => {
  switch (role) {
    case "team_club":
      return "team";
    case "school_team":
      return "team";
    case "referee":
      return "referee";
    case "head_coach_assistant":
      return "coach";
    default:
      return role;
  }
};

const getLegacyRoleForAccountRole = (role: string) => mapRoleForLegacyBackend(role);

const getAccountCategoryForRole = (role: string) => {
  if (role === "player") return "player";
  if (role === "parent") return "parent";
  if (role === "referee") return "referee";
  return "team_staff";
};

const getSignupRoleFromSelection = (
  selectedAccountType: AccountType | null,
  selectedStaffType: StaffType | null
) => {
  if (selectedAccountType === "player") return "player";
  if (selectedAccountType === "parent") return "parent";
  if (selectedAccountType === "referee") return "referee";
  if (selectedAccountType === "team_staff") return selectedStaffType;
  return null;
};

const getSignupSelectionFromRole = (role?: string | null): { accountType: AccountType | null; staffType: StaffType | null } => {
  switch (role) {
    case "player":
      return { accountType: "player", staffType: null };
    case "parent":
      return { accountType: "parent", staffType: null };
    case "referee":
      return { accountType: "referee", staffType: null };
    case "team_club":
    case "school_team":
    case "head_coach_assistant":
    case "scout":
    case "academy_director":
      return { accountType: "team_staff", staffType: role };
    case "coach":
      return { accountType: "team_staff", staffType: "head_coach_assistant" };
    case "team":
    case "club":
      return { accountType: "team_staff", staffType: "team_club" };
    case "school":
      return { accountType: "team_staff", staffType: "school_team" };
    default:
      return { accountType: null, staffType: null };
  }
};

const getStoredSignupFlow = () => {
  const savedFlow = sessionStorage.getItem(SIGNUP_FLOW_STORAGE_KEY) || localStorage.getItem(SIGNUP_FLOW_STORAGE_KEY);
  if (!savedFlow) return null;

  try {
    return JSON.parse(savedFlow) as {
      accountType?: AccountType | null;
      staffType?: StaffType | null;
      selectedRole?: string | null;
      pendingGoogleAuth?: boolean;
    };
  } catch {
    return null;
  }
};

const hasSignupValue = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? "").trim().length > 0;
};

const getSignupRequiredFieldLabel = (role: string, profileData: any, normalizedEmail: string, password: string, signupMethod: "email" | "google") => {
  const missing: string[] = [];

  if (!role || !VALID_SIGNUP_ROLES.has(role)) missing.push("Account type");
  if (!hasSignupValue(profileData?.username)) missing.push("Username");
  if (signupMethod === "email") {
    if (!hasSignupValue(normalizedEmail)) missing.push("Email");
    if (!hasSignupValue(password)) missing.push("Password");
  }

  const contactEmail = profileData?.contactEmail || normalizedEmail;

  if (role === "player") {
    if (!hasSignupValue(profileData?.fullName)) missing.push("Full name");
    if (!hasSignupValue(profileData?.gender)) missing.push("Player gender");
    if (!hasSignupValue(profileData?.dateOfBirth)) missing.push("Date of birth");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "parent") {
    if (!hasSignupValue(profileData?.fullName)) missing.push("Full name");
    if (!hasSignupValue(profileData?.relationshipToPlayer)) missing.push("Relationship to player");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "referee") {
    if (!hasSignupValue(profileData?.fullName)) missing.push("Full name");
    if (!hasSignupValue(profileData?.refereeCertificationLevel)) missing.push("Certification level");
    if (!hasSignupValue(profileData?.refereeCertifyingOrganization)) missing.push("Certifying organization");
    if (!hasSignupValue(profileData?.refereeYearsExperience)) missing.push("Years of experience");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "team_club") {
    if (!hasSignupValue(profileData?.clubName)) missing.push("Team or club name");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "school_team") {
    if (!hasSignupValue(profileData?.schoolName)) missing.push("School team name");
    if (!hasSignupValue(profileData?.teamMascot)) missing.push("Mascot");
    if (!hasSignupValue(profileData?.leagueConference)) missing.push("League or conference");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "head_coach_assistant" || role === "coach" || role === "trainer" || role === "team_staff" || role === "academy_director") {
    if (!hasSignupValue(profileData?.fullName)) missing.push("Full name");
    if (!hasSignupValue(profileData?.coachingRoleType)) missing.push("Role");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  } else if (role === "scout") {
    if (!hasSignupValue(profileData?.fullName)) missing.push("Full name");
    if (!hasSignupValue(profileData?.scoutRoleTitle)) missing.push("Scout role");
    if (!hasSignupValue(profileData?.scoutOrganization)) missing.push("Scout organization");
    if (!hasSignupValue(contactEmail)) missing.push("Contact email");
  }

  return missing[0] || null;
};

const verifySignupAccountPersistence = async (
  sessionUserId: string,
  expectedRole: string,
  expectedUsername?: string,
  expectedContactEmail?: string | null,
  expectedProfileData?: any
) => {
  const { data: savedProfile, error: profileError } = await (supabase as any)
    .from("profiles")
    .select("user_id, email, full_name, username, account_category, account_type, account_role, role, club_name, team_name, coaching_role_type, scout_role_title, referee_certification_level, referee_license_number, referee_certifying_organization, referee_years_experience, referee_main_experience, referee_assistant_experience, referee_leagues_tournaments, referee_availability, referee_accolades, referee_profile_public")
    .eq("user_id", sessionUserId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!savedProfile) throw new Error("Profile was not created after signup.");

  const actualRole = savedProfile.account_role || savedProfile.account_type;
  if (actualRole !== expectedRole) {
    console.error("Footy Status signup role verification failed", {
      authUserId: sessionUserId,
      expectedRole,
      savedProfile,
    });
    throw new Error(`Signup saved the wrong account type. Expected ${expectedRole}, got ${actualRole || "empty"}.`);
  }

  if (expectedUsername && savedProfile.username !== expectedUsername) {
    console.error("Footy Status signup username verification failed", {
      authUserId: sessionUserId,
      expectedUsername,
      savedUsername: savedProfile.username,
      savedProfile,
    });
    throw new Error("Signup saved the wrong username. Please try again.");
  }

  let roleSpecificRow: any = null;
  let roleSpecificError: any = null;

  if (["head_coach_assistant", "coach", "scout", "academy_director", "team_staff", "trainer"].includes(expectedRole)) {
    const result = await (supabase as any)
      .from("staff_profiles")
      .select("*")
      .eq("user_id", sessionUserId)
      .maybeSingle();
    roleSpecificRow = result.data;
    roleSpecificError = result.error;
  } else if (expectedRole === "team_club" || expectedRole === "school_team") {
    const result = await (supabase as any)
      .from("team_profiles")
      .select("*")
      .eq("user_id", sessionUserId)
      .maybeSingle();
    roleSpecificRow = result.data;
    roleSpecificError = result.error;
  } else if (expectedRole === "parent") {
    const result = await (supabase as any)
      .from("parent_profiles")
      .select("*")
      .eq("user_id", sessionUserId)
      .maybeSingle();
    roleSpecificRow = result.data;
    roleSpecificError = result.error;
  } else if (expectedRole === "player") {
    const result = await (supabase as any)
      .from("player_profiles")
      .select("*")
      .eq("user_id", sessionUserId)
      .maybeSingle();
    roleSpecificRow = result.data;
    roleSpecificError = result.error;
  } else if (expectedRole === "referee") {
    roleSpecificRow = savedProfile.referee_certification_level || savedProfile.account_role === "referee" ? savedProfile : null;
  }

  if (roleSpecificError) throw roleSpecificError;

  if (expectedRole !== "referee" && !roleSpecificRow) {
    console.error("Footy Status signup role-specific row missing", {
      authUserId: sessionUserId,
      expectedRole,
      savedProfile,
    });
    throw new Error(`Signup did not create the ${expectedRole} profile record.`);
  }

  const normalizedExpectedContactEmail = normalizeEmailValue(expectedContactEmail);
  if (normalizedExpectedContactEmail) {
    const savedContactEmail = normalizeEmailValue(roleSpecificRow?.contact_email || savedProfile.email);
    if (savedContactEmail !== normalizedExpectedContactEmail) {
      console.error("Footy Status signup contact verification failed", {
        authUserId: sessionUserId,
        expectedRole,
        expectedContactEmail: normalizedExpectedContactEmail,
        savedContactEmail,
        savedProfile,
        roleSpecificRow,
      });
      throw new Error("Signup did not save the contact email correctly. Please try again.");
    }
  }

  if (expectedRole === "referee") {
    const expectedYears = expectedProfileData?.refereeYearsExperience ? Number(expectedProfileData.refereeYearsExperience) : null;
    const refereeChecks: Array<[string, unknown, unknown]> = [
      ["Certification level", expectedProfileData?.refereeCertificationLevel || null, savedProfile.referee_certification_level || null],
      ["License number", expectedProfileData?.refereeLicenseNumber || null, savedProfile.referee_license_number || null],
      ["Certifying organization", expectedProfileData?.refereeCertifyingOrganization || null, savedProfile.referee_certifying_organization || null],
      ["Years experience", expectedYears, savedProfile.referee_years_experience ?? null],
      ["Main referee experience", expectedProfileData?.refereeMainExperience || null, savedProfile.referee_main_experience || null],
      ["Assistant referee experience", expectedProfileData?.refereeAssistantExperience || null, savedProfile.referee_assistant_experience || null],
      ["Leagues / tournaments", expectedProfileData?.refereeLeaguesTournaments || null, savedProfile.referee_leagues_tournaments || null],
      ["Availability", expectedProfileData?.refereeAvailability || null, savedProfile.referee_availability || null],
      ["Accolades", expectedProfileData?.refereeAccolades || null, savedProfile.referee_accolades || null],
    ];

    const failedRefereeCheck = refereeChecks.find(([, expected, actual]) => {
      if (expected === null || expected === undefined || expected === "") return false;
      return String(expected).trim() !== String(actual ?? "").trim();
    });

    if (failedRefereeCheck) {
      console.error("Footy Status referee signup verification failed", {
        authUserId: sessionUserId,
        field: failedRefereeCheck[0],
        expected: failedRefereeCheck[1],
        actual: failedRefereeCheck[2],
        savedProfile,
      });
      throw new Error(`Signup did not save referee ${failedRefereeCheck[0].toLowerCase()} correctly. Please try again.`);
    }
  }

  console.info("Footy Status signup persistence verified", {
    authUserId: sessionUserId,
    expectedRole,
    savedProfile,
    roleSpecificRow,
  });
};

const saveSignupContactRows = async (
  userId: string,
  contactEmail?: string | null,
  contactPhone?: string | null
) => {
  const entries: Array<[string, string]> = [
    ["player_email", contactEmail?.trim().toLowerCase() || ""],
    ["player_phone", contactPhone?.trim() || ""],
  ].filter(([, value]) => value.length > 0);

  for (const [contactType, value] of entries) {
    const existing = await (supabase as any)
      .from("user_contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("contact_type", contactType)
      .maybeSingle();

    if (existing.error) throw existing.error;

    const payload = {
      user_id: userId,
      contact_type: contactType,
      value,
      visibility: "public",
    };

    const saveResult = existing.data?.id
      ? await (supabase as any).from("user_contacts").update(payload).eq("id", existing.data.id)
      : await (supabase as any).from("user_contacts").insert(payload);

    if (saveResult.error) throw saveResult.error;
  }
};

const getTakenUsernameOwner = async (username: string, currentUserId?: string | null) => {
  const { data, error } = await (supabase as any)
    .from("profiles")
    .select("id, user_id, email, full_name, account_category, account_type, account_role, role, created_at, referee_certification_level, referee_certifying_organization, referee_years_experience")
    .eq("username", username)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.user_id === currentUserId) return null;
  return data;
};

const isIncompleteSignupProfile = (profile: any) =>
  Boolean(
    profile &&
      (
        !profile.account_category ||
        !profile.account_role ||
        !profile.account_type ||
        (
          (profile.account_role === "referee" || profile.account_type === "referee" || profile.role === "referee") &&
          (!profile.referee_certification_level ||
            !profile.referee_certifying_organization ||
            profile.referee_years_experience == null)
        )
      )
  );

const ensureUsernameAvailableForSignup = async (username: string, currentUserId?: string | null) => {
  let usernameOwner = await getTakenUsernameOwner(username, currentUserId);
  if (!usernameOwner) return;

  if (currentUserId && isIncompleteSignupProfile(usernameOwner)) {
    const releaseResult = await (supabase as any).rpc("release_incomplete_signup_username", {
      _username: username,
    });

    if (releaseResult.error) {
      console.warn("Could not release incomplete signup username", {
        attemptedUsername: username,
        currentAuthUserId: currentUserId,
        ownerUserId: usernameOwner.user_id,
        error: releaseResult.error,
      });
    } else if (releaseResult.data) {
      console.info("Released incomplete signup username and retrying signup", {
        attemptedUsername: username,
        currentAuthUserId: currentUserId,
        releasedOwnerUserId: usernameOwner.user_id,
      });
      usernameOwner = await getTakenUsernameOwner(username, currentUserId);
      if (!usernameOwner) return;
    }
  }

  console.warn("Footy Status signup username is already owned by another profile", {
    attemptedUsername: username,
    currentAuthUserId: currentUserId,
    ownerUserId: usernameOwner.user_id,
    ownerEmail: usernameOwner.email,
    ownerRole: usernameOwner.account_role || usernameOwner.account_type || usernameOwner.role,
    ownerLooksIncomplete: isIncompleteSignupProfile(usernameOwner),
  });
  throw new Error("Username already taken. Please choose another.");
};

const isUsernameTakenError = (error: any) =>
  String(error?.message || error || "").toLowerCase().includes("username is already taken") ||
  String(error?.message || error || "").toLowerCase().includes("username already taken");

const releaseUsernameConflictForSignup = async (username: string) => {
  const releaseResult = await (supabase as any).rpc("release_incomplete_signup_username", {
    _username: username,
  });

  if (releaseResult.error) {
    console.warn("Could not release username conflict during signup save", {
      attemptedUsername: username,
      error: releaseResult.error,
    });
    return false;
  }

  return Boolean(releaseResult.data);
};

const AuthShell = ({ children, backAction }: { children: React.ReactNode; backAction: () => void }) => (
  <div className="min-h-screen bg-background">
    <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden flex flex-col items-center justify-center px-4 relative">
      <button onClick={backAction} className="absolute top-4 left-4 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-5 w-5" /> Back
      </button>
      {children}
    </div>
  </div>
);

const AuthPage = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode");
  const authReason = searchParams.get("reason");
  const [isLogin, setIsLogin] = useState(mode !== "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signupStep, setSignupStep] = useState<SignupStep>('account_type');
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [staffType, setStaffType] = useState<StaffType | null>(null);
  const [pendingGoogleAuth, setPendingGoogleAuth] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const embeddedBrowser = isEmbeddedBrowser();
  const embeddedGoogleAuthMessage =
    "Google sign-in opens in Safari and does not carry the session back into this in-app browser. Use email/password here, or open Footy Status directly in Safari before using Google.";

  // Refs so the single onAuthStateChange subscription can read current values
  // without needing to re-subscribe on every state change.
  const isLoginRef = useRef(isLogin);
  const pendingGoogleAuthRef = useRef(pendingGoogleAuth);
  const accountTypeRef = useRef(accountType);
  const staffTypeRef = useRef(staffType);
  const modeRef = useRef(mode);
  const staleGoogleFlowHandledRef = useRef(false);

  useEffect(() => { isLoginRef.current = isLogin; }, [isLogin]);
  useEffect(() => { pendingGoogleAuthRef.current = pendingGoogleAuth; }, [pendingGoogleAuth]);
  useEffect(() => { accountTypeRef.current = accountType; }, [accountType]);
  useEffect(() => { staffTypeRef.current = staffType; }, [staffType]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const persistSignupFlow = (nextAccountType: AccountType | null, nextStaffType: StaffType | null) => {
    const selectedRole = getSignupRoleFromSelection(nextAccountType, nextStaffType);
    const payload = JSON.stringify({
      accountType: nextAccountType,
      staffType: nextStaffType,
      selectedRole,
      accountCategory: selectedRole ? getAccountCategoryForRole(selectedRole) : null,
      legacyRole: selectedRole ? getLegacyRoleForAccountRole(selectedRole) : null,
      pendingGoogleAuth: true,
    });

    sessionStorage.setItem(SIGNUP_FLOW_STORAGE_KEY, payload);
    localStorage.setItem(SIGNUP_FLOW_STORAGE_KEY, payload);
  };

  const clearSignupFlow = () => {
    sessionStorage.removeItem(SIGNUP_FLOW_STORAGE_KEY);
    localStorage.removeItem(SIGNUP_FLOW_STORAGE_KEY);
  };

  const prepareGoogleSignupSession = (session: any, selectedRole: string) => {
    if (!session?.user || !selectedRole || !VALID_SIGNUP_ROLES.has(selectedRole)) return;

    const restoredSelection = getSignupSelectionFromRole(selectedRole);

    console.info("Footy Status Google signup session restored", {
      authUserId: session.user.id,
      selectedRole,
      waitingForCreateAccount: true,
    });

    setAccountType(restoredSelection.accountType);
    setStaffType(restoredSelection.staffType);
    setEmail(session.user.email || "");
    setIsLogin(false);
    setPendingGoogleAuth(false);
    setSignupStep("profile_form");
  };

  const getSignupRoleFromSessionMetadata = (session: any) => {
    const metadataRole =
      session?.user?.user_metadata?.account_role ||
      session?.user?.user_metadata?.account_type ||
      session?.user?.user_metadata?.selected_account_type ||
      session?.user?.user_metadata?.role ||
      null;
    if (!metadataRole) return null;
    const normalizedRole =
      metadataRole === "team"
        ? "team_club"
        : metadataRole === "school"
          ? "school_team"
          : metadataRole === "coach"
            ? "head_coach_assistant"
            : metadataRole;
    return VALID_SIGNUP_ROLES.has(normalizedRole) ? normalizedRole : null;
  };

  // Checks if an existing auth session has an incomplete signup in the database,
  // and if so, restores the signup flow so the user can finish it.
  // Handles ALL account types, not just referee.
  const restoreIncompleteSignupFromMetadata = async (session: any): Promise<boolean> => {
    if (!session?.user) return false;

    const selectedRole = getSignupRoleFromSessionMetadata(session);
    if (!selectedRole || !VALID_SIGNUP_ROLES.has(selectedRole)) return false;

    const { data } = await (supabase as any)
      .from("profiles")
      .select("username, account_role, account_type, account_category, referee_certification_level, referee_certifying_organization, referee_years_experience")
      .eq("user_id", session.user.id)
      .maybeSingle();

    // Check if the signup is already complete for this role
    const hasBasicProfile = Boolean(
      data?.username &&
      data?.account_role &&
      data?.account_type &&
      data?.account_category
    );

    const isRefereeComplete = selectedRole === "referee"
      ? Boolean(
          data?.referee_certification_level &&
          data?.referee_certifying_organization &&
          data?.referee_years_experience != null
        )
      : true;

    if (hasBasicProfile && isRefereeComplete) {
      // Signup is already complete - do not restore
      return false;
    }

    // Incomplete signup found - restore the flow
    const restoredSelection = getSignupSelectionFromRole(selectedRole);
    persistSignupFlow(restoredSelection.accountType, restoredSelection.staffType);
    prepareGoogleSignupSession(session, selectedRole);
    return true;
  };

  useEffect(() => {
    if (mode === "signup") setIsLogin(false);
    else if (mode === "login") setIsLogin(true);
  }, [mode]);

  useEffect(() => {
    if (authReason === "login_required") {
      toast({
        title: "Login required",
        description: "Create an account or log in to open profiles, teams, leagues, and match details.",
      });
    }
  }, [authReason, toast]);

  // Restore the account type / staff type the user picked before leaving for
  // Google OAuth. This only primes local state - it must NOT advance to
  // profile_form on its own. Jumping straight to the form based on this
  // localStorage flag alone (without a real Supabase session) let a stale
  // flag from an earlier, abandoned Google attempt show the signup form with
  // no session behind it, so submitting always failed with "Google sign-up
  // did not finish correctly" after the user had already filled everything
  // in. Advancing to profile_form now only happens once the auth-state
  // effect below confirms a real session exists.
  useEffect(() => {
    const parsed = getStoredSignupFlow();
    if (!parsed) return;

    try {
      const restoredSelection = getSignupSelectionFromRole(parsed.selectedRole);

      if (parsed.accountType || restoredSelection.accountType) setAccountType(parsed.accountType || restoredSelection.accountType);
      if (parsed.staffType || restoredSelection.staffType) setStaffType(parsed.staffType || restoredSelection.staffType);
      if (parsed.pendingGoogleAuth) {
        setPendingGoogleAuth(true);
        setIsLogin(false);
      }
    } catch {
      clearSignupFlow();
    }
  }, []);

  // Single auth state subscription - runs once with empty deps to avoid
  // race conditions from stale closures on isLogin/pendingGoogleAuth changes.
  useEffect(() => {
    const handleIncomingSession = async (session: any) => {
      if (!session) {
        // A pendingGoogleAuth flag with no real session behind it means the
        // earlier Google attempt was abandoned or failed (or this is a stale
        // flag left over from a previous visit). Clear it and send the user
        // back to pick their account type instead of leaving them able to
        // fill out the whole signup form only to fail on submit.
        if (pendingGoogleAuthRef.current && !staleGoogleFlowHandledRef.current) {
          staleGoogleFlowHandledRef.current = true;
          clearSignupFlow();
          setPendingGoogleAuth(false);
          setSignupStep("account_type");
          toast({
            title: "Signup session expired",
            description: "Please choose your account type again before continuing with Google.",
            variant: "destructive",
          });
        }
        return;
      }

      staleGoogleFlowHandledRef.current = false;
      const storedFlow = getStoredSignupFlow();
      const selectedRole =
        storedFlow?.selectedRole ||
        getSignupRoleFromSelection(accountTypeRef.current, staffTypeRef.current);

      // Priority 1: Returning from Google OAuth - show the questionnaire.
      // Tag the session as "onboarding in progress" so the gate blocks the user
      // from accessing the app until they press Create Account.
      if (storedFlow?.pendingGoogleAuth && selectedRole) {
        try {
          await supabase.auth.updateUser({
            data: { onboarding_complete: false, selected_account_type: selectedRole },
          });
        } catch (err) {
          console.warn("OnboardingFlag: could not set onboarding_complete=false", err);
        }
        prepareGoogleSignupSession(session, selectedRole);
        return;
      }

      // Priority 2: In signup mode - check if the user has an incomplete signup
      // (handles cases where Google auth metadata is set but stored flow was lost)
      if (!isLoginRef.current && modeRef.current === "signup") {
        const restored = await restoreIncompleteSignupFromMetadata(session);
        if (!restored && pendingGoogleAuthRef.current) {
          setPendingGoogleAuth(false);
          setEmail(session.user.email || "");
          setSignupStep("profile_form");
        }
        return;
      }

      // Priority 3: Login mode - navigate to home.
      // If onboarding_complete is explicitly false this session belongs to an
      // incomplete signup; redirect to the signup flow instead of home.
      if (isLoginRef.current) {
        const onboardingComplete = session.user?.user_metadata?.onboarding_complete;
        if (onboardingComplete === false) {
          navigate("/auth?mode=signup", { replace: true });
        } else {
          navigate("/");
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Only act on sign-in events, not sign-out or token refresh
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          handleIncomingSession(session);
        }
      }
    );

    // Also check the current session immediately (for page reloads / direct navigation)
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleIncomingSession(session);
    });

    return () => subscription.unsubscribe();
  }, []); // Empty deps - subscribes once, uses refs for mutable state

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = emailPasswordSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast({ title: "Error", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
      });
      if (error) throw error;
      toast({ title: "Welcome back!", description: "Successfully logged in." });
      navigate("/");
    } catch (error: any) {
      toast({ title: "Error", description: getAuthErrorMessage(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = forgotPasswordSchema.safeParse({ email: forgotEmail });
    if (!parsed.success) {
      toast({ title: "Enter your email", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), {
        redirectTo: buildAppUrl("/reset-password"),
      });

      if (error) throw error;

      toast({ title: "Check your email", description: "We sent you a password reset link." });
      setShowForgotPassword(false);
      setForgotEmail(parsed.data.email.toLowerCase());
    } catch (error) {
      toast({ title: "Error", description: getAuthErrorMessage(error), variant: "destructive" });
    } finally {
      setForgotLoading(false);
    }
  };

  const handleAccountTypeSelect = (type: AccountType) => {
    setAccountType(type);
    if (type === 'team_staff') setSignupStep('staff_type');
    else setSignupStep('auth_method');
  };

  const handleStaffTypeSelect = (type: StaffType) => {
    setStaffType(type);
    setSignupStep('auth_method');
  };

  const handleGoogleAuth = async () => {
    const selectedRole = getSignupRoleFromSelection(accountType, staffType);
    if (!selectedRole) {
      toast({
        title: "Choose account type",
        description: "Please choose the account type you want before continuing with Google.",
        variant: "destructive",
      });
      return;
    }

    if (embeddedBrowser) {
      toast({
        title: "Open Google sign-in in Safari",
        description: embeddedGoogleAuthMessage,
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    setPendingGoogleAuth(true);
    persistSignupFlow(accountType, staffType);
    try {
      await supabase.auth.signOut({ scope: "local" });
      clearStoredAuthSession();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildAppUrl("/"),
          queryParams: {
            prompt: "select_account",
            include_granted_scopes: "true",
          },
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      setPendingGoogleAuth(false);
      clearSignupFlow();
    }
  };

  const handleEmailAuth = (emailVal: string, passwordVal: string) => {
    const parsed = emailPasswordSchema.safeParse({ email: emailVal, password: passwordVal });

    if (!parsed.success) {
      toast({ title: "Error", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }

    setEmail(parsed.data.email.toLowerCase());
    setPassword(parsed.data.password);
    setSignupStep('profile_form');
  };

  const getAccountTypeLabel = () => {
    if (accountType === 'player') return 'Player';
    if (accountType === 'parent') return 'Parent/Guardian';
    if (accountType === 'referee') return 'Referee';
    if (accountType === 'team_staff') {
      if (staffType === 'team_club') return 'Team / Club';
      if (staffType === 'school_team') return 'School Team';
      if (staffType === 'head_coach_assistant') return 'Coach / Trainer';
      if (staffType === 'scout') return 'Scout';
      if (staffType === 'academy_director') return 'Team Staff';
    }
    return '';
  };

  const createUserAndProfile = async (profileData: any, role: string) => {
    setLoading(true);
    let sessionUserIdForRecovery: string | null = null;
    let coreProfileSaved = false;
    let rolePersistenceVerified = false;
    const signupMethod = password ? "email" : "google";

    try {
      let sessionUserId: string | null = null;
      let normalizedEmail = normalizeEmailValue(email);
      const normalizedUsername = normalizeUsername(profileData.username);
      const usernameValidationMessage = validateUsername(normalizedUsername);
      const accountCategory = getAccountCategoryForRole(role);
      const legacyRole = getLegacyRoleForAccountRole(role);

      if (!role || !VALID_SIGNUP_ROLES.has(role)) {
        throw new Error("Please choose an account type before creating your account.");
      }

      const selectedRoleFromFlow = getSignupRoleFromSelection(accountType, staffType);
      if (selectedRoleFromFlow && selectedRoleFromFlow !== role) {
        throw new Error("Your signup account type changed unexpectedly. Please go back and choose the account type again.");
      }

      const missingRequiredField = getSignupRequiredFieldLabel(role, profileData, normalizedEmail, password, signupMethod);
      if (missingRequiredField) {
        throw new Error(`Missing required field: ${missingRequiredField}`);
      }

      console.info("Footy Status signup started", {
        method: signupMethod,
        selectedAccountType: accountType,
        selectedStaffType: staffType,
        selectedRole: role,
        accountCategory,
        legacyRole,
        onboardingPayloadKeys: Object.keys(profileData || {}),
      });

      if (usernameValidationMessage) {
        throw new Error(usernameValidationMessage);
      }

      const { data: { session: existingSession } } = await supabase.auth.getSession();
      const existingGoogleUser = existingSession
        ? null
        : signupMethod === "google"
          ? await supabase.auth.getUser()
          : null;
      const recoveredGoogleUser = existingGoogleUser?.data?.user || null;

      if (existingSession) {
        sessionUserId = existingSession.user.id;
        normalizedEmail = normalizeEmailValue(existingSession.user.email) || normalizedEmail;
        sessionUserIdForRecovery = sessionUserId;
        console.info("Footy Status signup using existing auth session", {
          method: signupMethod,
          authUserId: sessionUserId,
          restoredRole: role,
        });
        await ensureUsernameAvailableForSignup(normalizedUsername, sessionUserId);
      } else if (recoveredGoogleUser) {
        sessionUserId = recoveredGoogleUser.id;
        normalizedEmail = normalizeEmailValue(recoveredGoogleUser.email) || normalizedEmail;
        sessionUserIdForRecovery = sessionUserId;
        console.info("Footy Status signup recovered Google auth user without session object", {
          method: signupMethod,
          authUserId: sessionUserId,
          restoredRole: role,
        });
        await ensureUsernameAvailableForSignup(normalizedUsername, sessionUserId);
      } else {
        if (signupMethod === "google") {
          throw new Error(GOOGLE_SESSION_MISSING_MESSAGE);
        }

        const parsed = emailPasswordSchema.safeParse({ email: normalizedEmail, password });
        if (!parsed.success) {
          throw new Error(parsed.error.issues[0]?.message || "Please enter a valid email and password.");
        }

        await ensureUsernameAvailableForSignup(normalizedUsername, null);

        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: buildAppUrl("/"),
            data: {
              full_name: profileData.fullName || profileData.clubName || profileData.schoolName || "",
              username: normalizedUsername,
              account_category: accountCategory,
              account_role: role,
              account_type: role,
              role: legacyRole,
              selected_account_type: role,
              player_gender: role === "player" ? profileData.gender : null,
              onboarding_complete: false,
            },
          },
        });

        if (signUpError) {
          throw new Error(getAuthErrorMessage(signUpError));
        }

        if (!authData.user) {
          throw new Error("Failed to create your account. Please try again.");
        }

        sessionUserId = authData.user.id;
        sessionUserIdForRecovery = sessionUserId;
        console.info("Footy Status auth user created", {
          method: "email",
          authUserId: sessionUserId,
          selectedRole: role,
        });

        if (!authData.session) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: parsed.data.email,
            password: parsed.data.password,
          });

          if (signInError) throw signInError;
          if (!signInData.session) throw new Error("Account created, but we could not sign you in automatically. Please sign in.");

          sessionUserId = signInData.session.user.id;
          sessionUserIdForRecovery = sessionUserId;
        } else {
          sessionUserId = authData.session.user.id;
          sessionUserIdForRecovery = sessionUserId;
        }
      }

      if (!sessionUserId) {
        throw new Error("We couldn't finish creating your account. Please try again.");
      }

      const normalizedCity = [profileData.city, profileData.state].filter(Boolean).join(", ");
      const refereeProofFile = role === "referee" ? profileData.refereeCertificationProofFile as File | null : null;
      let refereeProofPath: string | null = null;

      const metadataUpdate = await supabase.auth.updateUser({
        data: {
          full_name: profileData.fullName || profileData.clubName || profileData.schoolName || "",
          username: normalizedUsername,
          account_category: accountCategory,
          account_role: role,
          account_type: role,
          role: legacyRole,
          selected_account_type: role,
          player_gender: role === "player" ? profileData.gender : null,
        },
      });

      if (metadataUpdate.error) {
        console.warn("Could not update signup role metadata after account creation:", metadataUpdate.error);
      } else {
        console.info("Footy Status auth metadata updated", {
          authUserId: sessionUserId,
          accountRole: role,
          accountCategory,
          legacyRole,
        });
      }

      if (refereeProofFile) {
        const extension = refereeProofFile.name.split(".").pop() || "file";
        const storagePath = `${sessionUserId}/certification-${Date.now()}.${extension}`;
        const uploadResult = await supabase.storage.from("referee-proof").upload(storagePath, refereeProofFile, {
          upsert: true,
        });
        if (uploadResult.error) throw uploadResult.error;
        refereeProofPath = storagePath;
      }

      const selectedStaffRole =
        role === "scout"
          ? profileData.scoutRoleTitle || "Scout"
          : role !== "team_club" && role !== "school_team" && role !== "player" && role !== "parent" && role !== "referee"
            ? formatRoleDisplayLabel(profileData.coachingRoleType || role, "Coach / Trainer")
            : null;

      const setupPayload = {
        ...profileData,
        username: normalizedUsername,
        accountCategory,
        accountType: role,
        accountRole: role,
        coachingRoleType: selectedStaffRole || profileData.coachingRoleType || null,
        contactEmail: profileData.contactEmail ? normalizeEmailValue(profileData.contactEmail) : null,
        email: normalizedEmail || null,
        city: normalizedCity || profileData.city || null,
        country: profileData.country || null,
        homeStadium: profileData.homeFieldAddress || profileData.homeStadium || null,
        trainingGround: profileData.trainingGroundAddress || profileData.trainingGround || null,
        refereeCertificationProofUrl: refereeProofPath,
      };

      let { error: setupError } = await (supabase as any).rpc('finish_account_onboarding', {
        _role: role,
        _profile: setupPayload,
      });

      if (isUsernameTakenError(setupError)) {
        const released = await releaseUsernameConflictForSignup(normalizedUsername);
        if (released) {
          const retryAfterRelease = await (supabase as any).rpc('finish_account_onboarding', {
            _role: role,
            _profile: setupPayload,
          });
          setupError = retryAfterRelease.error;
        }
      }

      if (setupError) {
        console.error("finish_account_onboarding failed", {
          method: signupMethod,
          authUserId: sessionUserId,
          selectedRole: role,
          error: setupError,
        });
        throw setupError;
      }

      console.info("Footy Status onboarding transaction saved", {
        authUserId: sessionUserId,
        selectedRole: role,
      });

      const normalizedFullName =
        role === "team_club"
          ? profileData.clubName || ""
          : role === "school_team"
            ? profileData.schoolName || profileData.clubName || ""
            : profileData.fullName || profileData.clubName || profileData.schoolName || "";

      const { data: savedRoleProfile, error: savedRoleError } = await (supabase as any)
        .from("profiles")
        .select("user_id, account_category, account_type, account_role, role")
        .eq("user_id", sessionUserId)
        .maybeSingle();

      if (savedRoleError) {
        throw savedRoleError;
      }

      if (savedRoleProfile?.account_role !== role || savedRoleProfile?.account_type !== role) {
        console.warn("Signup role mismatch detected; repairing profile role fields", {
          authUserId: sessionUserId,
          expectedRole: role,
          savedProfile: savedRoleProfile,
        });

        const repairRoleUpdate = await (supabase as any)
          .from("profiles")
          .update({
            account_category: accountCategory,
            account_type: role,
            account_role: role,
            role: legacyRole,
          })
          .eq("user_id", sessionUserId);

        if (repairRoleUpdate.error) {
          throw repairRoleUpdate.error;
        }
      }

      coreProfileSaved = true;
      console.info("Footy Status signup core profile saved", {
        method: signupMethod,
        authUserId: sessionUserId,
        finalAccountType: role,
        routingDestination: "/",
      });

      if (accountCategory === "team_staff" && role !== "team_club" && role !== "school_team") {
        const staffProfileRole =
          role === "academy_director"
            ? "academy_director"
            : role === "scout"
              ? "scout"
              : "coach";
        const staffOrganization =
          role === "scout"
            ? profileData.scoutOrganization || profileData.teamOrganizationName || null
            : profileData.teamOrganizationName || null;
        const staffLicenses =
          role === "scout"
            ? splitCommaValues(profileData.scoutingLicenses)
            : splitCommaValues(profileData.coachingLicenses);
        const staffExperience =
          role === "scout"
            ? splitCommaValues(profileData.scoutingExperience)
            : splitCommaValues(profileData.previousTeams);
        const staffAgeGroups =
          role === "scout"
            ? splitCommaValues(profileData.scoutingAgeGroups)
            : splitCommaValues(profileData.ageGroupsCoached);

        const { error: staffProfileError } = await (supabase as any)
          .from("staff_profiles")
          .upsert(
            {
              user_id: sessionUserId,
              full_name: normalizedFullName,
              role: staffProfileRole,
              team_organization_name: staffOrganization,
              country: profileData.country || null,
              city: normalizedCity || profileData.city || null,
              coaching_level: profileData.coachingLevel || null,
              years_experience: profileData.yearsExperience ? Number(profileData.yearsExperience) : null,
              coaching_licenses: staffLicenses,
              age_groups_coached: staffAgeGroups,
              contact_email: profileData.contactEmail ? String(profileData.contactEmail).trim().toLowerCase() : normalizedEmail,
              contact_phone: profileData.contactPhone || null,
              previous_teams: staffExperience,
              notable_achievements:
                role === "scout"
                  ? profileData.scoutingAccolades || null
                  : profileData.notableAchievements || null,
            },
            { onConflict: "user_id" }
          );

        if (staffProfileError) {
          throw new Error(staffProfileError.message || "We couldn't save your coach/staff profile answers.");
        }

        const selectedCoachingTeams = Array.isArray(profileData.selectedCoachingTeams)
          ? profileData.selectedCoachingTeams.slice(0, 5)
          : [];

        if (selectedCoachingTeams.length) {
          const joinRequestRows = selectedCoachingTeams
            .filter((team: any) => team?.team_id)
            .map((team: any) => ({
              team_id: team.team_id,
              club_team_id: team.club_team_id || null,
              league_id: team.league_id || null,
              age_group: team.age_group || null,
              coach_user_id: sessionUserId,
              staff_role: profileData.coachingRoleType || null,
              message: role === "academy_director" ? "Selected during club director/team staff signup." : "Selected during coach signup.",
              status: "pending",
              requested_at: new Date().toISOString(),
            }));

          const { error: joinRequestError } = await (supabase as any)
            .from("coach_staff_join_requests")
            .insert(joinRequestRows);

          if (joinRequestError?.message?.includes("club_team_id") || joinRequestError?.message?.includes("league_id") || joinRequestError?.message?.includes("age_group")) {
            const basicRows = joinRequestRows.map(({ club_team_id, league_id, age_group, ...row }: any) => row);
            const { error: basicJoinRequestError } = await (supabase as any)
              .from("coach_staff_join_requests")
              .insert(basicRows);
            if (basicJoinRequestError) throw basicJoinRequestError;
          } else if (joinRequestError) {
            throw joinRequestError;
          }
        }
      }

      if (role === "player") {
        const normalizedJerseyNumber = profileData.jerseyNumber ? String(profileData.jerseyNumber).trim() : null;

        const { error: playerGenderError } = await (supabase as any)
          .from("player_profiles")
          .upsert({
            user_id: sessionUserId,
            full_name: profileData.fullName || "",
            date_of_birth: profileData.dateOfBirth || null,
            position: profileData.position || null,
            team: profileData.team || null,
            height: profileData.height || null,
            weight: profileData.weight || null,
            contact_email: profileData.contactEmail ? String(profileData.contactEmail).trim().toLowerCase() : normalizedEmail,
            contact_phone: profileData.contactPhone || null,
            school_grade: profileData.schoolGrade || null,
            preferred_foot: profileData.preferredFoot || null,
            coach_email: profileData.coachEmail ? String(profileData.coachEmail).trim().toLowerCase() : null,
            jersey_number: normalizedJerseyNumber,
            player_gender: profileData.gender,
          }, { onConflict: "user_id" });

        if (playerGenderError) throw playerGenderError;

        const { error: legacyPlayerError } = await (supabase as any)
          .from("players")
          .upsert(
            {
              user_id: sessionUserId,
              name: profileData.fullName || "",
              club: profileData.team || "",
              league: "",
              position: profileData.position || null,
              jersey_number: normalizedJerseyNumber,
              height: profileData.height || null,
              weight: profileData.weight || null,
              contact_email: profileData.contactEmail ? String(profileData.contactEmail).trim().toLowerCase() : null,
              contact_phone: profileData.contactPhone || null,
              profile_image_url: null,
              player_gender: profileData.gender,
            },
            { onConflict: "user_id" }
          );

        if (legacyPlayerError) {
          console.warn("Legacy player mirror save failed after account setup succeeded:", legacyPlayerError);
        }
      }

      if (role === "parent") {
        await (supabase as any)
          .from("parent_profiles")
          .upsert(
            {
              user_id: sessionUserId,
              full_name: profileData.fullName || "",
              relationship_to_player: profileData.relationshipToPlayer || null,
              contact_email: profileData.contactEmail ? String(profileData.contactEmail).trim().toLowerCase() : normalizedEmail,
              contact_phone: profileData.contactPhone || null,
              emergency_contact: profileData.emergencyContact || null,
              child_full_name: profileData.childFullName || null,
              child_where_plays: profileData.childWherePlays || null,
              child_team: profileData.childTeam || null,
              child_league: profileData.childLeague || null,
              child_age_group: profileData.childAgeGroup || null,
              parent_notes: profileData.parentNotes || null,
            },
            { onConflict: "user_id" }
          );
      }

      if (role === "referee") {
        await saveSignupContactRows(
          sessionUserId,
          profileData.contactEmail || normalizedEmail,
          profileData.contactPhone || null
        );
      }

      if (role === "team_club" || role === "school_team") {
        const teamType = profileData.teamType === "school" ? "school" : "club";
        const schoolLevel = profileData.schoolLevel || null;
        const teamDisplayName = teamType === "school" ? profileData.schoolName || profileData.clubName : profileData.clubName;
        const leagueConference = teamType === "school" ? profileData.leagueConference || null : null;
        const teamContactEmail = profileData.contactEmail ? String(profileData.contactEmail).trim().toLowerCase() : normalizedEmail || null;
        const normalizedOfferedTeams = (profileData.offeredTeams || [])
          .map((team: any) => ({
            ...team,
            team_type: teamType,
            school_level: team.level?.trim() || schoolLevel,
            age_group: team.age_group?.trim() || "",
            league_name: team.league_name?.trim() || "",
            gender: team.gender?.trim() || null,
            season: team.season?.trim() || null,
            level: team.level?.trim() || null,
            coach_name: team.coach_name?.trim() || null,
            status: team.status || "active",
          }))
          .filter((team: any) => team.age_group && team.league_name);
        const leaguesOffered = [...new Set(normalizedOfferedTeams.map((team: any) => team.league_name))];
        const ageGroupsOffered = [...new Set(normalizedOfferedTeams.map((team: any) => team.age_group))];

        const initialTeamProfileUpsert = await (supabase as any)
          .from("team_profiles")
          .upsert(
            {
              user_id: sessionUserId,
              club_name: teamDisplayName || null,
              leagues_offered: leaguesOffered,
              founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
              city: normalizedCity || null,
              country: profileData.country || null,
              home_stadium: profileData.homeFieldAddress || null,
              training_ground: profileData.trainingGroundAddress || null,
              home_jersey_color: profileData.homeJerseyColor || null,
              away_jersey_color: profileData.awayJerseyColor || null,
              third_kit_color: profileData.thirdKitColor || null,
              age_groups_offered: ageGroupsOffered,
              contact_email: teamContactEmail,
              contact_phone: profileData.contactPhone || null,
              team_type: teamType,
              school_level: schoolLevel,
              school_name: teamType === "school" ? profileData.schoolName || null : null,
              team_mascot: teamType === "school" ? profileData.teamMascot || null : null,
              sport: teamType === "school" ? profileData.sport || "Soccer" : null,
              league_conference: leagueConference,
              school_website: teamType === "school" ? profileData.schoolWebsite || null : null,
              head_coach_name: teamType === "school" ? profileData.headCoachName || null : null,
              head_coach_email: teamType === "school" ? profileData.headCoachEmail || null : null,
              head_coach_phone: teamType === "school" ? profileData.headCoachPhone || null : null,
              team_colors: teamType === "school" ? profileData.teamColors || null : null,
              social_links: teamType === "school" ? profileData.socialLinks || null : null,
            },
            { onConflict: "user_id" }
          );

        if (initialTeamProfileUpsert.error) {
          const fallbackTeamProfile = await (supabase as any).rpc("save_team_account_profile", {
            _club_name: teamDisplayName || null,
            _leagues_offered: leaguesOffered,
            _age_groups_offered: ageGroupsOffered,
            _city: normalizedCity || null,
            _home_stadium: profileData.homeFieldAddress || null,
            _training_ground: profileData.trainingGroundAddress || null,
            _contact_email: teamContactEmail,
            _contact_phone: profileData.contactPhone || null,
          });

          if (fallbackTeamProfile.error) {
            throw new Error(fallbackTeamProfile.error.message || "We couldn't create your team profile.");
          }
        }

        let { error: saveClubProfileError } = await (supabase as any).rpc("save_club_profile", {
          _club_name: teamDisplayName || null,
          _city: normalizedCity || null,
          _founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
          _home_field_address: profileData.homeFieldAddress || null,
          _training_ground_address: profileData.trainingGroundAddress || null,
          _contact_email: teamContactEmail,
          _contact_phone: profileData.contactPhone || null,
          _offered_teams: normalizedOfferedTeams,
          _staff: (profileData.staffMembers || []).map((staff: any) => ({
            staff_name: staff.name || "",
            staff_role: staff.role || "",
            personal_email: staff.personalEmail || "",
          })),
        });

        if (saveClubProfileError?.message?.toLowerCase().includes("team profile not found")) {
          const fallbackTeamProfile = await (supabase as any).rpc("save_team_account_profile", {
            _club_name: teamDisplayName || null,
            _leagues_offered: leaguesOffered,
            _age_groups_offered: ageGroupsOffered,
            _city: normalizedCity || null,
            _home_stadium: profileData.homeFieldAddress || null,
            _training_ground: profileData.trainingGroundAddress || null,
            _contact_email: teamContactEmail,
            _contact_phone: profileData.contactPhone || null,
          });

          if (!fallbackTeamProfile.error) {
            const retry = await (supabase as any).rpc("save_club_profile", {
              _club_name: teamDisplayName || null,
              _city: normalizedCity || null,
              _founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
              _home_field_address: profileData.homeFieldAddress || null,
              _training_ground_address: profileData.trainingGroundAddress || null,
              _contact_email: teamContactEmail,
              _contact_phone: profileData.contactPhone || null,
              _offered_teams: normalizedOfferedTeams,
              _staff: (profileData.staffMembers || []).map((staff: any) => ({
                staff_name: staff.name || "",
                staff_role: staff.role || "",
                personal_email: staff.personalEmail || "",
              })),
            });
            saveClubProfileError = retry.error;
          }
        }

        if (saveClubProfileError) {
          throw new Error(saveClubProfileError.message || "We couldn't save your offered teams.");
        }

        const { data: teamProfileRow } = await (supabase as any)
          .from("team_profiles")
          .select("id, team_id")
          .eq("user_id", sessionUserId)
          .maybeSingle();

        const firstLeagueName = leaguesOffered[0] || null;
        const firstAgeGroup = ageGroupsOffered[0] || null;
        let leagueId: string | null = null;

        if (firstLeagueName) {
          const { data: matchedLeague } = await (supabase as any)
            .from("leagues")
            .select("id")
            .ilike("name", firstLeagueName)
            .maybeSingle();
          leagueId = matchedLeague?.id || null;
        }

        const finalTeamProfileUpsert = await (supabase as any)
          .from("team_profiles")
          .upsert(
            {
              user_id: sessionUserId,
              club_name: teamDisplayName || null,
              leagues_offered: leaguesOffered,
              founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
              city: normalizedCity || null,
              country: profileData.country || null,
              home_stadium: profileData.homeFieldAddress || null,
              training_ground: profileData.trainingGroundAddress || null,
              home_jersey_color: profileData.homeJerseyColor || null,
              away_jersey_color: profileData.awayJerseyColor || null,
              third_kit_color: profileData.thirdKitColor || null,
              age_groups_offered: ageGroupsOffered,
              contact_email: teamContactEmail,
              contact_phone: profileData.contactPhone || null,
              team_type: teamType,
              school_level: schoolLevel,
              school_name: teamType === "school" ? profileData.schoolName || null : null,
              team_mascot: teamType === "school" ? profileData.teamMascot || null : null,
              sport: teamType === "school" ? profileData.sport || "Soccer" : null,
              league_conference: leagueConference,
              school_website: teamType === "school" ? profileData.schoolWebsite || null : null,
              head_coach_name: teamType === "school" ? profileData.headCoachName || null : null,
              head_coach_email: teamType === "school" ? profileData.headCoachEmail || null : null,
              head_coach_phone: teamType === "school" ? profileData.headCoachPhone || null : null,
              team_colors: teamType === "school" ? profileData.teamColors || null : null,
              social_links: teamType === "school" ? profileData.socialLinks || null : null,
            },
            { onConflict: "user_id" }
          );
        if (finalTeamProfileUpsert.error) {
          throw finalTeamProfileUpsert.error;
        }

        const { data: refreshedTeamProfileRow } = await (supabase as any)
          .from("team_profiles")
          .select("id, team_id")
          .eq("user_id", sessionUserId)
          .maybeSingle();

        let resolvedTeamId = refreshedTeamProfileRow?.team_id || teamProfileRow?.team_id || null;

        if (!resolvedTeamId) {
          const { data: existingTeam } = await (supabase as any)
            .from("teams")
            .select("id")
            .eq("owner_user_id", sessionUserId)
            .maybeSingle();
          resolvedTeamId = existingTeam?.id || null;
        }

        if (!resolvedTeamId && profileData.clubName) {
          const { data: namedTeam } = await (supabase as any)
            .from("teams")
            .select("id")
            .eq("name", profileData.clubName)
            .maybeSingle();
          resolvedTeamId = namedTeam?.id || null;
        }

        if (resolvedTeamId) {
          const teamPayload = {
            name: teamDisplayName || null,
            league_id: leagueId,
            age_group: firstAgeGroup,
            contact_email: teamContactEmail,
            contact_phone: profileData.contactPhone || null,
            founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
            stadium: profileData.homeFieldAddress || null,
            home_jersey_color: profileData.homeJerseyColor || null,
            away_jersey_color: profileData.awayJerseyColor || null,
            third_kit_color: profileData.thirdKitColor || null,
            owner_user_id: sessionUserId,
            approval_status: "approved",
            team_type: teamType,
            school_level: schoolLevel,
            school_name: teamType === "school" ? profileData.schoolName || null : null,
            team_mascot: teamType === "school" ? profileData.teamMascot || null : null,
            sport: teamType === "school" ? profileData.sport || "Soccer" : null,
            conference_name: leagueConference,
            school_website: teamType === "school" ? profileData.schoolWebsite || null : null,
            head_coach_name: teamType === "school" ? profileData.headCoachName || null : null,
            head_coach_email: teamType === "school" ? profileData.headCoachEmail || null : null,
            head_coach_phone: teamType === "school" ? profileData.headCoachPhone || null : null,
            team_colors: teamType === "school" ? profileData.teamColors || null : null,
            social_links: teamType === "school" ? profileData.socialLinks || null : null,
          };

          const updateTeamResult = await stripMissingTeamsColumnsAndRetry(teamPayload, (nextPayload) =>
            (supabase as any)
              .from("teams")
              .update(nextPayload)
              .eq("id", resolvedTeamId)
          );
          if (updateTeamResult.error) {
            throw updateTeamResult.error;
          }
        } else {
          const teamPayload = {
            name: teamDisplayName || "Team",
            league_id: leagueId,
            age_group: firstAgeGroup,
            contact_email: teamContactEmail,
            contact_phone: profileData.contactPhone || null,
            founded_year: profileData.foundedYear ? Number(profileData.foundedYear) : null,
            stadium: profileData.homeFieldAddress || null,
            home_jersey_color: profileData.homeJerseyColor || null,
            away_jersey_color: profileData.awayJerseyColor || null,
            third_kit_color: profileData.thirdKitColor || null,
            owner_user_id: sessionUserId,
            approval_status: "approved",
            team_type: teamType,
            school_level: schoolLevel,
            school_name: teamType === "school" ? profileData.schoolName || null : null,
            team_mascot: teamType === "school" ? profileData.teamMascot || null : null,
            sport: teamType === "school" ? profileData.sport || "Soccer" : null,
            conference_name: leagueConference,
            school_website: teamType === "school" ? profileData.schoolWebsite || null : null,
            head_coach_name: teamType === "school" ? profileData.headCoachName || null : null,
            head_coach_email: teamType === "school" ? profileData.headCoachEmail || null : null,
            head_coach_phone: teamType === "school" ? profileData.headCoachPhone || null : null,
            team_colors: teamType === "school" ? profileData.teamColors || null : null,
            social_links: teamType === "school" ? profileData.socialLinks || null : null,
          };

          const insertResult = await stripMissingTeamsColumnsAndRetry(teamPayload, (nextPayload) =>
            (supabase as any)
              .from("teams")
              .insert(nextPayload)
              .select("id")
              .maybeSingle()
          );
          if (insertResult.error) {
            throw insertResult.error;
          }

          resolvedTeamId = insertResult.data?.id || null;
        }

        if (refreshedTeamProfileRow?.id && resolvedTeamId) {
          const linkTeamProfileResult = await (supabase as any)
            .from("team_profiles")
            .update({ team_id: resolvedTeamId })
            .eq("id", refreshedTeamProfileRow.id);
          if (linkTeamProfileResult.error) {
            throw linkTeamProfileResult.error;
          }

          if (teamType === "school") {
            const daughterTypeUpdates = await Promise.all(
              normalizedOfferedTeams.map((team: any) =>
                (supabase as any)
                  .from("club_teams")
                  .update({
                    team_type: "school",
                    school_level: team.school_level || null,
                  })
                  .eq("team_id", resolvedTeamId)
                  .eq("age_group", team.age_group)
                  .eq("league_name", team.league_name)
              )
            );
            const daughterTypeError = daughterTypeUpdates.find((result: any) => result?.error)?.error;
            if (daughterTypeError) {
              throw daughterTypeError;
            }
          }
        }

        if (refreshedTeamProfileRow?.id) {
          const deleteStaffResult = await (supabase as any).from("team_staff").delete().eq("team_profile_id", refreshedTeamProfileRow.id);
          if (deleteStaffResult.error) {
            throw deleteStaffResult.error;
          }

          const staffRows = (profileData.staffMembers || [])
            .filter((staff: any) => staff?.name?.trim() || staff?.role?.trim() || staff?.personalEmail?.trim())
            .map((staff: any) => ({
              team_profile_id: refreshedTeamProfileRow.id,
              staff_name: staff.name?.trim() || "Staff Member",
              staff_role: staff.role?.trim() || "Staff",
              personal_email: staff.personalEmail?.trim()?.toLowerCase() || null,
            }));

          if (staffRows.length) {
            const staffInsert = await (supabase as any).from("team_staff").insert(staffRows);

            if (staffInsert.error?.message?.includes("personal_email")) {
              const basicStaffInsert = await (supabase as any)
                .from("team_staff")
                .insert(
                  staffRows.map(({ team_profile_id, staff_name, staff_role }: any) => ({
                    team_profile_id,
                    staff_name,
                    staff_role,
                  }))
                );
              if (basicStaffInsert.error) {
                throw basicStaffInsert.error;
              }
            } else if (staffInsert.error) {
              throw staffInsert.error;
            }
          }
        }
      }

      await verifySignupAccountPersistence(
        sessionUserId,
        role,
        normalizedUsername,
        normalizedEmail || profileData.contactEmail,
        profileData
      );
      rolePersistenceVerified = true;

      // Mark onboarding as complete BEFORE navigating so the gate lets the user through.
      // If this call fails the gate falls back to the DB profile completeness check.
      const completionFlag = await supabase.auth.updateUser({ data: { onboarding_complete: true } });
      if (completionFlag.error) {
        console.warn("Could not set onboarding_complete: true; gate will fall back to DB check", completionFlag.error);
      }

      window.dispatchEvent(new CustomEvent("footy-status-profile-refresh", {
        detail: {
          authUserId: sessionUserId,
          accountRole: role,
          method: signupMethod,
        },
      }));

      toast({ title: "Welcome to Footy Status!", description: "Your account has been created successfully." });
      clearSignupFlow();
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Signup error:", {
        error,
        method: signupMethod,
        selectedAccountType: accountType,
        selectedStaffType: staffType,
        attemptedRole: role,
        authUserId: sessionUserIdForRecovery,
        coreProfileSaved,
        rolePersistenceVerified,
      });
      if (coreProfileSaved && rolePersistenceVerified && sessionUserIdForRecovery) {
        await supabase.auth.updateUser({ data: { onboarding_complete: true } }).catch(() => {});
        toast({
          title: "Welcome to Footy Status!",
          description: "Your account has been created successfully.",
        });
        window.dispatchEvent(new CustomEvent("footy-status-profile-refresh", {
          detail: {
            authUserId: sessionUserIdForRecovery,
            accountRole: role,
            method: signupMethod,
          },
        }));
        clearSignupFlow();
        navigate("/", { replace: true });
        return;
      }

      if (sessionUserIdForRecovery && !rolePersistenceVerified) {
        try {
          await supabase.auth.signOut({ scope: "global" });
        } catch (signOutError) {
          console.warn("Footy Status could not fully sign out after failed profile setup", signOutError);
        }
        clearStoredAuthSession();
      }

      const errorMessage = getUsernameErrorMessage(getAuthErrorMessage(error));
      const toastTitle =
        errorMessage === "Username already taken. Please choose another."
          ? "Username already taken"
          : errorMessage === GOOGLE_SESSION_MISSING_MESSAGE
            ? "Google signup failed"
          : errorMessage.startsWith("Missing required field:")
            ? "Missing required field"
            : coreProfileSaved
              ? "Profile setup failed"
              : "Signup failed";

      toast({
        title: toastTitle,
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerSubmit = (data: any) => createUserAndProfile(data, 'player');
  const handleTeamSubmit = (data: any) => createUserAndProfile(data, staffType === "school_team" ? "school_team" : "team_club");
  const handleStaffSubmit = (data: any) => createUserAndProfile(data, staffType!);
  const handleParentSubmit = (data: any) => createUserAndProfile(data, 'parent');
  const handleRefereeSubmit = (data: any) => createUserAndProfile(data, 'referee');

  const handleLoginGoogleAuth = async () => {
    if (embeddedBrowser) {
      toast({
        title: "Open Google sign-in in Safari",
        description: embeddedGoogleAuthMessage,
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
      clearStoredAuthSession();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildAppUrl("/"),
          queryParams: {
            prompt: "select_account",
            include_granted_scopes: "true",
          },
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
    }
  };

  // Signs out the temporary Google auth session when the user goes back before
  // completing signup. This prevents a dangling auth session without a profile.
  const discardTemporaryGoogleSignupSession = async () => {
    if (password) return; // email/password flow - nothing to discard

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    console.info("Footy Status discarding temporary Google signup session before account creation", {
      authUserId: session.user.id,
      signupStep,
    });

    await supabase.auth.signOut({ scope: "local" });
    clearStoredAuthSession();
    setPendingGoogleAuth(false);
  };

  const goBack = async () => {
    if (signupStep === 'profile_form') {
      await discardTemporaryGoogleSignupSession();
      clearSignupFlow();
      setSignupStep('auth_method');
    } else if (signupStep === 'auth_method') {
      await discardTemporaryGoogleSignupSession();
      clearSignupFlow();
      setEmail("");
      setPassword("");
      if (accountType === 'team_staff') setSignupStep('staff_type');
      else setSignupStep('account_type');
    } else if (signupStep === 'staff_type') {
      clearSignupFlow();
      setStaffType(null);
      setSignupStep('account_type');
    } else if (signupStep === 'account_type') {
      clearSignupFlow();
      setIsLogin(true);
    }
  };

  // Profile form step
  if (!isLogin && signupStep === 'profile_form') {
    return (
      <AuthShell backAction={goBack}>
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="FootyStatus" className="h-28 w-auto" />
          </div>
          {accountType === 'player' && <PlayerProfileForm email={email} onSubmit={handlePlayerSubmit} onBack={goBack} loading={loading} />}
          {accountType === 'team_staff' && (staffType === 'team_club' || staffType === 'school_team') && (
            <TeamProfileForm
              email={email}
              teamType={staffType === 'school_team' ? 'school' : 'club'}
              onSubmit={handleTeamSubmit}
              onBack={goBack}
              loading={loading}
            />
          )}
          {accountType === 'team_staff' && staffType && staffType !== 'team_club' && staffType !== 'school_team' && <StaffProfileForm email={email} staffType={staffType as any} onSubmit={handleStaffSubmit} onBack={goBack} loading={loading} />}
          {accountType === 'parent' && <ParentProfileForm email={email} onSubmit={handleParentSubmit} onBack={goBack} loading={loading} />}
          {accountType === 'referee' && <RefereeProfileForm email={email} onSubmit={handleRefereeSubmit} onBack={goBack} loading={loading} />}
        </div>
      </AuthShell>
    );
  }

  // Auth method step
  if (!isLogin && signupStep === 'auth_method') {
    return (
      <AuthShell backAction={goBack}>
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-center mb-4"><img src={logo} alt="FootyStatus" className="h-28 w-auto" /></div>
          <AuthMethodSelector
            onGoogleAuth={handleGoogleAuth}
            onEmailAuth={handleEmailAuth}
            loading={loading}
            accountTypeLabel={getAccountTypeLabel()}
            disableGoogleAuth={embeddedBrowser}
            googleAuthHelperText={embeddedBrowser ? embeddedGoogleAuthMessage : null}
          />
        </div>
      </AuthShell>
    );
  }

  // Staff type step
  if (!isLogin && signupStep === 'staff_type') {
    return (
      <AuthShell backAction={goBack}>
        <div className="w-full max-w-sm space-y-6">
          <div className="flex justify-center mb-4"><img src={logo} alt="FootyStatus" className="h-28 w-auto" /></div>
          <StaffTypeSelector onSelect={handleStaffTypeSelect} onBack={goBack} />
        </div>
      </AuthShell>
    );
  }

  // Account type step
  if (!isLogin && signupStep === 'account_type') {
    return (
      <AuthShell backAction={goBack}>
        <div className="w-full max-w-lg space-y-6">
          <div className="flex justify-center mb-4"><img src={logo} alt="FootyStatus" className="h-28 w-auto" /></div>
          {authReason === "login_required" ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center text-sm text-foreground">
              Log in or create an account to view full profiles, teams, leagues, and match details.
            </div>
          ) : null}
          <AccountTypeSelector onSelect={handleAccountTypeSelect} />
        </div>
      </AuthShell>
    );
  }

  // Forgot password view
  if (showForgotPassword) {
    return (
      <AuthShell backAction={() => setShowForgotPassword(false)}>
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center">
            <img src={logo} alt="FootyStatus" className="h-28 w-auto mb-6" />
            <h1 className="text-2xl font-bold text-foreground">Reset Password</h1>
            <p className="text-muted-foreground mt-2 text-center">Enter your email and we'll send you a reset link</p>
          </div>
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="forgot-email" type="email" placeholder="you@example.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} className="pl-10 border-2 focus:border-navy" required />
              </div>
            </div>
            <Button type="submit" className="w-full h-12 bg-gradient-to-r from-navy to-primary font-semibold" disabled={forgotLoading}>
              {forgotLoading ? "Sending..." : "Send Reset Link"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Remember your password?{" "}
            <button onClick={() => setShowForgotPassword(false)} className="font-semibold text-primary hover:underline">Sign in</button>
          </p>
        </div>
      </AuthShell>
    );
  }

  // Login form
  return (
    <AuthShell backAction={() => navigate("/")}>
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center">
          <img src={logo} alt="FootyStatus" className="h-28 w-auto mb-6" />
          <h1 className="text-2xl font-bold text-foreground">Welcome Back</h1>
          <p className="text-muted-foreground mt-2">Sign in to continue</p>
        </div>

        {embeddedBrowser ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            {embeddedGoogleAuthMessage}
          </div>
        ) : null}

        <Button
          variant="outline"
          className="w-full h-12 gap-3 font-medium border-2 hover:border-navy hover:bg-navy/5 transition-all"
          onClick={handleLoginGoogleAuth}
          disabled={loading || embeddedBrowser}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Or continue with email</span></div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10 border-2 focus:border-navy" required />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="password">Password</Label>
              <button type="button" onClick={() => setShowForgotPassword(true)} className="text-xs text-primary hover:underline">Forgot password?</button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 border-2 focus:border-navy" required minLength={6} />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 bg-gradient-to-r from-navy to-primary hover:from-navy-light hover:to-primary font-semibold shadow-lg transition-all" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <button onClick={() => setIsLogin(false)} className="font-semibold text-primary hover:underline">Sign up</button>
        </p>
      </div>
    </AuthShell>
  );
};

export default AuthPage;
