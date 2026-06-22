import { useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ClubNewsPostDetail, ClubNewsPostSummary, deleteClubNewsPost, fetchClubNewsForTeam, fetchClubNewsPost } from "@/lib/clubNews";
import ClubNewsCardCompact from "./ClubNewsCardCompact";
import ClubNewsComposer from "./ClubNewsComposer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface ClubNewsSectionProps {
  teamId: string;
  clubId?: string | null;
  clubName: string;
  canManage: boolean;
  userId?: string | null;
  city?: string | null;
}

const ClubNewsSection = ({ teamId, clubId, clubName, canManage, userId, city }: ClubNewsSectionProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [posts, setPosts] = useState<ClubNewsPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ClubNewsPostDetail | null>(null);
  const [deletePostId, setDeletePostId] = useState<string | null>(null);

  const loadPosts = async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const rows = await fetchClubNewsForTeam(teamId, 3);
      setPosts(rows);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, [teamId]);

  const handleOpenEdit = async (postId: string) => {
    try {
      const post = await fetchClubNewsPost(postId);
      setEditingPost(post);
      setComposerOpen(true);
    } catch (error: any) {
      toast({ title: "Could not open post", description: error.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deletePostId) return;
    try {
      await deleteClubNewsPost(deletePostId);
      toast({ title: "Post deleted" });
      setDeletePostId(null);
      loadPosts();
    } catch (error: any) {
      toast({ title: "Could not delete post", description: error.message, variant: "destructive" });
    }
  };

  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <button type="button" className="text-left" onClick={() => navigate(`/team/${teamId}/news`)}>
          <h3 className="text-base font-semibold text-navy">{`${clubName}'s News/Updates`}</h3>
        </button>
        <div className="flex items-center gap-2">
          {canManage && clubId && userId ? (
            <Button size="sm" className="h-8 gap-1 px-3" onClick={() => { setEditingPost(null); setComposerOpen(true); }}>
              <Plus className="h-4 w-4" /> Post
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8 px-3" onClick={() => navigate(`/team/${teamId}/news`)}>
            View All
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">Loading news...</div>
      ) : posts.length > 0 ? (
        <div className="space-y-1.5">
          {posts.map((post) => (
            <div key={post.id} className="space-y-1.5">
              <ClubNewsCardCompact
                post={post}
                onClick={() => navigate(`/club-news/${post.id}`)}
                onOpenClubProfile={() => navigate(`/team/${post.team_id}`)}
                showClubMeta={false}
              />
              {canManage ? (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => handleOpenEdit(post.id)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-3" onClick={() => setDeletePostId(post.id)}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card px-4 py-5 text-center">
          <FileText className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{canManage ? "No news posted yet. Share your first update." : "No news or updates yet."}</p>
        </div>
      )}

      {clubId && userId ? (
        <ClubNewsComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          clubId={clubId}
          teamId={teamId}
          clubName={clubName}
          userId={userId}
          city={city}
          initialPost={editingPost}
          onSaved={() => {
            setComposerOpen(false);
            setEditingPost(null);
            loadPosts();
          }}
        />
      ) : null}

      <AlertDialog open={!!deletePostId} onOpenChange={(open) => !open && setDeletePostId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove it from the homepage feed, the club profile, and the archive right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default ClubNewsSection;
