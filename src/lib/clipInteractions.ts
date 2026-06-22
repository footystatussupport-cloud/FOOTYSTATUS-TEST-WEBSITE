import { supabase } from "@/integrations/supabase/client";

interface ToggleClipLikeResult {
  liked: boolean;
  likesCount: number;
}

const getRpcRow = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
};

export const fetchLikedClipIds = async (userId: string) => {
  const { data, error } = await supabase
    .from("clip_likes")
    .select("clip_id")
    .eq("user_id", userId);

  if (error) throw error;
  return new Set((data || []).map((row) => row.clip_id).filter(Boolean) as string[]);
};

export const toggleClipLike = async (clipId: string, userId: string): Promise<ToggleClipLikeResult> => {
  const rpcResponse = await (supabase as any).rpc("toggle_clip_like", {
    _clip_id: clipId,
  });

  if (!rpcResponse.error) {
    const row = getRpcRow<{ liked: boolean; likes_count: number | null }>(rpcResponse.data);
    if (row) {
      return {
        liked: !!row.liked,
        likesCount: Number(row.likes_count || 0),
      };
    }
  }

  const { data: existingLike } = await supabase
    .from("clip_likes")
    .select("id")
    .eq("clip_id", clipId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingLike?.id) {
    const { error } = await supabase
      .from("clip_likes")
      .delete()
      .eq("clip_id", clipId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("clip_likes").insert({
      clip_id: clipId,
      user_id: userId,
    });
    if (error) throw error;
  }

  const { count, error: countError } = await supabase
    .from("clip_likes")
    .select("id", { count: "exact", head: true })
    .eq("clip_id", clipId);

  if (countError) throw countError;

  const likesCount = count || 0;
  await supabase.from("clips").update({ likes_count: likesCount }).eq("id", clipId);

  return {
    liked: !existingLike?.id,
    likesCount,
  };
};

export const recordClipView = async (clipId: string) => {
  const rpcResponse = await (supabase as any).rpc("record_clip_view", {
    _clip_id: clipId,
    _playback_source: "next_up",
  });

  if (!rpcResponse.error) {
    await (supabase as any).rpc("mark_next_up_clip_viewed", { _clip_id: clipId });
    const nextCount = Number(rpcResponse.data || 0);
    if (Number.isFinite(nextCount)) return nextCount;
  }

  const { data: clip, error: clipError } = await supabase
    .from("clips")
    .select("views_count")
    .eq("id", clipId)
    .maybeSingle();

  if (clipError) throw clipError;

  const nextViewsCount = Number(clip?.views_count || 0) + 1;
  const { error: updateError } = await supabase
    .from("clips")
    .update({ views_count: nextViewsCount })
    .eq("id", clipId);

  if (updateError) throw updateError;

  return nextViewsCount;
};
