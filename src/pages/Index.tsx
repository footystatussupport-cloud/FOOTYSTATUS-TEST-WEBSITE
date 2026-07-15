import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import TabNavigation from "@/components/TabNavigation";
import HomeTab from "@/components/HomeTab";
import ExploreTab from "@/components/ExploreTab";
import MatchesTab from "@/components/MatchesTab";
import NextUpTab from "@/components/NextUpTab";

const Index = () => {
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState("Home");
  const navigate = useNavigate();

  useEffect(() => {
    if (tabFromUrl) {
      const tabMap: Record<string, string> = {
        home: "Home",
        explore: "Explore",
        matches: "Matches",
        "next-up": "Next-Up Clips",
      };
      if (tabMap[tabFromUrl]) {
        setActiveTab(tabMap[tabFromUrl]);
      }
    }
  }, [tabFromUrl]);

  const handleTabChange = (tab: string) => {
    if (tab === "Other") {
      navigate("/other");
    } else {
      setActiveTab(tab);
    }
  };

  const isNextUpActive = activeTab === "Next-Up Clips";

  const renderContent = () => {
    switch (activeTab) {
      case "Home":
        return <HomeTab />;
      case "Explore":
        return <ExploreTab />;
      case "Matches":
        return <MatchesTab />;
      case "Next-Up Clips":
        return <NextUpTab />;
      default:
        return <HomeTab />;
    }
  };

  // Reserve room at the bottom of every screen for the fixed bottom nav bar
  // (its own height plus the device's home-indicator safe area).
  const bottomNavSpacing = "calc(var(--footy-bottom-nav) + env(safe-area-inset-bottom))";

  return (
    <div
      className={
        isNextUpActive
          ? "mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden border-x border-border bg-background"
          : "mx-auto min-h-[100dvh] max-w-md border-x border-border bg-background"
      }
      style={isNextUpActive ? { paddingBottom: bottomNavSpacing } : undefined}
    >
      {/* Top HUD is hidden only while viewing the Next Up feed. */}
      {!isNextUpActive && <Header />}

      <main
        className={isNextUpActive ? "min-h-0 flex-1 overflow-hidden" : undefined}
        style={isNextUpActive ? undefined : { paddingBottom: bottomNavSpacing }}
      >
        {renderContent()}
      </main>

      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
};

export default Index;
