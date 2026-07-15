import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisterRefresh } from "@/hooks/usePullToRefresh";
import { ArrowLeft, BadgeCheck, Building2, Calendar, Mail, Phone, Shield, Star, Trophy } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";
import ProfileHeader from "@/components/ProfileHeader";
import { useAuth } from "@/hooks/useAuth";
import { isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";

interface PublicRefereeProfile {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
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
  referee_verification_status?: string | null;
}

interface ContactItem {
  id: string;
  contact_type: string;
  value: string;
  visibility: string;
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
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("profiles")
      .select(
        "user_id, full_name, username, avatar_url, email, bio, referee_certification_level, referee_certifying_organization, referee_years_experience, referee_main_experience, referee_assistant_experience, referee_leagues_tournaments, referee_availability, referee_accolades, referee_profile_public, referee_verification_status"
      )
      .eq("user_id", userId)
      .eq("account_category", "referee")
      .maybeSingle();

    let contactRows: ContactItem[] = [];
    if (data?.user_id) {
      if (isOfficial) {
        const bundle = await (supabase as any).rpc("admin_get_account_bundle", { _target_user_id: data.user_id });
        contactRows = (bundle.data?.contacts || []).filter((item: ContactItem) => item.value?.trim());
      } else {
        const contactRes = await (supabase as any).rpc("get_profile_contact_info", { _target_user_id: data.user_id });
        contactRows = (contactRes.data || []).filter((item: ContactItem) => item.value?.trim());
      }
    }

    setProfile(data || null);
    setContacts(contactRows);
    setLoading(false);
  }, [userId, isOfficial]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useRegisterRefresh(loadProfile);

  const primaryEmail = useMemo(() => {
    const row = contacts.find((contact) => ["player_email", "coach_email"].includes(contact.contact_type));
    return row?.value || profile?.email || null;
  }, [contacts, profile?.email]);

  const primaryPhone = useMemo(() => {
    const row = contacts.find((contact) => ["player_phone", "coach_phone"].includes(contact.contact_type));
    return row?.value || null;
  }, [contacts]);

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
        <ProfileHeader
          avatarUrl={profile.avatar_url}
          displayName={profile.full_name || "Referee"}
          roleLabel="Referee"
          username={profile.username}
          usernameBadge={
            profile.referee_verification_status === "verified" ? (
              <BadgeCheck className="h-4 w-4 shrink-0 text-green-600" aria-label="Verified referee" />
            ) : null
          }
          bio={profile.bio}
          fallbackIcon={<Shield className="h-12 w-12 text-background" />}
          topRight={<InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} onChanged={loadProfile} />}
          below={
            profile.referee_verification_status === "verified" ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                <Shield className="h-3.5 w-3.5" /> Footy Status Verified Referee
              </span>
            ) : null
          }
        />

        <section className="relative overflow-hidden rounded-xl border border-border bg-card">
          <div className="absolute right-3 top-3 z-10"><InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="profile" label="Edit referee information" onChanged={loadProfile} /></div>
          <DetailRow icon={Trophy} label="Certification Level" value={profile.referee_certification_level} />
          <DetailRow icon={Building2} label="Certifying Organization" value={profile.referee_certifying_organization} />
          <DetailRow icon={Calendar} label="Refereeing Experience" value={profile.referee_years_experience != null ? `${profile.referee_years_experience} years` : null} />
          <DetailRow icon={Star} label="Main Referee Experience" value={profile.referee_main_experience} />
          <DetailRow icon={Star} label="Assistant Referee Experience" value={profile.referee_assistant_experience} />
          <DetailRow icon={Trophy} label="Leagues / Tournaments" value={profile.referee_leagues_tournaments} />
          <DetailRow icon={Calendar} label="Availability" value={profile.referee_availability} />
          <DetailRow icon={Star} label="Accolades / Notable Matches" value={profile.referee_accolades} />
        </section>

        {(isOfficial || primaryEmail || primaryPhone) ? (
          <section className="relative overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="text-sm font-bold tracking-wide text-navy">CONTACT INFORMATION</h2>
              <InlineProfileAdminControls
                targetUserId={profile.user_id}
                targetName={profile.full_name}
                section="profile"
                label="Edit referee contact information"
                onChanged={loadProfile}
              />
            </div>
            {primaryEmail ? (
              <DetailRow icon={Mail} label="Email Address" value={primaryEmail} />
            ) : null}
            {primaryPhone ? (
              <DetailRow icon={Phone} label="Phone Number" value={primaryPhone} />
            ) : null}
            {!primaryEmail && !primaryPhone ? (
              <div className="p-4 text-sm text-muted-foreground">No contact information added yet.</div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
};

export default RefereeProfilePage;
