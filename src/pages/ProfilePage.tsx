import { useState, useEffect, useRef, ChangeEvent, PointerEvent, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, User, Calendar, Trophy, Edit, Save, X, Upload, Video, Crown, Lock, Link as LinkIcon, Phone, Mail, Shield, Star, Building2, Briefcase, MapPin, Users, Heart, Eye, Check } from "lucide-react";
import Header from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActiveMembership, LiveStandingSummary, TeamRosterPlayer, fetchActiveMembershipsForUser, fetchLiveStandingForMembership, fetchRosterForTeam, formatTeamLeagueLine, getMembershipTeamDestination } from "@/lib/teamMemberships";
import ClubTeamsManager, { OfferedClubTeam } from "@/components/club/ClubTeamsManager";
import { ClubTeamRecord, archiveClubTeam, createDaughterTeam, fetchClubByTeamId, fetchClubTeamOptionsForParentTeam, fetchClubTeams, fetchRosterForClubTeam, formatTeamGender, getAgeGroupSortValue, getOfferedTeamDuplicate, normalizeTeamGender, sanitizeClubTeamAccessCode, setDaughterTeamGender, updateClubTeamAccessCode } from "@/lib/clubTeams";
import ClubNewsSection from "@/components/club-news/ClubNewsSection";
import { Badge } from "@/components/ui/badge";
import ProBadge from "@/components/ProBadge";
import ReportContentReview from "@/components/admin/ReportContentReview";
import NextUpClipReviewBank from "@/components/admin/NextUpClipReviewBank";

import CurrentStatsSection, { CurrentStats } from "@/components/CurrentStatsSection";
import ClubHistorySection, { ClubHistoryEntry } from "@/components/ClubHistorySection";
import { refereeRoleLabel, reviewRefereeMatchClaim } from "@/lib/referees";
import {
  CLUB_COACH_REQUEST_ROLE_OPTIONS,
  CoachClubTeamAssignment,
  CoachStaffTeamLink,
  acceptCoachStaffInvite,
  fetchCoachStaffForTeam,
  fetchCoachStaffProfiles,
  fetchCoachStaffTeamLinksForUser,
  formatRoleDisplayLabel,
  formatSpecificRoleDisplayLabel,
  inviteCoachStaffToTeam,
  requestCoachClubLink,
  reviewCoachStaffJoinRequest,
  sortCoachStaffByClubStaffRole,
  unlinkCoachStaffFromTeam,
  unlinkCoachStaffFromClub,
} from "@/lib/coachStaffTeams";
import {
  FREE_DELETION_LIMIT,
  FREE_VISIBLE_CLIP_LIMIT,
  canDeleteClip,
  canUploadVisibleClip,
  getDaysRemaining,
  getIsPro,
} from "@/lib/subscriptions";
import { FOOTY_STATUS_SUPER_ADMIN_EMAIL, isFootyStatusSuperAdminEmail } from "@/lib/superAdmin";
import {
  ParentPlayerLink,
  ParentProfileDetails,
  fetchParentLinksForParentUser,
  fetchParentLinksForPlayerUser,
  fetchParentProfileForUser,
  removeOwnParentPlayerLink,
  requestParentPlayerLink,
  reviewParentPlayerLink,
} from "@/lib/parentLinks";
import { getUsernameErrorMessage, normalizeUsername, validateUsername } from "@/lib/usernames";

interface ProfileData {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  age_birth_year: string | null;
  team_name: string | null;
  club_name: string | null;
  position: string | null;
  jersey_number: string | null;
  school_grade?: string | null;
  height: string | null;
  weight: string | null;
  is_pro: boolean;
  account_category: "player" | "team_staff" | "parent" | "referee" | null;
  account_role: "player" | "team_club" | "head_coach_assistant" | "scout" | "trainer" | "academy_director" | "parent" | "referee" | null;
  role: "player" | "team" | "coach" | "scout" | "trainer" | "academy_director" | "parent" | "referee" | null;
  account_tier?: "free" | "pro_annual" | "pro_lifetime" | null;
  pro_expires_at?: string | null;
  pro_started_at?: string | null;
  clip_deletions_used?: number | null;
  coaching_role_type?: string | null;
  teams_currently_coaching?: string | null;
  past_coaching_experience?: string | null;
  coaching_licenses?: string[] | null;
  coaching_accolades?: string | null;
  coaching_location?: string | null;
  scout_role_title?: string | null;
  scout_organization?: string | null;
  scouting_licenses?: string[] | null;
  scouting_experience?: string | null;
  scouting_regions?: string | null;
  scouting_age_groups?: string[] | null;
  scouting_positions?: string[] | null;
  scouting_accolades?: string | null;
  referee_certification_level?: string | null;
  referee_license_number?: string | null;
  referee_certifying_organization?: string | null;
  referee_years_experience?: number | null;
  referee_main_experience?: string | null;
  referee_assistant_experience?: string | null;
  referee_leagues_tournaments?: string | null;
  referee_availability?: string | null;
  referee_accolades?: string | null;
  referee_profile_public?: boolean | null;
}

interface ClipData {
  id: string;
  title: string;
  caption: string | null;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  likes_count: number | null;
  views_count: number | null;
  created_at: string;
  visibility?: string;
  duration: number | null;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
  playback_volume?: number | null;
  fit_mode?: ClipFitMode | null;
  review_status?: "pending_review" | "approved" | "needs_revision";
  revision_note?: string | null;
}

type ClipVisibility = "public" | "restricted" | "private";
type ClipFitMode = "cover" | "contain";

interface ContactItem {
  id: string;
  user_id: string;
  contact_type: string;
  value: string;
  visibility: "public" | "restricted" | "private";
}

interface ContactFormState {
  player_email: string;
  player_phone: string;
  coach_email: string;
  coach_phone: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  website: string;
}

type SeasonStats = CurrentStats;

interface PendingInvite {
  id: string;
  team_id: string;
  club_team_id: string | null;
  league_id: string | null;
  age_group: string | null;
  created_at: string;
  team_name: string;
  league_name: string | null;
}

interface PendingJoinRequest {
  id: string;
  team_id: string;
  age_group: string | null;
  requested_at: string;
  status: string;
  team_name: string;
  league_name: string | null;
}

interface ManagedClubTeamInvite {
  id: string;
  team_id: string;
  club_team_id: string | null;
  player_profile_id: string;
  player_user_id: string;
  age_group: string | null;
  created_at: string;
  status?: string | null;
  player_name: string;
  player_avatar_url: string | null;
  player_username: string | null;
}

interface ManagedClubTeamJoinRequest {
  id: string;
  team_id: string;
  club_team_id: string | null;
  player_profile_id: string;
  player_user_id: string;
  age_group: string | null;
  requested_at: string;
  access_code_last4: string | null;
  player_name: string;
  player_avatar_url: string | null;
  player_username: string | null;
}

interface TeamSearchResult {
  id: string;
  club_team_id?: string | null;
  name: string;
  league_id: string | null;
  age_group: string | null;
  approval_status: string;
  league_name: string | null;
  logo_url?: string | null;
  age_groups_offered?: string[] | null;
  result_type?: "mother" | "daughter";
  search_label?: string | null;
}

interface ClubHistoryFormState {
  id?: string;
  entry_type: "linked" | "manual";
  player_profile_id?: string | null;
  player_id?: string | null;
  team_id?: string | null;
  league_id?: string | null;
  club_name: string;
  season: string;
  competition: string;
  position_role: string;
  notes: string;
  manual_goals: string;
  manual_assists: string;
  manual_appearances: string;
  manual_starts: string;
  manual_clean_sheets: string;
  manual_yellow_cards: string;
  manual_red_cards: string;
}

interface TeamAccountData {
  id?: string;
  team_id?: string | null;
  club_id?: string | null;
  club_name: string;
  leagues_offered: string[] | null;
  founded_year: number | null;
  country: string | null;
  city: string | null;
  home_stadium: string | null;
  training_ground: string | null;
  home_jersey_color: string | null;
  away_jersey_color: string | null;
  third_kit_color: string | null;
  age_groups_offered: string[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  team_type?: "club" | "school" | null;
  school_level?: string | null;
}

interface TeamStaffMember {
  id: string;
  staff_name: string;
  staff_role: string;
  personal_email: string | null;
}

interface EditableTeamStaffMember {
  id?: string;
  staff_name: string;
  staff_role: string;
  personal_email: string;
}

interface StaffAccountData {
  full_name: string;
  role: string;
  team_organization_name: string | null;
  country: string | null;
  city: string | null;
  coaching_level: string | null;
  years_experience: number | null;
  coaching_licenses: string[] | null;
  age_groups_coached: string[] | null;
  contact_email: string | null;
  contact_phone: string | null;
  previous_teams: string[] | null;
  notable_achievements: string | null;
  coaching_role_type?: string | null;
  teams_currently_coaching?: string | null;
  past_coaching_experience?: string | null;
  coaching_accolades?: string | null;
  coaching_location?: string | null;
}

interface ClubInvitePlayerResult {
  id: string;
  user_id: string;
  full_name: string;
  position: string | null;
  profile_image_url: string | null;
  username: string | null;
}

interface AdminRefereeClaimReview {
  id: string;
  match_id: string;
  referee_user_id: string;
  referee_type: string;
  show_name_publicly: boolean;
  proof_url: string | null;
  proof_file_name: string | null;
  created_at: string;
  referee_name: string;
  referee_username: string | null;
  referee_avatar_url: string | null;
  referee_certification_level: string | null;
  referee_license_number: string | null;
  referee_certifying_organization: string | null;
  match_label: string;
  league_name: string | null;
  scheduled_at: string | null;
}

const formatStandingSuffix = (position?: number | null) => {
  if (!position) return "-";
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return position + "th";
  switch (position % 10) {
    case 1:
      return position + "st";
    case 2:
      return position + "nd";
    case 3:
      return position + "rd";
    default:
      return position + "th";
  }
};

interface EditFormState extends Partial<ProfileData> {
  display_name?: string;
  leagues_offered_text?: string;
  age_groups_offered_text?: string;
  home_field_address?: string;
  training_ground_address?: string;
  contact_email?: string;
  contact_phone?: string;
  team_organization_name?: string;
  coaching_level?: string;
  years_experience?: string;
  coaching_licenses_text?: string;
  age_groups_coached_text?: string;
  previous_teams_text?: string;
  notable_achievements?: string;
  city?: string;
  coaching_role_type?: string;
  teams_currently_coaching?: string;
  coaching_accolades?: string;
  coaching_location?: string;
  scout_role_title?: string;
  scout_organization?: string;
  scouting_licenses_text?: string;
  scouting_experience?: string;
  scouting_regions?: string;
  scouting_age_groups_text?: string;
  scouting_positions_text?: string;
  scouting_accolades?: string;
  emergency_contact?: string;
  child_full_name?: string;
  child_where_plays?: string;
  child_team?: string;
  child_league?: string;
  child_age_group?: string;
  parent_notes?: string;
  relationship_to_player?: string;
}

const MAX_FREE_CLIPS = FREE_VISIBLE_CLIP_LIMIT;
const MAX_FREE_CLIP_DURATION_SECONDS = 25;
const MAX_PRO_CLIP_DURATION_SECONDS = 45;
const CONTACT_LABELS: Record<keyof ContactFormState, string> = {
  player_email: "Player Email",
  player_phone: "Player Phone",
  coach_email: "Coach Email",
  coach_phone: "Coach Phone",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Website",
};
const CONTACT_VISIBILITY_OPTIONS = [
  { value: "everyone", label: "Everyone" },
  { value: "staff_only", label: "Teams / Coaches / Staff" },
  { value: "private", label: "Only Me" },
] as const;

const mapContactVisibility = (showContactInfo: string): "public" | "restricted" | "private" => {
  if (showContactInfo === "everyone") return "public";
  if (showContactInfo === "private") return "private";
  return "restricted";
};

const SOCIAL_CONTACTS: Array<keyof ContactFormState> = ["instagram", "tiktok", "youtube", "website"];
const RESTRICTED_CONTACTS: Array<keyof ContactFormState> = ["player_email", "player_phone", "coach_email", "coach_phone"];
const CONTACT_DISPLAY_ORDER: Array<keyof ContactFormState> = ["player_email", "player_phone", "coach_email", "coach_phone", "instagram", "tiktok", "youtube", "website"];
const BIO_MAX_LENGTH = 100;

const emptyContactForm = (): ContactFormState => ({
  player_email: "",
  player_phone: "",
  coach_email: "",
  coach_phone: "",
  instagram: "",
  tiktok: "",
  youtube: "",
  website: "",
});

const emptyClubHistoryForm = (): ClubHistoryFormState => ({
  entry_type: "linked",
  player_profile_id: null,
  player_id: null,
  team_id: null,
  league_id: null,
  club_name: "",
  season: "",
  competition: "",
  position_role: "",
  notes: "",
  manual_goals: "0",
  manual_assists: "0",
  manual_appearances: "0",
  manual_starts: "0",
  manual_clean_sheets: "0",
  manual_yellow_cards: "0",
  manual_red_cards: "0",
});

const toCommaSeparated = (values?: string[] | null) => (values && values.length ? values.join(", ") : "");

const isMissingAgeGroupColumnError = (error: any) =>
  typeof error?.message === "string" &&
  error.message.includes("Could not find the 'age_group' column of 'teams' in the schema cache");

const ProfilePage = () => {
  const { user, profile: authProfile, loading: authLoading } = useAuth();
  const { settings, updateSetting } = useSettings();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [clipCount, setClipCount] = useState(0);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactForm, setContactForm] = useState<ContactFormState>(emptyContactForm());
  const [seasonStats, setSeasonStats] = useState<SeasonStats[]>([]);
  const [clubHistory, setClubHistory] = useState<ClubHistoryEntry[]>([]);
  const [playerProfileId, setPlayerProfileId] = useState<string | null>(null);
  const [playerRecordId, setPlayerRecordId] = useState<string | null>(null);
  const [clubHistoryDialogOpen, setClubHistoryDialogOpen] = useState(false);
  const [clubHistoryForm, setClubHistoryForm] = useState<ClubHistoryFormState>(emptyClubHistoryForm());
  const [clubHistoryTeamSearchQuery, setClubHistoryTeamSearchQuery] = useState("");
  const [clubHistoryTeamResults, setClubHistoryTeamResults] = useState<TeamSearchResult[]>([]);
  const [savingClubHistory, setSavingClubHistory] = useState(false);
  const [teamAccountData, setTeamAccountData] = useState<TeamAccountData | null>(null);
  const [staffAccountData, setStaffAccountData] = useState<StaffAccountData | null>(null);
  const [parentAccountData, setParentAccountData] = useState<ParentProfileDetails | null>(null);
  const [parentChildLinks, setParentChildLinks] = useState<ParentPlayerLink[]>([]);
  const [playerParentLinks, setPlayerParentLinks] = useState<ParentPlayerLink[]>([]);
  const [parentPlayerSearchQuery, setParentPlayerSearchQuery] = useState("");
  const [parentPlayerSearchResults, setParentPlayerSearchResults] = useState<any[]>([]);
  const [requestingParentLink, setRequestingParentLink] = useState(false);
  const [reviewingParentLinkId, setReviewingParentLinkId] = useState<string | null>(null);
  const [teamStaffMembers, setTeamStaffMembers] = useState<TeamStaffMember[]>([]);
  const [linkedTeamClubStaff, setLinkedTeamClubStaff] = useState<any[]>([]);
  const [teamRoster, setTeamRoster] = useState<TeamRosterPlayer[]>([]);
  const [offeredClubTeams, setOfferedClubTeams] = useState<ClubTeamRecord[]>([]);
  const [offeredClubTeamRosters, setOfferedClubTeamRosters] = useState<Record<string, TeamRosterPlayer[]>>({});
  const [teamApprovalStatus, setTeamApprovalStatus] = useState<string | null>(null);
  const [teamStaffForm, setTeamStaffForm] = useState<EditableTeamStaffMember[]>([]);
  const [activeMembership, setActiveMembership] = useState<ActiveMembership | null>(null);
  const [activeMemberships, setActiveMemberships] = useState<ActiveMembership[]>([]);
  const [activeMembershipLogoUrls, setActiveMembershipLogoUrls] = useState<Record<string, string | null>>({});
  const [teamStanding, setTeamStanding] = useState<LiveStandingSummary | null>(null);
  const [coachStaffTeamLinks, setCoachStaffTeamLinks] = useState<CoachStaffTeamLink[]>([]);
  const [coachStaffInvites, setCoachStaffInvites] = useState<any[]>([]);
  const [coachStaffRequests, setCoachStaffRequests] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequest[]>([]);
  const [managedClubTeamInvites, setManagedClubTeamInvites] = useState<ManagedClubTeamInvite[]>([]);
  const [managedClubTeamJoinRequests, setManagedClubTeamJoinRequests] = useState<ManagedClubTeamJoinRequest[]>([]);
  const [adminRefereeClaims, setAdminRefereeClaims] = useState<AdminRefereeClaimReview[]>([]);
  const [reviewingAdminRefereeClaimId, setReviewingAdminRefereeClaimId] = useState<string | null>(null);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");
  const [teamSearchResults, setTeamSearchResults] = useState<TeamSearchResult[]>([]);
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [selectedJoinTeam, setSelectedJoinTeam] = useState<TeamSearchResult | null>(null);
  const [availableClubTeams, setAvailableClubTeams] = useState<ClubTeamRecord[]>([]);
  const [selectedJoinAgeGroup, setSelectedJoinAgeGroup] = useState("");
  const [selectedJoinLeague, setSelectedJoinLeague] = useState("");
  const [coachClubTeamRoles, setCoachClubTeamRoles] = useState<Record<string, string>>({});
  const [coachGeneralClubRole, setCoachGeneralClubRole] = useState(false);
  const [teamAccessCode, setTeamAccessCode] = useState("");
  const [activeInviteClubTeamId, setActiveInviteClubTeamId] = useState<string | null>(null);
  const [clubTeamInviteSearch, setClubTeamInviteSearch] = useState("");
  const [clubTeamInviteResults, setClubTeamInviteResults] = useState<ClubInvitePlayerResult[]>([]);
  const [clubTeamInviteSearchLoading, setClubTeamInviteSearchLoading] = useState(false);
  const [teamManagePlayerSearch, setTeamManagePlayerSearch] = useState("");
  const [teamManagePlayerResults, setTeamManagePlayerResults] = useState<ClubInvitePlayerResult[]>([]);
  const [teamManagePlayerSearchLoading, setTeamManagePlayerSearchLoading] = useState(false);
  const [teamManageCoachSearch, setTeamManageCoachSearch] = useState("");
  const [teamManageCoachResults, setTeamManageCoachResults] = useState<any[]>([]);
  const [teamManageCoachSearchLoading, setTeamManageCoachSearchLoading] = useState(false);
  const [teamManageInvitingPlayerId, setTeamManageInvitingPlayerId] = useState<string | null>(null);
  const [teamManageInvitingCoachId, setTeamManageInvitingCoachId] = useState<string | null>(null);
  const [reviewingCoachStaffRequestId, setReviewingCoachStaffRequestId] = useState<string | null>(null);
  const [teamOwnerPlayerInvites, setTeamOwnerPlayerInvites] = useState<any[]>([]);
  const [teamOwnerPlayerRequests, setTeamOwnerPlayerRequests] = useState<any[]>([]);
  const [reviewingTeamOwnerPlayerRequestId, setReviewingTeamOwnerPlayerRequestId] = useState<string | null>(null);
  const [invitingClubTeamId, setInvitingClubTeamId] = useState<string | null>(null);
  const [clubTeamAccessCodes, setClubTeamAccessCodes] = useState<Record<string, string>>({});
  const [savingClubTeamAccessCodeId, setSavingClubTeamAccessCodeId] = useState<string | null>(null);
  const [reviewingClubTeamRequestId, setReviewingClubTeamRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<"details" | "contact" | null>(null);
  const [saving, setSaving] = useState(false);
  const [daughterTeamDialogOpen, setDaughterTeamDialogOpen] = useState(false);
  const [creatingDaughterTeam, setCreatingDaughterTeam] = useState(false);
  const [categorizingDaughterTeamId, setCategorizingDaughterTeamId] = useState<string | null>(null);
  const [daughterTeamForm, setDaughterTeamForm] = useState({
    age_group: "",
    league_or_conference: "",
    school_level: "",
    gender: "",
    season: "",
    level: "",
  });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showAvatarCropDialog, setShowAvatarCropDialog] = useState(false);
  const [avatarCropSourceFile, setAvatarCropSourceFile] = useState<File | null>(null);
  const [avatarCropPreviewUrl, setAvatarCropPreviewUrl] = useState<string | null>(null);
  const [avatarCropImageSize, setAvatarCropImageSize] = useState<{ width: number; height: number } | null>(null);
  const [avatarCropZoom, setAvatarCropZoom] = useState(1);
  const [avatarCropOffsetX, setAvatarCropOffsetX] = useState(0);
  const [avatarCropOffsetY, setAvatarCropOffsetY] = useState(0);
  const [uploadingClip, setUploadingClip] = useState(false);
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [selectedVideoDuration, setSelectedVideoDuration] = useState<number | null>(null);
  const [selectedVideoPreviewUrl, setSelectedVideoPreviewUrl] = useState<string | null>(null);
  const [showPostConfirmation, setShowPostConfirmation] = useState(false);
  const [clipPendingDelete, setClipPendingDelete] = useState<ClipData | null>(null);
  const [clipTitle, setClipTitle] = useState("");
  const [clipCaption, setClipCaption] = useState("");
  const [clipVisibility, setClipVisibility] = useState<ClipVisibility>("public");
  const [clipTrimStart, setClipTrimStart] = useState(0);
  const [clipTrimEnd, setClipTrimEnd] = useState(0);
  const [clipPlaybackVolume, setClipPlaybackVolume] = useState(1);
  const [clipFitMode, setClipFitMode] = useState<ClipFitMode>("cover");
  const [editForm, setEditForm] = useState<EditFormState>({});
  const offeredClubTeamsByLeague = useMemo(() => {
    const activeTeams = offeredClubTeams.filter((team) => team.status !== "archived");
    const sortTeams = (teams: OfferedClubTeam[]) =>
      [...teams].sort((a, b) => {
        const leagueDiff = (a.league_name || "").localeCompare(b.league_name || "");
        return leagueDiff || getAgeGroupSortValue(a.age_group) - getAgeGroupSortValue(b.age_group);
      });
    const sections: Array<readonly [string, OfferedClubTeam[]]> = [
      ["Boys Teams", sortTeams(activeTeams.filter((team) => normalizeTeamGender(team.gender) === "boy"))],
      ["Girls Teams", sortTeams(activeTeams.filter((team) => normalizeTeamGender(team.gender) === "girl"))],
    ];
    const uncategorized = sortTeams(activeTeams.filter((team) => !normalizeTeamGender(team.gender)));
    if (uncategorized.length) sections.push(["Needs Categorization", uncategorized]);
    return sections;
  }, [offeredClubTeams]);
  const sortedLinkedTeamClubStaff = useMemo(
    () =>
      sortCoachStaffByClubStaffRole(
        linkedTeamClubStaff.filter((staff) => {
          const staffProfile = staff.profile || staff.profiles || {};
          return staffProfile.account_role === "academy_director";
        })
      ),
    [linkedTeamClubStaff]
  );

  useEffect(() => {
    setClubTeamAccessCodes((prev) => {
      const next: Record<string, string> = {};
      offeredClubTeams.forEach((team) => {
        if (!team.id) return;
        next[team.id] = prev[team.id] ?? team.access_code_value ?? "";
      });
      return next;
    });
  }, [offeredClubTeams]);

  useEffect(() => {
    if (!selectedVideoFile) {
      setSelectedVideoPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedVideoFile);
    setSelectedVideoPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedVideoFile]);

