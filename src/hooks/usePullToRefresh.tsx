import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";

/**
 * Native-feeling pull-to-refresh for the Footy Status PWA.
 *
 * Most pages scroll the document body, so the gesture is detected on the
 * window. When a page registers an async refresh handler (via
 * `useRegisterRefresh`) that handler is awaited and the spinner hides exactly
 * when its data arrives. Pages that do NOT register a handler fall back to a
 * remount of the current route subtree (see `RefreshBoundary`), which re-runs
 * their mount-time data fetches. This guarantees every screen refreshes its own
 * data without a full app reload.
 */

type RefreshHandler = () => Promise<void> | void;

interface PullToRefreshContextValue {
  /** Register the active page's refresh handler. Returns an unregister fn. */
  registerHandler: (handler: RefreshHandler) => () => void;
  /** Enable/disable the gesture (e.g. full-screen swipe feeds opt out). */
  setDisabled: (disabled: boolean) => void;
  /** Programmatically trigger a refresh (same path as the gesture). */
  triggerRefresh: () => void;
  /** Remount key consumed by <RefreshBoundary/> for the fallback path. */
  remountKey: number;
  isRefreshing: boolean;
}

const PullToRefreshContext = createContext<PullToRefreshContextValue | null>(null);

// Gesture tuning.
const TRIGGER_THRESHOLD = 70; // px of pull required to fire a refresh
const MAX_PULL = 110; // px the indicator can travel while dragging
const RESISTANCE = 0.5; // drag feels heavier than 1:1 finger movement
const MIN_SPINNER_MS = 550; // keep the spinner visible long enough to read as intentional

/** Returns true if any scrollable ancestor of `el` is scrolled away from top. */
function hasScrolledScrollableAncestor(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.dataset && node.dataset.noPullRefresh !== undefined) {
      return true; // opted out (e.g. NextUp video feed)
    }
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    if (scrollable && node.scrollTop > 0) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function PullToRefreshProvider({ children }: { children: ReactNode }) {
  const [remountKey, setRemountKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const handlerRef = useRef<RefreshHandler | null>(null);
  const disabledRef = useRef(false);
  const refreshingRef = useRef(false); // single-flight guard (sync)
  const pullDistanceRef = useRef(0); // latest pull distance for touchend closure
  pullDistanceRef.current = pullDistance;

  const registerHandler = useCallback((handler: RefreshHandler) => {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) {
        handlerRef.current = null;
      }
    };
  }, []);

  const setDisabled = useCallback((disabled: boolean) => {
    disabledRef.current = disabled;
  }, []);

  const triggerRefresh = useCallback(() => {
    if (refreshingRef.current) return; // prevent concurrent refreshes
    refreshingRef.current = true;
    setIsRefreshing(true);

    const startedAt = Date.now();
    const handler = handlerRef.current;

    const finish = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SPINNER_MS - elapsed);
      window.setTimeout(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
        setPullDistance(0);
      }, remaining);
    };

    if (handler) {
      // Page-provided refresh: hide the spinner exactly when data arrives.
      Promise.resolve()
        .then(() => handler())
        .catch((error) => {
          // Never let a refresh failure crash the page.
          console.error("[pull-to-refresh] handler failed", error);
        })
        .finally(finish);
    } else {
      // Fallback: remount the current route so its mount effects refetch.
      setRemountKey((key) => key + 1);
      finish();
    }
  }, []);

  // Touch gesture on the document (body-scroll pages).
  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let tracking = false; // a candidate pull is in progress
    let active = false; // we've committed to a pull (preventing scroll)

    const reset = () => {
      tracking = false;
      active = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (disabledRef.current || refreshingRef.current) return;
      if (event.touches.length !== 1) return;
      // Only start at the very top of the document.
      if (window.scrollY > 0) return;
      const target = event.target as HTMLElement;
      if (hasScrolledScrollableAncestor(target)) return;
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      tracking = true;
      active = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const dy = event.touches[0].clientY - startY;
      const dx = event.touches[0].clientX - startX;
      // Ignore predominantly-horizontal swipes (carousels, tab swipes) before we commit.
      if (!active && Math.abs(dx) > Math.abs(dy)) {
        tracking = false;
        return;
      }
      if (dy <= 0) {
        // Upward / no movement — abandon this gesture.
        if (active) {
          active = false;
          setPullDistance(0);
        }
        tracking = false;
        return;
      }
      // Re-check we haven't scrolled since touchstart.
      if (window.scrollY > 0) {
        reset();
        setPullDistance(0);
        return;
      }
      active = true;
      const distance = Math.min(MAX_PULL, dy * RESISTANCE);
      setPullDistance(distance);
      // Suppress the browser's own overscroll / native reload while we handle it.
      if (event.cancelable) event.preventDefault();
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      const shouldRefresh = active && pullDistanceRef.current >= TRIGGER_THRESHOLD;
      reset();
      if (shouldRefresh) {
        triggerRefresh();
      } else {
        setPullDistance(0);
      }
    };

    // touchmove must be non-passive so preventDefault works.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [triggerRefresh]);

  const value = useMemo<PullToRefreshContextValue>(
    () => ({ registerHandler, setDisabled, triggerRefresh, remountKey, isRefreshing }),
    [registerHandler, setDisabled, triggerRefresh, remountKey, isRefreshing]
  );

  return (
    <PullToRefreshContext.Provider value={value}>
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} />
      {children}
    </PullToRefreshContext.Provider>
  );
}

