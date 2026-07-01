import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COACHING_ROLE_OPTIONS } from "@/lib/coachStaffTeams";
import { normalizeUsername } from "@/lib/usernames";
import { supabase } from "@/integrations/supabase/client";
import { Search, X } from "lucide-react";

type StaffRole = 'head_coach_assistant' | 'scout' | 'academy_director';

interface CoachingTeamSelection {
  team_id: string;
  club_team_id: string | null;
  league_id: string | null;
  team_name: string;
  logo_url: string | null;
  league_name: string | null;
  age_group: string | null;
  label: string;
}

const STAFF_ROLE_OPTIONS = [
  "Club Director",
  "Academy Director",
  "Technical Director",
  "Operations Director",
  "Team Manager",
  "Team Administrator",
  "Team Coordinator",
  "Media Staff",
  "Equipment Manager",
  "Other Team Staff",
] as const;

interface StaffProfileData {
  fullName: string;
  username: string;
  bio: string;
  role: StaffRole;
  coachingRoleType: string;
  scoutRoleTitle: string;
  scoutOrganization: string;
  scoutingLicenses: string;
  scoutingExperience: string;
  scoutingRegions: string;
  scoutingAgeGroups: string;
  scoutingPositions: string;
  scoutingAccolades: string;
  teamOrganizationName: string;
  country: string;
  city: string;
  coachingLevel: string;
  yearsExperience: string;
  coachingLicenses: string;
  ageGroupsCoached: string;
  contactEmail: string;
  contactPhone: string;
  previousTeams: string;
  notableAchievements: string;
  selectedCoachingTeams: CoachingTeamSelection[];
}

interface StaffProfileFormProps {
  email: string;
  staffType: StaffRole;
  onSubmit: (data: StaffProfileData) => void;
  onBack: () => void;
  loading: boolean;
}

const roleLabels: Record<StaffRole, string> = {
  head_coach_assistant: "Coach / Trainer",
  scout: "Scout",
  academy_director: "Team Staff",
};

