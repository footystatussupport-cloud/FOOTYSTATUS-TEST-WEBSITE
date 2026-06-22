import { Image as ImageIcon, PlayCircle } from "lucide-react";
import { ClubNewsPostSummary, formatClubNewsDate, getClubNewsExcerpt } from "@/lib/clubNews";

interface ClubNewsCardFeedProps {
  post: ClubNewsPostSummary;
  onClick: () => void;
  onOpenClubProfile?: () => void;
}

const ClubNewsCardFeed = ({ post, onClick, onOpenClubProfile }: ClubNewsCardFeedProps) => (
  <div className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-navy hover:bg-muted">
    <div className="mb-2 flex items-center justify-between gap-2">
      <button type="button" onClick={onOpenClubProfile} className="inline-flex min-w-0 items-center gap-2 text-left">
        <div className="h-8 w-8 overflow-hidden rounded-full bg-muted shrink-0">
          {post.club_profile_image_url ? (
            <img src={post.club_profile_image_url} alt={post.club_name} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <span className="truncate text-xs font-semibold text-foreground">{post.club_name}</span>
      </button>
      {post.media_count > 1 ? (
        <span className="text-[10px] font-medium text-muted-foreground">{post.media_count} media</span>
      ) : null}
    </div>
    <button type="button" onClick={onClick} className="w-full text-left">
      <div className="flex gap-3">
        {post.cover_media_url ? (
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
            {post.cover_media_type === "video" ? (
              <video src={post.cover_media_url} className="h-full w-full object-cover" muted />
            ) : (
              <img src={post.cover_media_url} alt={post.title} className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              {post.cover_media_type === "video" ? (
                <PlayCircle className="h-5 w-5 text-white" />
              ) : (
                <ImageIcon className="h-5 w-5 text-white" />
              )}
            </div>
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-foreground">{post.title}</p>
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{getClubNewsExcerpt(post.body, 120)}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">{formatClubNewsDate(post.created_at)}</p>
        </div>
      </div>
    </button>
  </div>
);

export default ClubNewsCardFeed;
