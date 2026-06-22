import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, MapPin, Shield, Star, Trophy, User, Users } from "lucide-react";
import Header from "@/components/Header";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { CoachStaffProfile, CoachStaffTeamLink, fetchCoachStaffTeamLinksForUser, formatRoleDisplayLabel } from "@/lib/coachStaffTeams";
import InlineProfileAdminControls from "@/components/admin/InlineProfileAdminControls";

const CoachStaffProfilePage = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<CoachStaffProfile | null>(null);
  const [teams, setTeams] = useState<CoachStaffTeamLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) return;

      const [{ data }, linkedTeams] = await Promise.all([
        (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, account_category, account_role, coaching_role_type, teams_currently_coaching, past_coaching_experience, coaching_licenses, coaching_accolades, coaching_location, scout_role_title, scout_organization, scouting_licenses, scouting_experience, scouting_regions, scouting_age_groups, scouting_positions, scouting_accolades, bio")
          .eq("user_id", userId)
          .maybeSingle(),
        fetchCoachStaffTeamLinksForUser(userId).catch(() => []),
      ]);

      setProfile((data || null) as CoachStaffProfile | null);
      setTeams(linkedTeams);
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
          <InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} />
          <div className="flex flex-col items-center mb-6">
            <div className="w-28 h-28 rounded-full bg-foreground flex items-center justify-center overflow-hidden mb-4">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name || "Coach"} className="w-full h-full object-cover" />
              ) : (
                <User className="h-14 w-14 text-background" />
              )}
            </div>
            <h1 className="text-center text-2xl font-bold text-foreground">{profile.full_name || (isParent ? "Parent / Guardian" : isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coach / Staff")}</h1>
            <p className="mt-1 text-sm font-medium text-navy">
              {isParent
                ? "Parent / Guardian"
                : isScout
                  ? formatRoleDisplayLabel(profile.scout_role_title, "Scout")
                  : isAcademyStaff
                    ? formatRoleDisplayLabel(profile.coaching_role_type || profile.account_role, "Club Director / Team Staff")
                    : formatRoleDisplayLabel(profile.coaching_role_type || profile.account_role, "Coaching Staff")}
            </p>
            {profile.username ? <p className="text-sm text-muted-foreground">@{profile.username}</p> : null}
            {profile.bio ? <p className="mx-auto mt-2 max-w-xs whitespace-pre-wrap text-center text-sm text-muted-foreground">{profile.bio}</p> : null}
          </div>

          {teams.length ? (
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy">Current Teams</h2><InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="teams" label="Manage team links" /></div>
              <div className="space-y-3">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    onClick={() => navigate(`/team/${team.team_id}`)}
                    className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden">
                      {team.team_logo_url ? (
                        <img src={team.team_logo_url} alt={team.team_name} className="w-full h-full object-cover" />
                      ) : (
                        <Shield className="h-6 w-6 text-white" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{team.team_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatRoleDisplayLabel(
                          team.staff_role || (isScout ? profile.scout_role_title : profile.coaching_role_type),
                          isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coaching Staff"
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-semibold text-navy mb-3">{isParent ? "Parent / Guardian Details" : isScout ? "Scout Details" : isAcademyStaff ? "Club Director / Team Staff Details" : "Coach / Staff Details"}</h2><InlineProfileAdminControls targetUserId={profile.user_id} targetName={profile.full_name} section="profile" label="Edit profile information" /></div>
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
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
              {isAcademyStaff && profile.past_coaching_experience ? (
                <div className="flex items-center gap-3 p-4">
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Previous Organizations</p><p className="font-medium">{profile.past_coaching_experience}</p></div>
                </div>
              ) : null}
              {(isScout ? profile.scouting_accolades : profile.coaching_accolades) ? (
                <div className="flex items-center gap-3 p-4">
                  <Star className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Accolades</p><p className="font-medium">{isScout ? profile.scouting_accolades : profile.coaching_accolades}</p></div>
                </div>
              ) : null}
              {!isScout && profile.coaching_location ? (
                <div className="flex items-center gap-3 p-4">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Location</p><p className="font-medium">{profile.coaching_location}</p></div>
                </div>
              ) : null}
              <div className="flex items-center gap-3 p-4">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                <div><p className="text-sm text-muted-foreground">Role</p><p className="font-medium">{formatRoleDisplayLabel(isScout ? profile.scout_role_title : profile.coaching_role_type || profile.account_role, isScout ? "Scout" : isAcademyStaff ? "Team Staff" : "Coaching Staff")}</p></div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default CoachStaffProfilePage;