function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
}: {
  pullDistance: number;
  isRefreshing: boolean;
}) {
  const visible = pullDistance > 0 || isRefreshing;
  const progress = Math.min(1, pullDistance / TRIGGER_THRESHOLD);
  // Rest position while refreshing, otherwise follow the finger.
  const translateY = isRefreshing ? MAX_PULL * 0.6 : pullDistance;
  const rotation = isRefreshing ? 0 : progress * 270;

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      style={{
        transform: `translateY(${translateY}px)`,
        opacity: visible ? 1 : 0,
        transition: isRefreshing || pullDistance === 0 ? "transform 0.25s ease, opacity 0.25s ease" : "none",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
      }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border">
        <svg
          className={isRefreshing ? "animate-spin" : ""}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          style={{ transform: isRefreshing ? undefined : `rotate(${rotation}deg)` }}
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="hsl(var(--muted))"
            strokeWidth="2.5"
          />
          <path
            d="M12 3a9 9 0 0 1 9 9"
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ opacity: isRefreshing ? 1 : Math.max(0.25, progress) }}
          />
        </svg>
      </div>
    </div>
  );
}

function usePullToRefreshContext(): PullToRefreshContextValue {
  const ctx = useContext(PullToRefreshContext);
  if (!ctx) {
    throw new Error("usePullToRefresh hooks must be used within a PullToRefreshProvider");
  }
  return ctx;
}

/**
 * Register the current page's refresh callback. The callback should re-fetch the
 * data shown on that screen and resolve when done. Automatically unregisters on
 * unmount. Pass a stable/`useCallback`-wrapped fn (or accept it re-registering).
 */
export function useRegisterRefresh(handler: RefreshHandler) {
  const { registerHandler } = usePullToRefreshContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // Wrap in a stable indirection so re-renders don't thrash registration.
    const unregister = registerHandler(() => handlerRef.current());
    return unregister;
  }, [registerHandler]);
}

/** Disable pull-to-refresh while the component using it is mounted. */
export function usePullToRefreshDisabled(disabled: boolean) {
  const { setDisabled } = usePullToRefreshContext();
  useEffect(() => {
    if (!disabled) return;
    setDisabled(true);
    return () => setDisabled(false);
  }, [disabled, setDisabled]);
}

/** Access the remount key for the fallback refresh path. */
export function usePullToRefreshRemountKey(): number {
  return usePullToRefreshContext().remountKey;
}
