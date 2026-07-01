import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ClubTeamsManager, { OfferedClubTeam } from "@/components/club/ClubTeamsManager";
import { normalizeUsername } from "@/lib/usernames";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const SCHOOL_LEVEL_OPTIONS = [
  { value: "varsity", label: "High School Varsity" },
  { value: "junior_varsity", label: "Junior Varsity" },
  { value: "prep", label: "Prep Team" },
  { value: "middle_school", label: "Middle School Team" },
];

const cleanEmail = (value: string) => value.trim().toLowerCase();
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));

interface TeamProfileData {
  clubName: string;
  username: string;
  bio: string;
  foundedYear: string;
  city: string;
  state: string;
  country: string;
  homeFieldAddress: string;
  trainingGroundAddress: string;
  homeJerseyColor: string;
  awayJerseyColor: string;
  thirdKitColor: string;
  contactEmail: string;
  contactPhone: string;
  staffMembers: { name: string; role: string; personalEmail: string }[];
  offeredTeams: OfferedClubTeam[];
  teamType: "club" | "school";
  schoolName: string;
  teamMascot: string;
  sport: string;
  schoolLevel: string;
  schoolLevels: string[];
  teamGender: "" | "boy" | "girl";
  leagueConference: string;
  schoolWebsite: string;
  schoolLogoUrl: string;
  headCoachName: string;
  headCoachEmail: string;
  headCoachPhone: string;
  teamColors: string;
  socialLinks: string;
}

interface TeamProfileFormProps {
  email: string;
  teamType?: "club" | "school";
  onSubmit: (data: TeamProfileData) => void;
  onBack: () => void;
  loading: boolean;
}

