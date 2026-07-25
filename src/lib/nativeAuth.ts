import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export const NATIVE_AUTH_CALLBACK = "com.footystatus.app://auth/callback";
const RETURN_PATH_KEY = "footystatus_native_auth_return_path";

export const isNativeApp = () => Capacitor.isNativePlatform();

const safeReturnPath = (path: string) =>
  path.startsWith("/") && !path.startsWith("//") ? path : "/";

export const startNativeGoogleAuth = async (returnPath: string) => {
  sessionStorage.setItem(RETURN_PATH_KEY, safeReturnPath(returnPath));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK,
      skipBrowserRedirect: true,
      queryParams: {
        prompt: "select_account",
        include_granted_scopes: "true",
      },
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

  await Browser.open({ url: data.url });
};

const handleNativeAuthUrl = async (url: string) => {
  if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;

  const callback = new URL(url);
  const oauthError = callback.searchParams.get("error_description") || callback.searchParams.get("error");
  if (oauthError) throw new Error(oauthError);

  const code = callback.searchParams.get("code");
  if (!code) throw new Error("The Google sign-in callback did not contain an authorization code.");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;

  await Browser.close().catch(() => undefined);

  const returnPath = safeReturnPath(sessionStorage.getItem(RETURN_PATH_KEY) || "/");
  sessionStorage.removeItem(RETURN_PATH_KEY);
  window.history.replaceState({}, "", returnPath);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const initializeNativeAuth = async () => {
  if (!isNativeApp()) return;

  await App.addListener("appUrlOpen", ({ url }) => {
    void handleNativeAuthUrl(url).catch((error) => {
      console.error("Footy Status native authentication callback failed", error);
      window.dispatchEvent(
        new CustomEvent("footy-status-native-auth-error", {
          detail: error instanceof Error ? error.message : "Google sign-in could not be completed.",
        }),
      );
      void Browser.close().catch(() => undefined);
    });
  });

  // Covers a cold launch where iOS opened the app before the JavaScript listener existed.
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handleNativeAuthUrl(launch.url);
};
