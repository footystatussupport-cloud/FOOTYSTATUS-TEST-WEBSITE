import { supabase } from "@/integrations/supabase/client";

export type RefereeMatchRole = "main_referee" | "assistant_referee" | "fourth_official" | "other";
export type RefereeClaimStatus = "pending" | "approved" | "denied";
export type RefereeVerificationStatus = "pending" | "verified" | "revision_requested" | "rejected";

export interface RefereeVerificationState {
  status: RefereeVerificationStatus;
  note: string | null;
  submitted_at: string | null;
  certification_proof_url: string | null;
}

export const REFEREE_PROOF_ACCEPT = ".pdf,.jpg,.jpeg,.png";
export const REFEREE_PROOF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const REFEREE_PROOF_ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const REFEREE_PROOF_ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

/** Returns an error message when the certification file is not acceptable. */
export const validateRefereeProofFile = (file: File | null | undefined): string | null => {
  if (!file) return "Proof of referee certification is required before creating a Referee account.";
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!REFEREE_PROOF_ALLOWED_TYPES.includes(file.type) && !REFEREE_PROOF_ALLOWED_EXTENSIONS.includes(extension)) {
    return "Unsupported file type. Please upload a PDF, JPG, JPEG, or PNG.";
  }
  if (file.size > REFEREE_PROOF_MAX_BYTES) {
    return "The file is too large. Please upload a document under 10 MB.";
  }
  return null;
};

export const refereeVerificationLabel = (status?: string | null) => {
  switch (status) {
    case "verified":
      return "Verified Referee";
    case "revision_requested":
      return "Revision Required";
    case "rejected":
      return "Verification Denied";
    default:
      return "Pending Verification";
  }
};

export const fetchRefereeVerification = async (userId: string): Promise<RefereeVerificationState | null> => {
  const { data, error } = await (supabase as any)
    .from("profiles")
    .select("referee_verification_status, referee_verification_note, referee_verification_submitted_at, referee_certification_proof_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    status: (data.referee_verification_status || "pending") as RefereeVerificationStatus,
    note: data.referee_verification_note || null,
    submitted_at: data.referee_verification_submitted_at || null,
    certification_proof_url: data.referee_certification_proof_url || null,
  };
};

export const uploadRefereeCertification = async (userId: string, file: File) => {
  const extension = file.name.split(".").pop() || "file";
  const path = `${userId}/certification-${Date.now()}.${extension}`;
  const uploadRes = await supabase.storage.from("referee-proof").upload(path, file, { upsert: true });
  if (uploadRes.error) throw uploadRes.error;
  return path;
};

export const resubmitRefereeCertification = (proofPath: string) =>
  (supabase as any).rpc("resubmit_referee_certification", { _proof_path: proofPath });

export interface RefereeVerificationApplication {
  user_id: string;
  avatar_url: string | null;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  certification_level: string | null;
  license_number: string | null;
  certifying_organization: string | null;
  years_experience: number | null;
  main_experience: string | null;
  assistant_experience: string | null;
  leagues_tournaments: string | null;
  availability: string | null;
  accolades: string | null;
  bio: string | null;
  certification_proof_url: string | null;
  verification_status: string | null;
  verification_note: string | null;
  submitted_at: string | null;
}

export const fetchRefereeVerificationQueue = async () => {
  const { data, error } = await (supabase as any).rpc("get_referee_verification_queue");
  return { data: (data || []) as RefereeVerificationApplication[], error };
};

export const reviewRefereeVerification = (payload: {
  refereeUserId: string;
  action: "verify" | "request_revision" | "reject";
  note?: string | null;
}) =>
  (supabase as any).rpc("review_referee_verification", {
    _referee_user_id: payload.refereeUserId,
    _action: payload.action,
    _note: payload.note || null,
  });

export const getRefereeProofSignedUrl = async (path: string) => {
  const { data, error } = await supabase.storage.from("referee-proof").createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl || null;
};

export interface RefereeMatchClaim {
  id: string;
  match_id: string;
  referee_user_id: string;
  referee_type: RefereeMatchRole;
  show_name_publicly: boolean;
  proof_url: string | null;
  proof_file_name: string | null;
  status: RefereeClaimStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  referee_name?: string | null;
  match_label?: string | null;
  match_date?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  league_name?: string | null;
}

export const refereeRoleLabel = (role?: string | null) => {
  switch (role) {
    case "main_referee":
      return "Main referee";
    case "assistant_referee":
      return "Assistant referee";
    case "fourth_official":
      return "Fourth official";
    case "other":
      return "Other match staff";
    default:
      return "Referee";
  }
};

