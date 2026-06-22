import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Calendar, Shield, Star, Trophy, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";
import { useAuth } from "@/hooks/useAuth";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

interface PublicRefereeProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  referee_certification_level: string | null;
  referee_certifying_organization: string | null;
  referee_years_experience: number | null;
  referee_main_experience: string | null;
  referee_assistant_experience: string | null;
  referee_leagues_tournaments: string | null;
  referee_availability: string | null;
  referee_accolades: string | null;
  referee_profile_public: boolean | null;
}

const DetailRow = ({ icon: Icon, label, value }: { icon: typeof Shield; label: string; value?: string | number | null }) => {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-center gap-3 p-4">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
};

const RefereeProfilePage = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOfficial = isFootyStatusSuperAdminEmail(user?.email);
  const [profile, setProfile] = useState<PublicRefereeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) return;
      setLoading(true);
      const { data } = await (supabase as any)
        .from("profiles")
        .select(
          "user_id, full_name, avatar_url, bio, referee_certification_level, referee_certifying_organization, referee_years_experience, referee_main_experience, referee_assistant_experience, referee_leagues_tournaments, referee_availability, referee_accolades, referee_profile_public"
        )
        .eq("user_id", userId)
        .eq("account_category", "referee")
        .maybeSingle();
      setProfile(data || null);
      setLoading(false);
    };

    loadProfile();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="mb-6 h-8 w-28" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!profile || (!profile.referee_profile_public && !isOfficial)) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>
        <div className="mt-12 rounded-xl border border-border bg-card p-6 text-center">
          <Shield className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-bold text-foreground">Private referee profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">This referee has not made their profile public.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border">
      <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>
      </header>

      <main className="space-y-5 p-4">
        <InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} />
        <section className="rounded-2xl bg-gradient-to-br from-navy to-primary p-5 text-center text-white">
          <div className="flex flex-col items-center">
            <div className="mb-4 h-20 w-20 overflow-hidden rounded-full border border-white/20 bg-white/15">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name || "Referee"} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Shield className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="w-full">
              <h1 className="mx-auto max-w-[14rem] break-words text-center text-2xl font-bold">{profile.full_name || "Referee"}</h1>
              <p className="text-sm text-white/75">{profile.referee_certification_level || "Referee"}</p>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-xl border border-border bg-card">
          <div className="absolute right-3 top-3 z-10"><InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="profile" label="Edit referee information" /></div>
          <DetailRow icon={Trophy} label="Certification Level" value={profile.referee_certification_level} />
          <DetailRow icon={Building2} label="Certifying Organization" value={profile.referee_certifying_organization} />
          <DetailRow icon={Calendar} label="Refereeing Experience" value={profile.referee_years_experience != null ? `${profile.referee_years_experience} years` : null} />
          <DetailRow icon={Star} label="Main Referee Experience" value={profile.referee_main_experience} />
          <DetailRow icon={Star} label="Assistant Referee Experience" value={profile.referee_assistant_experience} />
          <DetailRow icon={Trophy} label="Leagues / Tournaments" value={profile.referee_leagues_tournaments} />
          <DetailRow icon={Calendar} label="Availability" value={profile.referee_availability} />
          <DetailRow icon={Star} label="Accolades / Notable Matches" value={profile.referee_accolades} />
          <DetailRow icon={User} label="Bio" value={profile.bio} />
        </section>
      </main>
    </div>
  );
};

export default RefereeProfilePage;
