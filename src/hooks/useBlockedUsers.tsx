import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface BlockedUser {
  id: string;
  blocked_user_id: string;
  created_at: string;
  email?: string;
  full_name?: string;
}

export const useBlockedUsers = () => {
  const { user } = useAuth();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBlocked = useCallback(async () => {
    if (!user) { setBlockedUsers([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("blocked_users")
      .select("id, blocked_user_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load blocked users:", error);
    } else {
      // Fetch profile names for blocked users
      const ids = (data || []).map((b) => b.blocked_user_id);
      const profileMap: Record<string, { full_name: string | null; email: string | null }> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", ids);
        if (profiles) {
          for (const p of profiles) {
            if (p.user_id) profileMap[p.user_id] = { full_name: p.full_name, email: p.email };
          }
        }
      }
      setBlockedUsers(
        (data || []).map((b) => ({
          ...b,
          full_name: profileMap[b.blocked_user_id]?.full_name || undefined,
          email: profileMap[b.blocked_user_id]?.email || undefined,
        }))
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchBlocked(); }, [fetchBlocked]);

  const blockUser = useCallback(async (blockedUserId: string) => {
    if (!user) return;
    const { error } = await supabase.from("blocked_users").insert({
      user_id: user.id,
      blocked_user_id: blockedUserId,
    });
    if (error) {
      toast({ title: "Error", description: "Could not block user.", variant: "destructive" });
    } else {
      toast({ title: "User blocked" });
      fetchBlocked();
    }
  }, [user, fetchBlocked]);

  const unblockUser = useCallback(async (blockedUserId: string) => {
    if (!user) return;
    const { error } = await supabase.from("blocked_users")
      .delete()
      .eq("user_id", user.id)
      .eq("blocked_user_id", blockedUserId);
    if (error) {
      toast({ title: "Error", description: "Could not unblock user.", variant: "destructive" });
    } else {
      toast({ title: "User unblocked" });
      fetchBlocked();
    }
  }, [user, fetchBlocked]);

  const isBlocked = useCallback((userId: string) => {
    return blockedUsers.some((b) => b.blocked_user_id === userId);
  }, [blockedUsers]);

  return { blockedUsers, loading, blockUser, unblockUser, isBlocked, refetch: fetchBlocked };
};
