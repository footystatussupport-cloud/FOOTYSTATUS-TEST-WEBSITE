import { useState } from "react";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeUsername } from "@/lib/usernames";

export interface RefereeProfileFormData {
  fullName: string;
  username: string;
  refereeCertificationLevel: string;
  refereeLicenseNumber: string;
  refereeCertifyingOrganization: string;
  refereeYearsExperience: string;
  refereeMainExperience: string;
  refereeAssistantExperience: string;
  refereeLeaguesTournaments: string;
  contactEmail: string;
  contactPhone: string;
  refereeAvailability: string;
  bio: string;
  refereeAccolades: string;
  refereeProfilePublic: boolean;
  refereeCertificationProofFile: File | null;
}

interface RefereeProfileFormProps {
  email: string;
  onSubmit: (data: RefereeProfileFormData) => void;
  onBack: () => void;
  loading: boolean;
}

const RefereeProfileForm = ({ email, onSubmit, onBack, loading }: RefereeProfileFormProps) => {
  const [formData, setFormData] = useState<RefereeProfileFormData>({
    fullName: "",
    username: "",
    refereeCertificationLevel: "",
    refereeLicenseNumber: "",
    refereeCertifyingOrganization: "",
    refereeYearsExperience: "",
    refereeMainExperience: "",
    refereeAssistantExperience: "",
    refereeLeaguesTournaments: "",
    contactEmail: email || "",
    contactPhone: "",
    refereeAvailability: "",
    bio: "",
    refereeAccolades: "",
    refereeProfilePublic: false,
    refereeCertificationProofFile: null,
  });

  const handleChange = <K extends keyof RefereeProfileFormData>(field: K, value: RefereeProfileFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="text-center">
        <h2 className="text-xl font-bold text-foreground">Referee Profile</h2>
        <p className="mt-2 text-sm text-muted-foreground">Your referee details stay private unless you choose to show them.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">Full Name *</Label>
        <Input id="fullName" value={formData.fullName} onChange={(e) => handleChange("fullName", e.target.value)} required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username *</Label>
        <Input
          id="username"
          value={formData.username}
          onChange={(e) => handleChange("username", normalizeUsername(e.target.value))}
          placeholder="refsmith"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="refereeCertificationLevel">Certification Level *</Label>
          <Input
            id="refereeCertificationLevel"
            value={formData.refereeCertificationLevel}
            onChange={(e) => handleChange("refereeCertificationLevel", e.target.value)}
            placeholder="Regional, Grassroots, National"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="refereeYearsExperience">Years Experience *</Label>
          <Input
            id="refereeYearsExperience"
            inputMode="numeric"
            value={formData.refereeYearsExperience}
            onChange={(e) => handleChange("refereeYearsExperience", e.target.value)}
            placeholder="3"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeLicenseNumber">License / Certification Number</Label>
        <Input
          id="refereeLicenseNumber"
          value={formData.refereeLicenseNumber}
          onChange={(e) => handleChange("refereeLicenseNumber", e.target.value)}
          placeholder="If applicable"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeCertifyingOrganization">Certifying Organization *</Label>
        <Input
          id="refereeCertifyingOrganization"
          value={formData.refereeCertifyingOrganization}
          onChange={(e) => handleChange("refereeCertifyingOrganization", e.target.value)}
          placeholder="USSF, local association, school federation"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeMainExperience">Main Referee Experience</Label>
        <Textarea
          id="refereeMainExperience"
          value={formData.refereeMainExperience}
          onChange={(e) => handleChange("refereeMainExperience", e.target.value)}
          placeholder="Age groups, leagues, match levels"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeAssistantExperience">Assistant Referee Experience</Label>
        <Textarea
          id="refereeAssistantExperience"
          value={formData.refereeAssistantExperience}
          onChange={(e) => handleChange("refereeAssistantExperience", e.target.value)}
          placeholder="Assistant referee or fourth official experience"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeLeaguesTournaments">Leagues / Tournaments Worked</Label>
        <Textarea
          id="refereeLeaguesTournaments"
          value={formData.refereeLeaguesTournaments}
          onChange={(e) => handleChange("refereeLeaguesTournaments", e.target.value)}
          placeholder="Local leagues, showcases, tournaments"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact Information</Label>
          <Input id="contactEmail" type="email" value={formData.contactEmail} onChange={(e) => handleChange("contactEmail", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactPhone">Phone</Label>
          <Input id="contactPhone" value={formData.contactPhone} onChange={(e) => handleChange("contactPhone", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeAvailability">Availability</Label>
        <Input
          id="refereeAvailability"
          value={formData.refereeAvailability}
          onChange={(e) => handleChange("refereeAvailability", e.target.value)}
          placeholder="Weekends, evenings, specific regions"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="refereeAccolades">Accolades / Notable Matches</Label>
        <Textarea
          id="refereeAccolades"
          value={formData.refereeAccolades}
          onChange={(e) => handleChange("refereeAccolades", e.target.value)}
          placeholder="Finals, tournaments, awards, notable assignments"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Optional Bio</Label>
        <Textarea id="bio" value={formData.bio} onChange={(e) => handleChange("bio", e.target.value)} maxLength={100} />
        <p className="text-xs text-muted-foreground">{formData.bio.length}/100</p>
      </div>

      <div className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <Label htmlFor="proof" className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload proof of certification / license
        </Label>
        <Input
          id="proof"
          type="file"
          accept="image/*,.pdf"
          onChange={(e) => handleChange("refereeCertificationProofFile", e.target.files?.[0] || null)}
        />
        {formData.refereeCertificationProofFile ? (
          <p className="text-xs text-muted-foreground">{formData.refereeCertificationProofFile.name}</p>
        ) : null}
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
        <input
          type="checkbox"
          checked={formData.refereeProfilePublic}
          onChange={(e) => handleChange("refereeProfilePublic", e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-medium text-foreground">Make my referee profile public</span>
          <span className="block text-muted-foreground">Leave this off to keep your referee profile private by default.</span>
        </span>
      </label>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading ? "Creating..." : "Create Referee Profile"}
        </Button>
      </div>
    </form>
  );
};

export default RefereeProfileForm;
