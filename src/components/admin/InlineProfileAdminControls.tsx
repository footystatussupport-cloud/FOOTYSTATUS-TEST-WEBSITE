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

type PlayerStatsState = {
  appearances: number;
  starts: number;
  minutes_played: number;
  goals: number;
  assists: number;
  clean_sheets: number;
  saves: number;
  tackles: number;
  interceptions: number;
  passes: number;
  chances_created: number;
  yellow_cards: number;
  red_cards: number;
  player_rating: number;
};

const DEFAULT_PLAYER_STATS: PlayerStatsState = {
  appearances: 0,
  starts: 0,
  minutes_played: 0,
  goals: 0,
  assists: 0,
  clean_sheets: 0,
  saves: 0,
  tackles: 0,
  interceptions: 0,
  passes: 0,
  chances_created: 0,
  yellow_cards: 0,
  red_cards: 0,
  player_rating: 0,
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAdminPlan = (value: unknown): "free" | "pro_annual" | "pro_lifetime" => {
  const plan = String(value || "").toLowerCase().trim().replace(/-/g, "_");
  if (["pro_annual", "annual", "year", "yearly"].includes(plan)) return "pro_annual";
  if (["pro_lifetime", "lifetime", "one_time", "onetime", "one_time_pro"].includes(plan)) return "pro_lifetime";
  return "free";
};

// The single source of truth for which edit form an account gets. Driven by the
// account's ROLE (not by which profile-record rows happen to exist), so a Parent
// Team / School Team — whose account_category is "team_staff" like coaches — is
// never mistaken for a Coach/Staff account. Each account type maps to exactly
// one form; unknown/future roles fall back to record presence, then "generic".
type AccountKind = "player" | "referee" | "scout" | "parent" | "team" | "staff" | "generic";

const resolveAccountKind = (data: Record<string, any> | null | undefined): AccountKind => {
  const profile = data?.profile || {};
  const role = String(profile.account_role || profile.account_type || profile.role || "").toLowerCase();
  const category = String(profile.account_category || "").toLowerCase();

  if (role === "player" || category === "player") return "player";
  if (role === "referee" || category === "referee") return "referee";
  if (role === "scout") return "scout";
  if (role === "parent" || category === "parent") return "parent";
  // Team / club / school BEFORE the team_staff category check — a Parent Team's
  // category is "team_staff" but its role is team_club / school_team.
  if (role === "team_club" || role === "school_team" || role === "team") return "team";
  if (["head_coach_assistant", "coach", "trainer", "academy_director", "team_staff"].includes(role)) return "staff";
  // Role missing/unknown: infer from records, preferring team over staff.
  if (data?.team_profile) return "team";
  if (data?.staff_profile) return "staff";
  if (data?.player_profile) return "player";
  if (data?.parent_profile) return "parent";
  return "generic";
};

const recordForKind = (data: Record<string, any> | null | undefined, kind: AccountKind): Record<string, any> => {
  if (kind === "player") return data?.player_profile || {};
  if (kind === "team") return data?.team_profile || {};
  if (kind === "staff") return data?.staff_profile || {};
  if (kind === "parent") return data?.parent_profile || {};
  return {};
};

const tableForKind = (kind: AccountKind): string | null => {
  if (kind === "player") return "player_profiles";
  if (kind === "team") return "team_profiles";
  if (kind === "staff") return "staff_profiles";
  if (kind === "parent") return "parent_profiles";
  return null;
};
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
  const [stats, setStats] = useState<PlayerStatsState>(DEFAULT_PLAYER_STATS);
  const [proPlan, setProPlan] = useState<"free" | "pro_annual" | "pro_lifetime">("free");
  const [teamSearch, setTeamSearch] = useState("");
  const [teamResults, setTeamResults] = useState<any[]>([]);
  const [parentUserId, setParentUserId] = useState("");
  const [playerUserId, setPlayerUserId] = useState("");
  const [confirmingClearAvatar, setConfirmingClearAvatar] = useState(false);
  const [clearingAvatar, setClearingAvatar] = useState(false);
  const effectiveSection = section || "profile";
  const editorLabel = (label || (!section ? "Edit profile header" : "")).toLowerCase();
  const editorKind = editorLabel.includes("contact") || editorLabel.includes("social")
    ? "contacts"
    : editorLabel.includes("header")
      ? "header"
      : "details";

  const contactMap = useMemo(() => Object.fromEntries((bundle?.contacts || []).map((item: any) => [item.contact_type, item])), [bundle]);
  const accountKind = resolveAccountKind(bundle);
  const activeRecord = recordForKind(bundle, accountKind);
  const activeTable = tableForKind(accountKind);
  const accountRole = String(bundle?.profile?.account_role || bundle?.profile?.account_type || bundle?.profile?.role || "").toLowerCase();
  const isRefereeAccount = accountKind === "referee";
  const isScoutAccount = accountKind === "scout";

  const hydrateForm = (data: Record<string, any>) => {
    const profile = data.profile || {};
    const record = recordForKind(data, resolveAccountKind(data));
    const contacts = Object.fromEntries((data.contacts || []).map((item: any) => [item.contact_type, item.value]));
    setProExpiry(data.profile?.pro_expires_at ? String(data.profile.pro_expires_at).slice(0, 10) : "");
    setProPlan(normalizeAdminPlan(data.profile?.account_tier));
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
        appearances: toNumber(firstStats.appearances),
        starts: toNumber(firstStats.starts),
        minutes_played: toNumber(firstStats.minutes_played),
        goals: toNumber(firstStats.goals),
        assists: toNumber(firstStats.assists),
        clean_sheets: toNumber(firstStats.clean_sheets),
        saves: toNumber(firstStats.saves),
        tackles: toNumber(firstStats.tackles),
        interceptions: toNumber(firstStats.interceptions),
        passes: toNumber(firstStats.passes),
        chances_created: toNumber(firstStats.chances_created),
        yellow_cards: toNumber(firstStats.yellow_cards),
        red_cards: toNumber(firstStats.red_cards),
        player_rating: toNumber(firstStats.player_rating),
      });
    } else {
      setStats(DEFAULT_PLAYER_STATS);
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
    const { data, error } = await (supabase as any).rpc(name, args);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save changes", description: error.message, variant: "destructive" });
      return false;
    }
    await finish(success);
    return data ?? true;
  };
  const patch = async (table: string, changes: Record<string, unknown>) => rpc("admin_patch_account_record", { _target_user_id: targetUserId, _table_name: table, _changes: changes, _reason: optionalReason() }, "Changes saved");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleClearAvatar = async () => {
    if (!targetUserId) return;
    setClearingAvatar(true);
    const { error } = await (supabase as any).rpc("admin_clear_profile_picture", { _target_user_id: targetUserId });
    setClearingAvatar(false);
    if (error) {
      toast({ title: "Could not clear profile picture", description: error.message, variant: "destructive" });
      return;
    }
    setConfirmingClearAvatar(false);
    setForm((current) => ({ ...current, avatar_url: "" }));
    toast({ title: "Profile picture cleared successfully.", description: "The default profile image has been restored." });
    await load();
    onChanged?.();
  };

  const saveProfile = async () => {
    let ok: boolean | void = true;
    if (editorKind === "header") {
      // Never send a null/blank username: leaving the field empty preserves
      // the account's existing username instead of tripping validation.
      const nextUsername = normalizeUsername(form.username);
      ok = await patch("profiles", {
        full_name: form.full_name,
        ...(nextUsername ? { username: nextUsername } : {}),
        bio: form.bio || null,
        avatar_url: form.avatar_url || null,
        account_role: form.account_role,
      });
      if (ok !== false) setOpen(false);
      return;
    }
    if (editorKind === "contacts") {
      const contactType = accountKind === "player" ? "player" : "coach";
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
      setOpen(false);
      return;
    }
    // Details editor — route strictly by the resolved account type so the edits
    // always land in the correct table (never a mismatched one).
    if (accountKind === "player") {
      ok = await patch("player_profiles", {
        position: form.position || null,
        height: form.height || null,
        weight: form.weight || null,
        school_grade: form.school_grade || null,
        preferred_foot: form.preferred_foot || null,
        jersey_number: form.jersey_number || null,
        player_gender: form.player_gender || null,
        team: form.team || null,
      });
    } else if (accountKind === "referee") {
      ok = await patch("profiles", {
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
    } else if (accountKind === "scout") {
      ok = await patch("profiles", {
        scout_role_title: form.scout_role_title || null,
        scout_organization: form.scout_organization || null,
        scouting_experience: form.scouting_experience || null,
        scouting_regions: form.scouting_regions || null,
        scouting_licenses: form.scouting_licenses ? form.scouting_licenses.split(",").map((item) => item.trim()).filter(Boolean) : [],
        scouting_accolades: form.scouting_accolades || null,
      });
    } else if (accountKind === "team") {
      ok = await patch("team_profiles", { club_name: form.club_name, logo_url: form.avatar_url || null, founded_year: form.founded_year ? Number(form.founded_year) : null, city: form.city || null, country: form.country || null, home_stadium: form.home_stadium || null, training_ground: form.training_ground || null, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null });
    } else if (accountKind === "staff") {
      ok = await patch("profiles", { coaching_role_type: form.coaching_role_type || null, coaching_licenses: form.coaching_licenses ? form.coaching_licenses.split(",").map((item) => item.trim()).filter(Boolean) : [], past_coaching_experience: form.past_coaching_experience || null, teams_currently_coaching: form.teams_currently_coaching || null, coaching_accolades: form.coaching_accolades || null, coaching_location: form.location || null });
    } else if (accountKind === "parent") {
      ok = await patch("parent_profiles", { full_name: form.full_name, contact_email: form.contact_email || null, contact_phone: form.contact_phone || null });
    } else {
      ok = await patch("profiles", { full_name: form.full_name, bio: form.bio || null });
    }
    // Only leave the edit form once the DB update actually succeeded; on failure
    // keep it open so the admin can retry (no false "saved" + no reload loop).
    if (ok !== false) setOpen(false);
  };

  const saveStats = async () => {
    const payload = Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, toNumber(value)])
    );
    const saved = await rpc(
      "admin_upsert_player_statistics",
      { _target_user_id: targetUserId, _season: season, _statistics: payload, _reason: optionalReason() },
      "Statistics saved"
    );
    if (saved === false) return;
  };

  const saveProStatus = async (plan: "free" | "pro_annual" | "pro_lifetime" = proPlan) => {
    const normalizedPlan = normalizeAdminPlan(plan);
    const expiresAt = normalizedPlan === "pro_annual" && proExpiry
      ? new Date(proExpiry).toISOString()
      : null;
    const saved = await rpc(
      "admin_set_pro_status",
      { _target_user_id: targetUserId, _plan: normalizedPlan, _expires_at: expiresAt, _reason: optionalReason() },
      normalizedPlan === "free"
        ? "Footy Status plan saved as Free"
        : normalizedPlan === "pro_annual"
          ? "Footy Status plan saved as Yearly"
          : "Footy Status plan saved as One-Time"
    );
    if (saved !== false) setProPlan(normalizedPlan);
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
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmingClearAvatar(false); }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          {loading || !bundle ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : (
            <div className="space-y-5">
              {effectiveSection === "profile" && editorKind === "header" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="Profile Picture or Logo URL" value={form.avatar_url || ""} onChange={(value) => update("avatar_url", value)} /></div>
                  <div className="sm:col-span-2 rounded-lg border border-border p-3">
                    {confirmingClearAvatar ? (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-foreground">Clear profile picture?</p>
                        <p className="text-sm text-muted-foreground">
                          Are you sure you want to remove this account’s current profile picture? The default profile image will be
                          restored. The account owner will still be able to upload a new profile picture later.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => setConfirmingClearAvatar(false)} disabled={clearingAvatar}>
                            Cancel
                          </Button>
                          <Button variant="destructive" size="sm" onClick={handleClearAvatar} disabled={clearingAvatar}>
                            {clearingAvatar ? "Clearing…" : "Yes, Clear Profile Picture"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Clear Profile Picture</p>
                          <p className="text-xs text-muted-foreground">Reset this account’s picture back to the default avatar.</p>
                        </div>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmingClearAvatar(true)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Clear Profile Picture
                        </Button>
                      </div>
                    )}
                  </div>
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

              {effectiveSection === "profile" && editorKind === "details" && accountKind === "player" ? (
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

              {effectiveSection === "profile" && editorKind === "details" && accountKind === "staff" ? (
                <div className="grid gap-4">
                  <Field label="Coach or Staff Role" value={form.coaching_role_type || ""} onChange={(value) => update("coaching_role_type", value)} />
                  <Field label="Licenses" value={form.coaching_licenses || ""} placeholder="Separate licenses with commas" onChange={(value) => update("coaching_licenses", value)} />
                  <Field label="Teams Coached" value={form.teams_currently_coaching || ""} onChange={(value) => update("teams_currently_coaching", value)} />
                  <Field label="Location" value={form.location || ""} onChange={(value) => update("location", value)} />
                  <div className="space-y-1.5"><Label>Experience</Label><Textarea value={form.past_coaching_experience || ""} onChange={(event) => update("past_coaching_experience", event.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Accolades</Label><Textarea value={form.coaching_accolades || ""} onChange={(event) => update("coaching_accolades", event.target.value)} /></div>
                </div>
              ) : null}

              {effectiveSection === "profile" && editorKind === "details" && accountKind === "team" ? (
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

              {effectiveSection === "profile" && editorKind === "details" && accountKind === "parent" ? (
                <div className="grid gap-4"><Field label="Parent Name" value={form.full_name || ""} onChange={(value) => update("full_name", value)} /><Field label="Email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} /><Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} /></div>
              ) : null}

              {effectiveSection === "stats" ? accountKind === "player" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Season" value={season} onChange={setSeason} />
                  {([
                    ["goals", "Goals"],
                    ["assists", "Assists"],
                    ["appearances", "Appearances"],
                    ["starts", "Starts"],
                    ["minutes_played", "Minutes Played"],
                    ["clean_sheets", "Clean Sheets"],
                    ["saves", "Saves"],
                    ["tackles", "Tackles"],
                    ["interceptions", "Interceptions"],
                    ["passes", "Passes"],
                    ["chances_created", "Chances Created"],
                    ["yellow_cards", "Yellow Cards"],
                    ["red_cards", "Red Cards"],
                    ["player_rating", "Player Rating"],
                  ] as Array<[keyof PlayerStatsState, string]>).map(([key, statLabel]) => (
                    <Field
                      key={key}
                      label={statLabel}
                      type="number"
                      value={String(stats[key])}
                      onChange={(value) => setStats((current) => ({ ...current, [key]: toNumber(value) }))}
                    />
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Statistics are only available for player accounts.</p> : null}

              {effectiveSection === "clips" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-3"><p className="font-medium">Footy Status Pro</p><p className="text-sm text-muted-foreground">Current plan: {normalizeAdminPlan(bundle.profile?.account_tier) === "free" ? "Free" : normalizeAdminPlan(bundle.profile?.account_tier) === "pro_annual" ? "Yearly" : "One-Time"}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => saveProStatus("free")}>Free</Button><Button size="sm" variant="outline" onClick={() => saveProStatus("pro_annual")}>Yearly</Button><Button size="sm" onClick={() => saveProStatus("pro_lifetime")}>One-Time</Button></div></div>
                  <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><div><p className="font-medium">Strike History</p><p className="text-sm text-muted-foreground">{(bundle.strikes || []).filter((strike: any) => !strike.removed_at).length} active strikes</p></div><Button size="sm" variant="destructive" onClick={() => rpc("admin_add_strike", { _target_user_id: targetUserId, _reason: reason }, "Strike added", { requireNote: true })}>Add Strike</Button></div>{(bundle.strikes || []).map((strike: any) => <div key={strike.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"><span>{strike.reason} <Badge variant={strike.removed_at ? "outline" : "destructive"}>{strike.removed_at ? "Removed" : "Active"}</Badge></span>{!strike.removed_at ? <Button size="sm" variant="ghost" onClick={() => rpc("remove_account_strike", { _strike_id: strike.id, _reason: reason }, "Strike removed", { requireNote: true })}>Remove Strike</Button> : null}</div>)}</div>
                  <div className="grid gap-3 sm:grid-cols-2">{(bundle.clips || []).length ? bundle.clips.map((clip: any) => <div key={clip.id} className="overflow-hidden rounded-xl border border-border"><video src={clip.video_url} controls className="aspect-video w-full bg-black object-contain" /><div className="space-y-2 p-3"><p className="truncate text-sm font-medium">{clip.caption || clip.title || "Untitled Video"}</p><Button className="w-full" size="sm" variant="outline" onClick={() => { if (window.confirm("Delete this video permanently?")) rpc("admin_delete_clip", { _clip_id: clip.id, _reason: reason }, "Video deleted", { requireNote: true }); }}><Trash2 className="mr-2 h-4 w-4" />Delete Video</Button><Button className="w-full" size="sm" variant="destructive" onClick={() => { if (window.confirm("Delete this video and add one strike to the player?")) rpc("admin_delete_clip_and_add_strike", { _clip_id: clip.id, _reason: reason }, "Video deleted and strike added", { requireNote: true }); }}><Trash2 className="mr-2 h-4 w-4" />Delete + Strike</Button></div></div>) : <p className="text-sm text-muted-foreground">No Next Up videos.</p>}</div>
                </div>
              ) : null}

              {effectiveSection === "pro" ? <div className="space-y-3"><Field label="Expiration Date for Yearly Pro" type="date" value={proExpiry} onChange={setProExpiry} /><div className="space-y-1.5"><Label>Footy Status Plan</Label><Select value={proPlan} onValueChange={(value) => setProPlan(normalizeAdminPlan(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">Free</SelectItem><SelectItem value="pro_annual">Yearly</SelectItem><SelectItem value="pro_lifetime">One-Time</SelectItem></SelectContent></Select></div><p className="text-xs text-muted-foreground">Choose the plan, then press Save Plan. Missing or unknown values now default to Free, not One-Time.</p></div> : null}

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
            {effectiveSection === "stats" ? <Button disabled={saving || loading} onClick={saveStats}>{saving ? "Saving…" : "Save Statistics"}</Button> : null}
            {effectiveSection === "pro" ? <Button disabled={saving || loading} onClick={() => saveProStatus()}>{saving ? "Saving…" : "Save Plan"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InlineProfileAdminControls;