  useEffect(() => {
    const video = clipPreviewVideoRef.current;
    if (!video) return;
    video.volume = clipPlaybackVolume;
    if (video.currentTime < clipTrimStart || video.currentTime > clipTrimEnd) {
      video.currentTime = clipTrimStart;
    }
  }, [clipPlaybackVolume, clipTrimEnd, clipTrimStart, selectedVideoPreviewUrl]);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const clipInputRef = useRef<HTMLInputElement>(null);
  const clipPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const avatarCropDragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const avatarCropPreviewSize = 288;
  const stopTileEvent = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  const formatManagementTimestamp = (value?: string | null) => {
    if (!value) return null;
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) return null;
    return parsedDate.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };
  const formatInviteStatus = (status?: string | null) => {
    if (!status) return "Pending";
    if (status === "revoked" || status === "cancelled") return "Cancelled";
    if (status === "rejected") return "Declined";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };
  const avatarCropMetrics = useMemo(() => {
    if (!avatarCropImageSize) return null;

    const baseScale = Math.max(
      avatarCropPreviewSize / avatarCropImageSize.width,
      avatarCropPreviewSize / avatarCropImageSize.height
    );
    const drawWidth = avatarCropImageSize.width * baseScale * avatarCropZoom;
    const drawHeight = avatarCropImageSize.height * baseScale * avatarCropZoom;
    const maxOffsetX = Math.max(0, (drawWidth - avatarCropPreviewSize) / 2);
    const maxOffsetY = Math.max(0, (drawHeight - avatarCropPreviewSize) / 2);
    const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, avatarCropOffsetX));
    const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, avatarCropOffsetY));

    return {
      drawWidth,
      drawHeight,
      drawX: (avatarCropPreviewSize - drawWidth) / 2 + clampedOffsetX,
      drawY: (avatarCropPreviewSize - drawHeight) / 2 + clampedOffsetY,
      maxOffsetX,
      maxOffsetY,
      clampedOffsetX,
      clampedOffsetY,
    };
  }, [avatarCropImageSize, avatarCropOffsetX, avatarCropOffsetY, avatarCropZoom]);

  const clampAvatarCropOffset = (value: number, maxOffset = 0) =>
    Math.max(-maxOffset, Math.min(maxOffset, value));

  const setClampedAvatarCropOffsets = (nextX: number, nextY: number) => {
    setAvatarCropOffsetX(clampAvatarCropOffset(nextX, avatarCropMetrics?.maxOffsetX ?? 0));
    setAvatarCropOffsetY(clampAvatarCropOffset(nextY, avatarCropMetrics?.maxOffsetY ?? 0));
  };

  const handleAvatarCropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!avatarCropMetrics) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    avatarCropDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: avatarCropMetrics.clampedOffsetX,
      offsetY: avatarCropMetrics.clampedOffsetY,
    };
  };

  const handleAvatarCropPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = avatarCropDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !avatarCropMetrics) return;
    event.preventDefault();
    setClampedAvatarCropOffsets(
      dragState.offsetX + event.clientX - dragState.startX,
      dragState.offsetY + event.clientY - dragState.startY
    );
  };

  const handleAvatarCropPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (avatarCropDragRef.current?.pointerId === event.pointerId) {
      avatarCropDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  useEffect(() => {
    if (!avatarCropMetrics) return;
    setAvatarCropOffsetX(avatarCropMetrics.clampedOffsetX);
    setAvatarCropOffsetY(avatarCropMetrics.clampedOffsetY);
  }, [avatarCropMetrics]);

  const normalizeAccountCategory = (nextProfile?: ProfileData | null) =>
    nextProfile?.account_category ||
    (nextProfile?.role === "player" ? "player" : nextProfile?.role === "parent" ? "parent" : nextProfile?.role === "referee" ? "referee" : nextProfile?.role ? "team_staff" : null);

  const normalizeAccountRole = (nextProfile?: ProfileData | null) =>
    nextProfile?.account_role ||
    (nextProfile?.role === "team"
      ? "team_club"
      : nextProfile?.role === "coach"
        ? "head_coach_assistant"
        : nextProfile?.role === "referee"
          ? "referee"
        : nextProfile?.role || null);

  const resolvedAccountCategory = normalizeAccountCategory(profile);
  const resolvedAccountRole = normalizeAccountRole(profile);

  const isPlayerAccount = resolvedAccountCategory === "player" || resolvedAccountRole === "player";
  const isTeamAccount = resolvedAccountRole === "team_club";
  const isTeamStaffAccount = resolvedAccountCategory === "team_staff" && resolvedAccountRole !== "team_club";
  const isRefereeAccount = resolvedAccountCategory === "referee" || resolvedAccountRole === "referee";
  const isParentAccount = resolvedAccountCategory === "parent" || resolvedAccountRole === "parent";
  const playerBirthYear = Number(String(profile?.age_birth_year || "").match(/(19|20)\d{2}/)?.[0]);
  const playerAge = playerBirthYear ? new Date().getFullYear() - playerBirthYear : null;
  const isYoungPlayerParentLinkAge = isPlayerAccount && playerAge !== null && playerAge >= 6 && playerAge <= 13;
  const isOfficialFootyStatusAccount = isFootyStatusSuperAdminEmail(user?.email || profile?.email);
  const profileDisplayName = isTeamAccount
    ? teamAccountData?.club_name || profile?.club_name || profile?.full_name || "No organization set"
    : isTeamStaffAccount
      ? staffAccountData?.full_name || profile?.full_name || "No name set"
      : profile?.full_name || "No name set";
  const isActivePro = getIsPro(profile);
  const maxClipDurationSeconds = isActivePro ? MAX_PRO_CLIP_DURATION_SECONDS : MAX_FREE_CLIP_DURATION_SECONDS;
  const editedClipDurationSeconds = Math.max(0, Math.round(clipTrimEnd - clipTrimStart));
  const visibleClipCount = clips.filter((clip) => clip.visibility !== "inactive" && clip.visibility !== "private").length;
  const daysRemaining = getDaysRemaining(profile);
  const profileDetailValues = [
    profile?.team_name,
    profile?.club_name,
    profile?.position,
    profile?.school_grade,
    profile?.age_birth_year,
    profile?.height,
    profile?.weight,
    teamAccountData?.club_name,
    staffAccountData?.team_organization_name,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const displayProfileBio =
    profile?.bio && !profileDetailValues.includes(profile.bio.trim().toLowerCase())
      ? profile.bio
      : null;

  const getAccountRoleLabel = () => {
    const selectedStaffRole =
      formatSpecificRoleDisplayLabel(staffAccountData?.coaching_role_type) ||
      formatSpecificRoleDisplayLabel(profile?.coaching_role_type) ||
      formatRoleDisplayLabel(resolvedAccountRole, null);
    const selectedScoutRole = formatSpecificRoleDisplayLabel(profile?.scout_role_title, "Scout");
    const selectedRefereeRole = formatSpecificRoleDisplayLabel(profile?.referee_certification_level, "Referee");

    switch (resolvedAccountRole) {
      case "team_club":
        return "Team / Club";
      case "head_coach_assistant":
        return formatRoleDisplayLabel(selectedStaffRole, "Coach / Trainer");
      case "scout":
        return formatRoleDisplayLabel(selectedScoutRole, "Scout");
      case "trainer":
        return formatRoleDisplayLabel(selectedStaffRole, "Coach / Trainer");
      case "academy_director":
        return formatRoleDisplayLabel(selectedStaffRole, "Academy Director");
      case "parent":
        return "Parent";
      case "referee":
        return formatRoleDisplayLabel(selectedRefereeRole, "Referee");
      default:
        return formatRoleDisplayLabel(profile?.position, "Player");
    }
  };

  const isEditingDetails = editingSection === "details";
  const isEditingContact = editingSection === "contact";

  const startEditingSection = (section: "details" | "contact") => {
    setEditForm(buildEditFormFromCurrentState());
    if (isTeamAccount) setTeamStaffForm(buildTeamStaffForm());
    setEditingSection(section);
  };

  const buildEditFormFromCurrentState = (): EditFormState => {
    if (isTeamAccount) {
      return {
        display_name: teamAccountData?.club_name || profile?.club_name || profile?.full_name || "",
        full_name: profile?.full_name || "",
        bio: profile?.bio || "",
        club_name: teamAccountData?.club_name || profile?.club_name || "",
        leagues_offered_text: toCommaSeparated(teamAccountData?.leagues_offered),
        age_groups_offered_text: toCommaSeparated(teamAccountData?.age_groups_offered),
        city: teamAccountData?.city || "",
        home_field_address: teamAccountData?.home_stadium || "",
        training_ground_address: teamAccountData?.training_ground || "",
        home_jersey_color: teamAccountData?.home_jersey_color || "",
        away_jersey_color: teamAccountData?.away_jersey_color || "",
        third_kit_color: teamAccountData?.third_kit_color || "",
        contact_email: teamAccountData?.contact_email || profile?.email || "",
        contact_phone: teamAccountData?.contact_phone || "",
      };
    }

    if (isTeamStaffAccount) {
      return {
        display_name: staffAccountData?.full_name || profile?.full_name || "",
        full_name: staffAccountData?.full_name || profile?.full_name || "",
        bio: profile?.bio || "",
        team_organization_name: staffAccountData?.team_organization_name || "",
        city: staffAccountData?.city || "",
        coaching_level: staffAccountData?.coaching_level || "",
        years_experience:
          staffAccountData?.years_experience != null ? String(staffAccountData.years_experience) : "",
        coaching_licenses_text: toCommaSeparated(staffAccountData?.coaching_licenses),
        age_groups_coached_text: toCommaSeparated(staffAccountData?.age_groups_coached),
        contact_email: staffAccountData?.contact_email || profile?.email || "",
        contact_phone: staffAccountData?.contact_phone || "",
        previous_teams_text: toCommaSeparated(staffAccountData?.previous_teams),
        notable_achievements: staffAccountData?.notable_achievements || "",
        coaching_role_type: formatRoleDisplayLabel(staffAccountData?.coaching_role_type || profile?.coaching_role_type, "") || "",
        teams_currently_coaching:
          staffAccountData?.teams_currently_coaching ||
          staffAccountData?.team_organization_name ||
          profile?.teams_currently_coaching ||
          "",
        coaching_accolades: staffAccountData?.coaching_accolades || profile?.coaching_accolades || "",
        coaching_location: staffAccountData?.coaching_location || profile?.coaching_location || "",
        scout_role_title: profile?.scout_role_title || "",
        scout_organization: profile?.scout_organization || "",
        scouting_licenses_text: toCommaSeparated(profile?.scouting_licenses),
        scouting_experience: profile?.scouting_experience || "",
        scouting_regions: profile?.scouting_regions || "",
        scouting_age_groups_text: toCommaSeparated(profile?.scouting_age_groups),
        scouting_positions_text: toCommaSeparated(profile?.scouting_positions),
        scouting_accolades: profile?.scouting_accolades || "",
      };
    }

    if (isParentAccount) {
      return {
        full_name: parentAccountData?.full_name || profile?.full_name || "",
        username: profile?.username || "",
        bio: profile?.bio || "",
        contact_email: parentAccountData?.contact_email || profile?.email || "",
        contact_phone: parentAccountData?.contact_phone || "",
        relationship_to_player: parentAccountData?.relationship_to_player || "",
        emergency_contact: parentAccountData?.emergency_contact || "",
        child_full_name: parentAccountData?.child_full_name || "",
        child_where_plays: parentAccountData?.child_where_plays || "",
        child_team: parentAccountData?.child_team || "",
        child_league: parentAccountData?.child_league || "",
        child_age_group: parentAccountData?.child_age_group || "",
        parent_notes: parentAccountData?.parent_notes || "",
      };
    }

    return {
      full_name: profile?.full_name || "",
      username: profile?.username || "",
      bio: profile?.bio || "",
      age_birth_year: profile?.age_birth_year || "",
      team_name: profile?.team_name || "",
      position: profile?.position || "",
      jersey_number: profile?.jersey_number || "",
      school_grade: profile?.school_grade || "",
      height: profile?.height || "",
      weight: profile?.weight || "",
    };
  };

  const buildBackfillContacts = async () => {
    if (!user) return emptyContactForm();

    const nextForm = emptyContactForm();
    const [{ data: playerDetails }, { data: teamDetails }, { data: staffDetails }] = await Promise.all([
      supabase.from("player_profiles").select("contact_email, contact_phone, coach_email").eq("user_id", user.id).maybeSingle(),
      supabase.from("team_profiles").select("contact_email, contact_phone").eq("user_id", user.id).maybeSingle(),
      supabase.from("staff_profiles").select("contact_email, contact_phone").eq("user_id", user.id).maybeSingle(),
    ]);

    if (profile?.email) nextForm.player_email = profile.email;
    if (playerDetails?.contact_email) nextForm.player_email = playerDetails.contact_email;
    if (playerDetails?.contact_phone) nextForm.player_phone = playerDetails.contact_phone;
    if (playerDetails?.coach_email) nextForm.coach_email = playerDetails.coach_email;
    if (teamDetails?.contact_email) nextForm.player_email = teamDetails.contact_email;
    if (teamDetails?.contact_phone) nextForm.player_phone = teamDetails.contact_phone;
    if (staffDetails?.contact_email) nextForm.player_email = staffDetails.contact_email;
    if (staffDetails?.contact_phone) nextForm.player_phone = staffDetails.contact_phone;

    return nextForm;
  };

  const buildTeamStaffForm = () =>
    teamStaffMembers.length
      ? teamStaffMembers.map((member) => ({
          id: member.id,
          staff_name: member.staff_name || "",
          staff_role: member.staff_role || "",
          personal_email: member.personal_email || "",
        }))
      : [{ staff_name: "", staff_role: "", personal_email: "" }];

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/auth'); return; }
    fetchProfile();
    fetchClips();
    if (!isTeamAccount) {
      fetchContacts();
    } else {
      setContacts([]);
      setContactForm(emptyContactForm());
    }
    if (isPlayerAccount) {
      fetchClubHistory();
    } else {
      setClubHistory([]);
    }
    fetchTeamConnectionData();
    fetchCoachStaffConnectionData();
  }, [user, authLoading, isPlayerAccount, isTeamAccount]);

  useEffect(() => {
    const channel = supabase
      .channel(`profile-clips-${user?.id ?? "guest"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clips" },
        () => {
          if (user) fetchClips();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_contacts" },
        () => {
          if (user && !isTeamAccount) fetchContacts();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_team_memberships" },
        () => {
          if (user) fetchTeamConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_player_invites" },
        () => {
          if (user) fetchTeamConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_join_requests" },
        () => {
          if (user) fetchTeamConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coach_staff_team_memberships" },
        () => {
          if (user) fetchCoachStaffConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coach_staff_team_invites" },
        () => {
          if (user) fetchCoachStaffConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "coach_staff_join_requests" },
        () => {
          if (user) fetchCoachStaffConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_statistics" },
        () => {
          if (user && isPlayerAccount) {
            fetchSeasonStats();
            fetchClubHistory();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "club_history" },
        () => {
          if (user && isPlayerAccount) fetchClubHistory();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_events" },
        () => {
          if (user && isPlayerAccount) {
            fetchSeasonStats();
            fetchClubHistory();
            fetchTeamConnectionData();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        () => {
          if (user && isPlayerAccount) {
            fetchTeamConnectionData();
            fetchClubHistory();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "league_standings" },
        () => {
          if (user && isPlayerAccount) fetchTeamConnectionData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assist_claims" },
        () => {
          if (user && isPlayerAccount) {
            fetchSeasonStats();
            fetchClubHistory();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isPlayerAccount]);

  useEffect(() => {
    if (!isTeamAccount || !teamAccountData?.team_id) {
      setManagedClubTeamInvites([]);
      setManagedClubTeamJoinRequests([]);
      return;
    }

    fetchManagedClubTeamRequests(teamAccountData.team_id, offeredClubTeams);
  }, [isTeamAccount, teamAccountData?.team_id, offeredClubTeams]);

  useEffect(() => {
    if (!isTeamAccount || !teamAccountData?.team_id) {
      if (isTeamAccount) {
        setCoachStaffInvites([]);
        setCoachStaffRequests([]);
        setTeamOwnerPlayerInvites([]);
        setTeamOwnerPlayerRequests([]);
      }
      return;
    }

    fetchTeamOwnerCoachStaffRequests(teamAccountData.team_id);
    fetchTeamOwnerPlayerRequests(teamAccountData.team_id);
  }, [isTeamAccount, teamAccountData?.team_id]);

  useEffect(() => {
    fetchAdminRefereeClaims();
  }, [isOfficialFootyStatusAccount]);

  useEffect(() => {
    const searchTeams = async () => {
      if (!isPlayerAccount && !isTeamStaffAccount) {
        setTeamSearchResults([]);
        return;
      }

      const trimmedQuery = teamSearchQuery.trim();
      let query = (supabase as any)
        .from("teams")
        .select("id, name, league_id, age_group, approval_status, logo_url")
        .eq("approval_status", "approved")
        .order("name", { ascending: true })
        .limit(8);

      if (trimmedQuery) {
        query = query.ilike("name", `%${trimmedQuery}%`);
      }

      const { data: teams } = await query;

      const leagueIds = [...new Set((teams || []).map((team: any) => team.league_id).filter(Boolean))];
      const teamIds = (teams || []).map((team: any) => team.id);
      const [{ data: leagues }, { data: teamProfiles }, { data: daughterMatchesByTeam }] = await Promise.all([
        leagueIds.length ? (supabase as any).from("leagues").select("id, name").in("id", leagueIds) : Promise.resolve({ data: [] }),
        teamIds.length ? (supabase as any).from("team_profiles").select("team_id, age_groups_offered").in("team_id", teamIds) : Promise.resolve({ data: [] }),
        teamIds.length
          ? (supabase as any)
              .from("club_teams")
              .select("id, team_id, league_id, league_name, age_group, status")
              .in("team_id", teamIds)
              .eq("status", "active")
              .order("league_name", { ascending: true })
              .order("age_group", { ascending: true })
              .limit(30)
          : Promise.resolve({ data: [] }),
      ]);

      const { data: daughterMatchesByDetails } = trimmedQuery
        ? await (supabase as any)
            .from("club_teams")
            .select("id, team_id, league_id, league_name, age_group, status")
            .eq("status", "active")
            .or(`age_group.ilike.%${trimmedQuery}%,league_name.ilike.%${trimmedQuery}%`)
            .order("league_name", { ascending: true })
            .order("age_group", { ascending: true })
            .limit(20)
        : { data: [] };

      const daughterRows = [...(daughterMatchesByTeam || []), ...(daughterMatchesByDetails || [])];
      const daughterParentIds = [...new Set(daughterRows.map((row: any) => row.team_id).filter(Boolean))];
      const { data: daughterParents } = daughterParentIds.length
        ? await (supabase as any)
            .from("teams")
            .select("id, name, league_id, age_group, approval_status, logo_url")
            .in("id", daughterParentIds)
            .eq("approval_status", "approved")
        : { data: [] };

      const leaguesById = new Map((leagues || []).map((league: any) => [league.id, league.name]));
      const profileByTeamId = new Map((teamProfiles || []).map((teamProfile: any) => [teamProfile.team_id, teamProfile]));
      const parentTeamsById = new Map([...(teams || []), ...(daughterParents || [])].map((team: any) => [team.id, team]));
      const uniqueDaughterRows = Array.from(new Map(daughterRows.map((row: any) => [row.id, row])).values());

      const motherResults = (teams || []).map((team: any) => ({
          ...team,
          club_team_id: null,
          result_type: "mother" as const,
          league_name: team.league_id ? leaguesById.get(team.league_id) || null : null,
          age_groups_offered: profileByTeamId.get(team.id)?.age_groups_offered || null,
          search_label: team.name,
        }));
      const daughterResults = uniqueDaughterRows
        .map((clubTeam: any) => {
          const parentTeam = parentTeamsById.get(clubTeam.team_id);
          if (!parentTeam) return null;
          return {
            id: parentTeam.id,
            club_team_id: clubTeam.id,
            name: parentTeam.name,
            league_id: clubTeam.league_id || parentTeam.league_id || null,
            age_group: clubTeam.age_group || null,
            approval_status: parentTeam.approval_status,
            league_name: clubTeam.league_name || (clubTeam.league_id ? leaguesById.get(clubTeam.league_id) || null : null),
            logo_url: parentTeam.logo_url || null,
            age_groups_offered: profileByTeamId.get(parentTeam.id)?.age_groups_offered || null,
            result_type: "daughter" as const,
            search_label: formatTeamLeagueLine(parentTeam.name, clubTeam.age_group || null, clubTeam.league_name || null),
          };
        })
        .filter(Boolean) as TeamSearchResult[];

      setTeamSearchResults([...motherResults, ...daughterResults].slice(0, 12));
    };

    searchTeams();
  }, [teamSearchQuery, isPlayerAccount, isTeamStaffAccount]);

  useEffect(() => {
    const searchClubHistoryTeams = async () => {
      if (!isPlayerAccount || !clubHistoryDialogOpen || clubHistoryForm.entry_type !== "linked" || !clubHistoryTeamSearchQuery.trim()) {
        setClubHistoryTeamResults([]);
        return;
      }

      const { data: teams } = await (supabase as any)
        .from("teams")
        .select("id, name, league_id, age_group, approval_status, logo_url")
        .eq("approval_status", "approved")
        .ilike("name", `%${clubHistoryTeamSearchQuery.trim()}%`)
        .order("name", { ascending: true })
        .limit(8);

      const leagueIds = [...new Set((teams || []).map((team: any) => team.league_id).filter(Boolean))];
      const teamIds = (teams || []).map((team: any) => team.id);
      const [{ data: leagues }, { data: teamProfiles }] = await Promise.all([
        leagueIds.length ? (supabase as any).from("leagues").select("id, name").in("id", leagueIds) : Promise.resolve({ data: [] }),
        teamIds.length ? (supabase as any).from("team_profiles").select("team_id, logo_url, age_groups_offered").in("team_id", teamIds) : Promise.resolve({ data: [] }),
      ]);

      const leaguesById = new Map((leagues || []).map((league: any) => [league.id, league.name]));
      const profileByTeamId = new Map((teamProfiles || []).map((teamProfile: any) => [teamProfile.team_id, teamProfile]));

      setClubHistoryTeamResults(
        (teams || []).map((team: any) => ({
          ...team,
          league_name: team.league_id ? leaguesById.get(team.league_id) || null : null,
          logo_url: profileByTeamId.get(team.id)?.logo_url || team.logo_url || null,
          age_groups_offered: profileByTeamId.get(team.id)?.age_groups_offered || null,
        }))
      );
    };

    searchClubHistoryTeams();
  }, [clubHistoryTeamSearchQuery, clubHistoryDialogOpen, clubHistoryForm.entry_type, isPlayerAccount]);

  useEffect(() => {
    const searchPlayersForInvite = async () => {
      if (!isTeamAccount || !activeInviteClubTeamId || !clubTeamInviteSearch.trim()) {
        setClubTeamInviteResults([]);
        setClubTeamInviteSearchLoading(false);
        return;
      }

      const currentRosterIds = new Set(
        (offeredClubTeamRosters[activeInviteClubTeamId] || []).map((player) => player.player_profile_id)
      );

      const query = clubTeamInviteSearch.trim();
      const selectedTeamGender = normalizeTeamGender(
        offeredClubTeams.find((team) => team.id === activeInviteClubTeamId)?.gender
      );
      setClubTeamInviteSearchLoading(true);
      const { data } = await (supabase as any)
        .from("player_profiles")
        .select("id, user_id, full_name, position, profile_image_url, player_gender")
        .eq("player_gender", selectedTeamGender)
        .ilike("full_name", `%${query}%`)
        .limit(6);

      setClubTeamInviteResults(
        ((data || []) as ClubInvitePlayerResult[]).filter((player) => !currentRosterIds.has(player.id))
      );
      setClubTeamInviteSearchLoading(false);
    };

    searchPlayersForInvite();
  }, [clubTeamInviteSearch, activeInviteClubTeamId, offeredClubTeamRosters, isTeamAccount, offeredClubTeams]);

  useEffect(() => {
    const searchPlayersForTeamManagement = async () => {
      if (!isTeamAccount || !teamAccountData?.team_id || !teamManagePlayerSearch.trim()) {
        setTeamManagePlayerResults([]);
        setTeamManagePlayerSearchLoading(false);
        return;
      }

      const rosterIds = new Set(teamRoster.map((player) => player.player_profile_id));
      const query = teamManagePlayerSearch.trim();
      const usernameQuery = query.replace(/^@/, "");
      setTeamManagePlayerSearchLoading(true);
      const { data } = await (supabase as any)
        .from("player_profiles_public")
        .select("id, user_id, full_name, position, profile_image_url, username")
        .or(`full_name.ilike.%${query}%,username.ilike.%${usernameQuery}%`)
        .limit(8);

      setTeamManagePlayerResults(((data || []) as ClubInvitePlayerResult[]).filter((player) => !rosterIds.has(player.id)));
      setTeamManagePlayerSearchLoading(false);
    };

    searchPlayersForTeamManagement();
  }, [isTeamAccount, teamAccountData?.team_id, teamManagePlayerSearch, teamRoster]);

  useEffect(() => {
    const searchCoachesForTeamManagement = async () => {
      if (!isTeamAccount || !teamAccountData?.team_id || !teamManageCoachSearch.trim()) {
        setTeamManageCoachResults([]);
        setTeamManageCoachSearchLoading(false);
        return;
      }

      setTeamManageCoachSearchLoading(true);
      const results = await fetchCoachStaffProfiles(teamManageCoachSearch).catch(() => []);
      const activeUserIds = new Set((teamRoster || []).map(() => ""));
      const pendingUserIds = new Set([
        ...coachStaffInvites.filter((invite) => invite.status === "pending").map((invite) => invite.coach_user_id),
        ...coachStaffRequests.map((request) => request.coach_user_id),
      ]);
      setTeamManageCoachResults(results.filter((staff) => !activeUserIds.has(staff.user_id) && !pendingUserIds.has(staff.user_id)));
      setTeamManageCoachSearchLoading(false);
    };

    searchCoachesForTeamManagement();
  }, [isTeamAccount, teamAccountData?.team_id, teamManageCoachSearch, coachStaffInvites, coachStaffRequests, teamRoster]);

  const fetchProfile = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (data) {
      const normalizedProfile = {
        ...(data as unknown as ProfileData),
        account_category: normalizeAccountCategory(data as unknown as ProfileData) as ProfileData["account_category"],
        account_role: normalizeAccountRole(data as unknown as ProfileData) as ProfileData["account_role"],
      };
      setProfile(normalizedProfile);
      setEditForm(normalizedProfile);
      if (normalizeAccountRole(normalizedProfile) === "player") {
        fetchSeasonStats();
      } else {
        setSeasonStats([]);
      }
    } else if (error && error.code === 'PGRST116') {
      // No profile yet, create one
      const { data: newProfile } = await supabase
        .from('profiles')
        .insert({
          user_id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || '',
          role: authProfile?.role || 'player',
          account_category: authProfile?.account_category || 'player',
          account_role: authProfile?.account_role || 'player',
        })
        .select()
        .single();
      if (newProfile) {
        const normalizedProfile = {
          ...(newProfile as unknown as ProfileData),
          account_category: normalizeAccountCategory(newProfile as unknown as ProfileData) as ProfileData["account_category"],
          account_role: normalizeAccountRole(newProfile as unknown as ProfileData) as ProfileData["account_role"],
        };
        setProfile(normalizedProfile);
        setEditForm(normalizedProfile);
        fetchSeasonStats();
      }
    }
    await fetchRoleSpecificAccountData(
      data
        ? ({
            ...(data as unknown as ProfileData),
            account_category: normalizeAccountCategory(data as unknown as ProfileData) as ProfileData["account_category"],
            account_role: normalizeAccountRole(data as unknown as ProfileData) as ProfileData["account_role"],
          } as ProfileData)
        : null
    );
    setLoading(false);
  };

  const fetchRoleSpecificAccountData = async (nextProfile?: ProfileData | null) => {
    const activeProfile = nextProfile || profile;
    if (!activeProfile?.user_id) return;

    const accountRole = normalizeAccountRole(activeProfile);
    const accountCategory = normalizeAccountCategory(activeProfile);

    if (accountRole === "team_club") {
      const { data } = await (supabase as any)
        .from("team_profiles")
        .select("id, team_id, club_id, club_name, leagues_offered, founded_year, country, city, home_stadium, training_ground, home_jersey_color, away_jersey_color, third_kit_color, age_groups_offered, contact_email, contact_phone, team_type, school_level")
        .eq("user_id", activeProfile.user_id)
        .maybeSingle();
      setTeamAccountData(data || null);
      if (data) {
        setEditForm((prev) => ({
          ...prev,
          display_name: data.club_name || prev.display_name || prev.full_name,
          club_name: data.club_name || prev.club_name,
          leagues_offered_text: toCommaSeparated(data.leagues_offered),
          age_groups_offered_text: toCommaSeparated(data.age_groups_offered),
          city: data.city || "",
          home_field_address: data.home_stadium || "",
          training_ground_address: data.training_ground || "",
          home_jersey_color: data.home_jersey_color || "",
          away_jersey_color: data.away_jersey_color || "",
          third_kit_color: data.third_kit_color || "",
          contact_email: data.contact_email || activeProfile.email || "",
          contact_phone: data.contact_phone || "",
        }));
      }
      if (data?.club_name) {
        const firstLeagueName = data.leagues_offered?.[0] || null;
        const firstAgeGroup = data.age_groups_offered?.[0] || null;
        let leagueId: string | null = null;

        if (firstLeagueName) {
          const { data: matchedLeague } = await (supabase as any)
            .from("leagues")
            .select("id")
            .ilike("name", firstLeagueName)
            .maybeSingle();
          leagueId = matchedLeague?.id || null;
        }

        let resolvedTeamId = data.team_id || null;

        if (!resolvedTeamId) {
          const { data: existingTeam } = await (supabase as any)
            .from("teams")
            .select("id")
            .eq("owner_user_id", activeProfile.user_id)
            .maybeSingle();
          resolvedTeamId = existingTeam?.id || null;
        }

        if (!resolvedTeamId) {
          const { data: namedTeam } = await (supabase as any)
            .from("teams")
            .select("id")
            .eq("name", data.club_name)
            .maybeSingle();
          resolvedTeamId = namedTeam?.id || null;
        }

        if (resolvedTeamId) {
          await (supabase as any)
            .from("teams")
            .update({
              name: data.club_name,
              league_id: leagueId,
              age_group: firstAgeGroup,
              contact_email: data.contact_email,
              contact_phone: data.contact_phone,
              founded_year: data.founded_year,
              stadium: data.home_stadium,
              owner_user_id: activeProfile.user_id,
              approval_status: "approved",
            })
            .eq("id", resolvedTeamId);
        } else {
          const { data: insertedTeam } = await (supabase as any)
            .from("teams")
            .insert({
              name: data.club_name,
              league_id: leagueId,
              age_group: firstAgeGroup,
              contact_email: data.contact_email,
              contact_phone: data.contact_phone,
              founded_year: data.founded_year,
              stadium: data.home_stadium,
              owner_user_id: activeProfile.user_id,
              approval_status: "approved",
            })
            .select("id")
            .maybeSingle();
          resolvedTeamId = insertedTeam?.id || null;
        }

        if (resolvedTeamId && resolvedTeamId !== data.team_id) {
          await (supabase as any)
            .from("team_profiles")
            .update({ team_id: resolvedTeamId })
            .eq("id", data.id);

          setTeamAccountData({
            ...(data as TeamAccountData),
            team_id: resolvedTeamId,
          });
        }

        if (resolvedTeamId) {
          const { data: resolvedTeam } = await (supabase as any)
            .from("teams")
            .select("approval_status")
            .eq("id", resolvedTeamId)
            .maybeSingle();
          setTeamApprovalStatus(resolvedTeam?.approval_status || "approved");

          const roster = await fetchRosterForTeam(resolvedTeamId);
          setTeamRoster(roster);
          const linkedStaff = await fetchCoachStaffForTeam(resolvedTeamId).catch(() => []);
          setLinkedTeamClubStaff(linkedStaff);
          const club = data.club_id ? { id: data.club_id } : await fetchClubByTeamId(resolvedTeamId);
          if (club?.id) {
            const clubTeams = await fetchClubTeams(club.id);
            setOfferedClubTeams(clubTeams);
            await fetchManagedClubTeamRequests(resolvedTeamId, clubTeams);
            const rosters = await Promise.all(
              clubTeams.map(async (team) => [team.id, await fetchRosterForClubTeam(team.id)] as const)
            );
            setOfferedClubTeamRosters(Object.fromEntries(rosters));
          } else {
            setOfferedClubTeams([]);
            setOfferedClubTeamRosters({});
            setManagedClubTeamInvites([]);
            setManagedClubTeamJoinRequests([]);
          }
        } else {
          setTeamApprovalStatus(null);
          setTeamRoster([]);
          setLinkedTeamClubStaff([]);
          setOfferedClubTeams([]);
          setOfferedClubTeamRosters({});
          setManagedClubTeamInvites([]);
          setManagedClubTeamJoinRequests([]);
        }
      } else {
        setTeamApprovalStatus(null);
        setTeamRoster([]);
        setLinkedTeamClubStaff([]);
        setOfferedClubTeams([]);
        setOfferedClubTeamRosters({});
        setManagedClubTeamInvites([]);
        setManagedClubTeamJoinRequests([]);
      }
      if (data?.id) {
        const staffWithEmail = await (supabase as any)
          .from("team_staff")
          .select("id, staff_name, staff_role, personal_email")
          .eq("team_profile_id", data.id)
          .order("created_at", { ascending: true });

        if (staffWithEmail.error?.message?.includes("personal_email")) {
          const fallbackStaff = await (supabase as any)
            .from("team_staff")
            .select("id, staff_name, staff_role")
            .eq("team_profile_id", data.id)
            .order("created_at", { ascending: true });

          setTeamStaffMembers(
            ((fallbackStaff.data || []) as any[]).map((staff) => ({
              ...staff,
              personal_email: null,
            }))
          );
        } else {
          setTeamStaffMembers((staffWithEmail.data || []) as TeamStaffMember[]);
        }
      } else {
        setTeamStaffMembers([]);
      }
      setStaffAccountData(null);
      return;
    }

    if (accountCategory === "team_staff") {
      const { data } = await (supabase as any)
        .from("staff_profiles")
        .select("full_name, role, team_organization_name, country, city, coaching_level, years_experience, coaching_licenses, age_groups_coached, contact_email, contact_phone, previous_teams, notable_achievements")
        .eq("user_id", activeProfile.user_id)
        .maybeSingle();
      const fallbackStaffData = {
        full_name: activeProfile.full_name || "",
        role:
          activeProfile.account_role === "academy_director"
            ? "academy_director"
            : activeProfile.account_role === "scout"
              ? "scout"
              : "coach",
        team_organization_name: activeProfile.scout_organization || activeProfile.teams_currently_coaching || null,
        country: null,
        city: activeProfile.coaching_location || null,
        coaching_level: null,
        years_experience: null,
        coaching_licenses: activeProfile.scouting_licenses || activeProfile.coaching_licenses || null,
        age_groups_coached: activeProfile.scouting_age_groups || null,
        contact_email: activeProfile.email || null,
        contact_phone: null,
        previous_teams: activeProfile.past_coaching_experience ? [activeProfile.past_coaching_experience] : null,
        notable_achievements: activeProfile.scouting_accolades || activeProfile.coaching_accolades || null,
      };
      const mergedStaffData = data
        ? {
            ...data,
            full_name: data.full_name || activeProfile.full_name || "",
            coaching_role_type:
              formatSpecificRoleDisplayLabel(activeProfile.scout_role_title) ||
              formatSpecificRoleDisplayLabel(activeProfile.coaching_role_type) ||
              formatSpecificRoleDisplayLabel(data.role, null),
            teams_currently_coaching: activeProfile.scout_organization || activeProfile.teams_currently_coaching || data.team_organization_name || null,
            past_coaching_experience: activeProfile.scouting_experience || activeProfile.past_coaching_experience || toCommaSeparated(data.previous_teams),
            coaching_licenses: activeProfile.coaching_licenses || data.coaching_licenses,
            coaching_accolades: activeProfile.scouting_accolades || activeProfile.coaching_accolades || data.notable_achievements || null,
            coaching_location: activeProfile.coaching_location || [data.city, data.country].filter(Boolean).join(", ") || null,
          }
        : {
            ...fallbackStaffData,
            coaching_role_type:
              formatSpecificRoleDisplayLabel(activeProfile.scout_role_title) ||
              formatSpecificRoleDisplayLabel(activeProfile.coaching_role_type) ||
              formatSpecificRoleDisplayLabel(activeProfile.account_role, null),
            teams_currently_coaching: activeProfile.scout_organization || activeProfile.teams_currently_coaching || null,
            past_coaching_experience: activeProfile.scouting_experience || activeProfile.past_coaching_experience || null,
            coaching_accolades: activeProfile.scouting_accolades || activeProfile.coaching_accolades || null,
            coaching_location: activeProfile.coaching_location || null,
          };
      setStaffAccountData(mergedStaffData);
      if (mergedStaffData) {
        setEditForm((prev) => ({
          ...prev,
          display_name: mergedStaffData.full_name || prev.display_name || prev.full_name,
          full_name: mergedStaffData.full_name || prev.full_name,
          team_organization_name: mergedStaffData.teams_currently_coaching || mergedStaffData.team_organization_name || "",
          city: mergedStaffData.city || "",
          coaching_level: mergedStaffData.coaching_level || "",
          years_experience: mergedStaffData.years_experience != null ? String(mergedStaffData.years_experience) : "",
          coaching_licenses_text: toCommaSeparated(mergedStaffData.coaching_licenses),
          age_groups_coached_text: toCommaSeparated(mergedStaffData.age_groups_coached),
          contact_email: mergedStaffData.contact_email || activeProfile.email || "",
          contact_phone: mergedStaffData.contact_phone || "",
          previous_teams_text: mergedStaffData.past_coaching_experience || toCommaSeparated(mergedStaffData.previous_teams),
          notable_achievements: mergedStaffData.coaching_accolades || mergedStaffData.notable_achievements || "",
          coaching_role_type: formatSpecificRoleDisplayLabel(mergedStaffData.coaching_role_type, "") || "",
          teams_currently_coaching: mergedStaffData.teams_currently_coaching || mergedStaffData.team_organization_name || "",
          coaching_location: mergedStaffData.coaching_location || "",
          scout_role_title: activeProfile.scout_role_title || "",
          scout_organization: activeProfile.scout_organization || "",
          scouting_licenses_text: toCommaSeparated(activeProfile.scouting_licenses),
          scouting_experience: activeProfile.scouting_experience || "",
          scouting_regions: activeProfile.scouting_regions || "",
          scouting_age_groups_text: toCommaSeparated(activeProfile.scouting_age_groups),
          scouting_positions_text: toCommaSeparated(activeProfile.scouting_positions),
          scouting_accolades: activeProfile.scouting_accolades || "",
        }));
      }
      setTeamAccountData(null);
      setTeamStaffMembers([]);
      setTeamRoster([]);
      setLinkedTeamClubStaff([]);
      setOfferedClubTeams([]);
      setOfferedClubTeamRosters({});
      setManagedClubTeamInvites([]);
      setManagedClubTeamJoinRequests([]);
      return;
    }

    if (accountCategory === "parent") {
      const [{ data: parentData }, links] = await Promise.all([
        fetchParentProfileForUser(activeProfile.user_id),
        fetchParentLinksForParentUser(activeProfile.user_id),
      ]);
      setParentAccountData(parentData || null);
      setParentChildLinks(links);
      setTeamAccountData(null);
      setTeamApprovalStatus(null);
      setStaffAccountData(null);
      setTeamStaffMembers([]);
      setTeamRoster([]);
      setLinkedTeamClubStaff([]);
      setOfferedClubTeams([]);
      setOfferedClubTeamRosters({});
      setManagedClubTeamInvites([]);
      setManagedClubTeamJoinRequests([]);
      if (parentData) {
        setEditForm((prev) => ({
          ...prev,
          full_name: parentData.full_name || prev.full_name || "",
          contact_email: parentData.contact_email || activeProfile.email || "",
          contact_phone: parentData.contact_phone || "",
          relationship_to_player: parentData.relationship_to_player || "",
          emergency_contact: parentData.emergency_contact || "",
          child_full_name: parentData.child_full_name || "",
          child_where_plays: parentData.child_where_plays || "",
          child_team: parentData.child_team || "",
          child_league: parentData.child_league || "",
          child_age_group: parentData.child_age_group || "",
          parent_notes: parentData.parent_notes || "",
        }));
      }
      return;
    }

    setTeamAccountData(null);
    setTeamApprovalStatus(null);
    setStaffAccountData(null);
    setTeamStaffMembers([]);
    setTeamRoster([]);
    setLinkedTeamClubStaff([]);
    setOfferedClubTeams([]);
    setOfferedClubTeamRosters({});
    setManagedClubTeamInvites([]);
    setManagedClubTeamJoinRequests([]);
    if (accountRole === "player") {
      const { data: playerAccount } = await (supabase as any)
        .from("player_profiles")
        .select("jersey_number, school_grade, team, position, height, weight")
        .eq("user_id", activeProfile.user_id)
        .maybeSingle();

      setProfile((prev) => (prev ? {
        ...prev,
        jersey_number: playerAccount?.jersey_number || prev.jersey_number || null,
        school_grade: playerAccount?.school_grade || prev.school_grade || null,
        team_name: prev.team_name || playerAccount?.team || null,
        position: prev.position || playerAccount?.position || null,
        height: prev.height || playerAccount?.height || null,
        weight: prev.weight || playerAccount?.weight || null,
      } : prev));
      setEditForm((prev) => ({
        ...prev,
        jersey_number: playerAccount?.jersey_number || prev.jersey_number || "",
        school_grade: playerAccount?.school_grade || prev.school_grade || "",
        team_name: prev.team_name || playerAccount?.team || "",
        position: prev.position || playerAccount?.position || "",
        height: prev.height || playerAccount?.height || "",
        weight: prev.weight || playerAccount?.weight || "",
      }));
      setPlayerParentLinks(await fetchParentLinksForPlayerUser(activeProfile.user_id));
    }
  };

  const fetchClips = async () => {
    if (!user) return;
    const [{ data: userClips }, { count }] = await Promise.all([
      supabase
        .from('clips')
        .select('id, title, caption, description, video_url, thumbnail_url, likes_count, views_count, created_at, visibility, duration, trim_start_seconds, trim_end_seconds, playback_volume, fit_mode, review_status, revision_note')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('clips')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .neq("visibility", "inactive")
        .neq("visibility", "private"),
    ]);

    setClips((userClips || []) as ClipData[]);
    setClipCount(count || 0);
  };

  const fetchSeasonStats = async () => {
    if (!user || isTeamAccount) {
      setSeasonStats([]);
      return;
    }

    const { data: statRows } = await (supabase as any)
      .from("current_player_statistics")
      .select("team_id, team_name, team_logo_url, season, goals, assists, appearances, substitute_ins, starts, clean_sheets, yellow_cards, red_cards")
      .eq("player_user_id", user.id)
      .order("team_name", { ascending: true });

    setSeasonStats((statRows || []) as SeasonStats[]);
  };

  const fetchClubHistory = async () => {
    if (!user || !isPlayerAccount) {
      setClubHistory([]);
      setPlayerProfileId(null);
      setPlayerRecordId(null);
      return;
    }

    const [{ data: profileRow }, { data: playerRow }] = await Promise.all([
      (supabase as any)
        .from("player_profiles_public")
        .select("id, user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      (supabase as any)
        .from("players")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    setPlayerProfileId(profileRow?.id || null);
    setPlayerRecordId(playerRow?.id || null);

    const { data } = await (supabase as any)
      .from("player_club_history")
      .select("*")
      .eq("player_user_id", user.id)
      .order("season", { ascending: false })
      .order("created_at", { ascending: false });

    setClubHistory((data || []) as ClubHistoryEntry[]);
  };

  const fetchTeamConnectionData = async () => {
    if (!user) return;

    const memberships = await fetchActiveMembershipsForUser(user.id);
    const membership = memberships[0] || null;
    setActiveMemberships(memberships);
    setActiveMembership(membership);
    const standing = await fetchLiveStandingForMembership(membership);
    setTeamStanding(standing);
    setActiveMembershipLogoUrls({});

    if (memberships.length > 0) {
      const logoEntries = await Promise.all(
        memberships.map(async (nextMembership) => {
          if (!nextMembership.team?.id) return [nextMembership.id, null] as const;
          const [{ data: teamProfileLogo }, { data: teamLogo }] = await Promise.all([
            (supabase as any)
              .from("team_profiles")
              .select("logo_url")
              .eq("team_id", nextMembership.team.id)
              .maybeSingle(),
            (supabase as any)
              .from("teams")
              .select("logo_url")
              .eq("id", nextMembership.team.id)
              .maybeSingle(),
          ]);
          return [nextMembership.id, teamProfileLogo?.logo_url || teamLogo?.logo_url || null] as const;
        })
      );
      const logoMap = Object.fromEntries(logoEntries);
      setActiveMembershipLogoUrls(logoMap);

      await Promise.all([
        supabase
          .from("profiles")
          .update({
            team_name: membership.team.name,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id),
        (supabase as any)
          .from("player_profiles")
          .update({
            team: membership.team.name,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id),
        (supabase as any)
          .from("players")
          .update({
            team_id: membership.team.id,
            club: membership.team.name,
            league: membership.league?.name || null,
          })
          .eq("user_id", user.id),
      ]);
    } else {
      await Promise.all([
        supabase
          .from("profiles")
          .update({
            team_name: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id),
        (supabase as any)
          .from("player_profiles")
          .update({
            team: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id),
        (supabase as any)
          .from("players")
          .update({
            team_id: null,
            club: null,
            league: null,
          })
          .eq("user_id", user.id),
      ]);
    }

    const [inviteRes, requestRes] = await Promise.all([
      (supabase as any)
        .from("team_player_invites")
        .select("id, team_id, club_team_id, league_id, age_group, created_at, status")
        .eq("player_user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("team_join_requests")
        .select("id, team_id, age_group, requested_at, status")
        .eq("player_user_id", user.id)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
    ]);

    const teamIds = [
      ...new Set([
        ...(inviteRes.data || []).map((invite: any) => invite.team_id),
        ...(requestRes.data || []).map((request: any) => request.team_id),
      ]),
    ];

    let teamsById = new Map<string, any>();
    let leaguesById = new Map<string, any>();
    let clubTeamsById = new Map<string, any>();
    let clubTeamOptionsByTeamId = new Map<string, Awaited<ReturnType<typeof fetchClubTeamOptionsForParentTeam>>>();
    if (teamIds.length) {
      const { data: teams } = await (supabase as any)
        .from("teams")
        .select("id, name, league_id, age_group")
        .in("id", teamIds);
      teamsById = new Map((teams || []).map((team: any) => [team.id, team]));

      const clubTeamOptionsEntries = await Promise.all(
        teamIds.map(async (teamId) => [teamId, await fetchClubTeamOptionsForParentTeam(teamId)] as const)
      );
      clubTeamOptionsByTeamId = new Map(clubTeamOptionsEntries);

      const leagueIds = [
        ...new Set([
          ...(teams || []).map((team: any) => team.league_id).filter(Boolean),
          ...(inviteRes.data || []).map((invite: any) => invite.league_id).filter(Boolean),
        ]),
      ];
      if (leagueIds.length) {
        const { data: leagues } = await (supabase as any)
          .from("leagues")
          .select("id, name")
          .in("id", leagueIds);
        leaguesById = new Map((leagues || []).map((league: any) => [league.id, league]));
      }
    }

    const clubTeamIds = [...new Set((inviteRes.data || []).map((invite: any) => invite.club_team_id).filter(Boolean))];
    if (clubTeamIds.length) {
      const { data: clubTeams } = await (supabase as any)
        .from("club_teams")
        .select("id, age_group, league_name")
        .in("id", clubTeamIds);
      clubTeamsById = new Map((clubTeams || []).map((clubTeam: any) => [clubTeam.id, clubTeam]));
    }

    setPendingInvites(
      (inviteRes.data || []).map((invite: any) => {
        const team = teamsById.get(invite.team_id);
        const clubTeam = invite.club_team_id ? clubTeamsById.get(invite.club_team_id) : null;
        const fallbackClubTeam =
          !clubTeam && invite.team_id
            ? (clubTeamOptionsByTeamId.get(invite.team_id) || []).find(
                (option) =>
                  option.status === "active" &&
                  option.age_group === (invite.age_group || team?.age_group || null) &&
                  (invite.league_id ? option.league_id === invite.league_id : true)
              ) || null
            : null;
        return {
          ...invite,
          team_name: team?.name || "Team",
          age_group: clubTeam?.age_group || fallbackClubTeam?.age_group || invite.age_group || team?.age_group || null,
          league_name:
            clubTeam?.league_name ||
            fallbackClubTeam?.league_name ||
            (invite.league_id ? leaguesById.get(invite.league_id)?.name || null : null) ||
            (team?.league_id ? leaguesById.get(team.league_id)?.name || null : null),
        };
      })
    );

    setPendingJoinRequests(
      (requestRes.data || []).map((request: any) => {
        const team = teamsById.get(request.team_id);
        return {
          ...request,
          team_name: team?.name || "Team",
          league_name: team?.league_id ? leaguesById.get(team.league_id)?.name || null : null,
        };
      })
    );
  };

  const openAddClubHistory = () => {
    setClubHistoryForm({
      ...emptyClubHistoryForm(),
      player_profile_id: playerProfileId,
      player_id: playerRecordId,
      position_role: profile?.position || "",
    });
    setClubHistoryTeamSearchQuery("");
    setClubHistoryTeamResults([]);
    setClubHistoryDialogOpen(true);
  };

  const openEditClubHistory = (entry: ClubHistoryEntry) => {
    setClubHistoryForm({
      id: entry.id,
      entry_type: entry.team_id ? "linked" : "manual",
      player_profile_id: entry.player_profile_id || playerProfileId,
      player_id: entry.player_id || playerRecordId,
      team_id: entry.team_id || null,
      league_id: entry.league_id || null,
      club_name: entry.club_name || "",
      season: entry.season || entry.years || "",
      competition: entry.competition || "",
      position_role: entry.position_role || entry.level || "",
      notes: entry.notes || "",
      manual_goals: String(entry.goals || 0),
      manual_assists: String(entry.assists || 0),
      manual_appearances: String(entry.appearances || 0),
      manual_starts: String(entry.starts || 0),
      manual_clean_sheets: String(entry.clean_sheets || 0),
      manual_yellow_cards: String(entry.yellow_cards || 0),
      manual_red_cards: String(entry.red_cards || 0),
    });
    setClubHistoryTeamSearchQuery(entry.team_id ? entry.club_name : "");
    setClubHistoryTeamResults([]);
    setClubHistoryDialogOpen(true);
  };

  const handleSelectClubHistoryTeam = (team: TeamSearchResult) => {
    setClubHistoryForm((prev) => ({
      ...prev,
      entry_type: "linked",
      team_id: team.id,
      league_id: team.league_id,
      club_name: team.name,
      competition: prev.competition || team.league_name || "",
    }));
    setClubHistoryTeamSearchQuery(team.name);
    setClubHistoryTeamResults([]);
  };

  const numberOrZero = (value: string) => {
    const nextValue = Number(value);
    return Number.isFinite(nextValue) && nextValue >= 0 ? Math.floor(nextValue) : 0;
  };

  const handleSaveClubHistory = async () => {
    if (!user || !playerProfileId) {
      toast({ title: "Player profile not ready", description: "Refresh once, then try adding club history again.", variant: "destructive" });
      return;
    }

    const isLinked = clubHistoryForm.entry_type === "linked";
    if (isLinked && !clubHistoryForm.team_id) {
      toast({ title: "Select a team", description: "Choose an existing Footy Status team or switch to manual entry.", variant: "destructive" });
      return;
    }

    if (!isLinked && !clubHistoryForm.club_name.trim()) {
      toast({ title: "Enter a team name", description: "Manual club history needs a team name.", variant: "destructive" });
      return;
    }

    setSavingClubHistory(true);
    const payload = {
      player_profile_id: playerProfileId,
      player_id: playerRecordId,
      team_id: isLinked ? clubHistoryForm.team_id : null,
      league_id: isLinked ? clubHistoryForm.league_id : null,
      club_name: clubHistoryForm.club_name.trim(),
      level: clubHistoryForm.position_role.trim() || "Player",
      years: clubHistoryForm.season.trim() || "Current Season",
      season: clubHistoryForm.season.trim() || null,
      competition: clubHistoryForm.competition.trim() || null,
      position_role: clubHistoryForm.position_role.trim() || null,
      notes: clubHistoryForm.notes.trim() || null,
      stats_source: isLinked ? "verified" : "manual",
      manual_goals: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_goals),
      manual_assists: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_assists),
      manual_appearances: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_appearances),
      manual_starts: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_starts),
      manual_clean_sheets: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_clean_sheets),
      manual_yellow_cards: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_yellow_cards),
      manual_red_cards: isLinked ? 0 : numberOrZero(clubHistoryForm.manual_red_cards),
      created_by_user_id: user.id,
    };

    const result = clubHistoryForm.id
      ? await (supabase as any).from("club_history").update(payload).eq("id", clubHistoryForm.id)
      : await (supabase as any).from("club_history").insert(payload);

    if (result.error) {
      toast({ title: "Could not save club history", description: result.error.message, variant: "destructive" });
    } else {
      toast({ title: "Club history saved" });
      setClubHistoryDialogOpen(false);
      setClubHistoryForm(emptyClubHistoryForm());
      await fetchClubHistory();
    }
    setSavingClubHistory(false);
  };

  const openClubHistoryTeam = (entry: ClubHistoryEntry) => {
    if (!entry.team_id) return;
    const params = new URLSearchParams();
    if (entry.season) params.set("season", entry.season);
    if (entry.competition) params.set("competition", entry.competition);
    navigate(`/team/${entry.team_id}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const fetchCoachStaffConnectionData = async () => {
    if (!user || !isTeamStaffAccount) {
      setCoachStaffTeamLinks([]);
      setCoachStaffInvites([]);
      setCoachStaffRequests([]);
      return;
    }

    const [links, invitesRes, requestsRes] = await Promise.all([
      fetchCoachStaffTeamLinksForUser(user.id).catch(() => []),
      (supabase as any)
        .from("coach_staff_team_invites")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, created_at, teams(name, logo_url)")
        .eq("coach_user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("coach_staff_join_requests")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, requested_at, requested_assignments, general_club_role, request_kind, teams(name, logo_url)")
        .eq("coach_user_id", user.id)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
    ]);

    setCoachStaffTeamLinks(links);
    setCoachStaffInvites(invitesRes.data || []);
    setCoachStaffRequests(requestsRes.data || []);
  };

  const fetchTeamOwnerCoachStaffRequests = async (teamId: string) => {
    if (!teamId) {
      setCoachStaffInvites([]);
      setCoachStaffRequests([]);
      return;
    }

    const [requestRes, inviteRes] = await Promise.all([
      (supabase as any)
        .from("coach_staff_join_requests")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, requested_at, requested_assignments, general_club_role, request_kind")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
      (supabase as any)
        .from("coach_staff_team_invites")
        .select("id, team_id, club_team_id, league_id, age_group, coach_user_id, staff_role, status, created_at")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    const staffUserIds = [
      ...new Set([
        ...((requestRes.data || []) as any[]).map((request) => request.coach_user_id),
        ...((inviteRes.data || []) as any[]).map((invite) => invite.coach_user_id),
      ]),
    ].filter(Boolean);

    const { data: profiles } = staffUserIds.length
      ? await (supabase as any)
          .from("profiles")
          .select("user_id, full_name, avatar_url, username, coaching_role_type, scout_role_title, account_role")
          .in("user_id", staffUserIds)
      : { data: [] };

    const profilesByUserId = new Map((profiles || []).map((staff: any) => [staff.user_id, staff]));
    setCoachStaffRequests(((requestRes.data || []) as any[]).map((request) => ({ ...request, profiles: profilesByUserId.get(request.coach_user_id) || null })));
    setCoachStaffInvites(((inviteRes.data || []) as any[]).map((invite) => ({ ...invite, profiles: profilesByUserId.get(invite.coach_user_id) || null })));
  };

  const fetchTeamOwnerPlayerRequests = async (teamId: string) => {
    if (!teamId) {
      setTeamOwnerPlayerInvites([]);
      setTeamOwnerPlayerRequests([]);
      return;
    }

    const [inviteRes, requestRes] = await Promise.all([
      (supabase as any)
        .from("team_player_invites")
        .select("id, team_id, club_team_id, player_profile_id, player_user_id, age_group, created_at, status")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("team_join_requests")
        .select("id, team_id, club_team_id, player_profile_id, player_user_id, age_group, requested_at, access_code_last4")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("requested_at", { ascending: false }),
    ]);

    const playerProfileIds = [
      ...new Set([
        ...((inviteRes.data || []) as any[]).map((invite) => invite.player_profile_id),
        ...((requestRes.data || []) as any[]).map((request) => request.player_profile_id),
      ]),
    ].filter(Boolean);

    const { data: playerProfiles } = playerProfileIds.length
      ? await (supabase as any)
          .from("player_profiles_public")
          .select("id, user_id, full_name, profile_image_url, username")
          .in("id", playerProfileIds)
      : { data: [] };

    const playerProfilesById = new Map((playerProfiles || []).map((player: any) => [player.id, player]));
    const decorate = (row: any) => {
      const playerProfile = playerProfilesById.get(row.player_profile_id);
      return {
        ...row,
        player_name: playerProfile?.full_name || "Unknown Player",
        player_avatar_url: playerProfile?.profile_image_url || null,
        player_username: playerProfile?.username || null,
      };
    };

    setTeamOwnerPlayerInvites(((inviteRes.data || []) as any[]).map(decorate));
    setTeamOwnerPlayerRequests(((requestRes.data || []) as any[]).map(decorate));
  };

  const fetchManagedClubTeamRequests = async (teamId: string, clubTeams: ClubTeamRecord[]) => {
    const activeClubTeamIds = clubTeams.map((clubTeam) => clubTeam.id).filter(Boolean);

    if (!teamId || !activeClubTeamIds.length) {
      setManagedClubTeamInvites([]);
      setManagedClubTeamJoinRequests([]);
      return;
    }

    const [inviteRes, requestRes] = await Promise.all([
      (supabase as any)
        .from("team_player_invites")
        .select("id, team_id, club_team_id, player_profile_id, player_user_id, age_group, created_at")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .in("club_team_id", activeClubTeamIds)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("team_join_requests")
        .select("id, team_id, club_team_id, player_profile_id, player_user_id, age_group, requested_at, access_code_last4")
        .eq("team_id", teamId)
        .eq("status", "pending")
        .in("club_team_id", activeClubTeamIds)
        .order("requested_at", { ascending: false }),
    ]);

    const playerProfileIds = [
      ...new Set([
        ...((inviteRes.data || []) as any[]).map((invite) => invite.player_profile_id),
        ...((requestRes.data || []) as any[]).map((request) => request.player_profile_id),
      ]),
    ].filter(Boolean);

    const { data: playerProfiles } = playerProfileIds.length
      ? await (supabase as any)
          .from("player_profiles_public")
          .select("id, user_id, full_name, profile_image_url, username")
          .in("id", playerProfileIds)
      : { data: [] };

    const playerProfilesById = new Map((playerProfiles || []).map((player: any) => [player.id, player]));

    setManagedClubTeamInvites(
      ((inviteRes.data || []) as any[]).map((invite) => {
        const playerProfile = playerProfilesById.get(invite.player_profile_id);
        return {
          ...invite,
          player_name: playerProfile?.full_name || "Unknown Player",
          player_avatar_url: playerProfile?.profile_image_url || null,
          player_username: playerProfile?.username || null,
        };
      })
    );

    setManagedClubTeamJoinRequests(
      ((requestRes.data || []) as any[]).map((request) => {
        const playerProfile = playerProfilesById.get(request.player_profile_id);
        return {
          ...request,
          player_name: playerProfile?.full_name || "Unknown Player",
          player_avatar_url: playerProfile?.profile_image_url || null,
          player_username: playerProfile?.username || null,
        };
      })
    );
  };

  const fetchAdminRefereeClaims = async () => {
    if (!isOfficialFootyStatusAccount) {
      setAdminRefereeClaims([]);
      return;
    }

    const { data: claims } = await (supabase as any)
      .from("referee_match_claims")
      .select("id, match_id, referee_user_id, referee_type, show_name_publicly, proof_url, proof_file_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    const claimRows = (claims || []) as any[];
    const refereeUserIds = [...new Set(claimRows.map((claim) => claim.referee_user_id).filter(Boolean))];
    const matchIds = [...new Set(claimRows.map((claim) => claim.match_id).filter(Boolean))];

    const [{ data: refereeProfiles }, { data: matchDetails }] = await Promise.all([
      refereeUserIds.length
        ? (supabase as any)
            .from("profiles")
            .select("user_id, full_name, username, avatar_url, referee_certification_level, referee_license_number, referee_certifying_organization")
            .in("user_id", refereeUserIds)
        : Promise.resolve({ data: [] }),
      matchIds.length
        ? (supabase as any)
            .from("league_match_details")
            .select("id, home_team_name, away_team_name, league_name, scheduled_at")
            .in("id", matchIds)
        : Promise.resolve({ data: [] }),
    ]);

    const profilesByUserId = new Map((refereeProfiles || []).map((profile: any) => [profile.user_id, profile]));
    const matchesById = new Map((matchDetails || []).map((match: any) => [match.id, match]));

    setAdminRefereeClaims(
      claimRows.map((claim) => {
        const refereeProfile = profilesByUserId.get(claim.referee_user_id) || {};
        const matchInfo = matchesById.get(claim.match_id) || {};
        return {
          ...claim,
          referee_name: refereeProfile.full_name || "Referee",
          referee_username: refereeProfile.username || null,
          referee_avatar_url: refereeProfile.avatar_url || null,
          referee_certification_level: refereeProfile.referee_certification_level || null,
          referee_license_number: refereeProfile.referee_license_number || null,
          referee_certifying_organization: refereeProfile.referee_certifying_organization || null,
          match_label: [matchInfo.home_team_name, matchInfo.away_team_name].filter(Boolean).join(" vs ") || "Match",
          league_name: matchInfo.league_name || null,
          scheduled_at: matchInfo.scheduled_at || null,
        };
      })
    );
  };

  const fetchContacts = async () => {
    if (!user || !isPlayerAccount) {
      setContacts([]);
      setContactForm(emptyContactForm());
      return;
    }

    const { data } = await supabase
      .from('user_contacts')
      .select('id, user_id, contact_type, value, visibility')
      .eq('user_id', user.id)
      .order('contact_type');

    const nextForm = emptyContactForm();
    (data || []).forEach((contact) => {
      if (contact.contact_type in nextForm) {
        nextForm[contact.contact_type as keyof ContactFormState] = contact.value;
      }
    });

    if (!data || data.length === 0) {
      const backfill = await buildBackfillContacts();
      const hasBackfill = Object.values(backfill).some(Boolean);

      if (hasBackfill) {
        setContactForm(backfill);
        const restrictedVisibility = mapContactVisibility(settings.showContactInfo);
        const rows = (Object.entries(backfill) as Array<[keyof ContactFormState, string]>)
          .filter(([, value]) => value.trim())
          .map(([contactType, value]) => ({
            user_id: user.id,
            contact_type: contactType,
            value: value.trim(),
            visibility: restrictedVisibility,
          }));

        const { data: inserted, error } = await supabase
          .from("user_contacts")
          .upsert(rows, { onConflict: "user_id,contact_type" })
          .select("id, user_id, contact_type, value, visibility");

        if (!error) {
          setContacts((inserted || []) as ContactItem[]);
          return;
        }
      }
    }

    setContacts((data || []) as ContactItem[]);
    setContactForm(nextForm);
  };

  const persistContacts = async () => {
    if (!user) return;

    const entries = Object.entries(contactForm) as Array<[keyof ContactFormState, string]>;
    const existingByType = new Map(contacts.map((contact) => [contact.contact_type, contact]));

    for (const [contactType, rawValue] of entries) {
      const value = rawValue.trim();
      const existing = existingByType.get(contactType);

      if (!value) {
        if (existing) {
          const { error } = await supabase.from('user_contacts').delete().eq('id', existing.id);
          if (error) throw error;
        }
        continue;
      }

      const payload = {
        user_id: user.id,
        contact_type: contactType,
        value,
        visibility: mapContactVisibility(settings.showContactInfo),
      };

      if (existing) {
        const { error } = await supabase.from('user_contacts').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_contacts').insert(payload);
        if (error) throw error;
      }
    }
  };

  const handleContactVisibilityChange = async (value: string) => {
    if (!user) return;

    const nextVisibility = mapContactVisibility(value);
    const { error } = await (supabase as any).rpc("set_contact_info_visibility", {
      _visibility: value,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    updateSetting("showContactInfo", value);
    setContacts((prev) =>
      prev.map((contact) => ({ ...contact, visibility: nextVisibility }))
    );
    toast({ title: "Contact visibility updated" });
  };

  const handleSaveProfile = async () => {
    if (!user || !profile) return;
    setSaving(true);
    const normalizedBio = editForm.bio?.trim().slice(0, BIO_MAX_LENGTH) || null;
    const normalizedUsername = normalizeUsername(editForm.username);
    const currentUsername = normalizeUsername(profile.username);

    if (normalizedUsername !== currentUsername) {
      const usernameValidationMessage = validateUsername(normalizedUsername);

      if (usernameValidationMessage) {
        toast({ title: "Error", description: usernameValidationMessage, variant: "destructive" });
        setSaving(false);
        return;
      }

      const { error: usernameError } = await (supabase as any).rpc("change_username", {
        _username: normalizedUsername,
      });

      if (usernameError) {
        toast({ title: "Error", description: getUsernameErrorMessage(usernameError.message), variant: "destructive" });
        setSaving(false);
        return;
      }
    }

    const profileUpdate = {
      full_name: editForm.full_name,
      bio: normalizedBio as any,
      age_birth_year: editForm.age_birth_year as any,
      team_name: editForm.team_name as any,
      position: editForm.position as any,
      height: editForm.height as any,
      weight: editForm.weight as any,
    };

    const { error } = await supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('user_id', user.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      if (isPlayerAccount) {
        const { error: playerProfileError } = await supabase
          .from('player_profiles')
          .update({
            full_name: editForm.full_name || null,
            team: editForm.team_name || null,
            position: editForm.position || null,
            jersey_number: editForm.jersey_number || null,
            school_grade: editForm.school_grade || null,
            height: editForm.height || null,
            weight: editForm.weight || null,
          })
          .eq('user_id', user.id);

        if (playerProfileError) {
          toast({ title: "Error", description: playerProfileError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

      } else if (isTeamAccount) {
        const teamDisplayName = editForm.display_name?.trim() || editForm.club_name?.trim() || null;
        const duplicateKey = getOfferedTeamDuplicate(offeredClubTeams);
        if (duplicateKey) {
          toast({ title: "Duplicate team combination", description: "This club already has that exact offered team.", variant: "destructive" });
          setSaving(false);
          return;
        }
        const normalizedOfferedTeams = offeredClubTeams
          .map((team) => ({
            ...team,
            age_group: team.age_group?.trim() || "",
            league_name: team.league_name?.trim() || "",
            gender: team.gender?.trim() || "",
            season: team.season?.trim() || "",
            level: team.level?.trim() || "",
            coach_name: team.coach_name?.trim() || "",
            status: team.status || "active",
          }))
          .filter((team) => team.age_group && team.league_name);
        const leaguesOffered = [...new Set(normalizedOfferedTeams.map((team) => team.league_name))];
        const ageGroupsOffered = [...new Set(normalizedOfferedTeams.map((team) => team.age_group))];
        const city = editForm.city?.trim() || null;
        const contactEmail = editForm.contact_email?.trim().toLowerCase() || null;
        const contactPhone = editForm.contact_phone?.trim() || null;
        const { error: teamSetupError } = await (supabase as any).rpc("save_club_profile", {
          _club_name: teamDisplayName,
          _city: city,
          _founded_year: null,
          _home_field_address: editForm.home_field_address?.trim() || null,
          _training_ground_address: editForm.training_ground_address?.trim() || null,
          _contact_email: contactEmail,
          _contact_phone: contactPhone,
          _offered_teams: normalizedOfferedTeams,
          _staff: teamStaffForm.map((member) => ({
            staff_name: member.staff_name.trim(),
            staff_role: member.staff_role.trim(),
            personal_email: member.personal_email.trim().toLowerCase(),
          })),
        });

        if (teamSetupError) {
          toast({ title: "Error", description: teamSetupError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        const { data: savedTeamProfile, error: teamProfilePersistError } = await (supabase as any)
          .from("team_profiles")
          .upsert(
            {
              user_id: user.id,
              club_name: teamDisplayName,
              leagues_offered: leaguesOffered,
              age_groups_offered: ageGroupsOffered,
              city,
              home_stadium: editForm.home_field_address?.trim() || null,
              training_ground: editForm.training_ground_address?.trim() || null,
              home_jersey_color: editForm.home_jersey_color?.trim() || null,
              away_jersey_color: editForm.away_jersey_color?.trim() || null,
              third_kit_color: editForm.third_kit_color?.trim() || null,
              contact_email: contactEmail,
              contact_phone: contactPhone,
            },
            { onConflict: "user_id" }
          )
          .select("id, team_id, club_name, leagues_offered, founded_year, country, city, home_stadium, training_ground, home_jersey_color, away_jersey_color, third_kit_color, age_groups_offered, contact_email, contact_phone, team_type, school_level")
          .maybeSingle();

        if (teamProfilePersistError) {
          toast({ title: "Error", description: teamProfilePersistError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        if (savedTeamProfile) {
          setTeamAccountData(savedTeamProfile as TeamAccountData);
        }

        const { error: profilePersistError } = await supabase
          .from("profiles")
          .update({
            full_name: teamDisplayName,
            club_name: teamDisplayName,
            email: contactEmail,
          })
          .eq("user_id", user.id);

        if (profilePersistError) {
          toast({ title: "Error", description: profilePersistError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        if (savedTeamProfile?.team_id) {
          await (supabase as any)
            .from("teams")
            .update({
              name: teamDisplayName,
              stadium: editForm.home_field_address?.trim() || null,
              home_jersey_color: editForm.home_jersey_color?.trim() || null,
              away_jersey_color: editForm.away_jersey_color?.trim() || null,
              third_kit_color: editForm.third_kit_color?.trim() || null,
            })
            .eq("id", savedTeamProfile.team_id);
        }

        const { data: teamProfileRow } = await (supabase as any)
          .from("team_profiles")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (teamProfileRow?.id) {
          const staffRows = teamStaffForm
            .map((member) => ({
              staff_name: member.staff_name.trim(),
              staff_role: member.staff_role.trim(),
              personal_email: member.personal_email.trim().toLowerCase(),
            }))
            .filter((member) => member.staff_name || member.staff_role || member.personal_email);

          const { error: deleteStaffError } = await (supabase as any)
            .from("team_staff")
            .delete()
            .eq("team_profile_id", teamProfileRow.id);

          if (deleteStaffError) {
            toast({ title: "Error", description: deleteStaffError.message, variant: "destructive" });
            setSaving(false);
            return;
          }

          if (staffRows.length) {
            const { error: insertStaffError } = await (supabase as any)
              .from("team_staff")
              .insert(
                staffRows.map((member) => ({
                  team_profile_id: teamProfileRow.id,
                  staff_name: member.staff_name || "Staff Member",
                  staff_role: member.staff_role || "Staff",
                  personal_email: member.personal_email || null,
                }))
              );

            if (insertStaffError) {
              toast({ title: "Error", description: insertStaffError.message, variant: "destructive" });
              setSaving(false);
              return;
            }
          }
        }

        if (savedTeamProfile?.team_id) {
          const refreshedClub = savedTeamProfile.club_id
            ? { id: savedTeamProfile.club_id }
            : await fetchClubByTeamId(savedTeamProfile.team_id);
          if (refreshedClub?.id) {
            const refreshedClubTeams = await fetchClubTeams(refreshedClub.id);
            setOfferedClubTeams(refreshedClubTeams);
            const refreshedRosters = await Promise.all(
              refreshedClubTeams.map(async (team) => [team.id, await fetchRosterForClubTeam(team.id)] as const)
            );
            setOfferedClubTeamRosters(Object.fromEntries(refreshedRosters));
          }
        }
      } else if (isParentAccount) {
        const parentDisplayName = editForm.full_name?.trim() || null;
        const { data: savedParentProfile, error: parentProfileError } = await (supabase as any)
          .from("parent_profiles")
          .upsert(
            {
              user_id: user.id,
              full_name: parentDisplayName || "",
              relationship_to_player: editForm.relationship_to_player?.trim() || null,
              contact_email: editForm.contact_email?.trim().toLowerCase() || null,
              contact_phone: editForm.contact_phone?.trim() || null,
              emergency_contact: editForm.emergency_contact?.trim() || null,
              child_full_name: editForm.child_full_name?.trim() || null,
              child_where_plays: editForm.child_where_plays?.trim() || null,
              child_team: editForm.child_team?.trim() || null,
              child_league: editForm.child_league?.trim() || null,
              child_age_group: editForm.child_age_group?.trim() || null,
              parent_notes: editForm.parent_notes?.trim() || null,
            },
            { onConflict: "user_id" }
          )
          .select("*")
          .maybeSingle();

        if (parentProfileError) {
          toast({ title: "Error", description: parentProfileError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        if (savedParentProfile) setParentAccountData(savedParentProfile as ParentProfileDetails);

        const { error: profilePersistError } = await supabase
          .from("profiles")
          .update({
            full_name: parentDisplayName,
            email: editForm.contact_email?.trim().toLowerCase() || null,
          })
          .eq("user_id", user.id);

        if (profilePersistError) {
          toast({ title: "Error", description: profilePersistError.message, variant: "destructive" });
          setSaving(false);
          return;
        }
      } else if (isTeamStaffAccount) {
        const staffDisplayName = editForm.display_name?.trim() || editForm.full_name?.trim() || null;
        const resolvedLegacyRole =
          profile?.role === "coach"
            ? "coach"
            : profile?.role === "scout"
              ? "scout"
              : profile?.role === "trainer"
                ? "trainer"
                : profile?.role === "academy_director"
                  ? "academy_director"
                  : "coach";

        const { error: staffSetupError } = await (supabase as any).rpc("save_staff_account_profile", {
          _role: resolvedLegacyRole,
          _full_name: staffDisplayName,
          _team_organization_name: editForm.team_organization_name?.trim() || null,
          _city: editForm.city?.trim() || null,
          _coaching_level: editForm.coaching_level || "",
          _years_experience: editForm.years_experience ? Number(editForm.years_experience) : null,
          _coaching_licenses: (editForm.coaching_licenses_text || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          _age_groups_coached: (editForm.age_groups_coached_text || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          _contact_email: editForm.contact_email?.trim().toLowerCase() || null,
          _contact_phone: editForm.contact_phone?.trim() || null,
          _previous_teams: (editForm.previous_teams_text || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          _notable_achievements: editForm.notable_achievements?.trim() || null,
        });

        if (staffSetupError) {
          toast({ title: "Error", description: staffSetupError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        const { data: savedStaffProfile, error: staffProfilePersistError } = await (supabase as any)
          .from("staff_profiles")
          .upsert(
            {
              user_id: user.id,
              full_name: staffDisplayName,
              role: profile?.role || "coach",
              team_organization_name: editForm.team_organization_name?.trim() || null,
              city: editForm.city?.trim() || null,
              coaching_level: editForm.coaching_level || null,
              years_experience: editForm.years_experience ? Number(editForm.years_experience) : null,
              coaching_licenses: (editForm.coaching_licenses_text || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              age_groups_coached: (editForm.age_groups_coached_text || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              contact_email: editForm.contact_email?.trim().toLowerCase() || null,
              contact_phone: editForm.contact_phone?.trim() || null,
              previous_teams: (editForm.previous_teams_text || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              notable_achievements: editForm.notable_achievements?.trim() || null,
            },
            { onConflict: "user_id" }
          )
          .select("full_name, role, team_organization_name, country, city, coaching_level, years_experience, coaching_licenses, age_groups_coached, contact_email, contact_phone, previous_teams, notable_achievements")
          .maybeSingle();

        if (staffProfilePersistError) {
          toast({ title: "Error", description: staffProfilePersistError.message, variant: "destructive" });
          setSaving(false);
          return;
        }

        if (savedStaffProfile) {
          setStaffAccountData(savedStaffProfile as StaffAccountData);
        }

        const { error: profilePersistError } = await supabase
          .from("profiles")
          .update({
            full_name: staffDisplayName,
            email: editForm.contact_email?.trim().toLowerCase() || null,
            coaching_role_type: editForm.coaching_role_type?.trim() || null,
            teams_currently_coaching: editForm.team_organization_name?.trim() || null,
            past_coaching_experience: editForm.previous_teams_text?.trim() || null,
            coaching_licenses: (editForm.coaching_licenses_text || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            coaching_accolades: editForm.notable_achievements?.trim() || null,
            coaching_location: editForm.city?.trim() || null,
            scout_role_title: editForm.scout_role_title?.trim() || null,
            scout_organization: editForm.scout_organization?.trim() || null,
            scouting_licenses: (editForm.scouting_licenses_text || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            scouting_experience: editForm.scouting_experience?.trim() || null,
            scouting_regions: editForm.scouting_regions?.trim() || null,
            scouting_age_groups: (editForm.scouting_age_groups_text || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            scouting_positions: (editForm.scouting_positions_text || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            scouting_accolades: editForm.scouting_accolades?.trim() || null,
          })
          .eq("user_id", user.id);

        if (profilePersistError) {
          toast({ title: "Error", description: profilePersistError.message, variant: "destructive" });
          setSaving(false);
          return;
        }
      }

      if (isPlayerAccount) {
        try {
          await persistContacts();
        } catch (contactError: any) {
          toast({ title: "Error", description: contactError.message, variant: "destructive" });
          setSaving(false);
          return;
        }
      }

      toast({ title: "Profile updated!" });
      setEditingSection(null);
      fetchProfile();
      if (isPlayerAccount) fetchContacts();
    }
    setSaving(false);
  };

  const handleParentPlayerSearch = async (query: string) => {
    setParentPlayerSearchQuery(query);
    if (!query.trim()) {
      setParentPlayerSearchResults([]);
      return;
    }

    const usernameQuery = query.trim().replace(/^@/, "");
    const { data } = await (supabase as any)
      .from("player_profiles_public")
      .select("id, user_id, full_name, username, team, team_name, position, profile_image_url, age_birth_year")
      .or(`full_name.ilike.%${query.trim()}%,username.ilike.%${usernameQuery}%`)
      .limit(8);

    const currentYear = new Date().getFullYear();
    setParentPlayerSearchResults(
      (data || []).filter((player: any) => {
        const birthYear = Number(String(player.age_birth_year || "").match(/(19|20)\d{2}/)?.[0]);
        if (!birthYear) return false;
        const age = currentYear - birthYear;
        return age >= 6 && age <= 13;
      })
    );
  };

  const handleRequestParentLink = async (playerUserId: string) => {
    if (!parentAccountData) return;
    setRequestingParentLink(true);
    const { error } = await requestParentPlayerLink(
      playerUserId,
      parentAccountData.relationship_to_player,
      parentAccountData.parent_notes
    );
    if (error) {
      toast({ title: "Could not request parent link", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Request sent", description: "The player can approve the parent link from their profile." });
      setParentPlayerSearchQuery("");
      setParentPlayerSearchResults([]);
      if (user?.id) setParentChildLinks(await fetchParentLinksForParentUser(user.id));
    }
    setRequestingParentLink(false);
  };

  const handleReviewParentLink = async (linkId: string, approve: boolean) => {
    setReviewingParentLinkId(linkId);
    const { error } = await reviewParentPlayerLink(linkId, approve);
    if (error) {
      toast({ title: "Could not review parent link", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Parent link approved" : "Parent link denied" });
      if (user?.id) setPlayerParentLinks(await fetchParentLinksForPlayerUser(user.id));
    }
    setReviewingParentLinkId(null);
  };

  const handleRemoveParentLink = async (linkId: string) => {
    const confirmed = window.confirm("Remove yourself from this child account? The child cannot undo this action.");
    if (!confirmed) return;

    setReviewingParentLinkId(linkId);
    const { error } = await removeOwnParentPlayerLink(linkId);
    if (error) {
      toast({ title: "Could not remove connection", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Parent connection removed" });
      if (user?.id) setParentChildLinks(await fetchParentLinksForParentUser(user.id));
    }
    setReviewingParentLinkId(null);
  };

  const resetAvatarCropState = () => {
    if (avatarCropPreviewUrl) {
      URL.revokeObjectURL(avatarCropPreviewUrl);
    }
    setShowAvatarCropDialog(false);
    setAvatarCropSourceFile(null);
    setAvatarCropPreviewUrl(null);
    setAvatarCropImageSize(null);
    setAvatarCropZoom(1);
    setAvatarCropOffsetX(0);
    setAvatarCropOffsetY(0);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const uploadAvatarBlob = async (file: Blob | File) => {
    if (!user) return false;

    setUploadingAvatar(true);

    const originalExtension = avatarCropSourceFile?.name.split(".").pop()?.toLowerCase();
    const fileExt = originalExtension === "png" ? "png" : "jpg";
    const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`;
    const contentType = file.type || (fileExt === "png" ? "image/png" : "image/jpeg");
    const uploadFile =
      file instanceof File ? file : new File([file], `avatar.${fileExt}`, { type: contentType });

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, uploadFile, {
        upsert: false,
        contentType,
      });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploadingAvatar(false);
      return false;
    }

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ avatar_url: urlData.publicUrl })
      .eq("user_id", user.id);

    if (profileUpdateError) {
      toast({ title: "Save failed", description: profileUpdateError.message, variant: "destructive" });
      setUploadingAvatar(false);
      return false;
    }

    if (isPlayerAccount) {
      const { error: playerUpdateError } = await supabase
        .from("player_profiles")
        .update({ profile_image_url: urlData.publicUrl })
        .eq("user_id", user.id);

      if (playerUpdateError) {
        toast({ title: "Save failed", description: playerUpdateError.message, variant: "destructive" });
        setUploadingAvatar(false);
        return false;
      }
    } else if (isTeamAccount) {
      const { data: managedTeamProfile } = await (supabase as any)
        .from("team_profiles")
        .select("team_id, club_id")
        .eq("user_id", user.id)
        .maybeSingle();

      const { error: teamProfileUpdateError } = await (supabase as any)
        .from("team_profiles")
        .update({ logo_url: urlData.publicUrl })
        .eq("user_id", user.id);

      if (teamProfileUpdateError) {
        toast({ title: "Save failed", description: teamProfileUpdateError.message, variant: "destructive" });
        setUploadingAvatar(false);
        return false;
      }

      if (managedTeamProfile?.team_id) {
        const { error: teamUpdateError } = await (supabase as any)
          .from("teams")
          .update({ logo_url: urlData.publicUrl })
          .eq("id", managedTeamProfile.team_id);

        if (teamUpdateError) {
          toast({ title: "Save failed", description: teamUpdateError.message, variant: "destructive" });
          setUploadingAvatar(false);
          return false;
        }
      }
    } else if (isTeamStaffAccount) {
      const { error: staffUpdateError } = await (supabase as any)
        .from("staff_profiles")
        .update({ profile_image_url: urlData.publicUrl })
        .eq("user_id", user.id);

      if (staffUpdateError) {
        toast({ title: "Save failed", description: staffUpdateError.message, variant: "destructive" });
        setUploadingAvatar(false);
        return false;
      }
    }

    toast({ title: "Avatar updated!" });
    await fetchProfile();
    setUploadingAvatar(false);
    return true;
  };

  const buildCroppedAvatarBlob = async () => {
    if (!avatarCropPreviewUrl) {
      throw new Error("No image selected.");
    }

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("We couldn't load that image. Please try another one."));
      nextImage.src = avatarCropPreviewUrl;
    });

    const canvas = document.createElement("canvas");
    const size = 512;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("We couldn't prepare that image for upload.");
    }

    const baseScale = Math.max(size / image.width, size / image.height);
    const drawWidth = image.width * baseScale * avatarCropZoom;
    const drawHeight = image.height * baseScale * avatarCropZoom;
    const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
    const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
    const previewToCanvasScale = size / avatarCropPreviewSize;
    const scaledOffsetX = avatarCropOffsetX * previewToCanvasScale;
    const scaledOffsetY = avatarCropOffsetY * previewToCanvasScale;
    const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, scaledOffsetX));
    const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, scaledOffsetY));
    const drawX = (size - drawWidth) / 2 + clampedOffsetX;
    const drawY = (size - drawHeight) / 2 + clampedOffsetY;

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("We couldn't finish cropping that image."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", 0.92);
    });
  };

  const handleSaveCroppedAvatar = async () => {
    try {
      const croppedBlob = await buildCroppedAvatarBlob();
      const originalExtension = avatarCropSourceFile?.name.split(".").pop()?.toLowerCase();
      const fileExt = originalExtension === "png" ? "png" : "jpg";
      const croppedFile = new File([croppedBlob], `avatar.${fileExt}`, { type: croppedBlob.type || `image/${fileExt}` });
      const uploadSucceeded = await uploadAvatarBlob(croppedFile);
      if (uploadSucceeded) {
        resetAvatarCropState();
      }
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      setUploadingAvatar(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Upload failed", description: "Please choose an image file.", variant: "destructive" });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }

    if (avatarCropPreviewUrl) {
      URL.revokeObjectURL(avatarCropPreviewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const imageSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error("We couldn't load that image. Please try another one."));
        image.src = previewUrl;
      });

      setAvatarCropSourceFile(file);
      setAvatarCropPreviewUrl(previewUrl);
      setAvatarCropImageSize(imageSize);
      setAvatarCropZoom(1);
      setAvatarCropOffsetX(0);
      setAvatarCropOffsetY(0);
      setShowAvatarCropDialog(true);
    } catch (error: any) {
      URL.revokeObjectURL(previewUrl);
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const getVideoDuration = (file: File) =>
    new Promise<number>((resolve, reject) => {
      const video = document.createElement('video');
      const objectUrl = URL.createObjectURL(file);

      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        URL.revokeObjectURL(objectUrl);
        resolve(duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("We couldn't read that video. Please choose another file."));
      };
      video.src = objectUrl;
    });

  const resetSelectedClip = () => {
    setSelectedVideoFile(null);
    setSelectedVideoDuration(null);
    setClipTrimStart(0);
    setClipTrimEnd(0);
    setClipPlaybackVolume(1);
    setClipFitMode("cover");
    if (clipInputRef.current) clipInputRef.current.value = "";
  };

  const handleClipUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("video/")) {
      toast({ title: "Video required", description: "Please choose a video file.", variant: "destructive" });
      resetSelectedClip();
      return;
    }

    if (!canUploadVisibleClip(profile, visibleClipCount)) {
      toast({
        title: "Clip limit reached",
        description: "Upgrade to FootyStatus Pro for unlimited visible clips.",
        variant: "destructive",
      });
      navigate("/pro");
      resetSelectedClip();
      return;
    }

    try {
      const duration = await getVideoDuration(file);

      setSelectedVideoFile(file);
      setSelectedVideoDuration(duration);
      setClipTrimStart(0);
      setClipTrimEnd(Math.min(Math.round(duration), maxClipDurationSeconds));
      setClipPlaybackVolume(1);
      setClipFitMode("cover");
      toast({ title: "Video ready", description: "Trim it, adjust volume, choose sizing, then post." });
    } catch (durationError: any) {
      toast({ title: "Video error", description: durationError.message, variant: "destructive" });
      resetSelectedClip();
    }
  };

  const handleConfirmPostClip = async () => {
    if (!selectedVideoFile || !user) return;

    if (!clipTitle.trim()) {
      toast({ title: "Title required", description: "Please enter a clip title before posting.", variant: "destructive" });
      return;
    }

    if (clipVisibility !== "private" && !canUploadVisibleClip(profile, visibleClipCount)) {
      toast({
        title: "Clip limit reached",
        description: "Upgrade to FootyStatus Pro for unlimited visible clips.",
        variant: "destructive",
      });
      navigate("/pro");
      return;
    }

    if (editedClipDurationSeconds <= 0) {
      toast({ title: "Trim needed", description: "Choose at least 1 second of video.", variant: "destructive" });
      return;
    }

    if (editedClipDurationSeconds > maxClipDurationSeconds) {
      toast({
        title: "Clip is too long",
        description: `${isActivePro ? "Pro" : "Free"} clips can be up to ${maxClipDurationSeconds} seconds.`,
        variant: "destructive",
      });
      return;
    }

    setUploadingClip(true);

    const fileExt = selectedVideoFile.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('clips')
      .upload(fileName, selectedVideoFile, { cacheControl: '3600', upsert: false });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploadingClip(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('clips').getPublicUrl(fileName);

    const { data: playerProfile } = await supabase
      .from('player_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!playerProfile) {
      const { error: playerProfileError } = await supabase
        .from('player_profiles')
        .insert({
          user_id: user.id,
          full_name: profile?.full_name || user.user_metadata?.full_name || user.email || "Player",
          team: profile?.team_name || null,
          position: profile?.position || null,
          jersey_number: profile?.jersey_number || null,
          height: profile?.height || null,
          weight: profile?.weight || null,
          profile_image_url: profile?.avatar_url || null,
          contact_email: profile?.email || user.email || null,
        });

      if (playerProfileError) {
        toast({ title: "Error saving clip", description: playerProfileError.message, variant: "destructive" });
        setUploadingClip(false);
        return;
      }
    }

    const { error: insertError } = await (supabase as any)
      .from('clips')
      .insert({
        title: clipTitle,
        caption: clipCaption || null,
        description: clipCaption || null,
        video_url: urlData.publicUrl,
        player_id: null,
        user_id: user.id,
        visibility: clipVisibility,
        duration: editedClipDurationSeconds,
        trim_start_seconds: Math.round(clipTrimStart),
        trim_end_seconds: Math.round(clipTrimEnd),
        playback_volume: clipPlaybackVolume,
        fit_mode: clipFitMode,
      });

    if (insertError) {
      toast({ title: "Error saving clip", description: insertError.message, variant: "destructive" });
    } else {
      toast({ title: "Clip submitted for review", description: "Footy Status will review your video before it goes live." });
      setClipTitle("");
      setClipCaption("");
      setClipVisibility("public");
      setClipPlaybackVolume(1);
      setClipFitMode("cover");
      resetSelectedClip();
      setShowPostConfirmation(false);
      fetchClips();
    }
    setUploadingClip(false);
  };

  const handleDeleteClip = async (clipId: string) => {
    if (!canDeleteClip(profile)) {
      toast({
        title: "Deletion limit reached",
        description: "Free accounts include 2 clip deletions. Upgrade to Pro for unlimited deletions.",
        variant: "destructive",
      });
      navigate("/pro");
      return;
    }

    const { error } = await supabase.from('clips').delete().eq('id', clipId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      if (!isActivePro && user?.id) {
        await (supabase as any)
          .from("profiles")
          .update({ clip_deletions_used: Number(profile?.clip_deletions_used || 0) + 1 })
          .eq("user_id", user.id);
        setProfile((prev) =>
          prev ? { ...prev, clip_deletions_used: Number(prev.clip_deletions_used || 0) + 1 } : prev
        );
      }
      toast({ title: "Clip deleted" });
      fetchClips();
    }
  };

  const handleClipVisibilityChange = async (clipId: string, nextVisibility: ClipVisibility) => {
    const { error } = await supabase
      .from("clips")
      .update({ visibility: nextVisibility })
      .eq("id", clipId)
      .eq("user_id", user?.id || "");

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    setClips((prev) =>
      prev.map((clip) => (clip.id === clipId ? { ...clip, visibility: nextVisibility } : clip))
    );
    toast({ title: "Clip visibility updated" });
  };

  const handleJoinTeam = async () => {
    if (!selectedJoinTeam) {
      toast({ title: "Select a team", description: "Search for and choose a team first.", variant: "destructive" });
      return;
    }

    const normalizedCode = sanitizeClubTeamAccessCode(teamAccessCode);

    if (normalizedCode.length !== 5) {
      toast({ title: "Code required", description: "Enter the exact 5-digit code for that team.", variant: "destructive" });
      return;
    }

    const selectedClubTeam = availableClubTeams.find(
      (team) => team.age_group === selectedJoinAgeGroup && team.league_name === selectedJoinLeague && team.status === "active"
    );

    if (!selectedClubTeam) {
      toast({ title: "Invalid team combination", description: "Please select a valid team combination.", variant: "destructive" });
      return;
    }

    const { data, error } = await (supabase as any).rpc("create_club_team_join_request", {
      _team_id: selectedJoinTeam.id,
      _club_team_id: selectedClubTeam.id,
      _access_code: normalizedCode,
    });

    if (error) {
      toast({ title: "Could not send request", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: data?.status === "approved" ? "Joined team" : "Join request sent",
      description:
        data?.status === "approved"
          ? "You were linked to that exact team immediately."
          : "Your request is waiting for team approval.",
    });
    setSelectedJoinTeam(null);
    setAvailableClubTeams([]);
    setSelectedJoinAgeGroup("");
    setSelectedJoinLeague("");
    setTeamSearchQuery("");
    setTeamSearchResults([]);
    setTeamAccessCode("");
    await Promise.all([fetchProfile(), fetchTeamConnectionData()]);
  };

  const handleCoachStaffRequestTeam = async () => {
    if (!user || !selectedJoinTeam) {
      toast({ title: "Select a team", description: "Choose the team you want to request first.", variant: "destructive" });
      return;
    }

    const assignments: CoachClubTeamAssignment[] = availableClubTeams
      .filter((team) => coachClubTeamRoles[team.id])
      .map((team) => ({
        club_team_id: team.id,
        role: coachClubTeamRoles[team.id],
        team_name: [team.age_group, team.level, team.league_name].filter(Boolean).join(" - "),
        age_group: team.age_group,
        league_name: team.league_name,
        league_id: team.league_id,
      }));

    if (!coachGeneralClubRole && assignments.length === 0) {
      toast({ title: "Choose a club role", description: "Select at least one daughter team or General Coach / Club Staff.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await requestCoachClubLink(
      selectedJoinTeam.id,
      assignments,
      coachGeneralClubRole
    );

    if (error) {
      toast({ title: "Request failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Request sent", description: "The team can approve your coach/staff request." });
      setSelectedJoinTeam(null);
      setAvailableClubTeams([]);
      setSelectedJoinAgeGroup("");
      setSelectedJoinLeague("");
      setCoachClubTeamRoles({});
      setCoachGeneralClubRole(false);
      setTeamSearchQuery("");
      await fetchCoachStaffConnectionData();
    }
    setSaving(false);
  };

  const handleCoachStaffInviteReview = async (invite: any, accept: boolean) => {
    setSaving(true);
    const result = accept
      ? await acceptCoachStaffInvite(invite)
      : await (supabase as any)
          .from("coach_staff_team_invites")
          .update({ status: "declined", reviewed_at: new Date().toISOString() })
          .eq("id", invite.id);

    if (result.error) {
      toast({ title: "Update failed", description: result.error.message, variant: "destructive" });
    } else {
      toast({ title: accept ? "Invite accepted" : "Invite declined" });
      await fetchCoachStaffConnectionData();
    }
    setSaving(false);
  };

  const handleCoachStaffLeaveTeam = async (membershipId: string) => {
    const confirmed = window.confirm("Leave this team?");
    if (!confirmed) return;

    setSaving(true);
    const { error } = await unlinkCoachStaffFromTeam(membershipId);
    if (error) {
      toast({ title: "Could not leave team", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Team unlinked" });
      await fetchCoachStaffConnectionData();
    }
    setSaving(false);
  };

  const handleCoachStaffLeaveClub = async (link: CoachStaffTeamLink) => {
    const confirmed = window.confirm("Leave this club and every daughter team you coach?");
    if (!confirmed) return;

    setSaving(true);
    const { error } = await unlinkCoachStaffFromClub(link.team_id, link.coach_user_id);
    if (error) {
      toast({ title: "Could not leave club", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Club connection removed" });
      await fetchCoachStaffConnectionData();
    }
    setSaving(false);
  };

  const handleCancelJoinRequest = async (requestId: string) => {
    const { error } = await (supabase as any).rpc("revoke_team_join_request", {
      _request_id: requestId,
    });

    if (error) {
      toast({ title: "Could not cancel request", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Join request cancelled" });
    fetchTeamConnectionData();
  };

  const handleRespondInvite = async (inviteId: string, accept: boolean) => {
    if (!accept) {
      const shouldDecline = window.confirm("Are you sure you want to decline this invite?");
      if (!shouldDecline) return;
    }

    const { error } = await (supabase as any).rpc("respond_team_player_invite", {
      _invite_id: inviteId,
      _accept: accept,
    });

    if (error) {
      toast({ title: "Invite update failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: accept ? "Invite accepted" : "Invite declined" });
    await Promise.all([fetchProfile(), fetchTeamConnectionData()]);
  };

  const handleLeaveTeam = async (membershipId?: string) => {
    if (!user || (!activeMembership && !membershipId)) return;

    const confirmed = window.confirm("Are you sure you want to leave this team?");
    if (!confirmed) return;

    setSaving(true);

    const { error: rpcError } = membershipId
      ? await (supabase as any).rpc("leave_team_membership", { _membership_id: membershipId })
      : await (supabase as any).rpc("leave_current_team");
    setSaving(false);

    const firstError = rpcError;

    if (firstError) {
      toast({ title: "Could not leave team", description: firstError.message, variant: "destructive" });
      return;
    }

    toast({ title: "Left team successfully" });
      setActiveMembership(null);
      setActiveMemberships([]);
      setTeamStanding(null);
      setActiveMembershipLogoUrls({});
    await Promise.all([fetchProfile(), fetchTeamConnectionData()]);
  };

  const handleInvitePlayerToClubTeam = async (clubTeamId: string, playerProfileId: string) => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId) {
      toast({ title: "Invite failed", description: "We couldn't find your team record.", variant: "destructive" });
      return;
    }

    setInvitingClubTeamId(clubTeamId);

    const inviteRes = await (supabase as any).rpc("create_team_player_invite_for_club_team", {
      _team_id: resolvedTeamId,
      _club_team_id: clubTeamId,
      _player_profile_id: playerProfileId,
    });
    const error = inviteRes.error;

    if (error) {
      const description =
        typeof error.message === "string" &&
        (error.message.includes("create_team_player_invite_for_club_team") || error.message.includes("function public.create_team_player_invite_for_club_team"))
          ? "The exact club-team invite system is not ready yet. Run the club-team invite SQL first so invites include the club name, age group, and league."
          : error.message;
      toast({ title: "Invite failed", description, variant: "destructive" });
      setInvitingClubTeamId(null);
      return;
    }

    toast({ title: "Invite sent" });
    setClubTeamInviteSearch("");
    setClubTeamInviteResults([]);
    setActiveInviteClubTeamId(null);
    setInvitingClubTeamId(null);
  };

  const handleInvitePlayerToManagedTeam = async (playerProfileId: string) => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId) {
      toast({ title: "Invite failed", description: "We couldn't find your team record.", variant: "destructive" });
      return;
    }

    setTeamManageInvitingPlayerId(playerProfileId);
    const { error } = await (supabase as any).rpc("create_team_player_invite", {
      _team_id: resolvedTeamId,
      _player_profile_id: playerProfileId,
    });

    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Player invite sent" });
      setTeamManagePlayerSearch("");
      setTeamManagePlayerResults([]);
      await fetchTeamConnectionData();
    }
    setTeamManageInvitingPlayerId(null);
  };

  const handleInviteCoachToManagedTeam = async (coachUserId: string, staffRole?: string | null) => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId || !user?.id) {
      toast({ title: "Invite failed", description: "We couldn't find your team record.", variant: "destructive" });
      return;
    }

    setTeamManageInvitingCoachId(coachUserId);
    const { error } = await inviteCoachStaffToTeam(resolvedTeamId, coachUserId, user.id, staffRole || "Coaching Staff");

    if (error) {
      toast({ title: "Invite failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Coach/staff invite sent" });
      setTeamManageCoachSearch("");
      setTeamManageCoachResults([]);
      await fetchTeamOwnerCoachStaffRequests(resolvedTeamId);
    }
    setTeamManageInvitingCoachId(null);
  };

  const handleCancelMotherTeamInvite = async (invite: any, inviteType: "player" | "staff") => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId) return;

    const confirmed = window.confirm("Cancel this pending invitation?");
    if (!confirmed) return;

    const table = inviteType === "player" ? "team_player_invites" : "coach_staff_team_invites";
    const nextStatus = inviteType === "player" ? "revoked" : "cancelled";
    const timestampColumn = inviteType === "player" ? "responded_at" : "reviewed_at";

    const { error } = await (supabase as any)
      .from(table)
      .update({ status: nextStatus, [timestampColumn]: new Date().toISOString() })
      .eq("id", invite.id);

    if (error) {
      toast({ title: "Could not cancel invite", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Invite cancelled" });
    await Promise.all([fetchTeamOwnerPlayerRequests(resolvedTeamId), fetchTeamOwnerCoachStaffRequests(resolvedTeamId)]);
  };

  const handleResendMotherTeamInvite = async (invite: any, inviteType: "player" | "staff") => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId) return;

    const table = inviteType === "player" ? "team_player_invites" : "coach_staff_team_invites";
    const resetPayload =
      inviteType === "player"
        ? { status: "pending", created_at: new Date().toISOString(), responded_at: null }
        : { status: "pending", created_at: new Date().toISOString(), reviewed_at: null };

    const { error } = await (supabase as any).from(table).update(resetPayload).eq("id", invite.id);

    if (error) {
      toast({ title: "Could not resend invite", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Invite resent" });
    await Promise.all([fetchTeamOwnerPlayerRequests(resolvedTeamId), fetchTeamOwnerCoachStaffRequests(resolvedTeamId)]);
  };

  const handleReviewCoachStaffManagedRequest = async (request: any, approve: boolean) => {
    const resolvedTeamId = teamAccountData?.team_id;
    if (!resolvedTeamId) return;

    setReviewingCoachStaffRequestId(request.id);
    const { error } = await reviewCoachStaffJoinRequest(request, approve);
    if (error) {
      toast({ title: "Could not update request", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Coach/staff approved" : "Request rejected" });
      await fetchTeamOwnerCoachStaffRequests(resolvedTeamId);
    }
    setReviewingCoachStaffRequestId(null);
  };

  const handleSaveClubTeamAccessCode = async (clubTeamId: string) => {
    const nextCode = sanitizeClubTeamAccessCode(clubTeamAccessCodes[clubTeamId] || "");
    if (nextCode.length !== 5) {
      toast({ title: "Invalid code", description: "Access code must be exactly 5 digits.", variant: "destructive" });
      return;
    }

    setSavingClubTeamAccessCodeId(clubTeamId);
    const { data, error } = await updateClubTeamAccessCode(clubTeamId, nextCode);

    if (error) {
      toast({ title: "Could not update code", description: error.message, variant: "destructive" });
      setSavingClubTeamAccessCodeId(null);
      return;
    }

    setOfferedClubTeams((prev) =>
      prev.map((team) =>
        team.id === clubTeamId
          ? {
              ...team,
              access_code_value: data?.access_code_value || nextCode,
              access_code_last4: data?.access_code_last4 || nextCode.slice(-4),
              access_code_updated_at: data?.access_code_updated_at || new Date().toISOString(),
            }
          : team
      )
    );
    setClubTeamAccessCodes((prev) => ({ ...prev, [clubTeamId]: data?.access_code_value || nextCode }));
    toast({ title: "Access code updated", description: "Players can now use this code for this exact daughter team." });
    setSavingClubTeamAccessCodeId(null);
  };

  const handleArchiveDaughterTeam = async (team: OfferedClubTeam) => {
    if (!team.id) return true;
    const { error } = await archiveClubTeam(team.id);

    if (error) {
      toast({
        title: "Could not delete daughter team",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
      return false;
    }

    setOfferedClubTeams((prev) => prev.filter((clubTeam) => clubTeam.id !== team.id));
    setOfferedClubTeamRosters((prev) => {
      const next = { ...prev };
      delete next[team.id as string];
      return next;
    });
    toast({ title: "Daughter team deleted", description: "It was removed from your team list and Explore." });
    return true;
  };

  const resetDaughterTeamForm = () => {
    setDaughterTeamForm({
      age_group: "",
      league_or_conference: "",
      school_level: "",
      gender: "",
      season: "",
      level: "",
    });
  };

  const handleCreateDaughterTeam = async () => {
    const parentTeamId = teamAccountData?.team_id;
    const isSchool = teamAccountData?.team_type === "school";
    const ageGroup = daughterTeamForm.age_group.trim();
    const leagueOrConference = daughterTeamForm.league_or_conference.trim();

    if (!parentTeamId) {
      toast({ title: "Team profile not ready", description: "Refresh the page and try again.", variant: "destructive" });
      return;
    }

    if ((!isSchool && !ageGroup) || !leagueOrConference || !daughterTeamForm.gender || (isSchool && !daughterTeamForm.school_level)) {
      toast({
        title: "Complete the required information",
        description: isSchool
          ? "Add the team level, Boys or Girls, and Conference / League Tier / Division."
          : "Add the age group, Boys or Girls, and league.",
        variant: "destructive",
      });
      return;
    }

    setCreatingDaughterTeam(true);
    const { error } = await createDaughterTeam({
      parentTeamId,
      ageGroup: isSchool ? null : ageGroup,
      leagueOrConference,
      schoolLevel: isSchool ? daughterTeamForm.school_level as any : null,
      gender: daughterTeamForm.gender as "boy" | "girl",
      season: daughterTeamForm.season.trim() || null,
      level: isSchool ? daughterTeamForm.school_level : daughterTeamForm.level.trim() || null,
    });

    if (error) {
      toast({ title: "Could not create daughter team", description: error.message, variant: "destructive" });
      setCreatingDaughterTeam(false);
      return;
    }

    const club = teamAccountData?.club_id
      ? { id: teamAccountData.club_id }
      : await fetchClubByTeamId(parentTeamId);
    if (club?.id) {
      const refreshedTeams = await fetchClubTeams(club.id);
      setOfferedClubTeams(refreshedTeams);
    }

    toast({
      title: isSchool ? "School team created" : "Club team created",
      description: "The daughter team is now on your profile and Explore.",
    });
    resetDaughterTeamForm();
    setDaughterTeamDialogOpen(false);
    setCreatingDaughterTeam(false);
  };

  const handleCategorizeDaughterTeam = async (clubTeamId: string, gender: "boy" | "girl") => {
    setCategorizingDaughterTeamId(clubTeamId);
    const { error } = await setDaughterTeamGender(clubTeamId, gender);
    if (error) {
      toast({ title: "Could not categorize team", description: error.message, variant: "destructive" });
    } else {
      setOfferedClubTeams((teams) =>
        teams.map((team) => (team.id === clubTeamId ? { ...team, gender } : team))
      );
      toast({ title: "Team category saved" });
    }
    setCategorizingDaughterTeamId(null);
  };

  const handleRemovePlayerFromClubTeam = async (membershipId: string) => {
    const confirmed = window.confirm("Are you sure you want to remove this player from this team?");
    if (!confirmed) return;

    const { error } = await (supabase as any).rpc("remove_player_from_club_team", {
      _membership_id: membershipId,
    });

    if (error) {
      toast({ title: "Could not remove player", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Player removed" });
    await Promise.all([fetchProfile(), fetchTeamConnectionData()]);
  };

  const handleReviewManagedClubTeamRequest = async (requestId: string, approve: boolean) => {
    setReviewingClubTeamRequestId(requestId);
    const { error } = await (supabase as any).rpc("review_team_join_request", {
      _request_id: requestId,
      _approve: approve,
    });

    if (error) {
      toast({ title: "Could not update request", description: error.message, variant: "destructive" });
      setReviewingClubTeamRequestId(null);
      return;
    }

    toast({ title: approve ? "Player approved" : "Request rejected" });
    await Promise.all([fetchProfile(), fetchTeamConnectionData()]);
    setReviewingClubTeamRequestId(null);
  };

  const handleReviewTeamOwnerPlayerRequest = async (requestId: string, approve: boolean) => {
    const resolvedTeamId = teamAccountData?.team_id;
    setReviewingTeamOwnerPlayerRequestId(requestId);
    const { error } = await (supabase as any).rpc("review_team_join_request", {
      _request_id: requestId,
      _approve: approve,
    });

    if (error) {
      toast({ title: "Could not update request", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Player approved" : "Request rejected" });
      if (resolvedTeamId) await fetchTeamOwnerPlayerRequests(resolvedTeamId);
      await fetchProfile();
    }
    setReviewingTeamOwnerPlayerRequestId(null);
  };

  const handleOpenAdminRefereeProof = async (proofPath?: string | null) => {
    if (!proofPath) return;
    const { data, error } = await supabase.storage.from("referee-proof").createSignedUrl(proofPath, 60);
    if (error || !data?.signedUrl) {
      toast({ title: "Could not open proof", description: error?.message || "Try again in a moment.", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleReviewAdminRefereeClaim = async (claimId: string, approve: boolean) => {
    if (!user?.id) return;
    setReviewingAdminRefereeClaimId(claimId);
    const { error } = await reviewRefereeMatchClaim({ claimId, reviewerUserId: user.id, approve });

    if (error) {
      toast({ title: "Could not review referee application", description: error.message, variant: "destructive" });
    } else {
      toast({ title: approve ? "Referee approved" : "Application dismissed" });
      setAdminRefereeClaims((prev) => prev.filter((claim) => claim.id !== claimId));
    }

    setReviewingAdminRefereeClaimId(null);
  };

  const openPostConfirmation = () => {
    if (!selectedVideoFile) {
      toast({ title: "Video required", description: "Choose a video before posting.", variant: "destructive" });
      return;
    }

    if (!clipTitle.trim()) {
      toast({ title: "Title required", description: "Please enter a clip title before posting.", variant: "destructive" });
      return;
    }

    if (editedClipDurationSeconds <= 0 || editedClipDurationSeconds > maxClipDurationSeconds) {
      toast({
        title: "Adjust clip length",
        description: `${isActivePro ? "Pro" : "Free"} clips can be up to ${maxClipDurationSeconds} seconds.`,
        variant: "destructive",
      });
      return;
    }

    setShowPostConfirmation(true);
  };

  const visibleContacts = contacts
    .filter((contact) => !!contact.value)
    .sort(
      (a, b) =>
        CONTACT_DISPLAY_ORDER.indexOf(a.contact_type as keyof ContactFormState) -
        CONTACT_DISPLAY_ORDER.indexOf(b.contact_type as keyof ContactFormState)
    );

  const linkedMembershipsForDisplay = activeMemberships.length ? activeMemberships : activeMembership ? [activeMembership] : [];
  const teamStaffContacts = [
    ...(isOfficialFootyStatusAccount
      ? [
          {
            label: "Footy Status Email",
            value: FOOTY_STATUS_SUPER_ADMIN_EMAIL,
            type: "email" as const,
          },
        ]
      : isTeamAccount
      ? [
          {
            label: "Team Email",
            value: teamAccountData?.contact_email || profile?.email || "",
            type: "email" as const,
          },
          {
            label: "Main Team Phone",
            value: teamAccountData?.contact_phone || "",
            type: "phone" as const,
          },
        ]
      : []),
    ...(!isOfficialFootyStatusAccount && isTeamStaffAccount
      ? [
          {
            label: "Contact Email",
            value: staffAccountData?.contact_email || profile?.email || "",
            type: "email" as const,
          },
          {
            label: "Contact Phone",
            value: staffAccountData?.contact_phone || "",
            type: "phone" as const,
          },
        ]
      : []),
  ].filter((contact) => contact.value);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
          <Header />
          <div className="px-4 py-6 w-full min-w-0">
            <Skeleton className="h-8 w-32 mb-6" />
            <Skeleton className="h-32 w-32 rounded-full mx-auto mb-4" />
            <Skeleton className="h-6 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-32 mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        
        <div className="px-4 py-6 w-full min-w-0">
          <Link to="/other" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        
        <div className="flex justify-between items-start mb-6">
          <h1 className="text-2xl font-bold">My Profile</h1>
        </div>

        {/* Avatar */}
        <div className="bg-card border border-border rounded-xl p-6 mb-6 text-center">
          <div className="relative inline-block mb-4">
            <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mx-auto overflow-hidden">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="h-12 w-12 text-muted-foreground" />
              )}
            </div>
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white"
              disabled={uploadingAvatar}
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          {isEditingDetails ? (
            <Input
              value={isTeamAccount ? editForm.display_name || "" : isTeamStaffAccount ? editForm.display_name || editForm.full_name || "" : editForm.full_name || ""}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  ...(isTeamAccount
                    ? { display_name: e.target.value }
                    : isTeamStaffAccount
                      ? { display_name: e.target.value, full_name: e.target.value }
                      : { full_name: e.target.value }),
                })
              }
              className="text-center font-bold text-xl mb-2"
              placeholder={isTeamAccount ? "Club / Organization Name" : "Full Name"}
            />
          ) : (
            <>
              <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
                <h2 className="col-start-2 max-w-[14rem] break-words text-center text-xl font-bold">{profileDisplayName}</h2>
                <div className="col-start-3 ml-2 flex items-center gap-1 justify-self-start">
                  {isPlayerAccount && isActivePro ? (
                    <ProBadge
                      iconOnly
                      showInfoBubble
                      className="border border-yellow-500 bg-white text-yellow-700 shadow-sm"
                    />
                  ) : null}
                  {isOfficialFootyStatusAccount || (isTeamAccount && teamApprovalStatus === "approved") ? (
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-sm" aria-label="Official Footy authenticated profile">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
              </div>
              {isTeamAccount && !isOfficialFootyStatusAccount ? (
                <span className="mt-2 inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  Team / Club Account
                </span>
              ) : null}
              {isTeamAccount && teamAccountData?.club_name && !isOfficialFootyStatusAccount ? (
                <p className="text-navy font-medium text-center mt-2">{teamAccountData.club_name}</p>
              ) : null}
              {isPlayerAccount ? (
                <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-bold text-foreground">Player</span>
                  {profile?.username ? <span className="break-all text-muted-foreground">@{profile.username}</span> : null}
                </div>
              ) : null}
              {displayProfileBio && <p className="mx-auto mt-1 w-full max-w-xs break-words whitespace-pre-wrap text-center text-sm text-muted-foreground" style={{ textAlign: "center" }}>{displayProfileBio}</p>}
            </>
          )}
          {!isTeamAccount && !isOfficialFootyStatusAccount && !isPlayerAccount && (
            <p className="text-sm text-muted-foreground mt-1">{getAccountRoleLabel()}</p>
          )}
          {isActivePro && !isPlayerAccount && <ProBadge className="mt-2" />}
          {isActivePro && daysRemaining !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Pro renews in {daysRemaining} days on {new Date(profile?.pro_expires_at || "").toLocaleDateString()}
            </p>
          ) : null}
        </div>

        {/* Profile Details */}
        {isTeamAccount && teamAccountData?.team_id ? (
          <ClubNewsSection
            teamId={teamAccountData.team_id}
            clubId={teamAccountData.club_id || null}
            clubName={teamAccountData.club_name || profileDisplayName}
            canManage={true}
            userId={user?.id || null}
            city={teamAccountData.city || null}
          />
        ) : null}

        {isOfficialFootyStatusAccount ? <NextUpClipReviewBank /> : null}
        {isOfficialFootyStatusAccount ? <ReportContentReview /> : null}


        {isOfficialFootyStatusAccount ? (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-navy">Referee Applications</h3>
              <Badge variant="secondary" className="rounded-full">{adminRefereeClaims.length}</Badge>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              {adminRefereeClaims.length ? (
                adminRefereeClaims.map((claim) => (
                  <div key={claim.id} className="space-y-3 rounded-lg border border-border p-3">
                    <div className="flex items-start gap-3">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-muted">
                        {claim.referee_avatar_url ? (
                          <img src={claim.referee_avatar_url} alt={claim.referee_name} className="h-full w-full object-cover" />
                        ) : (
                          <Shield className="mx-auto mt-2.5 h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{claim.referee_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[claim.referee_username ? `@${claim.referee_username}` : null, claim.referee_certification_level, claim.referee_certifying_organization]
                            .filter(Boolean)
                            .join(" - ") || "Referee"}
                        </p>
                        {claim.referee_license_number ? (
                          <p className="mt-1 text-xs text-muted-foreground">License: {claim.referee_license_number}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-lg bg-muted/40 p-3 text-sm">
                      <p className="font-medium text-foreground">{claim.match_label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[claim.league_name, claim.scheduled_at ? new Date(claim.scheduled_at).toLocaleString() : null].filter(Boolean).join(" - ")}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Applying as {refereeRoleLabel(claim.referee_type)}. {claim.show_name_publicly ? "Name can be shown publicly." : "Name should stay private publicly."}
                      </p>
                      {claim.proof_file_name ? <p className="mt-1 text-xs text-muted-foreground">Proof: {claim.proof_file_name}</p> : null}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => handleOpenAdminRefereeProof(claim.proof_url)}>
                        Proof
                      </Button>
                      <Button type="button" size="sm" onClick={() => handleReviewAdminRefereeClaim(claim.id, true)} disabled={reviewingAdminRefereeClaimId === claim.id}>
                        Approve
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => handleReviewAdminRefereeClaim(claim.id, false)} disabled={reviewingAdminRefereeClaimId === claim.id}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No pending referee applications.
                </p>
              )}
            </div>
          </section>
        ) : null}

        {!isOfficialFootyStatusAccount ? (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-navy">Details</h3>
            {!isEditingContact && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => startEditingSection("details")}>
                <Edit className="h-4 w-4" /> {isEditingDetails ? "Editing" : "Edit"}
              </Button>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {isEditingDetails && isPlayerAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Team Name</label>
                  <Input
                    value={
                      activeMembership?.team
                        ? formatTeamLeagueLine(
                            activeMembership.team.name,
                            activeMembership.age_group || activeMembership.team.age_group,
                            activeMembership.league?.name
                          )
                        : editForm.team_name || ""
                    }
                    onChange={(e) => setEditForm({ ...editForm, team_name: e.target.value })}
                    placeholder="Team"
                    disabled={!!activeMembership?.team}
                    className={activeMembership?.team ? "bg-muted text-muted-foreground" : ""}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Position</label>
                  <Input value={editForm.position || ""} onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} placeholder="e.g. Forward" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Jersey Number</label>
                  <Input value={editForm.jersey_number || ""} onChange={(e) => setEditForm({ ...editForm, jersey_number: e.target.value })} placeholder="e.g. 10" inputMode="numeric" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Birth Year</label>
                  <Input value={editForm.age_birth_year || ""} onChange={(e) => setEditForm({ ...editForm, age_birth_year: e.target.value })} placeholder="e.g. 2008" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">School Grade</label>
                  <Input value={editForm.school_grade || ""} onChange={(e) => setEditForm({ ...editForm, school_grade: e.target.value })} placeholder="e.g. 10th" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Height</label>
                  <Input value={editForm.height || ""} onChange={(e) => setEditForm({ ...editForm, height: e.target.value })} placeholder="e.g. 5'10" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Weight</label>
                  <Input value={editForm.weight || ""} onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })} placeholder="e.g. 150 lbs" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Username</label>
                  <Input
                    value={editForm.username || ""}
                    onChange={(e) => setEditForm({ ...editForm, username: normalizeUsername(e.target.value) })}
                    placeholder="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">You can change your username once every 14 days.</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Bio</label>
                  <div className="space-y-2">
                    <Input
                      value={editForm.bio || ""}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                      placeholder="Tell us about yourself"
                      maxLength={BIO_MAX_LENGTH}
                      className="text-center placeholder:text-center"
                      style={{ textAlign: "center" }}
                    />
                    <p className="text-xs text-muted-foreground text-right">{(editForm.bio || "").length}/{BIO_MAX_LENGTH}</p>
                  </div>
                </div>
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isEditingDetails && isTeamAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Club / Organization Name</label>
                  <Input value={editForm.display_name || ""} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value, club_name: e.target.value })} placeholder="Club / Organization Name" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Leagues Provided</label>
                  <Input value={editForm.leagues_offered_text || ""} onChange={(e) => setEditForm({ ...editForm, leagues_offered_text: e.target.value })} placeholder="MLS Next, ECNL" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Age Groups Provided</label>
                  <Input value={editForm.age_groups_offered_text || ""} onChange={(e) => setEditForm({ ...editForm, age_groups_offered_text: e.target.value })} placeholder="U13, U14, U15" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">Daughter Teams</label>
                  <ClubTeamsManager
                    value={offeredClubTeams}
                    onChange={setOfferedClubTeams}
                    onRemoveSavedTeam={handleArchiveDaughterTeam}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">City / State</label>
                  <Input value={editForm.city || ""} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} placeholder="Dallas, TX" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Bio</label>
                  <div className="space-y-2">
                    <Input
                      value={editForm.bio || ""}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                      placeholder="Short club bio"
                      maxLength={BIO_MAX_LENGTH}
                      className="text-center placeholder:text-center"
                      style={{ textAlign: "center" }}
                    />
                    <p className="text-xs text-muted-foreground text-right">{(editForm.bio || "").length}/{BIO_MAX_LENGTH}</p>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Home Field Address</label>
                  <Input value={editForm.home_field_address || ""} onChange={(e) => setEditForm({ ...editForm, home_field_address: e.target.value })} placeholder="123 Main St, Dallas, TX" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-muted-foreground">Home Jersey Color</label>
                    <Input value={editForm.home_jersey_color || ""} onChange={(e) => setEditForm({ ...editForm, home_jersey_color: e.target.value })} placeholder="Red" />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Away Jersey Color</label>
                    <Input value={editForm.away_jersey_color || ""} onChange={(e) => setEditForm({ ...editForm, away_jersey_color: e.target.value })} placeholder="White" />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">3rd Kit Color (Optional)</label>
                  <Input value={editForm.third_kit_color || ""} onChange={(e) => setEditForm({ ...editForm, third_kit_color: e.target.value })} placeholder="Blue" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Training Ground Address</label>
                  <Input value={editForm.training_ground_address || ""} onChange={(e) => setEditForm({ ...editForm, training_ground_address: e.target.value })} placeholder="456 Training Way, Dallas, TX" />
                </div>
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isTeamAccount ? (
              <>
                <div className="flex items-center gap-3 p-4">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Club / Organization</p><p className="font-medium">{teamAccountData?.club_name || profile?.club_name || profile?.full_name || "No organization yet"}</p></div>
                </div>
                {teamAccountData?.leagues_offered?.length && (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Leagues Provided</p>
                      <p className="font-medium">{teamAccountData.leagues_offered.join(", ")}</p>
                    </div>
                  </div>
                )}
                {teamAccountData?.age_groups_offered?.length ? (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Age Groups Provided</p>
                      <p className="font-medium">{teamAccountData.age_groups_offered.join(", ")}</p>
                    </div>
                  </div>
                ) : null}
                {teamAccountData?.city && (
                  <div className="flex items-center gap-3 p-4">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">City / State</p><p className="font-medium">{teamAccountData.city}</p></div>
                  </div>
                )}
                {teamAccountData?.home_stadium && (
                  <div className="flex items-center gap-3 p-4">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Home Field Address</p><p className="font-medium">{teamAccountData.home_stadium}</p></div>
                  </div>
                )}
                {teamAccountData?.training_ground && (
                  <div className="flex items-center gap-3 p-4">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Training Ground Address</p><p className="font-medium">{teamAccountData.training_ground}</p></div>
                  </div>
                )}
                {!teamAccountData?.club_name &&
                !teamAccountData?.city &&
                !teamAccountData?.country &&
                !teamAccountData?.home_stadium &&
                !teamAccountData?.training_ground &&
                !(teamAccountData?.age_groups_offered?.length || teamAccountData?.leagues_offered?.length) ? (
                  <div className="p-4 text-center text-muted-foreground">
                    <p>Your team profile details will appear here.</p>
                  </div>
                ) : null}
              </>
            ) : isEditingDetails && isParentAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Parent Full Name</label>
                  <Input value={editForm.full_name || ""} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} placeholder="Full Name" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Email</label>
                  <Input value={editForm.contact_email || ""} onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })} placeholder="parent@email.com" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Phone Number</label>
                  <Input value={editForm.contact_phone || ""} onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })} placeholder="Phone number" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Emergency Contact</label>
                  <Input value={editForm.emergency_contact || ""} onChange={(e) => setEditForm({ ...editForm, emergency_contact: e.target.value })} placeholder="Name and phone number" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Relationship to Player</label>
                  <Input value={editForm.relationship_to_player || ""} onChange={(e) => setEditForm({ ...editForm, relationship_to_player: e.target.value })} placeholder="Mother, father, guardian" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Child / Player Full Name</label>
                  <Input value={editForm.child_full_name || ""} onChange={(e) => setEditForm({ ...editForm, child_full_name: e.target.value })} placeholder="Player name" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Where Their Child Plays</label>
                  <Input value={editForm.child_where_plays || ""} onChange={(e) => setEditForm({ ...editForm, child_where_plays: e.target.value })} placeholder="Club, school, academy" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-muted-foreground">Child's Team</label>
                    <Input value={editForm.child_team || ""} onChange={(e) => setEditForm({ ...editForm, child_team: e.target.value })} placeholder="Team" />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Child's League</label>
                    <Input value={editForm.child_league || ""} onChange={(e) => setEditForm({ ...editForm, child_league: e.target.value })} placeholder="League" />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Child's Age Group</label>
                  <Input value={editForm.child_age_group || ""} onChange={(e) => setEditForm({ ...editForm, child_age_group: e.target.value })} placeholder="U15" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Important Notes</label>
                  <Input value={editForm.parent_notes || ""} onChange={(e) => setEditForm({ ...editForm, parent_notes: e.target.value })} placeholder="Important information" />
                </div>
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isParentAccount ? (
              <>
                <div className="flex items-center gap-3 p-4">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Parent / Guardian</p><p className="font-medium">{parentAccountData?.full_name || profile?.full_name || "No name set"}</p></div>
                </div>
                <div className="flex items-center gap-3 p-4">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Email</p><p className="font-medium">{parentAccountData?.contact_email || profile?.email || "Not set"}</p></div>
                </div>
                {parentAccountData?.contact_phone ? (
                  <div className="flex items-center gap-3 p-4">
                    <Phone className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Phone Number</p><p className="font-medium">{parentAccountData.contact_phone}</p></div>
                  </div>
                ) : null}
                {parentAccountData?.emergency_contact ? (
                  <div className="flex items-center gap-3 p-4">
                    <Heart className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Emergency Contact</p><p className="font-medium">{parentAccountData.emergency_contact}</p></div>
                  </div>
                ) : null}
                {parentAccountData?.relationship_to_player ? (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Relationship to Player</p><p className="font-medium capitalize">{parentAccountData.relationship_to_player.replaceAll("_", " ")}</p></div>
                  </div>
                ) : null}
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Linked Children / Players</p>
                  {parentChildLinks.length ? (
                    parentChildLinks.map((link) => (
                      <div key={link.id} className="rounded-lg border border-border p-3">
                        <button
                          type="button"
                          className="text-left"
                          onClick={() => link.player?.id && navigate(`/player/${link.player.id}`)}
                        >
                          <p className="font-medium hover:text-primary">{link.player?.full_name || parentAccountData?.child_full_name || "Player"}</p>
                        </button>
                        <p className="text-sm text-muted-foreground">
                          {[link.player?.team_name || link.player?.team || parentAccountData?.child_team, parentAccountData?.child_league, parentAccountData?.child_age_group]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                        <p className="mt-1 text-xs font-medium capitalize text-muted-foreground">Status: {link.status}</p>
                        {link.status === "approved" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-3"
                            disabled={reviewingParentLinkId === link.id}
                            onClick={() => handleRemoveParentLink(link.id)}
                          >
                            Remove My Connection
                          </Button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No linked players yet.</p>
                  )}
                </div>
                <div className="border-t border-border p-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Link a Child Player (Ages 6–13)</p>
                  <Input
                    value={parentPlayerSearchQuery}
                    onChange={(e) => handleParentPlayerSearch(e.target.value)}
                    placeholder="Search your child's player account"
                  />
                  {parentPlayerSearchResults.map((playerResult) => (
                    <div key={playerResult.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{playerResult.full_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{[playerResult.team_name || playerResult.team, playerResult.position].filter(Boolean).join(" - ")}</p>
                      </div>
                      <Button size="sm" onClick={() => handleRequestParentLink(playerResult.user_id)} disabled={requestingParentLink}>
                        Request
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : isEditingDetails && isRefereeAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Full Name</label>
                  <Input value={editForm.full_name || ""} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} placeholder="Full Name" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Username</label>
                  <Input value={editForm.username || ""} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} placeholder="username" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Bio</label>
                  <div className="space-y-2">
                    <Input
                      value={editForm.bio || ""}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                      placeholder="Short referee bio"
                      maxLength={BIO_MAX_LENGTH}
                      className="text-center placeholder:text-center"
                      style={{ textAlign: "center" }}
                    />
                    <p className="text-xs text-muted-foreground text-right">{(editForm.bio || "").length}/{BIO_MAX_LENGTH}</p>
                  </div>
                </div>
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isRefereeAccount ? (
              <>
                <div className="p-4">
                  <Button className="w-full" onClick={() => navigate("/referee")}>
                    <Shield className="mr-2 h-4 w-4" />
                    Open Referee Dashboard
                  </Button>
                </div>
                <div className="flex items-center gap-3 p-4">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Referee Profile Privacy</p><p className="font-medium">{profile?.referee_profile_public ? "Public" : "Private by default"}</p></div>
                </div>
                {profile?.referee_certification_level ? (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Certification Level</p><p className="font-medium">{profile.referee_certification_level}</p></div>
                  </div>
                ) : null}
                {profile?.referee_certifying_organization ? (
                  <div className="flex items-center gap-3 p-4">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Certifying Organization</p><p className="font-medium">{profile.referee_certifying_organization}</p></div>
                  </div>
                ) : null}
                {profile?.referee_years_experience != null ? (
                  <div className="flex items-center gap-3 p-4">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Refereeing Experience</p><p className="font-medium">{profile.referee_years_experience} years</p></div>
                  </div>
                ) : null}
                {profile?.referee_main_experience ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Main Referee Experience</p><p className="font-medium">{profile.referee_main_experience}</p></div>
                  </div>
                ) : null}
                {profile?.referee_assistant_experience ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Assistant Referee Experience</p><p className="font-medium">{profile.referee_assistant_experience}</p></div>
                  </div>
                ) : null}
                {profile?.referee_leagues_tournaments ? (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Leagues / Tournaments</p><p className="font-medium">{profile.referee_leagues_tournaments}</p></div>
                  </div>
                ) : null}
                {profile?.referee_availability ? (
                  <div className="flex items-center gap-3 p-4">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Availability</p><p className="font-medium">{profile.referee_availability}</p></div>
                  </div>
                ) : null}
                {profile?.referee_accolades ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Accolades / Notable Matches</p><p className="font-medium">{profile.referee_accolades}</p></div>
                  </div>
                ) : null}
                {displayProfileBio ? (
                  <div className="flex items-center gap-3 p-4">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Bio</p><p className="font-medium whitespace-pre-wrap">{displayProfileBio}</p></div>
                  </div>
                ) : null}
              </>
            ) : isEditingDetails && isTeamStaffAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Full Name</label>
                  <Input value={editForm.display_name || editForm.full_name || ""} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value, full_name: e.target.value })} placeholder="Full Name" />
                </div>
                {profile?.account_role === "scout" ? (
                  <>
                    <div>
                      <label className="text-sm text-muted-foreground">Scout Role / Title</label>
                      <Input value={editForm.scout_role_title || ""} onChange={(e) => setEditForm({ ...editForm, scout_role_title: e.target.value })} placeholder="Regional Scout" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Organization / Team</label>
                      <Input value={editForm.scout_organization || ""} onChange={(e) => setEditForm({ ...editForm, scout_organization: e.target.value })} placeholder="Club, academy, or organization" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Scouting Experience</label>
                      <Input value={editForm.scouting_experience || ""} onChange={(e) => setEditForm({ ...editForm, scouting_experience: e.target.value })} placeholder="Experience" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Scouting Licenses / Certifications</label>
                      <Input value={editForm.scouting_licenses_text || ""} onChange={(e) => setEditForm({ ...editForm, scouting_licenses_text: e.target.value })} placeholder="Licenses, certifications" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Regions / Areas Scouted</label>
                      <Input value={editForm.scouting_regions || ""} onChange={(e) => setEditForm({ ...editForm, scouting_regions: e.target.value })} placeholder="Regions" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Age Groups Scouted</label>
                      <Input value={editForm.scouting_age_groups_text || ""} onChange={(e) => setEditForm({ ...editForm, scouting_age_groups_text: e.target.value })} placeholder="U13, U15, U17" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Player Positions Focused On</label>
                      <Input value={editForm.scouting_positions_text || ""} onChange={(e) => setEditForm({ ...editForm, scouting_positions_text: e.target.value })} placeholder="Wingers, center backs" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Accolades / Achievements</label>
                      <Input value={editForm.scouting_accolades || ""} onChange={(e) => setEditForm({ ...editForm, scouting_accolades: e.target.value })} placeholder="Achievements" />
                    </div>
                  </>
                ) : profile?.account_role === "academy_director" ? (
                  <>
                    <div>
                      <label className="text-sm text-muted-foreground">Staff Role / Title</label>
                      <Input value={editForm.coaching_role_type || ""} onChange={(e) => setEditForm({ ...editForm, coaching_role_type: e.target.value })} placeholder="Club Director, Team Manager" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Current Team / Organization</label>
                      <Input value={editForm.team_organization_name || ""} onChange={(e) => setEditForm({ ...editForm, team_organization_name: e.target.value, teams_currently_coaching: e.target.value })} placeholder="Current team, club, academy, or organization" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Bio / About Me</label>
                      <Input
                        value={editForm.bio || ""}
                        onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                        placeholder="Short bio"
                        maxLength={BIO_MAX_LENGTH}
                        className="text-center placeholder:text-center"
                        style={{ textAlign: "center" }}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Work Experience</label>
                      <Input value={editForm.previous_teams_text || ""} onChange={(e) => setEditForm({ ...editForm, previous_teams_text: e.target.value })} placeholder="Work experience" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Years of Experience</label>
                      <Input type="number" value={editForm.years_experience || ""} onChange={(e) => setEditForm({ ...editForm, years_experience: e.target.value })} placeholder="5" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Licenses & Certifications</label>
                      <Input value={editForm.coaching_licenses_text || ""} onChange={(e) => setEditForm({ ...editForm, coaching_licenses_text: e.target.value })} placeholder="Licenses, certifications" />
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">Accolades & Achievements</label>
                      <Input value={editForm.notable_achievements || ""} onChange={(e) => setEditForm({ ...editForm, notable_achievements: e.target.value })} placeholder="Achievements" />
                    </div>
                  </>
                ) : (
                  <>
                <div>
                  <label className="text-sm text-muted-foreground">Coaching Role / Type</label>
                  <Input value={editForm.coaching_role_type || ""} onChange={(e) => setEditForm({ ...editForm, coaching_role_type: e.target.value })} placeholder="Head Coach, Trainer, Analyst" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Teams Currently Coaching</label>
                  <Input value={editForm.team_organization_name || ""} onChange={(e) => setEditForm({ ...editForm, team_organization_name: e.target.value, teams_currently_coaching: e.target.value })} placeholder="Current teams" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Bio</label>
                  <div className="space-y-2">
                    <Input
                      value={editForm.bio || ""}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                      placeholder="Short bio"
                      maxLength={BIO_MAX_LENGTH}
                      className="text-center placeholder:text-center"
                      style={{ textAlign: "center" }}
                    />
                    <p className="text-xs text-muted-foreground text-right">{(editForm.bio || "").length}/{BIO_MAX_LENGTH}</p>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">City / State</label>
                  <Input value={editForm.city || ""} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} placeholder="Miami, FL" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Level</label>
                  <Input value={editForm.coaching_level || ""} onChange={(e) => setEditForm({ ...editForm, coaching_level: e.target.value })} placeholder="academy" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Experience</label>
                  <Input type="number" value={editForm.years_experience || ""} onChange={(e) => setEditForm({ ...editForm, years_experience: e.target.value })} placeholder="5" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Certifications</label>
                  <Input value={editForm.coaching_licenses_text || ""} onChange={(e) => setEditForm({ ...editForm, coaching_licenses_text: e.target.value })} placeholder="UEFA B, USSF C" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Age Groups</label>
                  <Input value={editForm.age_groups_coached_text || ""} onChange={(e) => setEditForm({ ...editForm, age_groups_coached_text: e.target.value })} placeholder="U14, U16" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Past Coaching Experience</label>
                  <Input value={editForm.previous_teams_text || ""} onChange={(e) => setEditForm({ ...editForm, previous_teams_text: e.target.value })} placeholder="Team A, Team B" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Accolades / Achievements</label>
                  <Input value={editForm.notable_achievements || ""} onChange={(e) => setEditForm({ ...editForm, notable_achievements: e.target.value })} placeholder="Achievements" />
                </div>
                  </>
                )}
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isEditingDetails ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Full Name</label>
                  <Input
                    value={editForm.full_name || ""}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    placeholder="Full Name"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Username</label>
                  <Input
                    value={editForm.username || ""}
                    onChange={(e) => setEditForm({ ...editForm, username: normalizeUsername(e.target.value) })}
                    placeholder="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">You can change your username once every 14 days.</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Bio</label>
                  <div className="space-y-2">
                    <Input
                      value={editForm.bio || ""}
                      onChange={(e) => setEditForm({ ...editForm, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                      placeholder="Short bio"
                      maxLength={BIO_MAX_LENGTH}
                      className="text-center placeholder:text-center"
                      style={{ textAlign: "center" }}
                    />
                    <p className="text-xs text-muted-foreground text-right">{(editForm.bio || "").length}/{BIO_MAX_LENGTH}</p>
                  </div>
                </div>
                <Button className="w-full mt-4" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isTeamStaffAccount ? (
              <>
                {profile?.account_role === "scout" && profile.scout_role_title && (
                  <div className="flex items-center gap-3 p-4">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Scout Role / Title</p><p className="font-medium">{formatRoleDisplayLabel(profile.scout_role_title, "Scout")}</p></div>
                  </div>
                )}
                {profile?.account_role === "scout" && profile.scout_organization && (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Organization / Team</p><p className="font-medium">{profile.scout_organization}</p></div>
                  </div>
                )}
                {profile?.account_role === "scout" && profile.scouting_experience && (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Scouting Experience</p><p className="font-medium">{profile.scouting_experience}</p></div>
                  </div>
                )}
                {profile?.account_role === "scout" && profile.scouting_licenses?.length ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Licenses / Certifications</p><p className="font-medium">{profile.scouting_licenses.join(", ")}</p></div>
                  </div>
                ) : null}
                {profile?.account_role === "scout" && profile.scouting_regions && (
                  <div className="flex items-center gap-3 p-4">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Regions Covered</p><p className="font-medium">{profile.scouting_regions}</p></div>
                  </div>
                )}
                {profile?.account_role === "scout" && profile.scouting_age_groups?.length ? (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Age Groups Covered</p><p className="font-medium">{profile.scouting_age_groups.join(", ")}</p></div>
                  </div>
                ) : null}
                {profile?.account_role === "scout" && profile.scouting_positions?.length ? (
                  <div className="flex items-center gap-3 p-4">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Positions Scouted</p><p className="font-medium">{profile.scouting_positions.join(", ")}</p></div>
                  </div>
                ) : null}
                {profile?.account_role === "scout" && profile.scouting_accolades && (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Accolades</p><p className="font-medium">{profile.scouting_accolades}</p></div>
                  </div>
                )}
                {profile?.account_role === "academy_director" && staffAccountData?.coaching_role_type && (
                  <div className="flex items-center gap-3 p-4">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Staff Role / Title</p><p className="font-medium">{formatRoleDisplayLabel(staffAccountData.coaching_role_type, "Club Director / Team Staff")}</p></div>
                  </div>
                )}
                {profile?.account_role === "academy_director" && (staffAccountData?.teams_currently_coaching || staffAccountData?.team_organization_name) && (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Current Team / Organization</p><p className="font-medium">{staffAccountData.teams_currently_coaching || staffAccountData.team_organization_name}</p></div>
                  </div>
                )}
                {profile?.account_role !== "scout" && profile?.account_role !== "academy_director" && staffAccountData?.coaching_role_type && (
                  <div className="flex items-center gap-3 p-4">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Coaching Role / Type</p><p className="font-medium">{formatRoleDisplayLabel(staffAccountData.coaching_role_type, "Coach / Trainer")}</p></div>
                  </div>
                )}
                {profile?.account_role !== "scout" && profile?.account_role !== "academy_director" && (staffAccountData?.teams_currently_coaching || staffAccountData?.team_organization_name) && (
                  <div className="flex items-center gap-3 p-4">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Current Teams</p><p className="font-medium">{staffAccountData.teams_currently_coaching || staffAccountData.team_organization_name}</p></div>
                  </div>
                )}
                {(staffAccountData?.city || staffAccountData?.country) && (
                  <div className="flex items-center gap-3 p-4">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Location</p><p className="font-medium">{[staffAccountData?.city, staffAccountData?.country].filter(Boolean).join(", ")}</p></div>
                  </div>
                )}
                {staffAccountData?.coaching_level && (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Level</p><p className="font-medium capitalize">{staffAccountData.coaching_level.replaceAll("_", " ")}</p></div>
                  </div>
                )}
                {staffAccountData?.years_experience !== null && staffAccountData?.years_experience !== undefined && (
                  <div className="flex items-center gap-3 p-4">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Coaching Experience</p><p className="font-medium">{staffAccountData?.years_experience} years</p></div>
                  </div>
                )}
                {staffAccountData?.coaching_licenses?.length ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Licenses / Certifications</p><p className="font-medium">{staffAccountData.coaching_licenses.join(", ")}</p></div>
                  </div>
                ) : null}
                {(staffAccountData?.contact_email || staffAccountData?.contact_phone) ? (
                  <div className="flex items-center gap-3 p-4">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Contact Information</p>
                      <p className="font-medium">
                        {[staffAccountData?.contact_email, staffAccountData?.contact_phone].filter(Boolean).join(" | ")}
                      </p>
                    </div>
                  </div>
                ) : null}
                {profile?.account_role === "academy_director" && (staffAccountData?.past_coaching_experience || staffAccountData?.previous_teams?.length) ? (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Work Experience / Previous Organizations</p><p className="font-medium">{staffAccountData.past_coaching_experience || staffAccountData.previous_teams?.join(", ")}</p></div>
                  </div>
                ) : null}
                {profile?.account_role !== "scout" && profile?.account_role !== "academy_director" && (staffAccountData?.past_coaching_experience || staffAccountData?.previous_teams?.length) ? (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Teams Coached / Past Experience</p><p className="font-medium">{staffAccountData.past_coaching_experience || staffAccountData.previous_teams?.join(", ")}</p></div>
                  </div>
                ) : null}
                {(staffAccountData?.coaching_accolades || staffAccountData?.notable_achievements) ? (
                  <div className="flex items-center gap-3 p-4">
                    <Star className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Accolades</p><p className="font-medium">{staffAccountData.coaching_accolades || staffAccountData.notable_achievements}</p></div>
                  </div>
                ) : null}
                {displayProfileBio ? (
                  <div className="flex items-center gap-3 p-4">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Bio</p><p className="font-medium whitespace-pre-wrap">{displayProfileBio}</p></div>
                  </div>
                ) : null}
                {!staffAccountData?.coaching_role_type &&
                !staffAccountData?.team_organization_name &&
                !staffAccountData?.city &&
                !staffAccountData?.country &&
                !staffAccountData?.coaching_level &&
                staffAccountData?.years_experience == null &&
                !staffAccountData?.past_coaching_experience &&
                !staffAccountData?.previous_teams?.length &&
                !staffAccountData?.coaching_licenses?.length &&
                !staffAccountData?.coaching_accolades &&
                !displayProfileBio ? (
                  <div className="p-4 text-center text-muted-foreground">
                    <p>Your staff profile details will appear here.</p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {isYoungPlayerParentLinkAge ? (
                  <div className="border-b border-border p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Parents / Emergency Contacts</p>
                      <p className="text-xs text-muted-foreground">Up to two parents can be connected. Once approved, only the linked parent can remove their connection.</p>
                    </div>
                    {playerParentLinks.map((link) => (
                      <div key={link.id} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{link.parent?.full_name || "Parent / Guardian"}</p>
                            <p className="text-xs text-muted-foreground capitalize">{link.relationship_to_player || link.parent?.relationship_to_player || "Parent"} - {link.status}</p>
                          </div>
                          {link.status === "pending" ? (
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => handleReviewParentLink(link.id, true)} disabled={reviewingParentLinkId === link.id}>
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleReviewParentLink(link.id, false)} disabled={reviewingParentLinkId === link.id}>
                                Deny
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {link.status === "approved" ? (
                          <div className="text-sm text-muted-foreground">
                            {link.parent?.contact_phone ? <p>Phone: {link.parent.contact_phone}</p> : null}
                            {link.parent?.contact_email ? <p>Email: {link.parent.contact_email}</p> : null}
                            {link.parent?.emergency_contact ? <p>Emergency: {link.parent.emergency_contact}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {!playerParentLinks.length ? (
                      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                        No parent account is linked yet. Up to two parent accounts can request a connection.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {(linkedMembershipsForDisplay.length > 0 || profile?.team_name) && (
                  <div className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">{linkedMembershipsForDisplay.length > 1 ? "Teams" : "Team"}</p>
                    </div>
                    {linkedMembershipsForDisplay.length > 0 ? (
                      <div className="space-y-3">
                        {linkedMembershipsForDisplay.map((membership) => {
                          const membershipLine = formatTeamLeagueLine(
                            membership.team?.name,
                            membership.age_group || membership.team?.age_group,
                            membership.league?.name
                          );
                          const destination = getMembershipTeamDestination(membership);

                          return (
                            <div key={membership.id} className="space-y-2">
                              <button
                                className="w-full bg-card border-2 border-border rounded-xl p-4 flex items-center gap-3 hover:border-accent hover:shadow-md transition-all text-left"
                                onClick={() => {
                                  if (destination) navigate(destination);
                                }}
                              >
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden">
                                  {activeMembershipLogoUrls[membership.id] ? (
                                    <img src={activeMembershipLogoUrls[membership.id] || ""} alt={membership.team?.name || "Team"} className="w-full h-full object-cover" />
                                  ) : (
                                    <Shield className="h-6 w-6 text-white" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground">{membership.team?.name || "Team"}</p>
                                  {membershipLine ? <p className="text-sm text-muted-foreground truncate">{membershipLine}</p> : null}
                                </div>
                              </button>
                              <Button variant="outline" size="sm" onClick={() => handleLeaveTeam(membership.id)} disabled={saving}>
                                Leave Team
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                      ) : (
                        <p className="font-medium">{profile?.team_name}</p>
                      )}
                  </div>
                )}
                {profile?.position && (
                  <div className="flex items-center gap-3 p-4">
                    <Trophy className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Position</p><p className="font-medium">{profile.position}</p></div>
                  </div>
                )}
                {(activeMembership?.jersey_number || profile?.jersey_number) && (
                  <div className="flex items-center gap-3 p-4">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Jersey Number</p><p className="font-medium">{activeMembership?.jersey_number || profile?.jersey_number}</p></div>
                  </div>
                )}
                {profile?.age_birth_year && (
                  <div className="flex items-center gap-3 p-4">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Birth Year</p><p className="font-medium">{profile.age_birth_year}</p></div>
                  </div>
                )}
                {profile?.school_grade && (
                  <div className="flex items-center gap-3 p-4">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">School Grade</p><p className="font-medium">{profile.school_grade}</p></div>
                  </div>
                )}
                {profile?.height && (
                  <div className="flex items-center gap-3 p-4">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Height</p><p className="font-medium">{profile.height}</p></div>
                  </div>
                )}
                {profile?.weight && (
                  <div className="flex items-center gap-3 p-4">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Weight</p><p className="font-medium">{profile.weight}</p></div>
                  </div>
                )}
                {!profile?.position && !profile?.jersey_number && !profile?.team_name && !profile?.school_grade && !profile?.height && !profile?.weight && !displayProfileBio && (
                  <div className="p-4 text-center text-muted-foreground">
                    <p>No details yet. Tap Edit to add your info.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        ) : null}

        {isPlayerAccount && seasonStats.length > 0 ? (
          <div className="mb-6 space-y-4">
            {seasonStats.map((stats, index) => (
              <CurrentStatsSection key={stats.team_id || `${stats.team_name || "team"}-${index}`} stats={stats} />
            ))}
          </div>
        ) : null}

        {isPlayerAccount && (linkedMembershipsForDisplay.length === 0 || pendingInvites.length > 0 || pendingJoinRequests.length > 0) && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Team Requests</h3>
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              {linkedMembershipsForDisplay.length > 0 ? null : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Start by searching for the approved team you want to apply to.</p>
                  <div className="relative">
                    <Input
                      value={teamSearchQuery}
                      onChange={(e) => {
                        setTeamSearchQuery(e.target.value);
                        if (!e.target.value.trim()) setSelectedJoinTeam(null);
                      }}
                      onFocus={() => setShowTeamDropdown(true)}
                      onBlur={() => {
                        window.setTimeout(() => setShowTeamDropdown(false), 150);
                      }}
                      placeholder="Search approved teams"
                    />
                    {showTeamDropdown && teamSearchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-10 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                        {teamSearchResults.map((team) => (
                          <button
                            key={`${team.id}-${team.club_team_id || "mother"}`}
                            type="button"
                            className="w-full border-b last:border-b-0 border-border px-3 py-3 text-left hover:bg-muted transition-colors"
                            onClick={async () => {
                              const clubTeams = await fetchClubTeamOptionsForParentTeam(team.id);
                              const selectedClubTeam = team.club_team_id ? clubTeams.find((clubTeam) => clubTeam.id === team.club_team_id) : null;
                              setSelectedJoinTeam(team);
                              setAvailableClubTeams(clubTeams);
                              setTeamSearchQuery(team.search_label || team.name);
                              setSelectedJoinAgeGroup(selectedClubTeam?.age_group || "");
                              setSelectedJoinLeague(selectedClubTeam?.league_name || "");
                              setTeamSearchResults([]);
                              setShowTeamDropdown(false);
                            }}
                          >
                            <p className="font-medium">{team.search_label || team.name}</p>
                            <p className="text-xs text-muted-foreground">{team.result_type === "daughter" ? "Daughter team" : "Mother team"}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedJoinTeam && (
                    <div className="rounded-lg border border-border p-3 space-y-3">
                      <div>
                        <p className="text-sm text-muted-foreground">Team application started</p>
                        <p className="font-medium">{selectedJoinTeam.search_label || selectedJoinTeam.name}</p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Age group</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[...new Set(availableClubTeams.map((team) => team.age_group).filter(Boolean))].map((ageGroup) => {
                            const hasAny = !selectedJoinLeague
                              ? availableClubTeams.some((team) => team.age_group === ageGroup && team.status === "active")
                              : availableClubTeams.some((team) => team.age_group === ageGroup && team.league_name === selectedJoinLeague && team.status === "active");
                            return (
                              <button
                                key={ageGroup}
                                type="button"
                                disabled={!hasAny}
                                onClick={() => {
                                  setSelectedJoinAgeGroup(ageGroup);
                                  if (!availableClubTeams.some((team) => team.age_group === ageGroup && team.league_name === selectedJoinLeague && team.status === "active")) {
                                    setSelectedJoinLeague("");
                                  }
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                                  selectedJoinAgeGroup === ageGroup
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : hasAny
                                      ? "border-border bg-card"
                                      : "border-border bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                                }`}
                              >
                                {ageGroup}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">League</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[...new Set(availableClubTeams.map((team) => team.league_name).filter(Boolean))].map((leagueName) => {
                            const isValid = !selectedJoinAgeGroup
                              ? availableClubTeams.some((team) => team.league_name === leagueName && team.status === "active")
                              : availableClubTeams.some((team) => team.age_group === selectedJoinAgeGroup && team.league_name === leagueName && team.status === "active");
                            return (
                              <button
                                key={leagueName}
                                type="button"
                                disabled={!isValid}
                                onClick={() => {
                                  setSelectedJoinLeague(leagueName);
                                  if (!availableClubTeams.some((team) => team.age_group === selectedJoinAgeGroup && team.league_name === leagueName && team.status === "active")) {
                                    setSelectedJoinAgeGroup("");
                                  }
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                                  selectedJoinLeague === leagueName
                                    ? "border-primary bg-primary/10 text-foreground"
                                    : isValid
                                      ? "border-border bg-card"
                                      : "border-border bg-muted text-muted-foreground opacity-60 cursor-not-allowed"
                                }`}
                              >
                                {leagueName}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Available options update based on what this club offers.
                        </p>
                      </div>
                      {selectedJoinAgeGroup && selectedJoinLeague && !availableClubTeams.some((team) => team.age_group === selectedJoinAgeGroup && team.league_name === selectedJoinLeague && team.status === "active") ? (
                        <p className="text-sm text-destructive">This club does not offer that age group in this league.</p>
                      ) : null}
                      {selectedJoinAgeGroup && selectedJoinLeague ? (
                        <p className="text-xs text-muted-foreground">
                          You are applying to {formatTeamLeagueLine(selectedJoinTeam.name, selectedJoinAgeGroup, selectedJoinLeague)}.
                        </p>
                      ) : null}
                      <Input
                        value={teamAccessCode}
                        onChange={(e) => setTeamAccessCode(sanitizeClubTeamAccessCode(e.target.value))}
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="Enter 5-digit team code"
                      />
                      <Button className="w-full" onClick={handleJoinTeam}>
                        Join Team
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {pendingInvites.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Team invites</p>
                  {pendingInvites.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-primary">New invitation</p>
                      <p className="font-medium">{formatTeamLeagueLine(invite.team_name, invite.age_group, invite.league_name)}</p>
                      <p className="text-xs text-muted-foreground">This team invited you to join this exact squad.</p>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => handleRespondInvite(invite.id, true)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleRespondInvite(invite.id, false)}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingJoinRequests.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Pending join requests</p>
                  {pendingJoinRequests.map((request) => (
                    <div key={request.id} className="rounded-lg border border-border p-3">
                      <p className="font-medium">{formatTeamLeagueLine(request.team_name, request.age_group, request.league_name)}</p>
                      <p className="text-xs text-muted-foreground mt-1">Awaiting team approval</p>
                      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => handleCancelJoinRequest(request.id)}>
                        Cancel Request
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {isTeamStaffAccount && !isTeamAccount && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Team Connection</h3>
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              {coachStaffTeamLinks.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Current linked teams</p>
                  {coachStaffTeamLinks.map((link) => (
                    <div key={link.id} className="rounded-xl border border-border p-3 space-y-3">
                      <button
                        onClick={() => navigate(link.club_team_id ? `/club-team/${link.club_team_id}` : `/team/${link.team_id}`)}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-red-light flex items-center justify-center shadow-md overflow-hidden">
                          {link.team_logo_url ? (
                            <img src={link.team_logo_url} alt={link.team_name} className="w-full h-full object-cover" />
                          ) : (
                            <Shield className="h-6 w-6 text-white" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{link.team_name}</p>
                          <p className="text-sm text-muted-foreground">{formatRoleDisplayLabel(link.staff_role || staffAccountData?.coaching_role_type, "Coaching Staff")}</p>
                          {link.club_team_name ? <p className="text-xs text-muted-foreground">{link.club_team_name}</p> : null}
                        </div>
                      </button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => link.club_team_id ? handleCoachStaffLeaveTeam(link.id) : handleCoachStaffLeaveClub(link)}
                        disabled={saving}
                      >
                        {link.club_team_id ? "Leave Daughter Team" : "Leave Club"}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Search for an approved team and request to connect as coach/staff.</p>
              )}

              <div className="space-y-3">
                <div className="relative">
                  <Input
                    value={teamSearchQuery}
                    onChange={(e) => {
                      setTeamSearchQuery(e.target.value);
                      if (!e.target.value.trim()) setSelectedJoinTeam(null);
                    }}
                    onFocus={() => setShowTeamDropdown(true)}
                    onBlur={() => {
                      window.setTimeout(() => setShowTeamDropdown(false), 150);
                    }}
                    placeholder="Search approved teams"
                  />
                  {showTeamDropdown && teamSearchResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-10 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                      {teamSearchResults.map((team) => (
                        <button
                          key={`${team.id}-${team.club_team_id || "mother"}`}
                          type="button"
                          className="w-full border-b last:border-b-0 border-border px-3 py-3 text-left hover:bg-muted transition-colors"
                          onClick={async () => {
                            const clubTeams = await fetchClubTeamOptionsForParentTeam(team.id);
                            const selectedClubTeam = team.club_team_id ? clubTeams.find((clubTeam) => clubTeam.id === team.club_team_id) : null;
                            setSelectedJoinTeam(team);
                            setAvailableClubTeams(clubTeams);
                            setTeamSearchQuery(team.search_label || team.name);
                            setSelectedJoinAgeGroup(selectedClubTeam?.age_group || "");
                            setSelectedJoinLeague(selectedClubTeam?.league_name || "");
                            setCoachClubTeamRoles(
                              selectedClubTeam ? { [selectedClubTeam.id]: "Head Coach" } : {}
                            );
                            setCoachGeneralClubRole(false);
                            setTeamSearchResults([]);
                            setShowTeamDropdown(false);
                          }}
                        >
                          <p className="font-medium">{team.search_label || team.name}</p>
                          <p className="text-xs text-muted-foreground">{team.result_type === "daughter" ? "Daughter team" : "Mother team"}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedJoinTeam ? (
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground">Requesting team</p>
                      <p className="font-medium">{selectedJoinTeam.search_label || selectedJoinTeam.name}</p>
                    </div>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setCoachGeneralClubRole((current) => !current)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          coachGeneralClubRole ? "border-primary bg-primary/10" : "border-border bg-card"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className={`flex h-5 w-5 items-center justify-center rounded border ${
                            coachGeneralClubRole ? "border-primary bg-primary text-primary-foreground" : "border-border"
                          }`}>
                            {coachGeneralClubRole ? <Check className="h-3.5 w-3.5" /> : null}
                          </span>
                          General Coach / Club Staff
                        </span>
                        <span className="mt-1 block pl-7 text-xs text-muted-foreground">
                          Link to the mother club without being assigned to one daughter team.
                        </span>
                      </button>

                      {availableClubTeams.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Daughter teams coached</p>
                          {availableClubTeams.filter((team) => team.status === "active").map((team) => {
                            const selectedRole = coachClubTeamRoles[team.id];
                            return (
                              <div key={team.id} className={`rounded-lg border p-3 ${
                                selectedRole ? "border-primary/50 bg-primary/5" : "border-border"
                              }`}>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 text-left"
                                  onClick={() =>
                                    setCoachClubTeamRoles((current) => {
                                      const next = { ...current };
                                      if (next[team.id]) delete next[team.id];
                                      else next[team.id] = "Head Coach";
                                      return next;
                                    })
                                  }
                                >
                                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                    selectedRole ? "border-primary bg-primary text-primary-foreground" : "border-border"
                                  }`}>
                                    {selectedRole ? <Check className="h-3.5 w-3.5" /> : null}
                                  </span>
                                  <span>
                                    <span className="block text-sm font-medium">
                                      {[team.age_group, team.level].filter(Boolean).join(" - ") || "Daughter Team"}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">{team.league_name}</span>
                                  </span>
                                </button>
                                {selectedRole ? (
                                  <div className="mt-3 pl-7">
                                    <Select
                                      value={selectedRole}
                                      onValueChange={(role) => setCoachClubTeamRoles((current) => ({ ...current, [team.id]: role }))}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Choose your role" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CLUB_COACH_REQUEST_ROLE_OPTIONS.map((role) => (
                                          <SelectItem key={role} value={role}>{role}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">This club has no active daughter teams. Choose General Coach / Club Staff.</p>
                      )}
                    </div>
                    <Button className="w-full" onClick={handleCoachStaffRequestTeam} disabled={saving}>
                      Request to Join Team Staff
                    </Button>
                  </div>
                ) : null}
              </div>

              {coachStaffInvites.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Team invites</p>
                  {coachStaffInvites.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-primary">New staff invitation</p>
                      <p className="font-medium">{invite.teams?.name || "Team"}</p>
                      <p className="text-xs text-muted-foreground">{formatRoleDisplayLabel(invite.staff_role || staffAccountData?.coaching_role_type, "Coaching Staff")}</p>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={() => handleCoachStaffInviteReview(invite, true)} disabled={saving}>
                          Accept
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCoachStaffInviteReview(invite, false)} disabled={saving}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {coachStaffRequests.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Pending staff requests</p>
                  {coachStaffRequests.map((request) => (
                    <div key={request.id} className="rounded-lg border border-border p-3 space-y-2">
                      <p className="font-medium">{request.teams?.name || "Team"}</p>
                      {request.general_club_role ? <p className="text-xs text-muted-foreground">General Coach / Club Staff</p> : null}
                      {(request.requested_assignments || []).map((assignment: CoachClubTeamAssignment) => (
                        <p key={assignment.club_team_id} className="text-xs text-muted-foreground">
                          {assignment.team_name || "Daughter team"} - {assignment.role}
                        </p>
                      ))}
                      <p className="text-xs text-muted-foreground mt-1">Awaiting team approval</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        )}

        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-navy">{isPlayerAccount ? "My Contacts / Links" : "Contact Information"}</h3>
            {!isEditingDetails && !isOfficialFootyStatusAccount && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => startEditingSection("contact")}>
                <Edit className="h-4 w-4" /> {isEditingContact ? "Editing" : "Edit"}
              </Button>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {!isTeamAccount && (
              <div className="p-4 space-y-2">
                <p className="text-sm text-muted-foreground">Who can see my contact info</p>
                <Select value={settings.showContactInfo} onValueChange={handleContactVisibilityChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose contact visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_VISIBILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isEditingContact && isPlayerAccount ? (
              <div className="p-4 space-y-3">
                {RESTRICTED_CONTACTS.map((contactType) => (
                  <div key={contactType}>
                    <label className="text-sm text-muted-foreground">{CONTACT_LABELS[contactType]}</label>
                    <Input
                      type={contactType.includes("email") ? "email" : "tel"}
                      value={contactForm[contactType]}
                      onChange={(e) => setContactForm((prev) => ({ ...prev, [contactType]: e.target.value }))}
                      placeholder={CONTACT_LABELS[contactType]}
                    />
                  </div>
                ))}
                {SOCIAL_CONTACTS.map((contactType) => (
                  <div key={contactType}>
                    <label className="text-sm text-muted-foreground">{CONTACT_LABELS[contactType]}</label>
                    <Input
                      type={contactType === "website" ? "url" : "text"}
                      value={contactForm[contactType]}
                      onChange={(e) => setContactForm((prev) => ({ ...prev, [contactType]: e.target.value }))}
                      placeholder={CONTACT_LABELS[contactType]}
                    />
                  </div>
                ))}
                <Button className="w-full mt-2" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isEditingContact && isTeamAccount ? (
              <div className="p-4 space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-muted-foreground">Team Email</label>
                    <Input
                      type="email"
                      value={editForm.contact_email || ""}
                      onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                      placeholder="team@email.com"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Main Team Phone</label>
                    <Input
                      type="tel"
                      value={editForm.contact_phone || ""}
                      onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium">Club Staff</p>
                  {teamStaffForm.map((member, index) => (
                    <div key={`${member.id || "new"}-${index}`} className="rounded-lg border border-border p-3 space-y-2">
                      <Input
                        value={member.staff_name}
                        onChange={(e) =>
                          setTeamStaffForm((prev) =>
                            prev.map((item, itemIndex) => (itemIndex === index ? { ...item, staff_name: e.target.value } : item))
                          )
                        }
                        placeholder="Staff name"
                      />
                      <Input
                        value={member.staff_role}
                        onChange={(e) =>
                          setTeamStaffForm((prev) =>
                            prev.map((item, itemIndex) => (itemIndex === index ? { ...item, staff_role: e.target.value } : item))
                          )
                        }
                        placeholder="Role"
                      />
                      <Input
                        type="email"
                        value={member.personal_email}
                        onChange={(e) =>
                          setTeamStaffForm((prev) =>
                            prev.map((item, itemIndex) => (itemIndex === index ? { ...item, personal_email: e.target.value } : item))
                          )
                        }
                        placeholder="Contact email"
                      />
                      {teamStaffForm.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setTeamStaffForm((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Remove Staff Member
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTeamStaffForm((prev) => [...prev, { staff_name: "", staff_role: "", personal_email: "" }])}
                >
                  Add Staff Member
                </Button>
                <Button className="w-full" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isEditingContact && isTeamStaffAccount ? (
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">Contact Email</label>
                  <Input
                    type="email"
                    value={editForm.contact_email || ""}
                    onChange={(e) => setEditForm({ ...editForm, contact_email: e.target.value })}
                    placeholder="coach@email.com"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Contact Phone</label>
                  <Input
                    type="tel"
                    value={editForm.contact_phone || ""}
                    onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <Button className="w-full mt-2" onClick={handleSaveProfile} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            ) : isPlayerAccount && visibleContacts.length > 0 ? (
              visibleContacts.map((contact) => (
                <div key={contact.id} className="flex items-center gap-3 p-4">
                  {contact.contact_type.includes("phone") ? (
                    <Phone className="h-5 w-5 text-muted-foreground" />
                  ) : contact.contact_type.includes("email") ? (
                    <Mail className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <LinkIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {CONTACT_LABELS[contact.contact_type as keyof ContactFormState]}
                    </p>
                    {contact.contact_type.includes("phone") ? (
                      <a href={`tel:${contact.value}`} className="font-medium text-navy hover:underline">
                        {contact.value}
                      </a>
                    ) : contact.contact_type.includes("email") ? (
                      <a href={`mailto:${contact.value}`} className="font-medium text-navy hover:underline">
                        {contact.value}
                      </a>
                    ) : (
                      <a
                        href={contact.value.startsWith("http") ? contact.value : `https://${contact.value}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-navy hover:underline"
                      >
                        {contact.value}
                      </a>
                    )}
                  </div>
                </div>
              ))
            ) : !isPlayerAccount && (teamStaffContacts.length > 0 || (!isOfficialFootyStatusAccount && (teamStaffMembers.length > 0 || sortedLinkedTeamClubStaff.length > 0))) ? (
              <>
                {teamStaffContacts.map((contact) => (
                  <div key={contact.label} className="flex items-center gap-3 p-4">
                    {contact.type === "phone" ? (
                      <Phone className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <Mail className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground">{contact.label}</p>
                      {contact.type === "phone" ? (
                        <a href={`tel:${contact.value}`} className="font-medium text-navy hover:underline">
                          {contact.value}
                        </a>
                      ) : (
                        <a href={`mailto:${contact.value}`} className="font-medium text-navy hover:underline">
                          {contact.value}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {!isOfficialFootyStatusAccount && (teamStaffMembers.length > 0 || sortedLinkedTeamClubStaff.length > 0) ? (
                  <div className="p-4 space-y-3">
                    <p className="text-sm font-medium">Club Staff</p>
                    {sortedLinkedTeamClubStaff.map((staff) => {
                      const staffProfile = staff.profile || staff.profiles || {};
                      return (
                        <div key={staff.id} className="rounded-lg border border-border p-3 space-y-3">
                          <button
                            type="button"
                            onClick={() => navigate(staff.coach_user_id === user?.id ? "/profile" : `/staff/${staff.coach_user_id}`)}
                            className="w-full flex items-center gap-3 text-left"
                          >
                            <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                              {staffProfile.avatar_url ? (
                                <img src={staffProfile.avatar_url} alt={staffProfile.full_name || "Club staff"} className="w-full h-full object-cover" />
                              ) : (
                                <Briefcase className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{staffProfile.full_name || "Club Staff"}</p>
                              <p className="text-sm text-muted-foreground truncate">{formatRoleDisplayLabel(staff.staff_role || staffProfile.coaching_role_type, "Club Director / Team Staff")}</p>
                            </div>
                          </button>
                          <Button size="sm" variant="outline" onClick={() => handleCoachStaffLeaveTeam(staff.id)} disabled={saving}>
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                    {teamStaffMembers.map((staff) => (
                      <div key={staff.id} className="rounded-lg border border-border p-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{staff.staff_name}</p>
                          {staff.staff_role ? (
                            <span className="text-sm text-muted-foreground">
                              {staff.staff_role}
                            </span>
                          ) : null}
                        </div>
                        {staff.personal_email ? (
                          <a href={`mailto:${staff.personal_email}`} className="font-medium text-navy hover:underline break-all">
                            {staff.personal_email}
                          </a>
                        ) : (
                          <p className="text-sm text-muted-foreground">No email added yet</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                <p>{isPlayerAccount ? "No contacts or links added yet." : "No contact information added yet."}</p>
              </div>
            )}
          </div>
        </section>

        {isTeamAccount && !isOfficialFootyStatusAccount && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Invite Coaches / Staff</h3>
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Search eligible coaches, assistant coaches, trainer coaches, scouts, and academy director/team staff accounts.
              </p>
              <Input
                value={teamManageCoachSearch}
                onChange={(e) => setTeamManageCoachSearch(e.target.value)}
                placeholder="Search coaches, trainers, scouts, or staff"
              />
              {teamManageCoachSearch.trim() ? (
                teamManageCoachSearchLoading ? (
                  <p className="text-xs text-muted-foreground">Searching coaches and staff...</p>
                ) : teamManageCoachResults.length ? (
                  <div className="space-y-2">
                    {teamManageCoachResults.map((staff) => (
                      <div key={staff.user_id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                        <button
                          className="flex items-center gap-3 min-w-0 text-left"
                          onClick={() => navigate(staff.user_id === user?.id ? "/profile" : `/coach/${staff.user_id}`)}
                        >
                          <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                            {staff.avatar_url ? (
                              <img src={staff.avatar_url} alt={staff.full_name || "Coach / Staff"} className="w-full h-full object-cover" />
                            ) : (
                              <Briefcase className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{staff.full_name || "Coach / Staff"}</p>
                            <p className="text-xs text-muted-foreground truncate">{formatRoleDisplayLabel(staff.coaching_role_type || staff.scout_role_title || staff.account_role, "Staff")}</p>
                          </div>
                        </button>
                        <Button
                          size="sm"
                          className="h-8 px-3 shrink-0"
                          disabled={teamManageInvitingCoachId === staff.user_id}
                          onClick={() => handleInviteCoachToManagedTeam(staff.user_id, staff.coaching_role_type || staff.scout_role_title)}
                        >
                          {teamManageInvitingCoachId === staff.user_id ? "Sending..." : "Invite"}
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No matching coaches or staff found.</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground">Start typing a coach, trainer, scout, or staff name.</p>
              )}
            </div>
          </section>
        )}

        {/* My Clips */}
        {isPlayerAccount && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-navy">My Clips</h3>
            <span className="text-sm text-muted-foreground">
              {!isActivePro ? `${visibleClipCount}/${MAX_FREE_CLIPS} visible clips` : `${clipCount} clips`}
            </span>
          </div>
          <div className="mb-3 flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate("/analytics")}>
              <Eye className="h-4 w-4" /> Analytics
            </Button>
            {!isActivePro ? (
              <Button size="sm" className="gap-2" onClick={() => navigate("/pro")}>
                <Crown className="h-4 w-4" /> Upgrade
              </Button>
            ) : null}
          </div>

          {/* Upload Form */}
          <div className="bg-card border border-border rounded-xl p-4 mb-4">
            {!canUploadVisibleClip(profile, visibleClipCount) ? (
              <div className="text-center py-4">
                <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="font-medium">Clip limit reached</p>
                <p className="text-sm text-muted-foreground mt-1">Upgrade to FootyStatus Pro for unlimited clips</p>
                <Button className="mt-3 gap-2" size="sm" onClick={() => navigate("/pro")}>
                  <Crown className="h-4 w-4" /> Upgrade to Pro
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  placeholder="Clip title"
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                />
                <Input
                  placeholder="Caption (optional)"
                  value={clipCaption}
                  onChange={(e) => setClipCaption(e.target.value)}
                />
                <Select value={clipVisibility} onValueChange={setClipVisibility}>
                  <SelectTrigger>
                    <SelectValue placeholder="Who can see this clip?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Everyone</SelectItem>
                    <SelectItem value="restricted">Teams / Staff</SelectItem>
                    <SelectItem value="private">Only me</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => clipInputRef.current?.click()}
                  disabled={uploadingClip}
                >
                  <Upload className="h-4 w-4" />
                  {selectedVideoFile ? "Change Video" : "Upload Video"}
                </Button>
                <input ref={clipInputRef} type="file" accept="video/*" className="hidden" onChange={handleClipUpload} />
                {selectedVideoFile && (
                  <div className="space-y-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">{selectedVideoFile.name}</p>
                    {selectedVideoDuration !== null && (
                      <p>Source: {Math.round(selectedVideoDuration)} seconds</p>
                    )}
                    {selectedVideoPreviewUrl ? (
                      <div className="overflow-hidden rounded-lg border border-border bg-black">
                        <video
                          ref={clipPreviewVideoRef}
                          src={selectedVideoPreviewUrl}
                          controls
                          className={`aspect-[4/5] w-full ${clipFitMode === "contain" ? "object-contain" : "object-cover"}`}
                          onLoadedMetadata={(event) => {
                            event.currentTarget.volume = clipPlaybackVolume;
                            event.currentTarget.currentTime = clipTrimStart;
                          }}
                          onTimeUpdate={(event) => {
                            if (event.currentTarget.currentTime >= clipTrimEnd) {
                              event.currentTarget.currentTime = clipTrimStart;
                              event.currentTarget.pause();
                            }
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                      {isActivePro ? "Pro clips can be up to 45 seconds." : "Free clips can be up to 25 seconds."}
                      <span className="ml-1 font-medium text-foreground">Selected: {editedClipDurationSeconds}s</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span>Start</span>
                          <span>{Math.round(clipTrimStart)}s</span>
                        </div>
                        <Slider
                          min={0}
                          max={Math.max(1, Math.floor(selectedVideoDuration || 1) - 1)}
                          step={1}
                          value={[clipTrimStart]}
                          onValueChange={(value) => {
                            const nextStart = Math.min(value[0] || 0, Math.max(0, clipTrimEnd - 1));
                            setClipTrimStart(nextStart);
                            if (clipPreviewVideoRef.current) {
                              clipPreviewVideoRef.current.currentTime = nextStart;
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span>End</span>
                          <span>{Math.round(clipTrimEnd)}s</span>
                        </div>
                        <Slider
                          min={1}
                          max={Math.max(1, Math.floor(selectedVideoDuration || 1))}
                          step={1}
                          value={[clipTrimEnd]}
                          onValueChange={(value) => {
                            const nextEnd = Math.max(value[0] || 1, clipTrimStart + 1);
                            setClipTrimEnd(nextEnd);
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span>Volume</span>
                          <span>{Math.round(clipPlaybackVolume * 100)}%</span>
                        </div>
                        <Slider
                          min={0}
                          max={1}
                          step={0.05}
                          value={[clipPlaybackVolume]}
                          onValueChange={(value) => setClipPlaybackVolume(value[0] ?? 1)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={clipFitMode === "cover" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setClipFitMode("cover")}
                        >
                          Fill Frame
                        </Button>
                        <Button
                          type="button"
                          variant={clipFitMode === "contain" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setClipFitMode("contain")}
                        >
                          Fit Whole Clip
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <Button className="w-full" onClick={openPostConfirmation} disabled={uploadingClip || !selectedVideoFile}>
                  {uploadingClip ? "Posting..." : "Post Clip"}
                </Button>
              </div>
            )}
          </div>

          {/* Clip List */}
          {clips.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No clips uploaded yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.map((clip) => (
                <div
                  key={clip.id}
                  className="overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-accent"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({
                        tab: "next-up",
                        clip: clip.id,
                        returnTo: "/profile",
                      });
                      navigate(`/?${params.toString()}`);
                    }}
                    className="relative block aspect-[4/5] w-full bg-black"
                    aria-label={`Open ${clip.title} in Next Up`}
                  >
                    <video
                      src={clip.video_url}
                      muted
                      playsInline
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden="true"
                      className={`w-full h-full ${clip.fit_mode === "contain" ? "object-contain" : "object-cover"}`}
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg">
                        <Video className="h-5 w-5" />
                      </span>
                    </span>
                  </button>
                  <div className="p-3 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-medium text-sm leading-tight">{clip.title}</p>
                      <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0 shrink-0" onClick={() => setClipPendingDelete(clip)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Badge variant={clip.review_status === "approved" ? "default" : clip.review_status === "needs_revision" ? "destructive" : "secondary"}>
                        {clip.review_status === "approved" ? "Approved" : clip.review_status === "needs_revision" ? "Needs Revision" : "Pending Review"}
                      </Badge>
                      {clip.review_status === "needs_revision" && clip.revision_note ? (
                        <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                          <strong>Footy Status note:</strong> {clip.revision_note}
                          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => clipInputRef.current?.click()}>Upload Revised Video</Button>
                        </div>
                      ) : null}
                    </div>                    <Select
                      value={(clip.visibility as ClipVisibility) || "public"}
                      onValueChange={(value) => handleClipVisibilityChange(clip.id, value as ClipVisibility)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Choose visibility" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Everyone</SelectItem>
                        <SelectItem value="restricted">Teams / Staff</SelectItem>
                        <SelectItem value="private">Only me</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">
                        {clip.visibility === "restricted" ? "Teams / Staff" : clip.visibility === "inactive" ? "Hidden by Free limit" : clip.visibility || "public"}
                      </span>
                      {clip.duration !== null && <span>{clip.duration}s</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" />
                        {(clip.likes_count || 0).toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" />
                        {(clip.views_count || 0).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{new Date(clip.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {isTeamAccount && !isOfficialFootyStatusAccount && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Team Management</h3>
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">Pending Invites</p>
                  <Badge variant="secondary" className="rounded-full">
                    {teamOwnerPlayerInvites.length + coachStaffInvites.length}
                  </Badge>
                </div>

                {teamOwnerPlayerInvites.map((invite) => (
                  <div key={invite.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{invite.player_name}</p>
                        <p className="text-xs text-muted-foreground">Player invite</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 rounded-full">{formatInviteStatus(invite.status)}</Badge>
                    </div>
                    {invite.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleResendMotherTeamInvite(invite, "player")}>
                          Resend
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCancelMotherTeamInvite(invite, "player")}>
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}

                {coachStaffInvites.map((invite) => {
                  const staffProfile = invite.profiles || {};
                  return (
                    <div key={invite.id} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-sm">{staffProfile.full_name || "Coach / Staff"}</p>
                          <p className="text-xs text-muted-foreground">{formatRoleDisplayLabel(invite.staff_role || staffProfile.coaching_role_type || staffProfile.scout_role_title, "Staff")} invite</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-full">{formatInviteStatus(invite.status)}</Badge>
                      </div>
                      {invite.status === "pending" ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleResendMotherTeamInvite(invite, "staff")}>
                            Resend
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleCancelMotherTeamInvite(invite, "staff")}>
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {!teamOwnerPlayerInvites.length && !coachStaffInvites.length ? (
                  <p className="text-sm text-muted-foreground">No outgoing invitations yet.</p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">Pending Requests</p>
                  <Badge variant="secondary" className="rounded-full">
                    {teamOwnerPlayerRequests.length + coachStaffRequests.length}
                  </Badge>
                </div>

                {teamOwnerPlayerRequests.map((request) => (
                  <div key={request.id} className="rounded-lg border border-border p-3 space-y-2">
                    <p className="font-medium text-sm">{request.player_name}</p>
                    <p className="text-xs text-muted-foreground">Player request {request.access_code_last4 ? `- code ending in ${request.access_code_last4}` : ""}</p>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" disabled={reviewingTeamOwnerPlayerRequestId === request.id} onClick={() => handleReviewTeamOwnerPlayerRequest(request.id, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1" disabled={reviewingTeamOwnerPlayerRequestId === request.id} onClick={() => handleReviewTeamOwnerPlayerRequest(request.id, false)}>
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}

                {coachStaffRequests.map((request) => {
                  const staffProfile = request.profiles || {};
                  return (
                    <div key={request.id} className="rounded-lg border border-border p-3 space-y-2">
                      <p className="font-medium text-sm">{staffProfile.full_name || "Coach / Staff"}</p>
                      <p className="text-xs text-muted-foreground">{formatRoleDisplayLabel(request.staff_role || staffProfile.coaching_role_type || staffProfile.scout_role_title, "Staff")} request</p>
                      {request.general_club_role ? <p className="text-xs text-muted-foreground">General Coach / Club Staff</p> : null}
                      {(request.requested_assignments || []).map((assignment: CoachClubTeamAssignment) => (
                        <p key={assignment.club_team_id} className="text-xs text-muted-foreground">
                          {assignment.team_name || "Daughter team"} - {assignment.role}
                        </p>
                      ))}
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" disabled={reviewingCoachStaffRequestId === request.id} onClick={() => handleReviewCoachStaffManagedRequest(request, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" disabled={reviewingCoachStaffRequestId === request.id} onClick={() => handleReviewCoachStaffManagedRequest(request, false)}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {!teamOwnerPlayerRequests.length && !coachStaffRequests.length ? (
                  <p className="text-sm text-muted-foreground">No incoming join requests.</p>
                ) : null}
              </div>
            </div>
          </section>
        )}

        {isTeamAccount && !isOfficialFootyStatusAccount && offeredClubTeams.length === 0 && teamRoster.length > 0 && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Players</h3>
            {teamRoster.length > 0 ? (
              <div className="space-y-4">
                {Object.entries(
                  teamRoster.reduce<Record<string, TeamRosterPlayer[]>>((acc, player) => {
                    const key = player.age_group || "Roster";
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(player);
                    return acc;
                  }, {})
                ).map(([ageGroup, groupedPlayers]) => (
                  <div key={ageGroup} className="space-y-2">
                    <div className="bg-card border border-border rounded-xl px-4 py-3">
                      <p className="font-medium">
                        {formatTeamLeagueLine(
                          teamAccountData?.club_name || profile?.club_name || profile?.full_name || "Team",
                          ageGroup === "Roster" ? null : ageGroup,
                          teamAccountData?.leagues_offered?.[0] || groupedPlayers[0]?.league_name || null
                        )}
                      </p>
                    </div>
                    {groupedPlayers.map((player) => (
                      <div key={player.membership_id} className="w-full bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                        <button
                          onClick={() => navigate(player.player_user_id === user?.id ? "/profile" : `/player/${player.player_profile_id}`)}
                          className="min-w-0 flex flex-1 items-center gap-3 text-left hover:text-primary transition-colors"
                        >
                          <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                            {player.player_avatar_url ? (
                              <img src={player.player_avatar_url} alt={player.player_name} className="w-full h-full object-cover" />
                            ) : (
                              <Users className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{player.player_name}</p>
                            <p className="text-sm text-muted-foreground truncate">{player.player_position || "Player"}</p>
                          </div>
                        </button>
                        <p className="shrink-0 text-2xl font-semibold text-foreground/80">{player.player_jersey_number ? `#${player.player_jersey_number}` : "--"}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => handleRemovePlayerFromClubTeam(player.membership_id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {isTeamAccount && !isOfficialFootyStatusAccount ? (
          <section className="mb-6">
            <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-navy">Daughter Teams</h3>
                <p className="text-sm text-muted-foreground">Add or manage the teams connected to this account.</p>
              </div>
              <Button type="button" size="sm" onClick={() => setDaughterTeamDialogOpen(true)}>
                Add Daughter Team
              </Button>
            </div>
          </section>
        ) : null}

        {isTeamAccount && !isOfficialFootyStatusAccount && offeredClubTeams.length > 0 && (
          <section className="mb-6">
            <h3 className="text-lg font-semibold text-navy mb-3">Teams Offered</h3>
            <div className="space-y-5">
              {offeredClubTeamsByLeague.map(([leagueName, leagueTeams]) => (
                <div key={leagueName} className="space-y-3">
                  <div className="bg-card border border-border rounded-xl px-4 py-2.5">
                    <p className="font-semibold text-sm">{leagueName}</p>
                  </div>
                  {leagueTeams.map((team, index) => {
                    const savedClubTeamAccessCode = team.access_code_value ?? "";
                    const clubTeamAccessCode = team.id ? clubTeamAccessCodes[team.id] ?? savedClubTeamAccessCode : "";
                    const clubTeamAccessCodeChanged = sanitizeClubTeamAccessCode(clubTeamAccessCode) !== savedClubTeamAccessCode;
                    const clubTeamAccessCodeIsValid = sanitizeClubTeamAccessCode(clubTeamAccessCode).length === 5;
                    const teamPendingInvites = team.id ? managedClubTeamInvites.filter((invite) => invite.club_team_id === team.id) : [];
                    const teamPendingJoinRequests = team.id ? managedClubTeamJoinRequests.filter((request) => request.club_team_id === team.id) : [];

                    return (
                    <div
                      key={`${team.id || "offered"}-${index}`}
                      role={team.id ? "button" : undefined}
                      tabIndex={team.id ? 0 : undefined}
                      onClick={team.id ? () => navigate(`/club-team/${team.id}`) : undefined}
                      onKeyDown={
                        team.id
                          ? (e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                navigate(`/club-team/${team.id}`);
                              }
                            }
                          : undefined
                      }
                      className={`bg-card border border-border rounded-2xl p-4 ${team.id ? "cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-navy/10 ring-1 ring-border">
                          {profile?.avatar_url ? (
                            <img src={profile.avatar_url} alt={teamAccountData?.club_name || profile?.club_name || profile?.full_name || "Team"} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-navy text-white">
                              <Shield className="h-6 w-6" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-sm text-foreground">
                                {teamAccountData?.club_name || profile?.club_name || profile?.full_name || "Team"}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {[formatTeamGender(team.gender), team.age_group, team.league_name].filter(Boolean).join(" • ") || (teamAccountData?.team_type === "school" ? "School team" : "Club team")}
                              </p>
                            </div>
                            <Badge variant="outline" className="shrink-0 rounded-full">
                              {team.status === "inactive" ? "Inactive" : "Active"}
                            </Badge>
                          </div>
                          {[team.coach_name ? `Coach ${team.coach_name}` : null, formatTeamGender(team.gender), team.season, team.level]
                            .filter(Boolean)
                            .length ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              {[team.coach_name ? `Coach ${team.coach_name}` : null, formatTeamGender(team.gender), team.season, team.level]
                                .filter(Boolean)
                                .join(" • ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {!normalizeTeamGender(team.gender) && team.id ? (
                        <div
                          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3"
                          onClick={stopTileEvent}
                          onMouseDown={stopTileEvent}
                          onKeyDown={stopTileEvent}
                        >
                          <p className="mb-2 text-sm font-medium text-amber-950">What gender is this team?</p>
                          <Select
                            disabled={categorizingDaughterTeamId === team.id}
                            onValueChange={(value) => handleCategorizeDaughterTeam(team.id!, value as "boy" | "girl")}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose Boys or Girls" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="boy">Boys</SelectItem>
                              <SelectItem value="girl">Girls</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-1.5">
                        <div className="grid grid-cols-5 overflow-hidden rounded-xl bg-background text-center">
                          <div className="px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Wins</p>
                          <p className="text-sm font-semibold text-foreground">{team.wins || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Losses</p>
                          <p className="text-sm font-semibold text-foreground">{team.losses || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ties</p>
                          <p className="text-sm font-semibold text-foreground">{team.draws || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Points</p>
                          <p className="text-sm font-semibold text-foreground">{team.points || 0}</p>
                          </div>
                          <div className="border-l border-border px-2 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Place</p>
                          <p className="text-sm font-semibold text-foreground">{team.position ? `#${team.position}` : "--"}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {team.id ? (
                          <div
                            className="rounded-xl border border-border bg-background p-3 shadow-sm"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <div className="flex items-start gap-3">
                              <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" />
                              <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-foreground">5-digit access code</p>
                                  <Badge variant="secondary" className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                                    {team.id && savedClubTeamAccessCode ? savedClubTeamAccessCode : "No code"}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                  <Input
                                    value={clubTeamAccessCode}
                                    onClick={stopTileEvent}
                                    onMouseDown={stopTileEvent}
                                    onKeyDown={stopTileEvent}
                                    onChange={(e) =>
                                      setClubTeamAccessCodes((prev) => ({
                                        ...prev,
                                        [team.id!]: sanitizeClubTeamAccessCode(e.target.value),
                                      }))
                                    }
                                    inputMode="numeric"
                                    maxLength={5}
                                    placeholder="12345"
                                    className="max-w-[180px] text-center"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveClubTeamAccessCode(team.id!);
                                    }}
                                    onMouseDown={stopTileEvent}
                                    onKeyDown={stopTileEvent}
                                    disabled={savingClubTeamAccessCodeId === team.id || !clubTeamAccessCodeIsValid || !clubTeamAccessCodeChanged}
                                  >
                                    {savingClubTeamAccessCodeId === team.id ? "Saving..." : "Save"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {team.id && (teamPendingJoinRequests.length > 0 || teamPendingInvites.length > 0) ? (
                          <div
                            className="rounded-xl border border-border bg-background p-3 shadow-sm"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-foreground">Requests & Invites</p>
                              <Badge variant="secondary" className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted">
                                {teamPendingJoinRequests.length + teamPendingInvites.length}
                              </Badge>
                            </div>
                            <div className="mt-3 space-y-3">
                              {teamPendingJoinRequests.map((request) => (
                                <div key={request.id} className="rounded-lg border border-border px-3 py-3">
                                  <div className="flex items-start gap-3">
                                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                                      {request.player_avatar_url ? (
                                        <img src={request.player_avatar_url} alt={request.player_name} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <Users className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-foreground">{request.player_name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {[request.player_username ? `@${request.player_username}` : null, formatManagementTimestamp(request.requested_at)]
                                          .filter(Boolean)
                                          .join(" • ") || "Pending request"}
                                      </p>
                                      {request.access_code_last4 ? (
                                        <p className="mt-1 text-[11px] text-muted-foreground">Code ending in {request.access_code_last4}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    <Button
                                      size="sm"
                                      className="flex-1"
                                      disabled={reviewingClubTeamRequestId === request.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReviewManagedClubTeamRequest(request.id, true);
                                      }}
                                    >
                                      Accept
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="flex-1"
                                      disabled={reviewingClubTeamRequestId === request.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReviewManagedClubTeamRequest(request.id, false);
                                      }}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                </div>
                              ))}
                              {teamPendingInvites.map((invite) => (
                                <div key={invite.id} className="rounded-lg border border-border px-3 py-3">
                                  <div className="flex items-start gap-3">
                                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                                      {invite.player_avatar_url ? (
                                        <img src={invite.player_avatar_url} alt={invite.player_name} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <Users className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-foreground">{invite.player_name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {[invite.player_username ? `@${invite.player_username}` : null, formatManagementTimestamp(invite.created_at)]
                                          .filter(Boolean)
                                          .join(" • ") || "Pending invite"}
                                      </p>
                                      <p className="mt-1 text-[11px] text-muted-foreground">Invite sent for this exact team.</p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {team.id ? (
                          <div
                            className="rounded-xl border border-border bg-background p-3 shadow-sm"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <button
                              type="button"
                              disabled={!team.id || team.status !== "active"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveInviteClubTeamId((prev) => (prev === team.id ? null : team.id || null));
                                setClubTeamInviteSearch("");
                                setClubTeamInviteResults([]);
                              }}
                              onMouseDown={stopTileEvent}
                              onKeyDown={stopTileEvent}
                              className={`w-full rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                                !team.id || team.status !== "active"
                                  ? "border-border bg-muted text-muted-foreground opacity-70 cursor-not-allowed"
                                  : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                              }`}
                            >
                              Invite Player
                            </button>
                          </div>
                        ) : null}
                        {!team.id || team.status !== "active" ? (
                          <p className="text-[11px] text-muted-foreground">
                            {team.status !== "active" ? "This team must be active before you can invite players." : "Save this team first to invite players."}
                          </p>
                        ) : null}
                        {team.id && activeInviteClubTeamId === team.id ? (
                          <div
                            className="space-y-2 rounded-lg border border-border bg-background p-3"
                            onClick={stopTileEvent}
                            onMouseDown={stopTileEvent}
                            onKeyDown={stopTileEvent}
                          >
                            <Input
                              value={clubTeamInviteSearch}
                              onClick={stopTileEvent}
                              onMouseDown={stopTileEvent}
                              onKeyDown={stopTileEvent}
                              onChange={(e) => setClubTeamInviteSearch(e.target.value)}
                              placeholder="Search players from Explore"
                            />
                            {clubTeamInviteSearch.trim() ? (
                              clubTeamInviteSearchLoading ? (
                                <p className="text-xs text-muted-foreground">Searching players...</p>
                              ) : clubTeamInviteResults.length > 0 ? (
                                <div className="space-y-2">
                                  {clubTeamInviteResults.map((player) => (
                                    <div
                                      key={player.id}
                                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-9 h-9 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                                          {player.profile_image_url ? (
                                            <img src={player.profile_image_url} alt={player.full_name} className="w-full h-full object-cover" />
                                          ) : (
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium truncate">{player.full_name}</p>
                                          <p className="text-xs text-muted-foreground truncate">
                                            {[
                                              player.username ? `@${player.username}` : null,
                                              player.position,
                                            ]
                                              .filter(Boolean)
                                              .join(" • ") || "Player"}
                                          </p>
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        className="h-8 px-3 shrink-0"
                                        disabled={invitingClubTeamId === team.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleInvitePlayerToClubTeam(team.id, player.id);
                                        }}
                                        onMouseDown={stopTileEvent}
                                        onKeyDown={stopTileEvent}
                                      >
                                        {invitingClubTeamId === team.id ? "Sending..." : "Invite"}
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">No matching players found.</p>
                              )
                            ) : (
                              <p className="text-xs text-muted-foreground">Start typing a player name to invite them to this exact team.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )})}
                </div>
              ))}
            </div>
          </section>
        )}
        {isPlayerAccount ? (
          <ClubHistorySection
            entries={clubHistory}
            canManage
            onAdd={openAddClubHistory}
            onEdit={openEditClubHistory}
            onOpenLinkedTeam={openClubHistoryTeam}
          />
        ) : null}
        </div>
      </div>

      <Dialog open={clubHistoryDialogOpen} onOpenChange={setClubHistoryDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{clubHistoryForm.id ? "Edit Club History" : "Add Club History"}</DialogTitle>
            <DialogDescription>
              Link an official Footy Status team for verified stats, or add a manual club entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  clubHistoryForm.entry_type === "linked" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"
                }`}
                onClick={() => setClubHistoryForm((prev) => ({ ...prev, entry_type: "linked" }))}
              >
                Existing Team
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  clubHistoryForm.entry_type === "manual" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"
                }`}
                onClick={() =>
                  setClubHistoryForm((prev) => ({
                    ...prev,
                    entry_type: "manual",
                    team_id: null,
                    league_id: null,
                    club_name: prev.team_id ? "" : prev.club_name,
                  }))
                }
              >
                Manual Team
              </button>
            </div>

            {clubHistoryForm.entry_type === "linked" ? (
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Select team from Explore</label>
                <Input
                  value={clubHistoryTeamSearchQuery}
                  onChange={(e) => {
                    setClubHistoryTeamSearchQuery(e.target.value);
                    setClubHistoryForm((prev) => ({ ...prev, team_id: null, club_name: e.target.value }));
                  }}
                  placeholder="Search official teams"
                />
                {clubHistoryTeamResults.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-border">
                    {clubHistoryTeamResults.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-b-0 hover:bg-muted"
                        onClick={() => handleSelectClubHistoryTeam(team)}
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
                          {team.logo_url ? (
                            <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Shield className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{team.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[team.league_name, team.age_group].filter(Boolean).join(" - ") || "Official team"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {clubHistoryForm.team_id ? (
                  <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                    Linked to {clubHistoryForm.club_name}. Stats will come from verified match events.
                  </p>
                ) : null}
              </div>
            ) : (
              <div>
                <label className="text-sm text-muted-foreground">Manual team name</label>
                <Input
                  value={clubHistoryForm.club_name}
                  onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, club_name: e.target.value }))}
                  placeholder="Team or academy name"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground">Season or year</label>
                <Input value={clubHistoryForm.season} onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, season: e.target.value }))} placeholder="2025-26" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">League / competition</label>
                <Input value={clubHistoryForm.competition} onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, competition: e.target.value }))} placeholder="MLS Next" />
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Position or role</label>
              <Input value={clubHistoryForm.position_role} onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, position_role: e.target.value }))} placeholder="Forward" />
            </div>

            {clubHistoryForm.entry_type === "manual" ? (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">Manual statistics</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Goals", "manual_goals"],
                    ["Assists", "manual_assists"],
                    ["Appearances", "manual_appearances"],
                    ["Starts", "manual_starts"],
                    ["Clean Sheets", "manual_clean_sheets"],
                    ["Yellow Cards", "manual_yellow_cards"],
                    ["Red Cards", "manual_red_cards"],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <label className="text-xs text-muted-foreground">{label}</label>
                      <Input
                        type="number"
                        min="0"
                        value={clubHistoryForm[key as keyof ClubHistoryFormState] as string}
                        onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Linked-team statistics are read from approved match data and cannot be manually edited here.
              </p>
            )}

            <div>
              <label className="text-sm text-muted-foreground">Optional notes</label>
              <Input value={clubHistoryForm.notes} onChange={(e) => setClubHistoryForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Captain, tournament finalist, guest player..." />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setClubHistoryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveClubHistory} disabled={savingClubHistory}>
              {savingClubHistory ? "Saving..." : "Save Club"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAvatarCropDialog} onOpenChange={(open) => !open && resetAvatarCropState()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crop Profile Photo</DialogTitle>
            <DialogDescription>
              Adjust the photo so it fits neatly inside the profile circle across the app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div
              className="mx-auto relative overflow-hidden rounded-full bg-muted ring-1 ring-border"
              style={{ width: avatarCropPreviewSize, height: avatarCropPreviewSize, cursor: "grab", touchAction: "none" }}
              onPointerDown={handleAvatarCropPointerDown}
              onPointerMove={handleAvatarCropPointerMove}
              onPointerUp={handleAvatarCropPointerUp}
              onPointerCancel={handleAvatarCropPointerUp}
            >
              {avatarCropPreviewUrl && avatarCropMetrics ? (
                <img
                  src={avatarCropPreviewUrl}
                  alt="Avatar crop preview"
                  className="absolute left-0 top-0 max-w-none select-none"
                  style={{
                    width: avatarCropMetrics.drawWidth,
                    height: avatarCropMetrics.drawHeight,
                    maxWidth: "none",
                    left: avatarCropMetrics.drawX,
                    top: avatarCropMetrics.drawY,
                  }}
                />
              ) : null}
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Zoom</span>
                  <span>{avatarCropZoom.toFixed(1)}x</span>
                </div>
                <Slider
                  min={1}
                  max={2.5}
                  step={0.05}
                  value={[avatarCropZoom]}
                  onValueChange={(value) => setAvatarCropZoom(value[0] ?? 1)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Move Left / Right</span>
                  <span>{Math.round(avatarCropOffsetX)}px</span>
                </div>
                <Slider
                  min={-(avatarCropMetrics?.maxOffsetX ?? 140)}
                  max={avatarCropMetrics?.maxOffsetX ?? 140}
                  step={1}
                  value={[avatarCropMetrics?.clampedOffsetX ?? avatarCropOffsetX]}
                  onValueChange={(value) => setClampedAvatarCropOffsets(value[0] ?? 0, avatarCropOffsetY)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Move Up / Down</span>
                  <span>{Math.round(avatarCropOffsetY)}px</span>
                </div>
                <Slider
                  min={-(avatarCropMetrics?.maxOffsetY ?? 140)}
                  max={avatarCropMetrics?.maxOffsetY ?? 140}
                  step={1}
                  value={[avatarCropMetrics?.clampedOffsetY ?? avatarCropOffsetY]}
                  onValueChange={(value) => setClampedAvatarCropOffsets(avatarCropOffsetX, value[0] ?? 0)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetAvatarCropState} disabled={uploadingAvatar}>
              Cancel
            </Button>
            <Button onClick={handleSaveCroppedAvatar} disabled={uploadingAvatar}>
              {uploadingAvatar ? "Saving..." : "Save Photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={daughterTeamDialogOpen}
        onOpenChange={(open) => {
          setDaughterTeamDialogOpen(open);
          if (!open && !creatingDaughterTeam) resetDaughterTeamForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {teamAccountData?.team_type === "school" ? "School" : "Club"} Daughter Team
            </DialogTitle>
            <DialogDescription>
              Enter the team information below. It will be added to this profile and Explore immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {teamAccountData?.team_type === "school" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Team Level *</label>
                <Select
                  value={daughterTeamForm.school_level}
                  onValueChange={(value) =>
                    setDaughterTeamForm((current) => ({ ...current, school_level: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="varsity">High School Varsity</SelectItem>
                    <SelectItem value="junior_varsity">Junior Varsity</SelectItem>
                    <SelectItem value="prep">Prep Team</SelectItem>
                    <SelectItem value="middle_school">Middle School Team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className={`grid gap-3 ${teamAccountData?.team_type === "school" ? "grid-cols-1" : "grid-cols-2"}`}>
              {teamAccountData?.team_type !== "school" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Age Group *</label>
                  <Input
                    value={daughterTeamForm.age_group}
                    onChange={(event) =>
                      setDaughterTeamForm((current) => ({ ...current, age_group: event.target.value }))
                    }
                    placeholder="U14"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {teamAccountData?.team_type === "school" ? "Conference / League Tier / Division *" : "League *"}
                </label>
                <Input
                  value={daughterTeamForm.league_or_conference}
                  onChange={(event) =>
                    setDaughterTeamForm((current) => ({ ...current, league_or_conference: event.target.value }))
                  }
                  placeholder={teamAccountData?.team_type === "school" ? "Big North Conference or Division 1" : "EDP"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">What gender is this team? *</label>
                <Select
                  value={daughterTeamForm.gender}
                  onValueChange={(value) =>
                    setDaughterTeamForm((current) => ({ ...current, gender: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Boys or Girls" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boy">Boys</SelectItem>
                    <SelectItem value="girl">Girls</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Season</label>
                <Input
                  value={daughterTeamForm.season}
                  onChange={(event) =>
                    setDaughterTeamForm((current) => ({ ...current, season: event.target.value }))
                  }
                  placeholder="2026-27"
                />
              </div>
            </div>

            {teamAccountData?.team_type !== "school" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Competition Level</label>
                <Input
                  value={daughterTeamForm.level}
                  onChange={(event) =>
                    setDaughterTeamForm((current) => ({ ...current, level: event.target.value }))
                  }
                  placeholder="Premier, Academy, or Regional"
                />
              </div>
            ) : null}

          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDaughterTeamDialogOpen(false)}
              disabled={creatingDaughterTeam}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateDaughterTeam} disabled={creatingDaughterTeam}>
              {creatingDaughterTeam ? "Creating..." : "Create Daughter Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPostConfirmation} onOpenChange={setShowPostConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Clip?</DialogTitle>
            <DialogDescription>
              Your clip will be uploaded and sent to Footy Status for approval before it appears in Next Up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Title:</span> {clipTitle}</p>
            {clipCaption && <p><span className="font-medium">Caption:</span> {clipCaption}</p>}
            {selectedVideoFile && <p><span className="font-medium">Video:</span> {selectedVideoFile.name}</p>}
            {selectedVideoDuration !== null && <p><span className="font-medium">Edited length:</span> {editedClipDurationSeconds} seconds</p>}
            <p><span className="font-medium">Trim:</span> {Math.round(clipTrimStart)}s to {Math.round(clipTrimEnd)}s</p>
            <p><span className="font-medium">Volume:</span> {Math.round(clipPlaybackVolume * 100)}%</p>
            <p><span className="font-medium">Sizing:</span> {clipFitMode === "cover" ? "Fill frame" : "Fit whole clip"}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPostConfirmation(false)} disabled={uploadingClip}>
              Cancel
            </Button>
            <Button onClick={handleConfirmPostClip} disabled={uploadingClip}>
              {uploadingClip ? "Posting..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!clipPendingDelete} onOpenChange={(open) => !open && setClipPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Clip?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this clip? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            {clipPendingDelete && <p className="font-medium">{clipPendingDelete.title}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClipPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!clipPendingDelete) return;
                await handleDeleteClip(clipPendingDelete.id);
                setClipPendingDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProfilePage;
