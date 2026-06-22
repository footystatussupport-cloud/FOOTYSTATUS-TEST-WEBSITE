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
  label: "Next Up\nClips"
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
  return <nav className="px-4 bg-card border-b border-border w-full flex flex-row py-0">
      <div className="flex items-center justify-between w-full py-[3px]">
        {tabs.map(({
        name,
        icon: Icon,
        label
      }) => {
        return <button key={name} onClick={() => onTabChange(name)} className={cn("flex flex-col items-center justify-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-lg transition-all duration-200", activeTab === name ? "bg-navy text-white" : "text-muted-foreground hover:text-foreground")}>
                <Icon className={cn("h-6 w-6", activeTab === name ? "text-white" : "text-accent")} />
                <span className="whitespace-pre-line text-center leading-tight text-xs">{label}</span>
              </button>;
      })}
      </div>
    </nav>;
};
export default TabNavigation;