import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeUsername } from "@/lib/usernames";

interface PlayerProfileData {
  fullName: string;
  username: string;
  bio: string;
  dateOfBirth: string;
  position: string;
  jerseyNumber: string;
  team: string;
  height: string;
  weight: string;
  contactEmail: string;
  contactPhone: string;
  schoolGrade: string;
  preferredFoot: string;
  coachEmail: string;
  gender: "boy" | "girl" | "";
}

interface PlayerProfileFormProps {
  email: string;
  onSubmit: (data: PlayerProfileData) => void;
  onBack: () => void;
  loading: boolean;
}

const PlayerProfileForm = ({ email, onSubmit, onBack, loading }: PlayerProfileFormProps) => {
  const [formData, setFormData] = useState<PlayerProfileData>({
    fullName: "",
    username: "",
    bio: "",
    dateOfBirth: "",
    position: "",
    jerseyNumber: "",
    team: "",
    height: "",
    weight: "",
    contactEmail: email,
    contactPhone: "",
    schoolGrade: "",
    preferredFoot: "",
    coachEmail: "",
    gender: "",
  });

  useEffect(() => {
    if (!email) return;
    setFormData((prev) => ({
      ...prev,
      contactEmail: prev.contactEmail || email,
    }));
  }, [email]);

  const handleChange = (field: keyof PlayerProfileData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-foreground">Player Profile</h2>
        <p className="text-muted-foreground text-sm mt-1">Tell us about yourself</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-2">
          <Label htmlFor="fullName">Full Name *</Label>
          <Input id="fullName" value={formData.fullName} onChange={(e) => handleChange("fullName", e.target.value)} placeholder="John Doe" required className="border-2 focus:border-navy" />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="username">Username *</Label>
          <Input
            id="username"
            value={formData.username}
            onChange={(e) => handleChange("username", normalizeUsername(e.target.value))}
            placeholder="john10"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label>What is your gender? *</Label>
          <Select value={formData.gender} onValueChange={(value) => handleChange("gender", value)}>
            <SelectTrigger className="border-2 focus:border-navy">
              <SelectValue placeholder="Select one" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="boy">Boy</SelectItem>
              <SelectItem value="girl">Girl</SelectItem>
            </SelectContent>
          </Select>
          {!formData.gender ? <input className="sr-only" required value={formData.gender} onChange={() => undefined} /> : null}
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

        <div className="space-y-2">
          <Label htmlFor="dateOfBirth">Date of Birth *</Label>
          <Input id="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={(e) => handleChange("dateOfBirth", e.target.value)} required className="border-2 focus:border-navy" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="position">Position</Label>
          <Select value={formData.position} onValueChange={(v) => handleChange("position", v)}>
            <SelectTrigger className="border-2 focus:border-navy"><SelectValue placeholder="Select position" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="goalkeeper">Goalkeeper</SelectItem>
              <SelectItem value="defender">Defender</SelectItem>
              <SelectItem value="midfielder">Midfielder</SelectItem>
              <SelectItem value="forward">Forward</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="jerseyNumber">Jersey Number</Label>
          <Input
            id="jerseyNumber"
            value={formData.jerseyNumber}
            onChange={(e) => handleChange("jerseyNumber", e.target.value)}
            placeholder="10"
            inputMode="numeric"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="team">Current Team</Label>
          <Input id="team" value={formData.team} onChange={(e) => handleChange("team", e.target.value)} placeholder="Team name" className="border-2 focus:border-navy" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="height">Height</Label>
          <Input id="height" value={formData.height} onChange={(e) => handleChange("height", e.target.value)} placeholder="5'10" className="border-2 focus:border-navy" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="weight">Weight</Label>
          <Input id="weight" value={formData.weight} onChange={(e) => handleChange("weight", e.target.value)} placeholder="150 lbs" className="border-2 focus:border-navy" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="schoolGrade">School Grade</Label>
          <Select value={formData.schoolGrade} onValueChange={(v) => handleChange("schoolGrade", v)}>
            <SelectTrigger className="border-2 focus:border-navy"><SelectValue placeholder="Select grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6th">6th Grade</SelectItem>
              <SelectItem value="7th">7th Grade</SelectItem>
              <SelectItem value="8th">8th Grade</SelectItem>
              <SelectItem value="9th">9th Grade (Freshman)</SelectItem>
              <SelectItem value="10th">10th Grade (Sophomore)</SelectItem>
              <SelectItem value="11th">11th Grade (Junior)</SelectItem>
              <SelectItem value="12th">12th Grade (Senior)</SelectItem>
              <SelectItem value="college">College</SelectItem>
              <SelectItem value="graduated">Graduated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="preferredFoot">Preferred Foot</Label>
          <Select value={formData.preferredFoot} onValueChange={(v) => handleChange("preferredFoot", v)}>
            <SelectTrigger className="border-2 focus:border-navy"><SelectValue placeholder="Select foot" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Left</SelectItem>
              <SelectItem value="right">Right</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="coachEmail">Coach's Email</Label>
          <Input id="coachEmail" type="email" value={formData.coachEmail} onChange={(e) => handleChange("coachEmail", e.target.value)} placeholder="coach@example.com" className="border-2 focus:border-navy" />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="contactEmail">Contact Email</Label>
          <Input id="contactEmail" type="email" value={formData.contactEmail} onChange={(e) => handleChange("contactEmail", e.target.value)} placeholder="email@example.com" className="border-2 focus:border-navy" />
        </div>

        <div className="col-span-2 space-y-2">
          <Label htmlFor="contactPhone">Contact Phone</Label>
          <Input id="contactPhone" type="tel" value={formData.contactPhone} onChange={(e) => handleChange("contactPhone", e.target.value)} placeholder="(555) 123-4567" className="border-2 focus:border-navy" />
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" className="flex-1 bg-gradient-to-r from-navy to-primary hover:from-navy-light hover:to-primary" disabled={loading}>
          {loading ? "Creating..." : "Create Account"}
        </Button>
      </div>
    </form>
  );
};

export default PlayerProfileForm;
