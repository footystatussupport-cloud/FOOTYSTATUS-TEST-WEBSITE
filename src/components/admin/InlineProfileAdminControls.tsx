import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ensureFootyStatusAdminSession, isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeUsername } from "@/lib/usernames";

export type AdminEditSection = "profile" | "stats" | "clips" | "strikes" | "pro" | "teams" | "parents" | "account";

type Props = {
  targetUserId?: string | null;
  targetName?: string | null;
  section?: AdminEditSection;
  label?: string;
  onChanged?: () => void;
};

type FormState = Record<string, string>;

const text = (value: unknown) => value == null ? "" : String(value);
const Field = ({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </div>
);

const InlineProfileAdminControls = ({ targetUserId, targetName, section, label, onChanged }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOfficial = isFootyStatusSuperAdminEmail(user?.email);
  const [open, setOpen] = useState(false);
  const [bundle, setBundle] = useState<Record<string, any> | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [season, setSeason] = useState(new Date().getFullYear().toString());
  const [proExpiry, setProExpiry] = useState("");
  const [stats, setStats] = useState({ appearances: 0, starts: 0, goals: 0, assists: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0 });
  const [teamSearch, setTeamSearch] = useState("");
  const [teamResults, setTeamResults] = useState<any[]>([]);
  const [parentUserId, setParentUserId] = useState("");
  const [playerUserId, setPlayerUserId] = useState("");
  const effectiveSection = section || "profile";
  const editorLabel = (label || (!section ? "Edit profile header" : "")).toLowerCase();
  const editorKind = editorLabel.includes("contact") || editorLabel.includes("social")
    ? "contacts"
    : editorLabel.includes("header")
      ? "header"
      : "details";

  const contactMap = useMemo(() => Object.fromEntries((bundle?.contacts || []).map((item: any) => [item.contact_type, item])), [bundle]);
  const activeRecord = bundle?.player_profile || bundle?.staff_profile || bundle?.parent_profile || bundle?.team_profile || {};
  const activeTable = bundle?.player_profile ? "player_profiles" : bundle?.staff_profile ? "staff_profiles" : bundle?.parent_profile ? "parent_profiles" : bundle?.team_profile ? "team_profiles" : null;
  const accountRole = String(bundle?.profile?.account_role || bundle?.profile?.account_type || bundle?.profile?.role || "").toLowerCase();
  const isRefereeAccount = accountRole === "referee" || bundle?.profile?.account_category === "referee";
  const isScoutAccount = accountRole === "scout";

  const hydrateForm = (data: Record<string, any>) => {
    const profile = data.profile || {};
    const record = data.player_profile || data.staff_profile || data.parent_profile || data.team_profile || {};
    const contacts = Object.fromEntries((data.contacts || []).map((item: any) => [item.contact_type, item.value]));
    setProExpiry(data.profile?.pro_expires_at ? String(data.profile.pro_expires_at).slice(0, 10) : "");
    setForm({
      full_name: text(profile.full_name || record.full_name || profile.club_name || record.club_name),
      username: text(profile.username),
      bio: text(profile.bio),
      avatar_url: text(profile.avatar_url || record.profile_image_url || record.logo_url),
      account_role: text(profile.account_role),
      position: text(record.position || profile.position),
      height: text(record.height),
      weight: text(record.weight),
      school_grade: text(record.school_grade),
      preferred_foot: text(record.preferred_foot),
      jersey_number: text(record.jersey_number),
      player_gender: text(record.player_gender || profile.player_gender),
      team: text(record.team || profile.team_name),
      city: text(record.city || profile.city),
      country: text(record.country),
      location: text(profile.coaching_location || profile.location),
      nationality: text(profile.nationality),
      coaching_role_type: text(profile.coaching_role_type || record.role),
      coaching_licenses: Array.isArray(profile.coaching_licenses || record.coaching_licenses) ? (profile.coaching_licenses || record.coaching_licenses).join(", ") : text(profile.coaching_licenses || record.coaching_licenses),
      past_coaching_experience: text(profile.past_coaching_experience || record.years_experience),
      teams_currently_coaching: text(profile.teams_currently_coaching || record.team_organization_name),
      coaching_accolades: text(profile.coaching_accolades || record.notable_achievements),
      scout_role_title: text(profile.scout_role_title),
      scout_organization: text(profile.scout_organization),
      scouting_experience: text(profile.scouting_experience),
      scouting_regions: text(profile.scouting_regions),
      scouting_licenses: Array.isArray(profile.scouting_licenses) ? profile.scouting_licenses.join(", ") : text(profile.scouting_licenses),
      scouting_accolades: text(profile.scouting_accolades),
      referee_certification_level: text(profile.referee_certification_level),
      referee_license_number: text(profile.referee_license_number),
      referee_certifying_organization: text(profile.referee_certifying_organization),
      referee_years_experience: text(profile.referee_years_experience),
      referee_main_experience: text(profile.referee_main_experience),
      referee_assistant_experience: text(profile.referee_assistant_experience),
      referee_leagues_tournaments: text(profile.referee_leagues_tournaments),
      referee_availability: text(profile.referee_availability),
      referee_accolades: text(profile.referee_accolades),
      referee_profile_public: text(profile.referee_profile_public ?? ""),
      club_name: text(record.club_name || profile.club_name),
      founded_year: text(record.founded_year),
      home_stadium: text(record.home_stadium),
      training_ground: text(record.training_ground),
      contact_email: text(record.contact_email || contacts.player_email || contacts.coach_email),
      contact_phone: text(record.contact_phone || contacts.player_phone || contacts.coach_phone),
      instagram: text(contacts.instagram),
      website: text(contacts.website),
      tiktok: text(contacts.tiktok),
      youtube: text(contacts.youtube),
    });
    if (profile.account_role === "parent") setParentUserId(profile.user_id || targetUserId || "");
    if (data.player_profile) setPlayerUserId(profile.user_id || targetUserId || "");
    const firstStats = data.statistics?.[0];
    if (firstStats) {
      setSeason(text(firstStats.season || new Date().getFullYear()));
      setStats({
        appearances: firstStats.appearances || 0,
        starts: firstStats.starts || 0,
        goals: firstStats.goals || 0,
        assists: firstStats.assists || 0,
        clean_sheets: firstStats.clean_sheets || 0,
        yellow_cards: firstStats.yellow_cards || 0,
        red_cards: firstStats.red_cards || 0,
      });
    }
  };

  const load = async () => {
    if (!targetUserId || !isOfficial) return;
    setLoading(true);
    const permission = await ensureFootyStatusAdminSession();
    if (!permission.isAdmin) {
      setLoading(false);
      toast({ title: "Official permissions are not active", description: "Run the latest Official admin SQL, then sign out and back in.", variant: "destructive" });
      return;
    }
    const { data, error } = await (supabase as any).rpc("admin_get_account_bundle", { _target_user_id: targetUserId });
    setLoading(false);
    if (error) {
      toast({ title: "Admin details could not be loaded", description: error.message, variant: "destructive" });
      return;
    }
    const next = data || {};
    setBundle(next);
    hydrateForm(next);
  };

  useEffect(() => { setBundle(null); setOpen(false); }, [targetUserId]);
  if (!isOfficial || !targetUserId) return null;

  const requireReason = () => {
    if (reason.trim().length >= 3) return true;
    toast({ title: "Add an admin note", description: "Briefly explain why this change is being made.", variant: "destructive" });
    return false;
  };
  const optionalReason = () => reason.trim() || null;
  const finish = async (message: string) => {
    toast({ title: message, description: "The profile has been refreshed." });
    await load();
    onChanged?.();
  };
  const rpc = async (name: string, args: Record<string, unknown>, success: string, options: { requireNote?: boolean } = {}) => {
    if (options.requireNote && !requireReason()) return false;
    setSaving(true);
    const { error } = await (supabase as any).rpc(name, args);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save changes", description: error.message, variant: "destructive" });
      return false;
    }
    await finish(success);
    return true;
  };
  const patch = async (table: string, changes: Record<string, unknown>) => rpc("admin_patch_account_record", { _target_user_id: targetUserId, _table_name: table, _changes: changes, _reason: optionalReason() }, "Changes saved");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    if (editorKind === "header") {
      // Never send a null/blank username: leaving the field empty preserves
      // the account's existing username instead of tripping validation.
      const nextUsername = normalizeUsername(form.username);
      await patch("profiles", {
        full_name: form.full_name,
        ...(nextUsername ? { username: nextUsername } : {}),
        bio: form.bio || null,
        avatar_url: form.avatar_url || null,
        account_role: form.account_role,
      });
      return;
    }
    if (editorKind === "contacts") {
      const contactType = bundle?.player_profile ? "player" : "coach";
      const items = [
        [`${contactType}_email`, form.contact_email],
        [`${contactType}_phone`, form.contact_phone],
        ["instagram", form.instagram], ["website", form.website], ["tiktok", form.tiktok], ["youtube", form.youtube],
      ];
      setSaving(true);
      for (const [type, value] of items) {
        if (!value && !contactMap[type]) continue;
        const { error } = await (supabase as any).rpc("admin_set_contact", { _target_user_id: targetUserId, _contact_type: type, _value: value || "", _visibility: contactMap[type]?.visibility || "public", _reason: optionalReason() });
        if (error) { setSaving(false); toast({ title: "Could not save contact information", description: error.message, variant: "destructive" }); return; }
      }
      setSaving(false);
      await finish("Contact information saved");
      return;
    }
    const role = String(bundle?.profile?.account_role || bundle?.profile?.account_type || bundle?.profile?.role || "").toLowerCase();
    if (bundle?.player_profile) {
      await patch("player_profiles", {
        position: form.position || null,
        height: form.height || null,
        weight: form.weight || null,
        school_grade: form.school_grade || null,
        preferred_foot: form.preferred_foot || null,
        jersey_number: form.jersey_number || null,
        player_gender: form.player_gender || null,
        team: form.team || null,
      });
    } else if (role === "referee" || bundle?.profile?.account_category === "referee") {
      await patch("profiles", {
        referee_certification_level: form.referee_certification_level || null,
        referee_license_number: form.referee_license_number || null,
        referee_certifying_organization: form.referee_certifying_organization || null,
        referee_years_experience: form.referee_years_experience ? Number(form.referee_years_experience) : null,
        referee_main_experience: form.referee_main_experience || null,
        referee_assistant_experience: form.referee_assistant_experience || null,
        referee_leagues_tournaments: form.referee_leagues_tournaments || null,
        referee_availability: form.referee_availability || null,
        referee_accolades: form.referee_accolades || null,
        referee_profile_public: form.referee_profile_public === "false" ? false : true,
      });
    } else if (role === "scout") {
      await patch("profiles", {
        scout_role_title: form.scout_role_title || null,
        scout_organization: form.scout_organization || null,
        scouting_experience: form.scouting_experience || null,
        scouting_regions: form.scouting_regions || null,
        scouting_licenses: form.scouting_licenses ? form.scouting_licenses.split(",").map((item) => item.trim()).filter(Boolean) : [],
        scouting_accolades: form.scouting_accolades || null,
      });
    } else if (bundle?.staff_profile) {
      await patch("profiles", { coaching_role_type: form.coaching_role_type || null, coaching_licenses: form.coaching_licenses ? form.coaching_licenses.split(",").map((item) => item.trim()).filter(Boolean) : [], past_coaching_experience: form.past_coaching_experience || null, teams_currently_coaching: form.teams_currently_coaching || null, coaching_accolades: form.coaching_accolades || null, coaching_location: form.location || null });
    } else if (bundle?.team_profile) {
      await patch("team_profiles", { club_name: form.club_name, logo_url: form.avatar_url || null, founded_year: form.founded_year ? Number(form.founded_year) : null, city: form.city || null, country: form.country || null, home_stadium: form.home_stadium || null, training_ground: form.training_ground || null, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null });
    } else if (bundle?.parent_profile) {
      await patch("parent_profiles", { full_name: form.full_name, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null });
    } else {
      await patch("profiles", { full_name: form.full_name, bio: form.bio || null });
    }
  };

  const searchTeams = async () => {
    const { data, error } = await (supabase as any).rpc("admin_search_teams", { _query: teamSearch, _limit: 30 });
    if (error) return toast({ title: "Team search failed", description: error.message, variant: "destructive" });
    setTeamResults(data || []);
  };
  const linkTeam = async (team: any) => {
    const player = Boolean(bundle?.player_profile);
    await rpc(player ? "admin_link_player_to_team" : "admin_link_coach_to_team", player
      ? { _target_user_id: targetUserId, _team_id: team.team_id, _club_team_id: team.club_team_id, _age_group: null, _reason: optionalReason() }
      : { _target_user_id: targetUserId, _team_id: team.team_id, _club_team_id: team.club_team_id, _staff_role: form.coaching_role_type || bundle?.profile?.account_role || "coach", _reason: optionalReason() }, "Team added");
  };

  const title = label || ({ profile: "Edit Profile", stats: "Edit Statistics", clips: "Manage Next Up Clips", strikes: "Manage Strikes", pro: "Manage Footy Status Pro", teams: "Manage Team Links", parents: "Manage Parent Links", account: "Manage Account" } as Record<string, string>)[effectiveSection];

  return (
    <>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full border border-blue-500 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300" aria-label={title} title={title} onClick={() => { setOpen(true); if (!bundle) load(); }}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {loading || !bundle ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : (
            <div className="space-y-5">
              {effectiveSection === "profile" && editorKind === "header" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="Profile Picture or Logo URL" value={form.avatar_url || ""} onChange={(value) => update("avatar_url", value)} /></div>
                  <Field label="Name" value={form.full_name || ""} onChange={(value) => update("full_name", value)} />
                  <Field label="Username" value={form.username || ""} onChange={(value) => update("username", value)} />
                  <div className="sm:col-span-2 space-y-1.5"><Label>Bio</Label><Textarea value={form.bio || ""} onChange={(event) => update("bio", event.target.value)} /></div>
                  <div className="sm:col-span-2"><Field label="Account Type" value={form.account_role || ""} onChange={(value) => update("account_role", value)} /></div>
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "contacts" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Email" type="email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} />
                  <Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} />
                  <Field label="Instagram" value={form.instagram || ""} onChange={(value) => update("instagram", value)} />
                  <Field label="Website" value={form.website || ""} onChange={(value) => update("website", value)} />
                  <Field label="TikTok" value={form.tiktok || ""} onChange={(value) => update("tiktok", value)} />
                  <Field label="YouTube" value={form.youtube || ""} onChange={(value) => update("youtube", value)} />
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && bundle.player_profile ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Position" value={form.position || ""} onChange={(value) => update("position", value)} />
                  <Field label="Height" value={form.height || ""} onChange={(value) => update("height", value)} />
                  <Field label="Weight" value={form.weight || ""} onChange={(value) => update("weight", value)} />
                  <Field label="Graduation / School Year" value={form.school_grade || ""} onChange={(value) => update("school_grade", value)} />
                  <Field label="Preferred Foot" value={form.preferred_foot || ""} onChange={(value) => update("preferred_foot", value)} />
                  <Field label="Jersey Number" value={form.jersey_number || ""} onChange={(value) => update("jersey_number", value)} />
                  <div className="space-y-1.5">
                    <Label>Player Gender</Label>
                    <Select value={form.player_gender || ""} onValueChange={(value) => update("player_gender", value)}>
                      <SelectTrigger><SelectValue placeholder="Choose gender" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="boy">Boy</SelectItem>
                        <SelectItem value="girl">Girl</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Field label="Club or School" value={form.team || ""} onChange={(value) => update("team", value)} />
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && isRefereeAccount ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Certification Level" value={form.referee_certification_level || ""} onChange={(value) => update("referee_certification_level", value)} />
                  <Field label="License Number" value={form.referee_license_number || ""} onChange={(value) => update("referee_license_number", value)} />
                  <Field label="Certifying Organization" value={form.referee_certifying_organization || ""} onChange={(value) => update("referee_certifying_organization", value)} />
                  <Field label="Years of Experience" type="number" value={form.referee_years_experience || ""} onChange={(value) => update("referee_years_experience", value)} />
                  <div className="space-y-1.5 sm:col-span-2"><Label>Main Referee Experience</Label><Textarea value={form.referee_main_experience || ""} onChange={(event) => update("referee_main_experience", event.target.value)} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label>Assistant Referee Experience</Label><Textarea value={form.referee_assistant_experience || ""} onChange={(event) => update("referee_assistant_experience", event.target.value)} /></div>
                  <Field label="Leagues / Tournaments" value={form.referee_leagues_tournaments || ""} onChange={(value) => update("referee_leagues_tournaments", value)} />
                  <Field label="Availability" value={form.referee_availability || ""} onChange={(value) => update("referee_availability", value)} />
                  <div className="space-y-1.5 sm:col-span-2"><Label>Accolades / Notable Matches</Label><Textarea value={form.referee_accolades || ""} onChange={(event) => update("referee_accolades", event.target.value)} /></div>
                  <div className="space-y-1.5">
                    <Label>Public Profile</Label>
                    <Select value={form.referee_profile_public || "true"} onValueChange={(value) => update("referee_profile_public", value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Public</SelectItem>
                        <SelectItem value="false">Private</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && isScoutAccount ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Scout Role" value={form.scout_role_title || ""} onChange={(value) => update("scout_role_title", value)} />
                  <Field label="Organization / Team" value={form.scout_organization || ""} onChange={(value) => update("scout_organization", value)} />
                  <Field label="Regions Covered" value={form.scouting_regions || ""} onChange={(value) => update("scouting_regions", value)} />
                  <Field label="Licenses / Certifications" value={form.scouting_licenses || ""} placeholder="Separate with commas" onChange={(value) => update("scouting_licenses", value)} />
                  <div className="space-y-1.5 sm:col-span-2"><Label>Scouting Experience</Label><Textarea value={form.scouting_experience || ""} onChange={(event) => update("scouting_experience", event.target.value)} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label>Accolades</Label><Textarea value={form.scouting_accolades || ""} onChange={(event) => update("scouting_accolades", event.target.value)} /></div>
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && bundle.staff_profile && !isScoutAccount && !isRefereeAccount ? (
                <div className="grid gap-4">
                  <Field label="Coach or Staff Role" value={form.coaching_role_type || ""} onChange={(value) => update("coaching_role_type", value)} />
                  <Field label="Licenses" value={form.coaching_licenses || ""} placeholder="Separate licenses with commas" onChange={(value) => update("coaching_licenses", value)} />
                  <Field label="Teams Coached" value={form.teams_currently_coaching || ""} onChange={(value) => update("teams_currently_coaching", value)} />
                  <Field label="Location" value={form.location || ""} onChange={(value) => update("location", value)} />
                  <div className="space-y-1.5"><Label>Experience</Label><Textarea value={form.past_coaching_experience || ""} onChange={(event) => update("past_coaching_experience", event.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Accolades</Label><Textarea value={form.coaching_accolades || ""} onChange={(event) => update("coaching_accolades", event.target.value)} /></div>
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && bundle.team_profile ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Team or School Name" value={form.club_name || ""} onChange={(value) => update("club_name", value)} />
                  <Field label="Logo URL" value={form.avatar_url || ""} onChange={(value) => update("avatar_url", value)} />
                  <Field label="Founded Year" type="number" value={form.founded_year || ""} onChange={(value) => update("founded_year", value)} />
                  <Field label="City" value={form.city || ""} onChange={(value) => update("city", value)} />
                  <Field label="Country" value={form.country || ""} onChange={(value) => update("country", value)} />
                  <Field label="Home Field" value={form.home_stadium || ""} onChange={(value) => update("home_stadium", value)} />
                  <Field label="Training Ground" value={form.training_ground || ""} onChange={(value) => update("training_ground", value)} />
                  <Field label="Email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} />
                  <Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} />
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && bundle.parent_profile ? (
                <div className="grid gap-4"><Field label="Parent Name" value={form.full_name || ""} onChange={(value) => update("full_name", value)} /><Field label="Email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} /><Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} /></div>
              ) : null}

              {effectiveSection === "stats" ? bundle.player_profile ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Season" value={season} onChange={setSeason} />
                  {(["goals", "assists", "clean_sheets", "appearances", "starts", "yellow_cards", "red_cards"] as const).map((key) => <Field key={key} label={{ goals: "Goals", assists: "Assists", clean_sheets: "Clean Sheets", appearances: "Appearances", starts: "Starts", yellow_cards: "Yellow Cards", red_cards: "Red Cards" }[key]} type="number" value={String(stats[key])} onChange={(value) => setStats((current) => ({ ...current, [key]: Number(value) }))} />)}
                </div>
              ) : <p className="text-sm text-muted-foreground">Statistics are only available for player accounts.</p> : null}

              {effectiveSection === "clips" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-3"><p className="font-medium">Footy Status Pro</p><p className="text-sm text-muted-foreground">Current status: {bundle.profile?.account_tier === "free" ? "Off" : "On"}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "free", _expires_at: null, _reason: optionalReason() }, "Pro turned off")}>Free / Off</Button><Button size="sm" variant="outline" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "pro_annual", _expires_at: proExpiry ? new Date(proExpiry).toISOString() : null, _reason: optionalReason() }, "Yearly Pro activated")}>Yearly</Button><Button size="sm" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "pro_lifetime", _expires_at: null, _reason: optionalReason() }, "One-Time Pro activated")}>One-Time</Button></div></div>
                  <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><div><p className="font-medium">Strike History</p><p className="text-sm text-muted-foreground">{(bundle.strikes || []).filter((strike: any) => !strike.removed_at).length} active strikes</p></div><Button size="sm" variant="destructive" onClick={() => rpc("admin_add_strike", { _target_user_id: targetUserId, _reason: reason }, "Strike added", { requireNote: true })}>Add Strike</Button></div>{(bundle.strikes || []).map((strike: any) => <div key={strike.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"><span>{strike.reason} <Badge variant={strike.removed_at ? "outline" : "destructive"}>{strike.removed_at ? "Removed" : "Active"}</Badge></span>{!strike.removed_at ? <Button size="sm" variant="ghost" onClick={() => rpc("remove_account_strike", { _strike_id: strike.id, _reason: reason }, "Strike removed", { requireNote: true })}>Remove Strike</Button> : null}</div>)}</div>
                  <div className="grid gap-3 sm:grid-cols-2">{(bundle.clips || []).length ? bundle.clips.map((clip: any) => <div key={clip.id} className="overflow-hidden rounded-xl border border-border"><video src={clip.video_url} controls className="aspect-video w-full bg-black object-contain" /><div className="space-y-2 p-3"><p className="truncate text-sm font-medium">{clip.caption || clip.title || "Untitled Video"}</p><Button className="w-full" size="sm" variant="outline" onClick={() => { if (window.confirm("Delete this video permanently?")) rpc("admin_delete_clip", { _clip_id: clip.id, _reason: reason }, "Video deleted", { requireNote: true }); }}><Trash2 className="mr-2 h-4 w-4" />Delete Video</Button><Button className="w-full" size="sm" variant="destructive" onClick={() => { if (window.confirm("Delete this video and add one strike to the player?")) rpc("admin_delete_clip_and_add_strike", { _clip_id: clip.id, _reason: reason }, "Video deleted and strike added", { requireNote: true }); }}><Trash2 className="mr-2 h-4 w-4" />Delete + Strike</Button></div></div>) : <p className="text-sm text-muted-foreground">No Next Up videos.</p>}</div>
                </div>
              ) : null}

              {effectiveSection === "pro" ? <div className="space-y-3"><Field label="Expiration Date for Yearly Pro" type="date" value={proExpiry} onChange={setProExpiry} /><Label>Pro Type</Label><Select value={bundle.profile?.account_tier || "free"} onValueChange={(value) => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: value, _expires_at: null, _reason: optionalReason() }, "Pro status updated")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">Free / Off</SelectItem><SelectItem value="pro_annual">Yearly</SelectItem><SelectItem value="pro_lifetime">One-Time</SelectItem></SelectContent></Select></div> : null}

              {effectiveSection === "teams" ? (
                <div className="space-y-4">
                  <div><h3 className="font-medium">Current Teams</h3>{[...(bundle.player_team_links || []).map((item: any) => ({ ...item, kind: "player" })), ...(bundle.coach_team_links || []).map((item: any) => ({ ...item, kind: "coach" }))].map((link: any) => <div key={`${link.kind}-${link.id}`} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border p-3"><div><p className="font-medium">{link.daughter_team_name || link.team_name || "Team"}</p><p className="text-xs text-muted-foreground">{link.club_team_id ? "Daughter Team" : "Mother Team"}</p></div><Button size="sm" variant="outline" onClick={() => rpc("admin_remove_team_link", { _link_type: link.kind, _membership_id: link.id, _reason: optionalReason() }, "Removed from team")}>Remove from Team</Button></div>)}</div>
                  <div className="flex gap-2"><Input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search team name" /><Button variant="outline" onClick={searchTeams}>Search</Button></div>
                  {teamResults.map((team) => <div key={`${team.team_id}-${team.club_team_id || "mother"}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"><div><p className="font-medium">{team.daughter_team_name || team.team_name}</p><p className="text-xs text-muted-foreground">{team.club_team_id ? "Daughter Team" : "Mother Team"}{team.gender ? ` · ${team.gender}` : ""}</p></div><Button size="sm" onClick={() => linkTeam(team)}>Add to Team</Button></div>)}
                </div>
              ) : null}

              {effectiveSection === "parents" ? <div className="space-y-4"><div><h3 className="font-medium">Current Parent and Child Links</h3>{(bundle.parent_links || []).map((link: any) => <div key={link.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border p-3"><span>{link.parent_name || "Parent"} ↔ {link.player_name || "Player"}</span><Button size="sm" variant="outline" onClick={() => rpc("admin_manage_parent_link", { _parent_user_id: link.parent_user_id, _player_user_id: link.player_user_id, _mode: "remove", _relationship: link.relationship_to_player || "Parent / Guardian", _notes: "Removed by Footy Status Official", _reason: optionalReason() }, "Link removed")}>Remove Link</Button></div>)}</div><Field label="Parent Account ID" value={parentUserId} onChange={setParentUserId} /><Field label="Child Player Account ID" value={playerUserId} onChange={setPlayerUserId} /><div className="flex gap-2"><Button onClick={() => rpc("admin_manage_parent_link", { _parent_user_id: parentUserId, _player_user_id: playerUserId, _mode: "direct", _relationship: "Parent / Guardian", _notes: "Linked by Footy Status Official", _reason: optionalReason() }, "Parent and child linked")}>Link Parent / Child</Button></div></div> : null}

              <div className="space-y-1.5"><Label>Admin Note <span className="text-xs font-normal text-muted-foreground">(optional for normal edits)</span></Label><Textarea value={reason} placeholder="Optional note for support edits. Required for strikes, video deletion, and other serious moderation actions." onChange={(event) => setReason(event.target.value)} /></div>
            </div>
          )}
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            {effectiveSection === "profile" ? <Button disabled={saving || loading} onClick={saveProfile}>{saving ? "Saving…" : "Save"}</Button> : null}
            {effectiveSection === "stats" ? <Button disabled={saving || loading} onClick={() => rpc("admin_upsert_player_statistics", { _target_user_id: targetUserId, _season: season, _statistics: stats, _reason: optionalReason() }, "Statistics saved")}>{saving ? "Saving…" : "Save Statistics"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InlineProfileAdminControls;
