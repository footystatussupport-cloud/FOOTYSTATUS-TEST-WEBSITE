import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, Link as LinkIcon, Mail, MapPin, Phone, Shield, Star, Trophy, User, Users } from "lucide-react";
import Header from "@/components/Header";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { CoachStaffProfile, CoachStaffTeamLink, fetchCoachStaffTeamLinksForUser, formatRoleDisplayLabel, groupCoachStaffTeamLinksByMotherTeam } from "@/lib/coachStaffTeams";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";
import ProfileHeader from "@/components/ProfileHeader";

interface ContactItem {
  id: string;
  contact_type: string;
  value: string;
  visibility: string;
}

const CONTACT_TYPE_LABELS: Record<string, string> = {
  player_email: "Email",
  player_phone: "Phone",
  coach_email: "Email",
  coach_phone: "Phone",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Website",
};

interface StaffRecordDetails {
  country: string | null;
  city: string | null;
  years_experience: number | null;
}

const CoachStaffProfilePage = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CoachStaffProfile | null>(null);
  const [teams, setTeams] = useState<CoachStaffTeamLink[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [staffRecord, setStaffRecord] = useState<StaffRecordDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) return;

      const [{ data }, linkedTeams, contactRes, staffRes] = await Promise.all([
        (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, account_category, account_role, coaching_role_type, teams_currently_coaching, past_coaching_experience, coaching_licenses, coaching_accolades, coaching_location, scout_role_title, scout_organization, scouting_licenses, scouting_experience, scouting_regions, scouting_age_groups, scouting_positions, scouting_accolades, bio")
          .eq("user_id", userId)
          .maybeSingle(),
        fetchCoachStaffTeamLinksForUser(userId).catch(() => []),
        // Contact information lives only in the Contact Information section and
        // is enforced server-side by the account's contact privacy setting.
        (supabase as any).rpc("get_profile_contact_info", { _target_user_id: userId }),
        (supabase as any)
          .from("staff_profiles")
          .select("country, city, years_experience")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      setProfile((data || null) as CoachStaffProfile | null);
      setTeams(linkedTeams);
      setContacts((contactRes?.data || []) as ContactItem[]);
      setStaffRecord((staffRes?.data || null) as StaffRecordDetails | null);
      setLoading(false);
    };

    loadProfile();
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <Skeleton className="h-8 w-24 mb-6" />
        <Skeleton className="h-24 w-24 rounded-full mx-auto mb-4" />
        <Skeleton className="h-6 w-48 mx-auto" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background max-w-md mx-auto border-x border-border p-4">
        <button onClick={() => navigate("/?tab=explore")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Explore
        </button>
          <p className="text-center mt-12 text-muted-foreground">Profile not found</p>
      </div>
    );
  }

  const isScout = profile.account_role === "scout";
  const isAcademyStaff = profile.account_role === "academy_director";
  const isParent = profile.account_category === "parent" || profile.account_role === "parent";
  const coachStaffTeamGroups = useMemo(() => groupCoachStaffTeamLinksByMotherTeam(teams), [teams]);
  const dedupedContacts = contacts.reduce<ContactItem[]>((result, contact) => {
    const normalizedKind = contact.contact_type.includes("email")
      ? "email"
      : contact.contact_type.includes("phone")
        ? "phone"
        : contact.contact_type;
    const alreadyAdded = result.some((item) => {
      const itemKind = item.contact_type.includes("email")
        ? "email"
        : item.contact_type.includes("phone")
          ? "phone"
          : item.contact_type;
      return itemKind === normalizedKind;
    });
    return alreadyAdded ? result : [...result, contact];
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        <header className="sticky top-0 bg-background border-b border-border px-4 py-3 z-10">
          <button onClick={() => navigate("/?tab=explore")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
            Back to Explore
          </button>
        </header>

        <main className="p-4">
          <ProfileHeader
            avatarUrl={profile.avatar_url}
            displayName={profile.full_name || (isParent ? "Parent / Guardian" : isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coach / Staff")}
            roleLabel={
              isParent
                ? "Parent"
                : isScout
                  ? formatRoleDisplayLabel(profile.scout_role_title, "Scout")
                  : isAcademyStaff
                    ? formatRoleDisplayLabel(profile.coaching_role_type || profile.account_role, "Team Staff")
                    : formatRoleDisplayLabel(profile.coaching_role_type || profile.account_role, "Coaching Staff")
            }
            username={profile.username}
            bio={profile.bio}
            topRight={<InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} />}
          />

          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy mb-3">{isParent ? "Parent / Guardian Details" : isScout ? "Scout Details" : isAcademyStaff ? "Club Director / Team Staff Details" : "Coach / Staff Details"}</h2><InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="profile" label="Edit profile information" /></div>
            <div className="bg-card border border-border rounded-xl">
              {isAcademyStaff && profile.teams_currently_coaching ? (
                <div className="flex items-center gap-3 p-4">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Current Team / Organization</p><p className="font-medium">{profile.teams_currently_coaching}</p></div>
                </div>
              ) : null}
              {isScout && profile.scout_organization ? (
                <div className="flex items-center gap-3 p-4">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Organization / Team</p><p className="font-medium">{profile.scout_organization}</p></div>
                </div>
              ) : null}
              {!isScout && !isAcademyStaff && profile.teams_currently_coaching ? (
                <div className="flex items-center gap-3 p-4">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Teams Coached</p><p className="font-medium">{profile.teams_currently_coaching}</p></div>
                </div>
              ) : null}
              {isScout && profile.scouting_experience ? (
                <div className="flex items-center gap-3 p-4">
                  <Trophy className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Scouting Experience</p><p className="font-medium">{profile.scouting_experience}</p></div>
                </div>
              ) : null}
              {isAcademyStaff && profile.past_coaching_experience ? (
                <div className="flex items-center gap-3 p-4">
                  <Trophy className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Work Experience</p><p className="font-medium">{profile.past_coaching_experience}</p></div>
                </div>
              ) : null}
              {!isScout && !isAcademyStaff && profile.past_coaching_experience ? (
                <div className="flex items-center gap-3 p-4">
                  <Trophy className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Coaching Experience</p><p className="font-medium">{profile.past_coaching_experience}</p></div>
                </div>
              ) : null}
              {(isScout ? profile.scouting_licenses : profile.coaching_licenses)?.length ? (
                <div className="flex items-center gap-3 p-4">
                  <Star className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Licenses / Certifications</p><p className="font-medium">{(isScout ? profile.scouting_licenses : profile.coaching_licenses)?.join(", ")}</p></div>
                </div>
              ) : null}
              {isScout && profile.scouting_regions ? (
                <div className="flex items-center gap-3 p-4">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Regions Covered</p><p className="font-medium">{profile.scouting_regions}</p></div>
                </div>
              ) : null}
              {isScout && profile.scouting_age_groups?.length ? (
                <div className="flex items-center gap-3 p-4">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Age Groups Covered</p><p className="font-medium">{profile.scouting_age_groups.join(", ")}</p></div>
                </div>
              ) : null}
              {isScout && profile.scouting_positions?.length ? (
                <div className="flex items-center gap-3 p-4">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Positions Scouted</p><p className="font-medium">{profile.scouting_positions.join(", ")}</p></div>
                </div>
              ) : null}
              {(isScout ? profile.scouting_accolades : profile.coaching_accolades) ? (
                <div className="flex items-center gap-3 p-4">
                  <Star className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Accolades</p><p className="font-medium">{isScout ? profile.scouting_accolades : profile.coaching_accolades}</p></div>
                </div>
              ) : null}
              {(staffRecord?.city || staffRecord?.country || profile.coaching_location) ? (
                <div className="flex items-center gap-3 p-4">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Location</p>
                    <p className="font-medium">{[staffRecord?.city, staffRecord?.country].filter(Boolean).join(", ") || profile.coaching_location}</p>
                  </div>
                </div>
              ) : null}
              {staffRecord?.years_experience != null ? (
                <div className="flex items-center gap-3 p-4">
                  <Star className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">{isScout ? "Years Scouting" : "Years of Experience"}</p>
                    <p className="font-medium">{staffRecord.years_experience} years</p>
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-3 p-4">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Role</p><p className="font-medium">{formatRoleDisplayLabel(isScout ? profile.scout_role_title : profile.coaching_role_type || profile.account_role, isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coaching Staff")}</p></div>
              </div>
            </div>
          </section>

          {coachStaffTeamGroups.length ? (
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-navy">Current Teams</h2>
                <InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="teams" label="Manage team links" />
              </div>
              <div className="space-y-3">
                {coachStaffTeamGroups.map((group) => (
                  <button
                    key={group.team_id}
                    onClick={() => navigate(`/team/${group.team_id}`)}
                    className="w-full bg-card border border-border rounded-xl p-4 flex items-start gap-3 hover:border-accent hover:shadow-sm transition-all text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden shrink-0">
                      {group.team_logo_url ? (
                        <img src={group.team_logo_url} alt={group.team_name} className="w-full h-full object-cover" />
                      ) : (
                        <Shield className="h-6 w-6 text-white" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{group.team_name}</p>
                      <div className="mt-1 space-y-0.5">
                        {group.mother_link ? (
                          <p className="text-xs text-muted-foreground">
                            Mother Team — {formatRoleDisplayLabel(group.mother_link.staff_role || (isScout ? profile.scout_role_title : profile.coaching_role_type), isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coaching Staff")}
                          </p>
                        ) : null}
                        {group.daughter_links.map((link) => (
                          <p key={link.id} className="text-xs text-muted-foreground">
                            {link.club_team_name || "Daughter Team"} — {formatRoleDisplayLabel(link.staff_role || (isScout ? profile.scout_role_title : profile.coaching_role_type), isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coaching Staff")}
                          </p>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {dedupedContacts.length ? (
            <section className="mb-6">
              <h2 className="mb-3 text-lg font-semibold text-navy">Contact Information</h2>
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                {dedupedContacts.map((contact) => (
                  <div key={contact.id} className="flex items-start gap-3 min-w-0">
                    {contact.contact_type.includes("phone") ? (
                      <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                    ) : contact.contact_type.includes("email") ? (
                      <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                    ) : (
                      <LinkIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{CONTACT_TYPE_LABELS[contact.contact_type] || contact.contact_type}</p>
                      {contact.contact_type.includes("phone") ? (
                        <a href={`tel:${contact.value}`} className="text-sm text-navy hover:underline break-all min-w-0">{contact.value}</a>
                      ) : contact.contact_type.includes("email") ? (
                        <a href={`mailto:${contact.value}`} className="text-sm text-navy hover:underline break-all min-w-0">{contact.value}</a>
                      ) : (
                        <a
                          href={contact.value.startsWith("http") ? contact.value : `https://${contact.value}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-navy hover:underline break-all min-w-0"
                        >
                          {contact.value}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default CoachStaffProfilePage;
