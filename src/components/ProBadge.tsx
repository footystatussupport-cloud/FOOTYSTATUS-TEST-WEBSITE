import { useEffect, useRef, useState } from "react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProBadgeProps {
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  showInfoBubble?: boolean;
}

const ProBadge = ({ className, compact = false, iconOnly = false, showInfoBubble = false }: ProBadgeProps) => {
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const showBubble = () => {
    if (!showInfoBubble) return;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    setIsBubbleVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      setIsBubbleVisible(false);
      hideTimerRef.current = null;
    }, 3000);
  };

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    []
  );

  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800",
          iconOnly && "h-5 w-5 justify-center gap-0 px-0 py-0",
          showInfoBubble && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2",
          className
        )}
        aria-label="Footy Status Pro"
        role={showInfoBubble ? "button" : undefined}
        tabIndex={showInfoBubble ? 0 : undefined}
        aria-expanded={showInfoBubble ? isBubbleVisible : undefined}
        onMouseEnter={showBubble}
        onClick={showBubble}
        onKeyDown={(event) => {
          if (showInfoBubble && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            showBubble();
          }
        }}
      >
        <Crown className="h-3 w-3" />
        {!iconOnly ? (compact ? "Pro" : "Footy Status Pro") : null}
      </span>
      {showInfoBubble && isBubbleVisible ? (
        <span
          role="status"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[14rem] -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-center text-xs font-medium text-popover-foreground shadow-lg"
        >
          This player has a Footy Status Pro account.
        </span>
      ) : null}
    </span>
  );
};

export default ProBadge;
