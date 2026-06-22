import { supabase } from "@/integrations/supabase/client";

export interface ParentProfileDetails {
  id: string;
  user_id: string;
  full_name: string;
  relationship_to_player: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  emergency_contact: string | null;
  child_full_name: string | null;
  child_where_plays: string | null;
  child_team: string | null;
  child_league: string | null;
  child_age_group: string | null;
  parent_notes: string | null;
}

export interface ParentPlayerLink {
  id: string;
  status: "pending" | "approved" | "denied";
  parent_profile_id: string;
  player_profile_id: string;
  relationship_to_player: string | null;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  parent?: ParentProfileDetails | null;
  player?: {
    id: string;
    user_id: string;
    full_name: string | null;
    team: string | null;
    team_name: string | null;
    age_birth_year: string | null;
    position: string | null;
  } | null;
}

export interface PrivateParentContact {
  link_id: string;
  parent_user_id: string;
  parent_full_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  emergency_contact: string | null;
  relationship_to_player: string | null;
  notes: string | null;
}

export const requestParentPlayerLink = (playerUserId: string, relationship?: string | null, notes?: string | null) =>
  (supabase as any).rpc("request_parent_player_link", {
    _player_user_id: playerUserId,
    _relationship: relationship || null,
    _notes: notes || null,
  });

export const reviewParentPlayerLink = (linkId: string, approve: boolean) =>
  (supabase as any).rpc("review_parent_player_link", {
    _link_id: linkId,
    _approve: approve,
  });

export const removeOwnParentPlayerLink = (linkId: string) =>
  (supabase as any).rpc("remove_own_parent_player_link", {
    _link_id: linkId,
  });

export const fetchParentProfileForUser = async (userId: string) => {
  const { data, error } = await (supabase as any)
    .from("parent_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return { data: (data || null) as ParentProfileDetails | null, error };
};

export const fetchParentLinksForParentUser = async (userId: string) => {
  const { data: parentProfile } = await (supabase as any)
    .from("parent_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!parentProfile?.id) return [] as ParentPlayerLink[];

  const { data } = await (supabase as any)
    .from("parent_player_links")
    .select("*, player_profiles(id, user_id, full_name, team, team_name, age_birth_year, position)")
    .eq("parent_profile_id", parentProfile.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  return (data || []).map((link: any) => ({
    ...link,
    player: link.player_profiles || null,
  })) as ParentPlayerLink[];
};

export const fetchParentLinksForPlayerUser = async (userId: string) => {
  const { data: playerProfile } = await (supabase as any)
    .from("player_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!playerProfile?.id) return [] as ParentPlayerLink[];

  const { data } = await (supabase as any)
    .from("parent_player_links")
    .select("*, parent_profiles(*)")
    .eq("player_profile_id", playerProfile.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  return (data || []).map((link: any) => ({
    ...link,
    parent: link.parent_profiles || null,
  })) as ParentPlayerLink[];
};

export const fetchPrivateParentContactsForPlayer = async (playerUserId: string) => {
  const { data, error } = await (supabase as any).rpc("get_player_private_parent_contacts", {
    _player_user_id: playerUserId,
  });

  return { data: (data || []) as PrivateParentContact[], error };
};
