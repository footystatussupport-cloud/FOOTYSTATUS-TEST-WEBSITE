import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { SettingsProvider } from "@/hooks/useSettings";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import OtherPage from "./pages/OtherPage";
import AuthPage from "./pages/AuthPage";
import PlayerProfile from "./pages/PlayerProfile";
import MatchDetails from "./pages/MatchDetails";
import TeamProfile from "./pages/TeamProfile";
import ClubTeamProfile from "./pages/ClubTeamProfile";
import LeaguePage from "./pages/LeaguePage";
import NotFound from "./pages/NotFound";
import SettingsPage from "./pages/SettingsPage";
import NotificationsPage from "./pages/NotificationsPage";
import PrivacyPage from "./pages/PrivacyPage";
import SupportPage from "./pages/SupportPage";
import AboutPage from "./pages/AboutPage";
import ProfilePage from "./pages/ProfilePage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ClubNewsArchivePage from "./pages/ClubNewsArchivePage";
import ClubNewsDetailPage from "./pages/ClubNewsDetailPage";
import ProUpgradePage from "./pages/ProUpgradePage";
import ProfileAnalyticsPage from "./pages/ProfileAnalyticsPage";
import CoachStaffProfilePage from "./pages/CoachStaffProfilePage";
import RefereeDashboardPage from "./pages/RefereeDashboardPage";
import RefereeProfilePage from "./pages/RefereeProfilePage";
import PlayerGenderCompletionGate from "./components/PlayerGenderCompletionGate";
import AccountModerationGate from "./components/AccountModerationGate";
import RefereeOnboardingGate from "./components/RefereeOnboardingGate";
import ClipSharePage from "./pages/ClipSharePage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <SettingsProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <PlayerGenderCompletionGate />
          <BrowserRouter>
            <RefereeOnboardingGate>
            <AccountModerationGate>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/other" element={<OtherPage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/clip/:clipId" element={<ClipSharePage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/player/:id" element={<ProtectedRoute><PlayerProfile /></ProtectedRoute>} />
              <Route path="/coach/:userId" element={<ProtectedRoute><CoachStaffProfilePage /></ProtectedRoute>} />
              <Route path="/staff/:userId" element={<ProtectedRoute><CoachStaffProfilePage /></ProtectedRoute>} />
              <Route path="/scout/:userId" element={<ProtectedRoute><CoachStaffProfilePage /></ProtectedRoute>} />
              <Route path="/match/:id" element={<ProtectedRoute><MatchDetails /></ProtectedRoute>} />
              <Route path="/team/:id" element={<ProtectedRoute><TeamProfile /></ProtectedRoute>} />
              <Route path="/club-team/:id" element={<ProtectedRoute><ClubTeamProfile /></ProtectedRoute>} />
              <Route path="/team/:id/news" element={<ProtectedRoute><ClubNewsArchivePage /></ProtectedRoute>} />
              <Route path="/club-news/:id" element={<ProtectedRoute><ClubNewsDetailPage /></ProtectedRoute>} />
              <Route path="/league/:id" element={<ProtectedRoute><LeaguePage /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
              <Route path="/privacy" element={<ProtectedRoute><PrivacyPage /></ProtectedRoute>} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/pro" element={<ProUpgradePage />} />
              <Route path="/analytics" element={<ProtectedRoute><ProfileAnalyticsPage /></ProtectedRoute>} />
              <Route path="/referee" element={<ProtectedRoute><RefereeDashboardPage /></ProtectedRoute>} />
              <Route path="/referee-profile/:userId" element={<ProtectedRoute><RefereeProfilePage /></ProtectedRoute>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </AccountModerationGate>
            </RefereeOnboardingGate>
          </BrowserRouter>
        </TooltipProvider>
      </SettingsProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
