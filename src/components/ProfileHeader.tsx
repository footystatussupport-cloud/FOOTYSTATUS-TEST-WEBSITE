import { ReactNode } from "react";
import { User } from "lucide-react";

interface ProfileHeaderProps {
  /** Avatar / logo image url. Falls back to a generic icon when absent. */
  avatarUrl?: string | null;
  /** Large bold display name. */
  displayName: string;
  /** Account type / role shown in bold (e.g. "Player", "Scout", "Club Team"). */
  roleLabel: string;
  /** Username shown in grey immediately to the right of the role. */
  username?: string | null;
  /** Optional badge rendered inline right after the @username (e.g. verified referee check). */
  usernameBadge?: ReactNode;
  /** Bio shown directly beneath the header in normal black text. */
  bio?: string | null;
  /** Optional badge rendered inline next to the display name (verified / pro). */
  nameBadge?: ReactNode;
  /** Optional content rendered below the role/username line (e.g. pro renewal, verification chip). */
  below?: ReactNode;
  /** Optional overlay on the avatar, e.g. a change-photo button on the owner's profile. */
  avatarOverlay?: ReactNode;
  /** Optional control anchored to the top-right of the header (e.g. admin controls). */
  topRight?: ReactNode;
  /** Optional custom fallback icon when there is no avatar. */
  fallbackIcon?: ReactNode;
}

/**
 * The single universal profile header used by every account type across Footy
 * Status. Layout (top to bottom): profile picture, bold display name, then the
 * bold role with the grey @username on the same line, then the bio. Only the
 * data changes per account type — the structure and styling never do.
 */
const ProfileHeader = ({
  avatarUrl,
  displayName,
  roleLabel,
  username,
  usernameBadge,
  bio,
  nameBadge,
  below,
  avatarOverlay,
  topRight,
  fallbackIcon,
}: ProfileHeaderProps) => {
  return (
    <div className="relative mb-8 flex flex-col items-center">
      {topRight ? <div className="absolute right-0 top-0 z-10">{topRight}</div> : null}

      <div className="relative mb-4">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-foreground">
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            fallbackIcon || <User className="h-14 w-14 text-background" />
          )}
        </div>
        {avatarOverlay}
      </div>

      <div className="flex max-w-full items-center justify-center gap-2">
        <h1 className="max-w-[16rem] break-words text-center text-2xl font-bold text-foreground">{displayName}</h1>
        {nameBadge}
      </div>

      <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
        <span className="font-bold text-foreground">{roleLabel}</span>
        {username ? <span className="break-all text-muted-foreground">@{username}</span> : null}
        {usernameBadge}
      </div>

      {below}

      {bio ? (
        <p className="mx-auto mt-2 w-full max-w-xs break-words whitespace-pre-wrap text-center text-sm font-normal text-foreground">
          {bio}
        </p>
      ) : null}
    </div>
  );
};

export default ProfileHeader;
