import { supabase } from "@/integrations/supabase/client";

export const CLUB_NEWS_MAX_IMAGES = 5;
export const CLUB_NEWS_MAX_VIDEOS = 3;
export const CLUB_NEWS_MAX_MEDIA_ITEMS = CLUB_NEWS_MAX_IMAGES + CLUB_NEWS_MAX_VIDEOS;
const LOCATION_CACHE_KEY = "footystatus_viewer_location";
const LOCATION_CACHE_TTL_MS = 1000 * 60 * 30;

export interface ClubNewsMediaItem {
  id: string;
  post_id: string;
  media_type: "image" | "video";
  media_url: string;
  thumbnail_url: string | null;
  storage_path: string;
  sort_order: number;
  created_at: string;
}

export interface ClubNewsPostSummary {
  id: string;
  club_id: string;
  team_id: string;
  author_user_id: string;
  club_name: string;
  club_profile_image_url: string | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | null;
  media_count: number;
}

export interface ClubNewsPostDetail extends ClubNewsPostSummary {
  media: ClubNewsMediaItem[];
}

export interface ClubNewsComposerPayload {
  clubId: string;
  teamId: string;
  clubName: string;
  title: string;
  body: string;
  userId: string;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
}

export interface ViewerCoordinates {
  latitude: number;
  longitude: number;
}

const normalizeSummary = (row: any, media: ClubNewsMediaItem[] = []): ClubNewsPostSummary => ({
  id: row.id,
  club_id: row.club_id,
  team_id: row.team_id,
  author_user_id: row.author_user_id,
  club_name: row.club_name || row.clubs?.name || "Club",
  club_profile_image_url: row.club_profile_image_url || null,
  title: row.title,
  body: row.body,
  created_at: row.created_at,
  updated_at: row.updated_at,
  cover_media_url:
    row.cover_media_url ||
    row.cover_media?.media_url ||
    media[0]?.thumbnail_url ||
    media[0]?.media_url ||
    null,
  cover_media_type: row.cover_media_type || row.cover_media?.media_type || media[0]?.media_type || null,
  media_count: Number(row.media_count || media.length || 0),
});

const sortMedia = (media: ClubNewsMediaItem[]) =>
  [...media].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

const attachClubProfileImages = async <T extends { team_id: string }>(rows: T[]) => {
  const teamIds = Array.from(new Set(rows.map((row) => row.team_id).filter(Boolean)));
  if (!teamIds.length) {
    return rows.map((row) => ({ ...row, club_profile_image_url: null }));
  }

  const { data: teamProfiles } = await (supabase as any)
    .from("team_profiles")
    .select("team_id, logo_url")
    .in("team_id", teamIds);

  const logoByTeamId = new Map<string, string | null>();
  ((teamProfiles || []) as Array<{ team_id: string; logo_url: string | null }>).forEach((row) => {
    if (!logoByTeamId.has(row.team_id) && row.logo_url) {
      logoByTeamId.set(row.team_id, row.logo_url);
    }
  });

  return rows.map((row) => ({
    ...row,
    club_profile_image_url: logoByTeamId.get(row.team_id) || null,
  }));
};

export const getClubNewsExcerpt = (body: string, maxLength = 110) => {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
};

export const formatClubNewsDate = (dateString: string) =>
  new Date(dateString).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const getCachedViewerCoordinates = async (): Promise<ViewerCoordinates | null> => {
  if (typeof window === "undefined" || !("geolocation" in navigator)) return null;

  const cached = window.localStorage.getItem(LOCATION_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ViewerCoordinates & { savedAt: number };
      if (Date.now() - parsed.savedAt < LOCATION_CACHE_TTL_MS) {
        return { latitude: parsed.latitude, longitude: parsed.longitude };
      }
    } catch {
      window.localStorage.removeItem(LOCATION_CACHE_KEY);
    }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextValue = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(nextValue));
        resolve({ latitude: nextValue.latitude, longitude: nextValue.longitude });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 6000,
        maximumAge: LOCATION_CACHE_TTL_MS,
      }
    );
  });
};