export const uploadRefereeProofFile = async (payload: {
  userId: string;
  matchId: string;
  file: File;
}) => {
  const extension = payload.file.name.split(".").pop() || "file";
  const path = `${payload.userId}/${payload.matchId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const uploadRes = await supabase.storage.from("referee-proof").upload(path, payload.file, { upsert: true });
  if (uploadRes.error) throw uploadRes.error;
  return path;
};

export const submitRefereeMatchClaim = async (payload: {
  matchId: string;
  userId: string;
  refereeType: RefereeMatchRole;
  showNamePublicly: boolean;
  proofFile: File;
}) => {
  const proofPath = await uploadRefereeProofFile({
    userId: payload.userId,
    matchId: payload.matchId,
    file: payload.proofFile,
  });

  return (supabase as any)
    .from("referee_match_claims")
    .upsert(
      {
        match_id: payload.matchId,
        referee_user_id: payload.userId,
        referee_type: payload.refereeType,
        show_name_publicly: payload.showNamePublicly,
        proof_url: proofPath,
        proof_file_name: payload.proofFile.name,
        status: "pending",
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "match_id,referee_user_id" }
    )
    .select("*")
    .single();
};

export const updateRefereeMatchClaim = async (payload: {
  claimId: string;
  refereeType: RefereeMatchRole;
  showNamePublicly: boolean;
  proofFile?: File | null;
  userId: string;
  matchId: string;
}) => {
  const updatePayload: Record<string, any> = {
    referee_type: payload.refereeType,
    show_name_publicly: payload.showNamePublicly,
    updated_at: new Date().toISOString(),
  };

  if (payload.proofFile) {
    updatePayload.proof_url = await uploadRefereeProofFile({
      userId: payload.userId,
      matchId: payload.matchId,
      file: payload.proofFile,
    });
    updatePayload.proof_file_name = payload.proofFile.name;
    updatePayload.status = "pending";
    updatePayload.review_notes = null;
  }

  return (supabase as any).from("referee_match_claims").update(updatePayload).eq("id", payload.claimId).select("*").single();
};

export const reviewRefereeMatchClaim = async (payload: {
  claimId: string;
  reviewerUserId: string;
  approve: boolean;
  notes?: string | null;
}) => {
  if (!payload.approve) {
    return (supabase as any).from("referee_match_claims").delete().eq("id", payload.claimId);
  }

  return (supabase as any)
    .from("referee_match_claims")
    .update({
      status: "approved",
      review_notes: payload.notes || null,
      reviewed_by: payload.reviewerUserId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.claimId)
    .select("*")
    .single();
};

export const removeRefereeMatchAssignment = async (payload: {
  claimId: string;
  matchId?: string | null;
}) =>
  (supabase as any).rpc("remove_referee_match_assignment", {
    _claim_id: payload.claimId,
    _match_id: payload.matchId || null,
  });

export const fetchRefereeClaimsForMatch = async (matchId: string, includePrivate = false) => {
  if (!includePrivate) {
    const { data, error } = await (supabase as any).rpc("get_public_referee_match_assignments", { _match_id: matchId });
    return {
      data: (data || []) as RefereeMatchClaim[],
      error: error || null,
    };
  }

  const columns = includePrivate
    ? "*, profiles!referee_match_claims_referee_user_id_fkey(full_name)"
    : "id, match_id, referee_user_id, referee_type, show_name_publicly, status, created_at, updated_at, profiles!referee_match_claims_referee_user_id_fkey(full_name)";

  const { data, error } = await (supabase as any)
    .from("referee_match_claims")
    .select(columns)
    .eq("match_id", matchId)
    .order("created_at", { ascending: false });

  if (error) return { data: [] as RefereeMatchClaim[], error };

  return {
    data: (data || []).map((claim: any) => ({
      ...claim,
      referee_name: claim.profiles?.full_name || null,
    })) as RefereeMatchClaim[],
    error: null,
  };
};

export const fetchRefereeClaimsForUser = async (userId: string) => {
  const { data, error } = await (supabase as any)
    .from("referee_match_claims")
    .select("*")
    .eq("referee_user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return { data: [] as RefereeMatchClaim[], error };

  const matchIds = [...new Set((data || []).map((claim: any) => claim.match_id).filter(Boolean))];
  const { data: matchDetails } = matchIds.length
    ? await (supabase as any)
        .from("league_match_details")
        .select("id, home_team_name, away_team_name, league_name, scheduled_at")
        .in("id", matchIds)
    : { data: [] };
  const matchById = new Map((matchDetails || []).map((match: any) => [match.id, match]));

  return {
    data: (data || []).map((claim: any) => {
      const details = matchById.get(claim.match_id);
      return {
        ...claim,
        home_team_name: details?.home_team_name || null,
        away_team_name: details?.away_team_name || null,
        league_name: details?.league_name || null,
        match_date: details?.scheduled_at || null,
      };
    }) as RefereeMatchClaim[],
    error: null,
  };
};
