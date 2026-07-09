import { Mail, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LinkedParentTile as LinkedParentTileData } from "@/lib/parentLinks";

interface LinkedParentTileProps {
  /** The linked parent account rendered as an interactive profile tile. */
  tile: LinkedParentTileData;
  /** Opens the parent's profile when the tile body is clicked. */
  onOpen: (parentUserId: string) => void;
  /** When provided and the request is pending, renders Approve / Deny controls. */
  onReview?: (linkId: string, approve: boolean) => void;
  /** Disables the review controls while a review is in flight. */
  reviewing?: boolean;
}

/**
 * The linked parent account displayed as a profile tile on a player's profile,
 * matching every other linked-account tile in Footy Status: profile picture,
 * name, account type, @username, and (when available) a contact button. Tapping
 * the tile body opens the parent's profile; contact links and review controls
 * stop propagation so they act independently.
 */
const LinkedParentTile = ({ tile, onOpen, onReview, reviewing }: LinkedParentTileProps) => {
  const relationshipLabel = tile.relationship_to_player
    ? tile.relationship_to_player.replace(/_/g, " ")
    : null;
  const showReview = !!onReview && tile.can_review && tile.status === "pending";

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => onOpen(tile.parent_user_id)}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground">
            {tile.avatar_url ? (
              <img src={tile.avatar_url} alt={tile.full_name} className="h-full w-full object-cover" />
            ) : (
              <User className="h-6 w-6 text-background" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium hover:text-primary">{tile.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Parent</span>
              {tile.username ? <span> - @{tile.username}</span> : null}
            </p>
            <p className="truncate text-xs capitalize text-muted-foreground">
              {[relationshipLabel, tile.status].filter(Boolean).join(" - ")}
            </p>
          </div>
        </button>
        {showReview ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => onReview?.(tile.link_id, true)} disabled={reviewing}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => onReview?.(tile.link_id, false)} disabled={reviewing}>
              Deny
            </Button>
          </div>
        ) : null}
      </div>

      {(tile.contact_phone || tile.contact_email) && tile.status === "approved" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tile.contact_phone ? (
            <a
              href={`tel:${tile.contact_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-navy hover:border-accent"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          ) : null}
          {tile.contact_email ? (
            <a
              href={`mailto:${tile.contact_email}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-navy hover:border-accent"
            >
              <Mail className="h-3.5 w-3.5" />
              Email
            </a>
          ) : null}
        </div>
      ) : null}

      {tile.status === "approved" && (tile.contact_phone || tile.contact_email || tile.emergency_contact) ? (
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {tile.contact_phone ? <p>Phone: {tile.contact_phone}</p> : null}
          {tile.contact_email ? <p>Email: {tile.contact_email}</p> : null}
          {tile.emergency_contact ? <p>Emergency: {tile.emergency_contact}</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export default LinkedParentTile;
