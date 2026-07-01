import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeUsername } from "@/lib/usernames";

interface ParentProfileData {
  fullName: string;
  username: string;
  bio: string;
  relationshipToPlayer: string;
  contactEmail: string;
  contactPhone: string;
  emergencyContact: string;
  childFullName: string;
  childWherePlays: string;
  childTeam: string;
  childLeague: string;
  childAgeGroup: string;
  parentNotes: string;
}

interface ParentProfileFormProps {
  email: string;
  onSubmit: (data: ParentProfileData) => void;
  onBack: () => void;
  loading: boolean;
}

const ParentProfileForm = ({ email, onSubmit, onBack, loading }: ParentProfileFormProps) => {
  const [formData, setFormData] = useState<ParentProfileData>({
    fullName: "",
    username: "",
    bio: "",
    relationshipToPlayer: "",
    contactEmail: email,
    contactPhone: "",
    emergencyContact: "",
    childFullName: "",
    childWherePlays: "",
    childTeam: "",
    childLeague: "",
    childAgeGroup: "",
    parentNotes: "",
  });

  useEffect(() => {
    if (!email) return;
    setFormData((prev) => ({
      ...prev,
      contactEmail: prev.contactEmail || email,
    }));
  }, [email]);

  const handleChange = (field: keyof ParentProfileData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold text-foreground">Parent / Guardian Profile</h2>
        <p className="text-muted-foreground text-sm mt-1">Your contact information</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full Name *</Label>
          <Input
            id="fullName"
            value={formData.fullName}
            onChange={(e) => handleChange("fullName", e.target.value)}
            placeholder="Jane Doe"
            required
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">Username *</Label>
          <Input
            id="username"
            value={formData.username}
            onChange={(e) => handleChange("username", normalizeUsername(e.target.value))}
            placeholder="janedoe"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
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
          <Label htmlFor="relationshipToPlayer">Relationship to Player</Label>
          <Select value={formData.relationshipToPlayer} onValueChange={(v) => handleChange("relationshipToPlayer", v)}>
            <SelectTrigger className="border-2 focus:border-navy">
              <SelectValue placeholder="Select relationship" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mother">Mother</SelectItem>
              <SelectItem value="father">Father</SelectItem>
              <SelectItem value="guardian">Legal Guardian</SelectItem>
              <SelectItem value="grandparent">Grandparent</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact Email *</Label>
          <Input
            id="contactEmail"
            type="email"
            value={formData.contactEmail}
            onChange={(e) => handleChange("contactEmail", e.target.value)}
            placeholder="parent@example.com"
            required
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
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

        <div className="space-y-2">
          <Label htmlFor="emergencyContact">Emergency Contact</Label>
          <Input
            id="emergencyContact"
            value={formData.emergencyContact}
            onChange={(e) => handleChange("emergencyContact", e.target.value)}
            placeholder="Name and phone number"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="pt-2">
          <p className="text-sm font-semibold text-foreground">Child / Player Information</p>
          <p className="text-xs text-muted-foreground">This helps match the right player account later.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="childFullName">Child / Player Full Name</Label>
          <Input
            id="childFullName"
            value={formData.childFullName}
            onChange={(e) => handleChange("childFullName", e.target.value)}
            placeholder="Player name"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="childWherePlays">Where Their Child Plays</Label>
          <Input
            id="childWherePlays"
            value={formData.childWherePlays}
            onChange={(e) => handleChange("childWherePlays", e.target.value)}
            placeholder="Club, school, academy, city"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="childTeam">Child's Team</Label>
            <Input
              id="childTeam"
              value={formData.childTeam}
              onChange={(e) => handleChange("childTeam", e.target.value)}
              placeholder="Team"
              className="border-2 focus:border-navy"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="childLeague">Child's League</Label>
            <Input
              id="childLeague"
              value={formData.childLeague}
              onChange={(e) => handleChange("childLeague", e.target.value)}
              placeholder="League"
              className="border-2 focus:border-navy"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="childAgeGroup">Child's Age Group</Label>
          <Input
            id="childAgeGroup"
            value={formData.childAgeGroup}
            onChange={(e) => handleChange("childAgeGroup", e.target.value)}
            placeholder="U13, U15, Varsity"
            className="border-2 focus:border-navy"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="parentNotes">Important Notes / Necessary Information</Label>
          <Input
            id="parentNotes"
            value={formData.parentNotes}
            onChange={(e) => handleChange("parentNotes", e.target.value)}
            placeholder="Medical notes, pickup notes, or anything important"
            className="border-2 focus:border-navy"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        After creating your account, you can link to your child's player profile.
      </p>

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

export default ParentProfileForm;
