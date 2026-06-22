const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const STORAGE_KEY = "footystatus_public_origin";

const normalizeOrigin = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
};

export const getAppOrigin = () => {
  const configuredOrigin = normalizeOrigin(import.meta.env.VITE_PUBLIC_APP_URL);

  if (typeof window === "undefined") {
    return configuredOrigin || "";
  }

  const runtimeOrigin = normalizeOrigin(window.location.origin);
  const storedOrigin = normalizeOrigin(window.localStorage.getItem(STORAGE_KEY));
  const isLocalRuntime = LOCAL_HOSTS.has(window.location.hostname);

  if (!isLocalRuntime && runtimeOrigin) {
    window.localStorage.setItem(STORAGE_KEY, runtimeOrigin);
  }

  return configuredOrigin || (isLocalRuntime ? storedOrigin || runtimeOrigin || "" : runtimeOrigin || "");
};

export const buildAppUrl = (path = "/") => {
  const origin = getAppOrigin();
  if (!origin) return path;
  return new URL(path, `${origin}/`).toString();
};