export const compressImageForClubNews = async (file: File) => {
  if (!file.type.startsWith("image/")) return file;

  return new Promise<File>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");

        if (!context) {
          resolve(file);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.82
        );
      };
      image.onerror = () => resolve(file);
      image.src = String(reader.result);
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};

export const fetchManagedClubContext = async (userId: string) => {
  const [{ data: teamProfile }, { data: profile }] = await Promise.all([
    (supabase as any)
      .from("team_profiles")
      .select("club_id, team_id, club_name, city")
      .eq("user_id", userId)
      .maybeSingle(),
    (supabase as any).from("profiles").select("account_role").eq("user_id", userId).maybeSingle(),
  ]);

  if (!teamProfile || profile?.account_role !== "team_club") return null;

  const club =
    teamProfile.club_id &&
    (await (supabase as any).from("clubs").select("id, name, city, latitude, longitude").eq("id", teamProfile.club_id).maybeSingle()).data;

  return {
    clubId: club?.id || teamProfile.club_id || null,
    teamId: teamProfile.team_id || null,
    clubName: club?.name || teamProfile.club_name || null,
    city: club?.city || teamProfile.city || null,
    latitude: club?.latitude || null,
    longitude: club?.longitude || null,
  };
};

export const fetchClubNewsForTeam = async (teamId: string, limit?: number) => {
  let query = (supabase as any)
    .from("club_news_posts")
    .select("id, club_id, team_id, author_user_id, title, body, created_at, updated_at, cover_media_id, clubs(name)")
    .eq("team_id", teamId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  const postRows = (data || []) as any[];
  const enrichedPostRows = await attachClubProfileImages(postRows);
  const postIds = enrichedPostRows.map((row) => row.id);
  const { data: mediaRows, error: mediaError } = postIds.length
    ? await (supabase as any)
        .from("club_news_media")
        .select("id, post_id, media_type, media_url, thumbnail_url, storage_path, sort_order, created_at")
        .in("post_id", postIds)
    : { data: [], error: null };

  if (mediaError) throw mediaError;

  const mediaByPostId = new Map<string, ClubNewsMediaItem[]>();
  ((mediaRows || []) as ClubNewsMediaItem[]).forEach((media) => {
    const current = mediaByPostId.get(media.post_id) || [];
    current.push(media);
    mediaByPostId.set(media.post_id, current);
  });

  return enrichedPostRows.map((row) => {
    const media = sortMedia(mediaByPostId.get(row.id) || []);
    const cover = media.find((item) => item.id === row.cover_media_id) || media[0] || null;
    return normalizeSummary({
      ...row,
      club_name: row.clubs?.name,
      cover_media_url: cover?.thumbnail_url || cover?.media_url || null,
      cover_media_type: cover?.media_type || null,
      media_count: media.length,
    });
  });
};

export const fetchClubNewsPost = async (postId: string) => {
  const [{ data: postRow, error: postError }, { data: mediaRows, error: mediaError }] = await Promise.all([
    (supabase as any)
      .from("club_news_posts")
      .select("id, club_id, team_id, author_user_id, title, body, created_at, updated_at, clubs(name)")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle(),
    (supabase as any)
      .from("club_news_media")
      .select("id, post_id, media_type, media_url, thumbnail_url, storage_path, sort_order, created_at")
      .eq("post_id", postId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (postError) throw postError;
  if (mediaError) throw mediaError;
  if (!postRow) return null;

  const [enrichedPostRow] = await attachClubProfileImages([postRow as any]);

  const media = sortMedia((mediaRows || []) as ClubNewsMediaItem[]);
  return {
    ...normalizeSummary(
      {
        ...enrichedPostRow,
        club_name: (enrichedPostRow as any).clubs?.name || postRow.clubs?.name,
        media_count: media.length,
      },
      media
    ),
    media,
  } as ClubNewsPostDetail;
};

export const fetchNearbyClubNews = async (coordinates: ViewerCoordinates, limit = 20) => {
  const { data, error } = await (supabase as any).rpc("fetch_nearby_club_news", {
    _viewer_lat: coordinates.latitude,
    _viewer_lng: coordinates.longitude,
    _radius_miles: 500,
    _limit: limit,
  });

  if (error) throw error;
  const enrichedRows = await attachClubProfileImages((data || []) as any[]);
  return (enrichedRows as any[]).map((row) => normalizeSummary(row));
};

export const createClubNewsPost = async (payload: ClubNewsComposerPayload) => {
  const { data, error } = await (supabase as any)
    .from("club_news_posts")
    .insert({
      club_id: payload.clubId,
      team_id: payload.teamId,
      author_user_id: payload.userId,
      title: payload.title.trim(),
      body: payload.body.trim(),
      city: payload.city || null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
};

export const updateClubNewsPost = async (
  postId: string,
  payload: Pick<ClubNewsComposerPayload, "title" | "body" | "latitude" | "longitude" | "city">
) => {
  const { error } = await (supabase as any)
    .from("club_news_posts")
    .update({
      title: payload.title.trim(),
      body: payload.body.trim(),
      city: payload.city || null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) throw error;
};

export const deleteClubNewsPost = async (postId: string) => {
  const { data: mediaRows } = await (supabase as any)
    .from("club_news_media")
    .select("id, storage_path")
    .eq("post_id", postId);

  const storagePaths = ((mediaRows || []) as any[]).map((row) => row.storage_path).filter(Boolean);
  if (storagePaths.length) {
    await supabase.storage.from("club-news").remove(storagePaths);
  }

  const { error } = await (supabase as any).from("club_news_posts").delete().eq("id", postId);
  if (error) throw error;
};

export const deleteClubNewsMedia = async (mediaIds: string[]) => {
  if (!mediaIds.length) return;
  const { data: rows } = await (supabase as any)
    .from("club_news_media")
    .select("id, storage_path")
    .in("id", mediaIds);

  const storagePaths = ((rows || []) as any[]).map((row) => row.storage_path).filter(Boolean);
  if (storagePaths.length) {
    await supabase.storage.from("club-news").remove(storagePaths);
  }

  const { error } = await (supabase as any).from("club_news_media").delete().in("id", mediaIds);
  if (error) throw error;
};

export const uploadClubNewsMediaFiles = async (
  postId: string,
  userId: string,
  files: File[]
) => {
  const uploadedRows: ClubNewsMediaItem[] = [];
  const { data: existingMediaRows } = await (supabase as any)
    .from("club_news_media")
    .select("id")
    .eq("post_id", postId);

  const startingSortOrder = (existingMediaRows || []).length;

  for (let index = 0; index < files.length; index += 1) {
    const originalFile = files[index];
    const file = await compressImageForClubNews(originalFile);
    const fileExt = file.name.split(".").pop() || "bin";
    const mediaType = file.type.startsWith("video/") ? "video" : "image";
    const storagePath = `${userId}/club-news/${postId}/${Date.now()}-${index}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("club-news")
      .upload(storagePath, file, { cacheControl: "3600", upsert: false });

    if (uploadError) {
      throw uploadError;
    }

    const { data: urlData } = supabase.storage.from("club-news").getPublicUrl(storagePath);
    const { data: mediaRow, error: mediaError } = await (supabase as any)
      .from("club_news_media")
      .insert({
        post_id: postId,
        media_type: mediaType,
        media_url: urlData.publicUrl,
        thumbnail_url: mediaType === "image" ? urlData.publicUrl : null,
        storage_path: storagePath,
        sort_order: startingSortOrder + index,
      })
      .select("id, post_id, media_type, media_url, thumbnail_url, storage_path, sort_order, created_at")
      .single();

    if (mediaError) {
      throw mediaError;
    }

    uploadedRows.push(mediaRow as ClubNewsMediaItem);
  }

  return uploadedRows;
};

export const updateClubNewsCoverMedia = async (postId: string, coverMediaId: string | null) => {
  const { error } = await (supabase as any)
    .from("club_news_posts")
    .update({ cover_media_id: coverMediaId, updated_at: new Date().toISOString() })
    .eq("id", postId);

  if (error) throw error;
};

export const updateClubCoordinates = async (clubId: string, coordinates: ViewerCoordinates | null) => {
  if (!coordinates) return;

  const { error } = await (supabase as any)
    .from("clubs")
    .update({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clubId);

  if (error) throw error;
};
