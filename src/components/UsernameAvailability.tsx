import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUsername, validateUsername } from "@/lib/usernames";

export type UsernameAvailabilityStatus = "idle" | "checking" | "available" | "unavailable";

export interface UsernameAvailabilityState {
  status: UsernameAvailabilityStatus;
  message: string | null;
  /** True when the username is safe to submit (available or unchanged). */
  canSubmit: boolean;
}

/**
 * Live global-username-bank check shared by every signup form and the profile
 * username editor. Validates length / characters / profanity locally, then
 * asks the backend whether the name is taken (case-insensitive).
 */
export const useUsernameAvailability = (
  usernameInput: string,
  currentUsername?: string | null
): UsernameAvailabilityState => {
  const [state, setState] = useState<UsernameAvailabilityState>({
    status: "idle",
    message: null,
    canSubmit: false,
  });

  useEffect(() => {
    const normalized = normalizeUsername(usernameInput);

    if (!normalized) {
      setState({ status: "idle", message: null, canSubmit: false });
      return;
    }

    if (currentUsername && normalized === normalizeUsername(currentUsername)) {
      setState({ status: "available", message: "This is your current username.", canSubmit: true });
      return;
    }

    const localError = validateUsername(normalized);
    if (localError) {
      setState({ status: "unavailable", message: localError, canSubmit: false });
      return;
    }

    let cancelled = false;
    setState({ status: "checking", message: null, canSubmit: false });

    const timer = setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("check_username_availability", {
        _username: normalized,
      });

      if (cancelled) return;

      if (error || !data) {
        // If the live check cannot run, fall back to server-side enforcement
        // at submit time instead of blocking the user.
        setState({ status: "idle", message: null, canSubmit: true });
        return;
      }

      if (data.available) {
        setState({ status: "available", message: "Username available", canSubmit: true });
      } else {
        setState({
          status: "unavailable",
          message: data.message || "This username is already taken. Please choose another username.",
          canSubmit: false,
        });
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [usernameInput, currentUsername]);

  return state;
};

export const UsernameAvailabilityHint = ({ state }: { state: UsernameAvailabilityState }) => {
  if (state.status === "idle") return null;

  if (state.status === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking availability...
      </p>
    );
  }

  if (state.status === "available") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> {state.message || "Username available"}
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-destructive">
      <XCircle className="h-3.5 w-3.5" /> {state.message}
    </p>
  );
};
