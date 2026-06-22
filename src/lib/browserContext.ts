const EMBEDDED_BROWSER_MARKERS = [
  "FBAN",
  "FBAV",
  "Instagram",
  "Line/",
  "LinkedInApp",
  "wv",
  "GSA/",
  "Snapchat",
  "OpenAI",
  "Codex",
];

export const isEmbeddedBrowser = () => {
  if (typeof window === "undefined") return false;

  const userAgent = window.navigator.userAgent || "";
  const normalizedUserAgent = userAgent.toLowerCase();

  return EMBEDDED_BROWSER_MARKERS.some((marker) =>
    normalizedUserAgent.includes(marker.toLowerCase())
  );
};