const StaffProfileForm = ({ email, staffType, onSubmit, onBack, loading }: StaffProfileFormProps) => {
  const [formData, setFormData] = useState<StaffProfileData>({
    fullName: "",
    username: "",
    bio: "",
    role: staffType,
    coachingRoleType:
      staffType === "head_coach_assistant"
        ? "Head Coach"
        : staffType === "academy_director"
          ? "Club Director"
          : "",
    scoutRoleTitle: "Scout",
    scoutOrganization: "",
    scoutingLicenses: "",
    scoutingExperience: "",
    scoutingRegions: "",
    scoutingAgeGroups: "",
    scoutingPositions: "",
    scoutingAccolades: "",
    teamOrganizationName: "",
    country: "",
    city: "",
    coachingLevel: "",
    yearsExperience: "",
    coachingLicenses: "",
    ageGroupsCoached: "",
    contactEmail: email,
    contactPhone: "",
    previousTeams: "",
    notableAchievements: "",
    selectedCoachingTeams: [],
  });
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [teamSearchResults, setTeamSearchResults] = useState<CoachingTeamSelection[]>([]);
  const [teamSearchLoading, setTeamSearchLoading] = useState(false);

  useEffect(() => {
    if (!email) return;
    setFormData((prev) => ({
      ...prev,
      contactEmail: prev.contactEmail || email,
    }));
  }, [email]);

  const handleChange = (field: keyof StaffProfileData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const isScout = staffType === "scout";
  const isAcademyStaff = staffType === "academy_director";
  const maxSelectableTeams = isAcademyStaff ? 1 : 5;
  const selectedTeamKeys = useMemo(
    () => new Set(formData.selectedCoachingTeams.map((team) => `${team.team_id}:${team.club_team_id || "main"}`)),
    [formData.selectedCoachingTeams]
  );

  useEffect(() => {
    if (isScout) return;

    const query = teamSearchQuery.trim();
    if (query.length < 2) {
      setTeamSearchResults([]);
      return;
    }

    let cancelled = false;
    const searchTeams = async () => {
      setTeamSearchLoading(true);
      const teamsResult = await (supabase as any)
        .from("teams")
        .select("id, name, logo_url, league_id, age_group, leagues(name)")
        .ilike("name", `%${query}%`)
        .limit(8);

      const clubTeamsResult = isAcademyStaff
        ? { data: [] }
        : await (supabase as any)
            .from("club_teams")
            .select("id, team_id, league_id, league_name, age_group, level, status, teams(name, logo_url)")
            .or(`age_group.ilike.%${query}%,league_name.ilike.%${query}%,level.ilike.%${query}%`)
            .neq("status", "archived")
            .limit(10);

      if (cancelled) return;

      const parentTeams = ((teamsResult.data || []) as any[]).map((team) => ({
        team_id: team.id,
        club_team_id: null,
        league_id: team.league_id || null,
        team_name: team.name || "Team",
        logo_url: team.logo_url || null,
        league_name: team.leagues?.name || null,
        age_group: team.age_group || null,
        label: [team.name, team.leagues?.name, team.age_group].filter(Boolean).join(" - "),
      }));

      const subTeams = ((clubTeamsResult.data || []) as any[])
        .filter((team) => team.team_id)
        .map((team) => {
          const teamName = team.teams?.name || "Team";
          const details = [team.age_group, team.league_name, team.level].filter(Boolean).join(" - ");
          return {
            team_id: team.team_id,
            club_team_id: team.id,
            league_id: team.league_id || null,
            team_name: teamName,
            logo_url: team.teams?.logo_url || null,
            league_name: team.league_name || null,
            age_group: team.age_group || null,
            label: details ? `${teamName} - ${details}` : teamName,
          };
        });

      const seen = new Set<string>();
      setTeamSearchResults(
        [...parentTeams, ...subTeams].filter((team) => {
          const key = `${team.team_id}:${team.club_team_id || "main"}`;
          if (seen.has(key) || selectedTeamKeys.has(key)) return false;
          seen.add(key);
          return true;
        })
      );
      setTeamSearchLoading(false);
    };

    const timeoutId = window.setTimeout(searchTeams, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isAcademyStaff, isScout, selectedTeamKeys, teamSearchQuery]);

  const addCoachingTeam = (team: CoachingTeamSelection) => {
    if (formData.selectedCoachingTeams.length >= maxSelectableTeams) return;
    const nextTeams = [...formData.selectedCoachingTeams, team];
    setFormData((prev) => ({
      ...prev,
      selectedCoachingTeams: nextTeams,
      teamOrganizationName: nextTeams.map((selectedTeam) => selectedTeam.label).join(", "),
    }));
    setTeamSearchQuery("");
    setTeamSearchResults([]);
  };

  const removeCoachingTeam = (teamKey: string) => {
    const nextTeams = formData.selectedCoachingTeams.filter((team) => `${team.team_id}:${team.club_team_id || "main"}` !== teamKey);
    setFormData((prev) => ({
      ...prev,
      selectedCoachingTeams: nextTeams,
      teamOrganizationName: nextTeams.map((selectedTeam) => selectedTeam.label).join(", "),
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-foreground">{roleLabels[staffType]} Profile</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {isScout ? "Tell us about your scouting work" : isAcademyStaff ? "Tell us about your staff role" : "Tell us about your experience"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="fullName">Full Name *</Label>
          <Input
            id="fullName"
            value={formData.fullName}
            onChange={(e) => handleChange("fullName", e.target.value)}
            placeholder="John Smith"
            required
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="username">Username *</Label>
          <Input
            id="username"
            value={formData.username}
            onChange={(e) => handleChange("username", normalizeUsername(e.target.value))}
            placeholder="coachsmith"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="bio">Bio</Label>
            <span className="text-xs text-muted-foreground">{formData.bio.length}/100</span>
          </div>
          <Input
            id="bio"
            value={formData.bio}
            onChange={(e) => handleChange("bio", e.target.value.slice(0, 100))}
            placeholder="Short bio"
            maxLength={100}
            className="border-2 text-center placeholder:text-center focus:border-navy"
            style={{ textAlign: "center" }}
          />
        </div>

        {!isScout && !isAcademyStaff ? (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="coachingRoleType">Coaching Role / Type *</Label>
          <Select value={formData.coachingRoleType} onValueChange={(v) => handleChange("coachingRoleType", v)} required>
            <SelectTrigger id="coachingRoleType" className="border-2 focus:border-navy">
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {COACHING_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        ) : (
        isScout ? (
        <>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutRoleTitle">Scout Role / Title *</Label>
          <Input
            id="scoutRoleTitle"
            value={formData.scoutRoleTitle}
            onChange={(e) => handleChange("scoutRoleTitle", e.target.value)}
            placeholder="Regional Scout, Academy Scout, Talent ID Scout"
            required
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutOrganization">Team, Club, Academy, or Organization</Label>
          <Input
            id="scoutOrganization"
            value={formData.scoutOrganization}
            onChange={(e) => handleChange("scoutOrganization", e.target.value)}
            placeholder="FC United Academy"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingLicenses">Scouting Licenses / Certifications</Label>
          <Input
            id="scoutingLicenses"
            value={formData.scoutingLicenses}
            onChange={(e) => handleChange("scoutingLicenses", e.target.value)}
            placeholder="Talent ID, USSF, FA Scouting (comma separated)"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingExperience">Scouting Experience</Label>
          <Input
            id="scoutingExperience"
            value={formData.scoutingExperience}
            onChange={(e) => handleChange("scoutingExperience", e.target.value)}
            placeholder="5 years academy scouting, regional tournaments"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingRegions">Regions / Areas Scouted</Label>
          <Input
            id="scoutingRegions"
            value={formData.scoutingRegions}
            onChange={(e) => handleChange("scoutingRegions", e.target.value)}
            placeholder="Florida, Georgia, Southeast"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingAgeGroups">Age Groups Scouted</Label>
          <Input
            id="scoutingAgeGroups"
            value={formData.scoutingAgeGroups}
            onChange={(e) => handleChange("scoutingAgeGroups", e.target.value)}
            placeholder="U13, U15, U17 (comma separated)"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingPositions">Player Positions Focused On</Label>
          <Input
            id="scoutingPositions"
            value={formData.scoutingPositions}
            onChange={(e) => handleChange("scoutingPositions", e.target.value)}
            placeholder="Wingers, center backs, goalkeepers"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="scoutingAccolades">Accolades / Achievements</Label>
          <Textarea
            id="scoutingAccolades"
            value={formData.scoutingAccolades}
            onChange={(e) => handleChange("scoutingAccolades", e.target.value)}
            placeholder="Players discovered, tournaments covered, awards..."
            className="border-2 focus:border-navy min-h-[80px]"
          />
        </div>
        </>
        ) : (
        <>
        <div className="col-span-2 space-y-2">
          <Label htmlFor="coachingRoleType">Staff Role / Title *</Label>
          <Select value={formData.coachingRoleType} onValueChange={(v) => handleChange("coachingRoleType", v)} required>
            <SelectTrigger id="coachingRoleType" className="border-2 focus:border-navy">
              <SelectValue placeholder="Select staff role" />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="teamOrganizationName">Current Team, Club, Academy, or Organization</Label>
          <Input
            id="teamOrganizationName"
            value={formData.teamOrganizationName}
            onChange={(e) => handleChange("teamOrganizationName", e.target.value)}
            placeholder="Search and select your club below, or type an organization"
            className="border-2 focus:border-navy"
          />
        </div>
        </>
        )
        )}

        {!isScout && (
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="teamSearch">{isAcademyStaff ? "Link to Mother Team" : "Teams Currently Coaching"}</Label>
            <span className="text-xs text-muted-foreground">{formData.selectedCoachingTeams.length}/{maxSelectableTeams} selected</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="teamSearch"
              value={teamSearchQuery}
              onChange={(e) => setTeamSearchQuery(e.target.value)}
              placeholder={isAcademyStaff ? "Search mother teams from Explore" : "Search teams and subteams from Explore"}
              className="border-2 pl-9 focus:border-navy"
              disabled={formData.selectedCoachingTeams.length >= maxSelectableTeams}
            />
          </div>
          {formData.selectedCoachingTeams.length >= maxSelectableTeams && (
            <p className="text-xs font-medium text-navy">
              {isAcademyStaff ? "You can link to 1 mother team during signup." : "You can choose up to 5 teams."}
            </p>
          )}
          {formData.selectedCoachingTeams.length > 0 && (
            <div className="space-y-2">
              {formData.selectedCoachingTeams.map((team) => {
                const key = `${team.team_id}:${team.club_team_id || "main"}`;
                return (
                  <div key={key} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2">
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-background border border-border flex items-center justify-center">
                      {team.logo_url ? (
                        <img src={team.logo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground">{team.team_name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{team.team_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[team.age_group, team.league_name].filter(Boolean).join(" - ") || "Main team"}</p>
                    </div>
                    <button type="button" onClick={() => removeCoachingTeam(key)} className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {teamSearchQuery.trim().length >= 2 && (
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              {teamSearchLoading ? (
                <p className="p-3 text-sm text-muted-foreground">Searching teams...</p>
              ) : teamSearchResults.length ? (
                teamSearchResults.map((team) => (
                  <button
                    key={`${team.team_id}:${team.club_team_id || "main"}`}
                    type="button"
                    onClick={() => addCoachingTeam(team)}
                    className="flex w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-muted/50"
                  >
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-muted border border-border flex items-center justify-center">
                      {team.logo_url ? (
                        <img src={team.logo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground">{team.team_name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{team.team_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{[team.age_group, team.league_name].filter(Boolean).join(" - ") || "Main team"}</p>
                    </div>
                  </button>
                ))
              ) : (
                <p className="p-3 text-sm text-muted-foreground">No teams found.</p>
              )}
            </div>
          )}
        </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={formData.country}
            onChange={(e) => handleChange("country", e.target.value)}
            placeholder="USA"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleChange("city", e.target.value)}
            placeholder="Los Angeles"
            className="border-2 focus:border-navy"
          />
        </div>

        {!isScout && !isAcademyStaff && (
        <div className="space-y-2">
          <Label htmlFor="coachingLevel">Coaching Level</Label>
          <Select value={formData.coachingLevel} onValueChange={(v) => handleChange("coachingLevel", v)}>
            <SelectTrigger className="border-2 focus:border-navy">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grassroots">Grassroots</SelectItem>
              <SelectItem value="academy">Academy</SelectItem>
              <SelectItem value="semi_pro">Semi-Pro</SelectItem>
              <SelectItem value="pro">Professional</SelectItem>
            </SelectContent>
          </Select>
        </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="yearsExperience">{isScout ? "Years Scouting" : isAcademyStaff ? "Years of Experience" : "Years Experience"}</Label>
          <Input
            id="yearsExperience"
            type="number"
            value={formData.yearsExperience}
            onChange={(e) => handleChange("yearsExperience", e.target.value)}
            placeholder="5"
            className="border-2 focus:border-navy"
          />
        </div>

        {!isScout && (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="coachingLicenses">{isAcademyStaff ? "Licenses and Certifications" : "Coaching Licenses"}</Label>
          <Input
            id="coachingLicenses"
            value={formData.coachingLicenses}
            onChange={(e) => handleChange("coachingLicenses", e.target.value)}
            placeholder={isAcademyStaff ? "Safeguarding, operations, admin certifications" : "UEFA B, USSF D (comma separated)"}
            className="border-2 focus:border-navy"
          />
        </div>
        )}

        {!isScout && !isAcademyStaff && (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="ageGroupsCoached">Age Groups Coached</Label>
          <Input
            id="ageGroupsCoached"
            value={formData.ageGroupsCoached}
            onChange={(e) => handleChange("ageGroupsCoached", e.target.value)}
            placeholder="U12, U14, U16 (comma separated)"
            className="border-2 focus:border-navy"
          />
        </div>
        )}

        <div className="col-span-2 space-y-2">
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input
            id="contactEmail"
            type="email"
            value={formData.contactEmail}
            onChange={(e) => handleChange("contactEmail", e.target.value)}
            placeholder="coach@example.com"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="contactPhone">Contact Phone</Label>
          <Input
            id="contactPhone"
            type="tel"
            value={formData.contactPhone}
            onChange={(e) => handleChange("contactPhone", e.target.value)}
            placeholder="(555) 123-4567"
            className="border-2 focus:border-navy"
          />
        </div>

        {!isScout && (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="previousTeams">{isAcademyStaff ? "Previous Teams or Organizations Worked With" : "Past Coaching Experience"}</Label>
          <Input
            id="previousTeams"
            value={formData.previousTeams}
            onChange={(e) => handleChange("previousTeams", e.target.value)}
            placeholder={isAcademyStaff ? "Club A, Academy B, Team C" : "Team A assistant coach, Team B academy coach"}
            className="border-2 focus:border-navy"
          />
        </div>
        )}

        {!isScout && (
        <div className="col-span-2 space-y-2">
          <Label htmlFor="notableAchievements">{isAcademyStaff ? "Accolades and Achievements" : "Accolades / Achievements"}</Label>
          <Textarea
            id="notableAchievements"
            value={formData.notableAchievements}
            onChange={(e) => handleChange("notableAchievements", e.target.value)}
            placeholder={isAcademyStaff ? "Programs managed, awards, operational achievements..." : "Championships, awards, player development successes..."}
            className="border-2 focus:border-navy min-h-[80px]"
          />
        </div>
        )}
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button
          type="submit"
          className="flex-1 bg-gradient-to-r from-navy to-primary hover:from-navy-light hover:to-primary"
          disabled={loading}
        >
          {loading ? "Creating..." : "Create Account"}
        </Button>
      </div>
    </form>
  );
};

export default StaffProfileForm;
