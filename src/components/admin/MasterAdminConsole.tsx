import { useState } from "react";
import { Crown, Search, ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AccountResult = {
  user_id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  account_role: string;
  avatar_url: string | null;
  account_tier: string;
  pro_expires_at: string | null;
};

type AccountBundle = Record<string, any>;
const editableRecords = ["profile", "player_profile", "staff_profile", "parent_profile", "team_profile"] as const;

const MasterAdminConsole = () => {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountResult[]>([]);
  const [selected, setSelected] = useState<AccountResult | null>(null);
  const [bundle, setBundle] = useState<AccountBundle | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [season, setSeason] = useState(new Date().getFullYear().toString());
  const [stats, setStats] = useState({ appearances: 0, starts: 0, goals: 0, assists: 0, mvp_matches: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0 });
  const [teamQuery, setTeamQuery] = useState("");
  const [teams, setTeams] = useState<any[]>([]);
  const [parentUserId, setParentUserId] = useState("");
  const [playerUserId, setPlayerUserId] = useState("");

  const requireReason = () => {
    if (reason.trim().length < 3) {
      toast({ title: "Add an audit reason", description: "Enter at least 3 characters before making a change.", variant: "destructive" });
      return false;
    }
    return true;
  };

  const searchAccounts = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_search_accounts", { _query: query, _limit: 40 });
    setLoading(false);
    if (error) return toast({ title: "Account search failed", description: error.message, variant: "destructive" });
    setResults(data || []);
  };

  const loadAccount = async (account: AccountResult) => {
    setSelected(account);
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_get_account_bundle", { _target_user_id: account.user_id });
    setLoading(false);
    if (error) return toast({ title: "Account could not be opened", description: error.message, variant: "destructive" });
    setBundle(data || {});
    const nextDrafts: Record<string, string> = {};
    editableRecords.forEach((key) => { if (data?.[key]) nextDrafts[key] = JSON.stringify(data[key], null, 2); });
    setDrafts(nextDrafts);
    if (data?.profile?.account_role === "parent") setParentUserId(account.user_id);
    else setPlayerUserId(account.user_id);
  };

  const refresh = async () => { if (selected) await loadAccount(selected); };

  const saveRecord = async (recordKey: typeof editableRecords[number]) => {
    if (!selected || !requireReason()) return;
    try {
      const parsed = JSON.parse(drafts[recordKey] || "{}");
      const original = bundle?.[recordKey] || {};
      const changes = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
      if (!Object.keys(changes).length) return toast({ title: "No changes to save" });
      const { error } = await (supabase as any).rpc("admin_patch_account_record", {
        _target_user_id: selected.user_id, _table_name: recordKey === "profile" ? "profiles" : `${recordKey}s`,
        _changes: changes, _reason: reason,
      });
      if (error) throw error;
      toast({ title: "Account updated", description: "The change was added to the admin audit log." });
      await refresh();
    } catch (error: any) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    }
  };

  const setPro = async (plan: "free" | "pro_annual" | "pro_lifetime") => {
    if (!selected || !requireReason()) return;
    const { error } = await (supabase as any).rpc("admin_set_pro_status", {
      _target_user_id: selected.user_id, _plan: plan, _expires_at: null, _reason: reason,
    });
    if (error) return toast({ title: "Pro status update failed", description: error.message, variant: "destructive" });
    toast({ title: plan === "free" ? "Pro removed" : "Pro activated" });
    await refresh();
  };

  const saveStats = async () => {
    if (!selected || !requireReason()) return;
    const { error } = await (supabase as any).rpc("admin_upsert_player_statistics", {
      _target_user_id: selected.user_id, _season: season, _statistics: stats, _reason: reason,
    });
    if (error) return toast({ title: "Stats update failed", description: error.message, variant: "destructive" });
    toast({ title: "Player statistics saved" });
    await refresh();
  };

  const deleteClip = async (clipId: string) => {
    if (!requireReason() || !window.confirm("Delete this Next Up clip? This cannot be undone.")) return;
    const { error } = await (supabase as any).rpc("admin_delete_clip", { _clip_id: clipId, _reason: reason });
    if (error) return toast({ title: "Clip deletion failed", description: error.message, variant: "destructive" });
    toast({ title: "Clip deleted" });
    await refresh();
  };

  const addStrike = async () => {
    if (!selected || !requireReason() || !window.confirm("Add a strike to this account?")) return;
    const { error } = await (supabase as any).rpc("admin_add_strike", { _target_user_id: selected.user_id, _reason: reason });
    if (error) return toast({ title: "Strike could not be added", description: error.message, variant: "destructive" });
    toast({ title: "Strike added" });
    await refresh();
  };

  const findTeams = async () => {
    const { data, error } = await (supabase as any).rpc("admin_search_teams", { _query: teamQuery, _limit: 30 });
    if (error) return toast({ title: "Team search failed", description: error.message, variant: "destructive" });
    setTeams(data || []);
  };

  const linkTeam = async (team: any) => {
    if (!selected || !requireReason()) return;
    const isPlayer = Boolean(bundle?.player_profile);
    const rpc = isPlayer ? "admin_link_player_to_team" : "admin_link_coach_to_team";
    const args = isPlayer
      ? { _target_user_id: selected.user_id, _team_id: team.team_id, _club_team_id: team.club_team_id, _age_group: null, _reason: reason }
      : { _target_user_id: selected.user_id, _team_id: team.team_id, _club_team_id: team.club_team_id, _staff_role: bundle?.profile?.account_role || "coach", _reason: reason };
    const { error } = await (supabase as any).rpc(rpc, args);
    if (error) return toast({ title: "Team link failed", description: error.message, variant: "destructive" });
    toast({ title: "Team link added" });
    await refresh();
  };

  const removeTeamLink = async (type: "player" | "coach", id: string) => {
    if (!requireReason()) return;
    const { error } = await (supabase as any).rpc("admin_remove_team_link", { _link_type: type, _membership_id: id, _reason: reason });
    if (error) return toast({ title: "Team link removal failed", description: error.message, variant: "destructive" });
    toast({ title: "Team link removed" });
    await refresh();
  };

  const parentLink = async (mode: "direct" | "invite" | "remove", existing?: any) => {
    if (!requireReason()) return;
    const parent = existing?.parent_user_id || parentUserId;
    const player = existing?.player_user_id || playerUserId;
    if (!parent || !player) return toast({ title: "Enter both account IDs", variant: "destructive" });
    const { error } = await (supabase as any).rpc("admin_manage_parent_link", {
      _parent_user_id: parent, _player_user_id: player, _mode: mode,
      _relationship: existing?.relationship || "Parent / Guardian", _notes: "Managed by Footy Status Official", _reason: reason,
    });
    if (error) return toast({ title: "Parent link update failed", description: error.message, variant: "destructive" });
    toast({ title: mode === "remove" ? "Parent link removed" : mode === "invite" ? "Parent invitation created" : "Parent linked directly" });
    await refresh();
  };

  return (
    <section className="mb-6 rounded-2xl border border-amber-400/50 bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <span className="rounded-full bg-amber-400 p-2 text-slate-950"><ShieldCheck className="h-5 w-5" /></span>
        <div>
          <h3 className="font-semibold text-foreground">Official Admin Console</h3>
          <p className="text-sm text-muted-foreground">Search, inspect, support, and manage every Footy Status account.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && searchAccounts()} placeholder="Name, username, email, or account ID" />
        <Button onClick={searchAccounts} disabled={loading}><Search className="mr-2 h-4 w-4" />Search</Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {results.map((account) => (
          <button key={account.user_id} onClick={() => loadAccount(account)} className="flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted">
            <UserRoundCog className="h-5 w-5 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{account.display_name}</span>
              <span className="block truncate text-xs text-muted-foreground">{account.email} · {account.account_role}</span>
            </span>
            {account.account_tier !== "free" ? <Crown className="h-4 w-4 text-amber-500" /> : null}
          </button>
        ))}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.display_name} — Admin Account View</DialogTitle></DialogHeader>
          {bundle && selected ? (
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <p><strong>Email:</strong> {bundle.profile?.email || "Not set"}</p>
                <p><strong>Account ID:</strong> <span className="break-all">{selected.user_id}</span></p>
                <p><strong>Role:</strong> {bundle.profile?.account_role || bundle.profile?.account_category || "Not set"}</p>
              </div>
              <div>
                <Label htmlFor="admin-reason">Required audit reason</Label>
                <Input id="admin-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why are you making this change?" />
              </div>

              <div className="space-y-3">
                <h4 className="font-semibold">Profile records</h4>
                {editableRecords.filter((key) => bundle[key]).map((key) => (
                  <details key={key} className="rounded-xl border border-border p-3">
                    <summary className="cursor-pointer font-medium capitalize">{key.replaceAll("_", " ")}</summary>
                    <Textarea className="mt-3 min-h-48 font-mono text-xs" value={drafts[key] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} />
                    <Button className="mt-2" size="sm" onClick={() => saveRecord(key)}>Save this record</Button>
                  </details>
                ))}
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-2 flex items-center gap-2 font-semibold"><Crown className="h-4 w-4 text-amber-500" />Footy Status Pro</h4>
                <p className="mb-3 text-sm text-muted-foreground">Current: {bundle.profile?.account_tier || "free"} {bundle.profile?.pro_expires_at ? `until ${new Date(bundle.profile.pro_expires_at).toLocaleDateString()}` : ""}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPro("free")}>Turn Pro off</Button>
                  <Button size="sm" variant="outline" onClick={() => setPro("pro_annual")}>Give yearly Pro</Button>
                  <Button size="sm" onClick={() => setPro("pro_lifetime")}>Give lifetime Pro</Button>
                </div>
              </div>

              {bundle.player_profile ? (
                <div className="rounded-xl border border-border p-3">
                  <h4 className="mb-3 font-semibold">Player statistics</h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Input value={season} onChange={(event) => setSeason(event.target.value)} placeholder="Season" />
                    {Object.keys(stats).map((key) => <Input key={key} type="number" value={(stats as any)[key]} onChange={(event) => setStats((current) => ({ ...current, [key]: Number(event.target.value) }))} placeholder={key.replaceAll("_", " ")} />)}
                  </div>
                  <Button className="mt-3" size="sm" onClick={saveStats}>Save statistics</Button>
                </div>
              ) : null}

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-3 font-semibold">Private contact information</h4>
                {bundle.contacts?.length ? bundle.contacts.map((contact: any) => (
                  <div key={contact.id} className="mb-2 rounded-lg bg-muted p-2 text-sm">
                    <strong>{contact.contact_type}:</strong> {contact.value} <Badge variant="outline">{contact.visibility}</Badge>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No saved contact records.</p>}
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-3 font-semibold">Team links</h4>
                {[...(bundle.player_team_links || []).map((x: any) => ({ ...x, type: "player" })), ...(bundle.coach_team_links || []).map((x: any) => ({ ...x, type: "coach" }))].map((link: any) => (
                  <div key={`${link.type}-${link.id}`} className="mb-2 flex items-center justify-between rounded-lg bg-muted p-2 text-sm">
                    <span>{link.daughter_team_name || link.team_name || link.team_id} · {link.status}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeTeamLink(link.type, link.id)}>Remove</Button>
                  </div>
                ))}
                <div className="mt-3 flex gap-2"><Input value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Search a mother or daughter team" /><Button variant="outline" onClick={findTeams}>Find</Button></div>
                <div className="mt-2 space-y-2">{teams.map((team) => <button key={`${team.team_id}-${team.club_team_id || "mother"}`} onClick={() => linkTeam(team)} className="block w-full rounded-lg border border-border p-2 text-left text-sm hover:bg-muted">Add to {team.daughter_team_name || team.team_name} {team.gender ? `· ${team.gender}` : ""}</button>)}</div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-3 font-semibold">Parent / child links</h4>
                <div className="grid gap-2 sm:grid-cols-2"><Input value={parentUserId} onChange={(event) => setParentUserId(event.target.value)} placeholder="Parent account ID" /><Input value={playerUserId} onChange={(event) => setPlayerUserId(event.target.value)} placeholder="Player account ID" /></div>
                <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => parentLink("direct")}>Link directly</Button><Button size="sm" variant="outline" onClick={() => parentLink("invite")}>Send invitation</Button></div>
                {bundle.parent_links?.map((link: any) => <div key={link.id} className="mt-2 flex items-center justify-between rounded-lg bg-muted p-2 text-sm"><span>{link.parent_name || "Parent"} ↔ {link.player_name || "Player"} · {link.status}</span><Button size="sm" variant="ghost" onClick={() => parentLink("remove", link)}>Remove</Button></div>)}
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="mb-3 flex items-center justify-between"><h4 className="font-semibold">Strikes</h4><Button size="sm" variant="destructive" onClick={addStrike}>Add strike</Button></div>
                {bundle.strikes?.map((strike: any) => <div key={strike.id} className="mb-2 rounded-lg bg-muted p-2 text-sm">{strike.reason} · {new Date(strike.created_at).toLocaleString()} {strike.removed_at ? <Badge variant="outline">Removed</Badge> : <Badge variant="destructive">Active</Badge>}</div>)}
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-3 font-semibold">Next Up clips</h4>
                <div className="grid gap-3 sm:grid-cols-2">{bundle.clips?.map((clip: any) => <div key={clip.id} className="overflow-hidden rounded-xl border border-border"><video src={clip.video_url} controls className="aspect-video w-full bg-black object-contain" /><div className="flex items-center justify-between gap-2 p-2"><span className="truncate text-sm">{clip.caption || clip.title || "Untitled clip"}</span><Button size="icon" variant="destructive" onClick={() => deleteClip(clip.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <h4 className="mb-3 font-semibold">Admin audit history</h4>
                {bundle.audit?.map((entry: any) => <div key={entry.id} className="mb-2 border-b border-border pb-2 text-sm"><strong>{entry.action}</strong> — {entry.reason || "No reason"}<span className="block text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span></div>)}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Loading account…</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default MasterAdminConsole;