const TeamProfileForm = ({ email, teamType = "club", onSubmit, onBack, loading }: TeamProfileFormProps) => {
  const isSchoolTeam = teamType === "school";
  const [formError, setFormError] = useState("");
  const [formData, setFormData] = useState<TeamProfileData>({
    clubName: "",
    username: "",
    bio: "",
    foundedYear: "",
    city: "",
    state: "",
    country: "United States",
    homeFieldAddress: "",
    trainingGroundAddress: "",
    homeJerseyColor: "",
    awayJerseyColor: "",
    thirdKitColor: "",
    contactEmail: email,
    contactPhone: "",
    staffMembers: [{ name: "", role: "", personalEmail: "" }],
    offeredTeams: [{ age_group: "", league_name: "", gender: "", season: "", level: "", coach_name: "", status: "active" }],
    teamType,
    schoolName: "",
    teamMascot: "",
    sport: "Soccer",
    schoolLevel: "",
    schoolLevels: [],
    teamGender: "",
    leagueConference: "",
    schoolWebsite: "",
    schoolLogoUrl: "",
    headCoachName: "",
    headCoachEmail: "",
    headCoachPhone: "",
    teamColors: "",
    socialLinks: "",
  });

  useEffect(() => {
    if (!email) return;
    setFormData((prev) => ({
      ...prev,
      contactEmail: prev.contactEmail || email,
    }));
  }, [email]);

  const handleChange = (field: keyof TeamProfileData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleStaffChange = (index: number, field: "name" | "role" | "personalEmail", value: string) => {
    const newStaff = [...formData.staffMembers];
    newStaff[index][field] = value;
    setFormData((prev) => ({ ...prev, staffMembers: newStaff }));
  };

  const toggleSchoolLevel = (level: string) => {
    setFormData((prev) => {
      const hasLevel = prev.schoolLevels.includes(level);
      const schoolLevels = hasLevel
        ? prev.schoolLevels.filter((item) => item !== level)
        : [...prev.schoolLevels, level];
      return {
        ...prev,
        schoolLevels,
        schoolLevel: schoolLevels[0] || "",
      };
    });
  };

  const addStaffMember = () => {
    setFormData((prev) => ({
      ...prev,
      staffMembers: [...prev.staffMembers, { name: "", role: "", personalEmail: "" }],
    }));
  };

  const removeStaffMember = (index: number) => {
    if (formData.staffMembers.length > 1) {
      setFormData((prev) => ({
        ...prev,
        staffMembers: prev.staffMembers.filter((_, i) => i !== index),
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!isSchoolTeam) {
      const hasIncompleteTeamGender = formData.offeredTeams.some(
        (team) => team.age_group.trim() && team.league_name.trim() && !team.gender
      );

      if (hasIncompleteTeamGender) {
        setFormError("Choose Boys or Girls for each team you're adding.");
        return;
      }

      onSubmit({ ...formData, contactEmail: cleanEmail(formData.contactEmail), teamType: "club" });
      return;
    }

    const selectedLevels = formData.schoolLevels.length ? formData.schoolLevels : [formData.schoolLevel].filter(Boolean);
    const cleanedSchoolEmail = cleanEmail(formData.contactEmail);
    const cleanedCoachEmail = cleanEmail(formData.headCoachEmail);

    if (!isValidEmail(cleanedSchoolEmail)) {
      setFormError("Enter a valid school email address.");
      return;
    }

    if (!isValidEmail(cleanedCoachEmail)) {
      setFormError("Enter a valid coach email address.");
      return;
    }

    if (!formData.teamGender) {
      setFormError("Choose Boys or Girls.");
      return;
    }

    onSubmit({
      ...formData,
      contactEmail: cleanedSchoolEmail,
      headCoachEmail: cleanedCoachEmail,
      teamType: "school",
      schoolLevel: selectedLevels[0] || "",
      clubName: formData.schoolName,
      homeJerseyColor: formData.teamColors,
      offeredTeams: selectedLevels.map((level) => {
        const schoolLevelLabel = SCHOOL_LEVEL_OPTIONS.find((option) => option.value === level)?.label || level;
        return {
          age_group: schoolLevelLabel,
          league_name: formData.leagueConference,
          gender: formData.teamGender,
          season: "",
          level,
          coach_name: formData.headCoachName,
          status: "active",
        };
      }),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-foreground">{isSchoolTeam ? "School Team Profile" : "Club Team Profile"}</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {isSchoolTeam ? "Register your school athletics team" : "Register your club"}
        </p>
      </div>
      {formError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor={isSchoolTeam ? "schoolName" : "clubName"}>{isSchoolTeam ? "School Name *" : "Club Name *"}</Label>
          <Input
            id={isSchoolTeam ? "schoolName" : "clubName"}
            value={isSchoolTeam ? formData.schoolName : formData.clubName}
            onChange={(e) => handleChange(isSchoolTeam ? "schoolName" : "clubName", e.target.value)}
            placeholder={isSchoolTeam ? "Lincoln High School" : "FC United"}
            required
            className="border-2 focus:border-navy"
          />
        </div>

        {isSchoolTeam && (
          <>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="teamMascot">Team Name / Mascot *</Label>
              <Input
                id="teamMascot"
                value={formData.teamMascot}
                onChange={(e) => handleChange("teamMascot", e.target.value)}
                placeholder="Lions"
                required
                className="border-2 focus:border-navy"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Team Levels *</Label>
              <div className="grid grid-cols-2 gap-2">
                {SCHOOL_LEVEL_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={formData.schoolLevels.includes(option.value)}
                      onChange={() => toggleSchoolLevel(option.value)}
                      className="h-4 w-4"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <input value={formData.schoolLevels.join(",")} required readOnly className="sr-only" tabIndex={-1} />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>Boys or Girls Team? *</Label>
              <Select
                value={formData.teamGender}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, teamGender: value as TeamProfileData["teamGender"] }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose Boys or Girls" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boy">Boys</SelectItem>
                  <SelectItem value="girl">Girls</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="leagueConference">League or Conference *</Label>
              <Input
                id="leagueConference"
                value={formData.leagueConference}
                onChange={(e) => handleChange("leagueConference", e.target.value)}
                placeholder="County Athletic Conference"
                required
                className="border-2 focus:border-navy"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="schoolWebsite">School Website URL *</Label>
              <Input
                id="schoolWebsite"
                type="url"
                value={formData.schoolWebsite}
                onChange={(e) => handleChange("schoolWebsite", e.target.value)}
                placeholder="https://school.edu"
                required
                className="border-2 focus:border-navy"
              />
            </div>
          </>
        )}

        <div className="col-span-2 space-y-2">
          <Label htmlFor="username">Username *</Label>
          <Input
            id="username"
            value={formData.username}
            onChange={(e) => handleChange("username", normalizeUsername(e.target.value))}
            placeholder="fcunited"
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
            placeholder="Short club bio"
            maxLength={100}
            className="border-2 text-center placeholder:text-center focus:border-navy"
            style={{ textAlign: "center" }}
          />
        </div>

        {!isSchoolTeam && (
          <div className="space-y-2">
          <Label htmlFor="foundedYear">Founded Year</Label>
          <Input
            id="foundedYear"
            type="number"
            value={formData.foundedYear}
            onChange={(e) => handleChange("foundedYear", e.target.value)}
            placeholder="2010"
            className="border-2 focus:border-navy"
          />
          </div>
        )}

        {!isSchoolTeam && (
          <div className="space-y-2">
            <Label htmlFor="foundedYearSpacer"> </Label>
            <div id="foundedYearSpacer" className="h-10" />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleChange("city", e.target.value)}
            placeholder="Los Angeles"
            required={isSchoolTeam}
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Select value={formData.state} onValueChange={(value) => handleChange("state", value)}>
            <SelectTrigger id="state" className="border-2 focus:border-navy">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
            <SelectContent>
              {US_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isSchoolTeam && <input value={formData.state} required readOnly className="sr-only" tabIndex={-1} />}
        </div>

        {isSchoolTeam && (
          <div className="col-span-2 space-y-2">
            <Label htmlFor="country">Country *</Label>
            <Input
              id="country"
              value={formData.country}
              onChange={(e) => handleChange("country", e.target.value)}
              placeholder="United States"
              required
              className="border-2 focus:border-navy"
            />
          </div>
        )}

        <div className="col-span-2 space-y-2">
          <Label htmlFor="homeFieldAddress">Home Field Address</Label>
          <Input
            id="homeFieldAddress"
            value={formData.homeFieldAddress}
            onChange={(e) => handleChange("homeFieldAddress", e.target.value)}
            placeholder="123 Main St, Springfield, IL"
            className="border-2 focus:border-navy"
          />
        </div>

        {isSchoolTeam && (
          <div className="col-span-2 space-y-2">
            <Label htmlFor="contactEmail">School Email *</Label>
            <Input
              id="contactEmail"
              type="email"
              value={formData.contactEmail}
              onChange={(e) => handleChange("contactEmail", e.target.value)}
              onBlur={(e) => handleChange("contactEmail", cleanEmail(e.target.value))}
              placeholder="athletics@school.edu"
              required
              className="border-2 focus:border-navy"
            />
          </div>
        )}

        <div className={isSchoolTeam ? "col-span-2 space-y-2" : "space-y-2"}>
          <Label htmlFor={isSchoolTeam ? "teamColors" : "homeJerseyColor"}>{isSchoolTeam ? "Team Colors *" : "Home Jersey Color"}</Label>
          <Input
            id={isSchoolTeam ? "teamColors" : "homeJerseyColor"}
            value={isSchoolTeam ? formData.teamColors : formData.homeJerseyColor}
            onChange={(e) => handleChange(isSchoolTeam ? "teamColors" : "homeJerseyColor", e.target.value)}
            placeholder={isSchoolTeam ? "Red, white, navy" : "Red"}
            required={isSchoolTeam}
            className="border-2 focus:border-navy"
          />
        </div>

        {!isSchoolTeam && (
          <div className="space-y-2">
          <Label htmlFor="awayJerseyColor">Away Jersey Color</Label>
          <Input
            id="awayJerseyColor"
            value={formData.awayJerseyColor}
            onChange={(e) => handleChange("awayJerseyColor", e.target.value)}
            placeholder="White"
            className="border-2 focus:border-navy"
          />
          </div>
        )}

        {!isSchoolTeam && (
          <div className="col-span-2 space-y-2">
          <Label htmlFor="thirdKitColor">3rd Kit Color (Optional)</Label>
          <Input
            id="thirdKitColor"
            value={formData.thirdKitColor}
            onChange={(e) => handleChange("thirdKitColor", e.target.value)}
            placeholder="Blue"
            className="border-2 focus:border-navy"
          />
          </div>
        )}

        <div className="col-span-2 space-y-2">
          <Label htmlFor="trainingGroundAddress">Training Ground Address (Optional)</Label>
          <Input
            id="trainingGroundAddress"
            value={formData.trainingGroundAddress}
            onChange={(e) => handleChange("trainingGroundAddress", e.target.value)}
            placeholder="456 Training Way, Springfield, IL"
            className="border-2 focus:border-navy"
          />
        </div>

        {!isSchoolTeam && (
          <div className="col-span-2 space-y-2">
            <Label htmlFor="contactEmail">Contact Email</Label>
            <Input
              id="contactEmail"
              type="email"
              value={formData.contactEmail}
              onChange={(e) => handleChange("contactEmail", e.target.value)}
              onBlur={(e) => handleChange("contactEmail", cleanEmail(e.target.value))}
              placeholder="contact@club.com"
              className="border-2 focus:border-navy"
            />
          </div>
        )}

        {isSchoolTeam && (
          <>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="headCoachName">Head Coach Name *</Label>
              <Input
                id="headCoachName"
                value={formData.headCoachName}
                onChange={(e) => handleChange("headCoachName", e.target.value)}
                placeholder="Coach name"
                required
                className="border-2 focus:border-navy"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="headCoachEmail">Coach Email *</Label>
              <Input
                id="headCoachEmail"
                type="email"
                value={formData.headCoachEmail}
                onChange={(e) => handleChange("headCoachEmail", e.target.value)}
                onBlur={(e) => handleChange("headCoachEmail", cleanEmail(e.target.value))}
                placeholder="coach@school.edu"
                required
                className="border-2 focus:border-navy"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="headCoachPhone">Coach Phone Number *</Label>
              <Input
                id="headCoachPhone"
                type="tel"
                value={formData.headCoachPhone}
                onChange={(e) => handleChange("headCoachPhone", e.target.value)}
                placeholder="(555) 123-4567"
                required
                className="border-2 focus:border-navy"
              />
            </div>

          </>
        )}

        <div className="col-span-2 space-y-2">
          <Label htmlFor="contactPhone">{isSchoolTeam ? "School Phone Number *" : "Contact Phone"}</Label>
          <Input
            id="contactPhone"
            type="tel"
            value={formData.contactPhone}
            onChange={(e) => handleChange("contactPhone", e.target.value)}
            placeholder="(555) 123-4567"
            required={isSchoolTeam}
            className="border-2 focus:border-navy"
          />
        </div>

        {isSchoolTeam && (
          <div className="col-span-2 space-y-2">
            <Label htmlFor="socialLinks">Team Social Media Links (Optional)</Label>
            <Input
              id="socialLinks"
              value={formData.socialLinks}
              onChange={(e) => handleChange("socialLinks", e.target.value)}
              placeholder="@schoolteam or website links"
              className="border-2 focus:border-navy"
            />
          </div>
        )}

        {!isSchoolTeam && (
          <div className="col-span-2 space-y-3">
          <Label>Teams Offered</Label>
          <ClubTeamsManager
            value={formData.offeredTeams}
            onChange={(offeredTeams) => setFormData((prev) => ({ ...prev, offeredTeams }))}
            disabled={loading}
          />
          </div>
        )}

        <div className="col-span-2 space-y-3">
          <Label>Admin & Staff</Label>
          {formData.staffMembers.map((staff, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-border p-3">
              <Input
                value={staff.name}
                onChange={(e) => handleStaffChange(index, "name", e.target.value)}
                placeholder="Staff name"
                className="border-2 focus:border-navy"
              />
              <Input
                value={staff.role}
                onChange={(e) => handleStaffChange(index, "role", e.target.value)}
                placeholder="Role"
                className="border-2 focus:border-navy"
              />
              <Input
                type="email"
                value={staff.personalEmail}
                onChange={(e) => handleStaffChange(index, "personalEmail", e.target.value)}
                placeholder="Personal email"
                className="border-2 focus:border-navy"
              />
              {formData.staffMembers.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeStaffMember(index)}
                  className="px-2"
                >
                  ×
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addStaffMember}>
            + Add Staff Member
          </Button>
        </div>
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

export default TeamProfileForm;
