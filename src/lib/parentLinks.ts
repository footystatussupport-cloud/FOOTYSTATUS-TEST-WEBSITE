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
    username: string | null;
    avatar_url: string | null;
    team: string | null;
    team_name: string | null;
    age_birth_year: string | null;
    position: string | null;
    // Live values from the linked player account (single source of truth).
    current_league_name?: string | null;
    current_age_group?: string | null;
  } | null;
}

// A linked parent account rendered as an interactive profile tile on the player
// side. Identity fields mirror the parent's live public profile so the tile
// stays in sync; contact fields are only populated for viewers the player's
// contact-privacy setting allows.
export interface LinkedParentTile {
  link_id: string;
  status: "pending" | "approved";
  parent_user_id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
  relationship_to_player: string | null;
  notes: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  emergency_contact: string | null;
  can_review: boolean;
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
  const rpcResult = await (supabase as any).rpc("get_parent_profile_details", {
    _parent_user_id: userId,
  });

  if (!rpcResult.error) {
    const firstRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    return { data: (firstRow || null) as ParentProfileDetails | null, error: null };
  }

  const { data, error } = await (supabase as any)
    .from("parent_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return { data: (data || null) as ParentProfileDetails | null, error };
};

export const fetchParentLinksForParentUser = async (userId: string) => {
  // Read the parent's linked children through a SECURITY DEFINER RPC so the
  // relationship is retrieved authoritatively from the parent side, immune to
  // player_profiles RLS that would otherwise hide the child rows.
  const { data, error } = await (supabase as any).rpc("get_parent_linked_children", {
    _parent_user_id: userId,
  });

  if (error || !data) return [] as ParentPlayerLink[];

  const rows = data as any[];

  // Enrich with the players' live team / league / age group from the public
  // player view (single source of truth for the player's current information).
  const playerProfileIds = rows.map((row) => row.player_profile_id).filter(Boolean);

  let liveById: Record<string, any> = {};
  if (playerProfileIds.length) {
    const { data: liveRows } = await (supabase as any)
      .from("player_profiles_public")
      .select("id, full_name, username, avatar_url, profile_image_url, team, team_name, current_league_name, current_age_group, age_birth_year")
      .in("id", playerProfileIds);
    liveById = Object.fromEntries((liveRows || []).map((row: any) => [row.id, row]));
  }

  return rows.map((row: any) => {
    const live = liveById[row.player_profile_id] || {};
    return {
      id: row.link_id,
      status: row.status,
      parent_profile_id: "",
      player_profile_id: row.player_profile_id,
      relationship_to_player: row.relationship_to_player,
      notes: row.notes,
      created_at: row.created_at,
      approved_at: row.approved_at,
      player: {
        id: row.player_profile_id,
        user_id: row.player_user_id,
        full_name: live.full_name ?? row.player_full_name,
        username: live.username ?? row.player_username ?? null,
        avatar_url: live.avatar_url ?? live.profile_image_url ?? row.player_avatar_url ?? null,
        team: live.team ?? row.player_team,
        team_name: live.team_name ?? row.player_team_name,
        age_birth_year: live.age_birth_year ?? row.player_age_birth_year,
        position: row.player_position,
        current_league_name: live.current_league_name ?? null,
        current_age_group: live.current_age_group ?? null,
      },
    };
  }) as ParentPlayerLink[];
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

// Authoritative list of a player's linked parent accounts as interactive
// profile tiles (identity + gated contact + review flag). Used on both the
// player's own profile and, for allowed viewers, their public profile.
export const fetchLinkedParentsForPlayer = async (playerUserId: string) => {
  const { data, error } = await (supabase as any).rpc("get_player_linked_parents", {
    _player_user_id: playerUserId,
  });

  if (error || !data) return [] as LinkedParentTile[];

  return (data as any[]).map((row) => ({
    link_id: row.link_id,
    status: row.status,
    parent_user_id: row.parent_user_id,
    full_name: row.parent_full_name || "Parent / Guardian",
    username: row.parent_username || null,
    avatar_url: row.parent_avatar_url || null,
    relationship_to_player: row.relationship_to_player || null,
    notes: row.notes || null,
    contact_email: row.contact_email || null,
    contact_phone: row.contact_phone || null,
    emergency_contact: row.emergency_contact || null,
    can_review: !!row.can_review,
  })) as LinkedParentTile[];
};

export const fetchPrivateParentContactsForPlayer = async (playerUserId: string) => {
  const { data, error } = await (supabase as any).rpc("get_player_private_parent_contacts", {
    _player_user_id: playerUserId,
  });

  return { data: (data || []) as PrivateParentContact[], error };
};
