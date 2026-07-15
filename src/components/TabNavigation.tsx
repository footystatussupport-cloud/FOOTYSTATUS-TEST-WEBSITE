import { cn } from "@/lib/utils";
import { Home, Search, CalendarDays, MoreHorizontal, Play } from "lucide-react";
interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}
const tabs = [{
  name: "Home",
  icon: Home,
  label: "Home"
}, {
  name: "Matches",
  icon: CalendarDays,
  label: "Matches"
}, {
  name: "Next-Up Clips",
  icon: Play,
  label: "Next Up"
}, {
  name: "Explore",
  icon: Search,
  label: "Explore"
}, {
  name: "Other",
  icon: MoreHorizontal,
  label: "Other",
  isLink: true
}];
const TabNavigation = ({
  activeTab,
  onTabChange
}: TabNavigationProps) => {
  return (
    <nav
      className="fixed bottom-0 left-1/2 z-50 w-full max-w-md -translate-x-1/2 border-t border-border bg-card/95 px-1 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-[var(--footy-bottom-nav)] w-full items-stretch">
        {tabs.map(({
          name,
          icon: Icon,
          label
        }) => {
          const isActive = activeTab === name;
          return (
            <button
              key={name}
              onClick={() => onTabChange(name)}
              className={cn(
                "flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-[10px] font-medium leading-none transition-colors duration-200",
                isActive ? "text-navy" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-navy" : "text-accent")} />
              <span className="w-full truncate text-center">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
export default TabNavigation;
