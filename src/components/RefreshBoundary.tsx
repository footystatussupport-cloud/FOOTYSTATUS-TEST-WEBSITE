import { ReactNode } from "react";
import { usePullToRefreshRemountKey } from "@/hooks/usePullToRefresh";

/**
 * Wraps the routed page tree. When a page has NOT registered its own refresh
 * handler, a pull-to-refresh bumps the remount key, which changes this key and
 * remounts the current route — re-running its mount-time data fetches. Pages
 * that register a handler refresh in place and never hit this path.
 */
export default function RefreshBoundary({ children }: { children: ReactNode }) {
  const remountKey = usePullToRefreshRemountKey();
  return <div key={remountKey} className="contents">{children}</div>;
}
