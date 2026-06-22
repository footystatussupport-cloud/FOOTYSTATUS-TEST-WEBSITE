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
  const editorLabel = (label || "").toLowerCase();
  const editorKind = editorLabel.includes("contact") || editorLabel.includes("social")
    ? "contacts"
    : editorLabel.includes("header")
      ? "header"
      : "details";

  const contactMap = useMemo(() => Object.fromEntries((bundle?.contacts || []).map((item: any) => [item.contact_type, item])), [bundle]);
  const activeRecord = bundle?.player_profile || bundle?.staff_profile || bundle?.parent_profile || bundle?.team_profile || {};
  const activeTable = bundle?.player_profile ? "player_profiles" : bundle?.staff_profile ? "staff_profiles" : bundle?.parent_profile ? "parent_profiles" : bundle?.team_profile ? "team_profiles" : null;

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
      team: text(record.team || profile.team_name),
      city: text(record.city || profile.city),
      country: text(record.country),
      coaching_role_type: text(profile.coaching_role_type || record.role),
      coaching_licenses: Array.isArray(profile.coaching_licenses || record.coaching_licenses) ? (profile.coaching_licenses || record.coaching_licenses).join(", ") : text(profile.coaching_licenses || record.coaching_licenses),
      past_coaching_experience: text(profile.past_coaching_experience || record.years_experience),
      teams_currently_coaching: text(profile.teams_currently_coaching || record.team_organization_name),
      coaching_accolades: text(profile.coaching_accolades || record.notable_achievements),
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
  if (!isOfficial || !targetUserId || targetUserId === user?.id || !section) return null;

  const requireReason = () => {
    if (reason.trim().length >= 3) return true;
    toast({ title: "Add an admin note", description: "Briefly explain why this change is being made.", variant: "destructive" });
    return false;
  };
  const finish = async (message: string) => {
    toast({ title: message, description: "The profile has been refreshed." });
    await load();
    onChanged?.();
  };
  const rpc = async (name: string, args: Record<string, unknown>, success: string) => {
    if (!requireReason()) return false;
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
  const patch = async (table: string, changes: Record<string, unknown>) => rpc("admin_patch_account_record", { _target_user_id: targetUserId, _table_name: table, _changes: changes, _reason: reason }, "Changes saved");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const saveProfile = async () => {
    if (editorKind === "header") {
      await patch("profiles", { full_name: form.full_name, username: form.username || null, bio: form.bio || null, avatar_url: form.avatar_url || null, account_role: form.account_role });
      return;
    }
    if (editorKind === "contacts") {
      const contactType = bundle?.player_profile ? "player" : "coach";
      const items = [
        [`${contactType}_email`, form.contact_email],
        [`${contactType}_phone`, form.contact_phone],
        ["instagram", form.instagram], ["website", form.website], ["tiktok", form.tiktok], ["youtube", form.youtube],
      ];
      if (!requireReason()) return;
      setSaving(true);
      for (const [type, value] of items) {
        if (!value && !contactMap[type]) continue;
        const { error } = await (supabase as any).rpc("admin_set_contact", { _target_user_id: targetUserId, _contact_type: type, _value: value || "", _visibility: contactMap[type]?.visibility || "public", _reason: reason });
        if (error) { setSaving(false); toast({ title: "Could not save contact information", description: error.message, variant: "destructive" }); return; }
      }
      setSaving(false);
      await finish("Contact information saved");
      return;
    }
    if (bundle?.player_profile) {
      await patch("player_profiles", { position: form.position || null, height: form.height || null, weight: form.weight || null, school_grade: form.school_grade || null, team: form.team || null });
    } else if (bundle?.staff_profile) {
      await patch("profiles", { coaching_role_type: form.coaching_role_type || null, coaching_licenses: form.coaching_licenses ? form.coaching_licenses.split(",").map((item) => item.trim()).filter(Boolean) : [], past_coaching_experience: form.past_coaching_experience || null, teams_currently_coaching: form.teams_currently_coaching || null, coaching_accolades: form.coaching_accolades || null });
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
      ? { _target_user_id: targetUserId, _team_id: team.team_id, _club_team_id: team.club_team_id, _age_group: null, _reason: reason }
      : { _target_user_id: targetUserId, _team_id: team.team_id, _club_team_id: team.club_team_id, _staff_role: form.coaching_role_type || bundle?.profile?.account_role || "coach", _reason: reason }, "Team added");
  };

  const title = label || ({ profile: "Edit Profile", stats: "Edit Statistics", clips: "Manage Next Up Clips", strikes: "Manage Strikes", pro: "Manage Footy Status Pro", teams: "Manage Team Links", parents: "Manage Parent Links", account: "Manage Account" } as Record<string, string>)[section];

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
              {section === "profile" && editorKind === "header" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="Profile Picture or Logo URL" value={form.avatar_url || ""} onChange={(value) => update("avatar_url", value)} /></div>
                  <Field label="Name" value={form.full_name || ""} onChange={(value) => update("full_name", value)} />
                  <Field label="Username" value={form.username || ""} onChange={(value) => update("username", value)} />
                  <div className="sm:col-span-2 space-y-1.5"><Label>Bio</Label><Textarea value={form.bio || ""} onChange={(event) => update("bio", event.target.value)} /></div>
                  <div className="sm:col-span-2"><Field label="Account Type" value={form.account_role || ""} onChange={(value) => update("account_role", value)} /></div>
                </div>
              ) : null}

              {section === "profile" && editorKind === "contacts" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Email" type="email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} />
                  <Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} />
                  <Field label="Instagram" value={form.instagram || ""} onChange={(value) => update("instagram", value)} />
                  <Field label="Website" value={form.website || ""} onChange={(value) => update("website", value)} />
                  <Field label="TikTok" value={form.tiktok || ""} onChange={(value) => update("tiktok", value)} />
                  <Field label="YouTube" value={form.youtube || ""} onChange={(value) => update("youtube", value)} />
                </div>
              ) : null}

              {section === "profile" && editorKind === "details" && bundle.player_profile ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Position" value={form.position || ""} onChange={(value) => update("position", value)} />
                  <Field label="Height" value={form.height || ""} onChange={(value) => update("height", value)} />
                  <Field label="Weight" value={form.weight || ""} onChange={(value) => update("weight", value)} />
                  <Field label="Graduation / School Year" value={form.school_grade || ""} onChange={(value) => update("school_grade", value)} />
                  <Field label="Club or School" value={form.team || ""} onChange={(value) => update("team", value)} />
                </div>
              ) : null}

              {section === "profile" && editorKind === "details" && bundle.staff_profile ? (
                <div className="grid gap-4">
                  <Field label="Coach or Staff Role" value={form.coaching_role_type || ""} onChange={(value) => update("coaching_role_type", value)} />
                  <Field label="Licenses" value={form.coaching_licenses || ""} placeholder="Separate licenses with commas" onChange={(value) => update("coaching_licenses", value)} />
                  <Field label="Teams Coached" value={form.teams_currently_coaching || ""} onChange={(value) => update("teams_currently_coaching", value)} />
                  <div className="space-y-1.5"><Label>Experience</Label><Textarea value={form.past_coaching_experience || ""} onChange={(event) => update("past_coaching_experience", event.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Accolades</Label><Textarea value={form.coaching_accolades || ""} onChange={(event) => update("coaching_accolades", event.target.value)} /></div>
                </div>
              ) : null}

              {section === "profile" && editorKind === "details" && bundle.team_profile ? (
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

              {section === "profile" && editorKind === "details" && bundle.parent_profile ? (
                <div className="grid gap-4"><Field label="Parent Name" value={form.full_name || ""} onChange={(value) => update("full_name", value)} /><Field label="Email" value={form.contact_email || ""} onChange={(value) => update("contact_email", value)} /><Field label="Phone Number" value={form.contact_phone || ""} onChange={(value) => update("contact_phone", value)} /></div>
              ) : null}

              {section === "stats" ? bundle.player_profile ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Season" value={season} onChange={setSeason} />
                  {(["goals", "assists", "clean_sheets", "appearances", "starts", "yellow_cards", "red_cards"] as const).map((key) => <Field key={key} label={{ goals: "Goals", assists: "Assists", clean_sheets: "Clean Sheets", appearances: "Appearances", starts: "Starts", yellow_cards: "Yellow Cards", red_cards: "Red Cards" }[key]} type="number" value={String(stats[key])} onChange={(value) => setStats((current) => ({ ...current, [key]: Number(value) }))} />)}
                </div>
              ) : <p className="text-sm text-muted-foreground">Statistics are only available for player accounts.</p> : null}

              {section === "clips" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-3"><p className="font-medium">Footy Status Pro</p><p className="text-sm text-muted-foreground">Current status: {bundle.profile?.account_tier === "free" ? "Off" : "On"}</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "free", _expires_at: null, _reason: reason }, "Pro turned off")}>Free / Off</Button><Button size="sm" variant="outline" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "pro_annual", _expires_at: proExpiry ? new Date(proExpiry).toISOString() : null, _reason: reason }, "Yearly Pro activated")}>Yearly</Button><Button size="sm" onClick={() => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: "pro_lifetime", _expires_at: null, _reason: reason }, "One-Time Pro activated")}>One-Time</Button></div></div>
                  <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><div><p className="font-medium">Strike History</p><p className="text-sm text-muted-foreground">{(bundle.strikes || []).filter((strike: any) => !strike.removed_at).length} active strikes</p></div><Button size="sm" variant="destructive" onClick={() => rpc("admin_add_strike", { _target_user_id: targetUserId, _reason: reason }, "Strike added")}>Add Strike</Button></div>{(bundle.strikes || []).map((strike: any) => <div key={strike.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-sm"><span>{strike.reason} <Badge variant={strike.removed_at ? "outline" : "destructive"}>{strike.removed_at ? "Removed" : "Active"}</Badge></span>{!strike.removed_at ? <Button size="sm" variant="ghost" onClick={() => rpc("remove_account_strike", { _strike_id: strike.id, _reason: reason }, "Strike removed")}>Remove Strike</Button> : null}</div>)}</div>
                  <div className="grid gap-3 sm:grid-cols-2">{(bundle.clips || []).length ? bundle.clips.map((clip: any) => <div key={clip.id} className="overflow-hidden rounded-xl border border-border"><video src={clip.video_url} controls className="aspect-video w-full bg-black object-contain" /><div className="space-y-2 p-3"><p className="truncate text-sm font-medium">{clip.caption || clip.title || "Untitled Video"}</p><Button className="w-full" size="sm" variant="destructive" onClick={() => { if (window.confirm("Delete this video permanently?")) rpc("admin_delete_clip", { _clip_id: clip.id, _reason: reason }, "Video deleted"); }}><Trash2 className="mr-2 h-4 w-4" />Delete Video</Button></div></div>) : <p className="text-sm text-muted-foreground">No Next Up videos.</p>}</div>
                </div>
              ) : null}

              {section === "pro" ? <div className="space-y-3"><Field label="Expiration Date for Yearly Pro" type="date" value={proExpiry} onChange={setProExpiry} /><Label>Pro Type</Label><Select value={bundle.profile?.account_tier || "free"} onValueChange={(value) => rpc("admin_set_pro_status", { _target_user_id: targetUserId, _plan: value, _expires_at: null, _reason: reason }, "Pro status updated")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">Free / Off</SelectItem><SelectItem value="pro_annual">Yearly</SelectItem><SelectItem value="pro_lifetime">One-Time</SelectItem></SelectContent></Select></div> : null}

              {section === "teams" ? (
                <div className="space-y-4">
                  <div><h3 className="font-medium">Current Teams</h3>{[...(bundle.player_team_links || []).map((item: any) => ({ ...item, kind: "player" })), ...(bundle.coach_team_links || []).map((item: any) => ({ ...item, kind: "coach" }))].map((link: any) => <div key={`${link.kind}-${link.id}`} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border p-3"><div><p className="font-medium">{link.daughter_team_name || link.team_name || "Team"}</p><p className="text-xs text-muted-foreground">{link.club_team_id ? "Daughter Team" : "Mother Team"}</p></div><Button size="sm" variant="outline" onClick={() => rpc("admin_remove_team_link", { _link_type: link.kind, _membership_id: link.id, _reason: reason }, "Removed from team")}>Remove from Team</Button></div>)}</div>
                  <div className="flex gap-2"><Input value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Search team name" /><Button variant="outline" onClick={searchTeams}>Search</Button></div>
                  {teamResults.map((team) => <div key={`${team.team_id}-${team.club_team_id || "mother"}`} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"><div><p className="font-medium">{team.daughter_team_name || team.team_name}</p><p className="text-xs text-muted-foreground">{team.club_team_id ? "Daughter Team" : "Mother Team"}{team.gender ? ` · ${team.gender}` : ""}</p></div><Button size="sm" onClick={() => linkTeam(team)}>Add to Team</Button></div>)}
                </div>
              ) : null}

              {section === "parents" ? <div className="space-y-4"><div><h3 className="font-medium">Current Parent and Child Links</h3>{(bundle.parent_links || []).map((link: any) => <div key={link.id} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border p-3"><span>{link.parent_name || "Parent"} ↔ {link.player_name || "Player"}</span><Button size="sm" variant="outline" onClick={() => rpc("admin_manage_parent_link", { _parent_user_id: link.parent_user_id, _player_user_id: link.player_user_id, _mode: "remove", _relationship: link.relationship_to_player || "Parent / Guardian", _notes: "Removed by Footy Status Official", _reason: reason }, "Link removed")}>Remove Link</Button></div>)}</div><Field label="Parent Account ID" value={parentUserId} onChange={setParentUserId} /><Field label="Child Player Account ID" value={playerUserId} onChange={setPlayerUserId} /><div className="flex gap-2"><Button onClick={() => rpc("admin_manage_parent_link", { _parent_user_id: parentUserId, _player_user_id: playerUserId, _mode: "direct", _relationship: "Parent / Guardian", _notes: "Linked by Footy Status Official", _reason: reason }, "Parent and child linked")}>Link Parent / Child</Button></div></div> : null}

              <div className="space-y-1.5"><Label>Admin Note</Label><Textarea value={reason} placeholder="Briefly explain this change" onChange={(event) => setReason(event.target.value)} /></div>
            </div>
          )}
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            {section === "profile" ? <Button disabled={saving || loading} onClick={saveProfile}>{saving ? "Saving…" : "Save"}</Button> : null}
            {section === "stats" ? <Button disabled={saving || loading} onClick={() => rpc("admin_upsert_player_statistics", { _target_user_id: targetUserId, _season: season, _statistics: stats, _reason: reason }, "Statistics saved")}>{saving ? "Saving…" : "Save Statistics"}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InlineProfileAdminControls;