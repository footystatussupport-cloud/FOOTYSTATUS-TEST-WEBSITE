import { useEffect, useState } from "react";
import { ArrowLeft, Expand } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import ClubNewsComposer from "@/components/club-news/ClubNewsComposer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { ClubNewsPostDetail, deleteClubNewsPost, fetchClubNewsPost, fetchManagedClubContext, formatClubNewsDate } from "@/lib/clubNews";
import { useToast } from "@/hooks/use-toast";

const ClubNewsDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const [post, setPost] = useState<ClubNewsPostDetail | null>(null);
  const [managedContext, setManagedContext] = useState<{ clubId: string | null; teamId: string | null; clubName: string | null; city: string | null } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);

  const canManage = !!(
    user &&
    profile?.account_role === "team_club" &&
    post &&
    managedContext?.clubId === post.club_id
  );

  const loadPost = async () => {
    if (!id) return;
    const loadedPost = await fetchClubNewsPost(id);
    setPost(loadedPost);
  };

  useEffect(() => {
    loadPost();
  }, [id]);

  useEffect(() => {
    setSelectedMediaIndex(0);
    setImageViewerOpen(false);
  }, [post?.id]);

  useEffect(() => {
    const loadManagedContext = async () => {
      if (!user) {
        setManagedContext(null);
        return;
      }
      const context = await fetchManagedClubContext(user.id);
      setManagedContext(context);
    };
    loadManagedContext();
  }, [user?.id]);

  const handleDelete = async () => {
    if (!post) return;
    try {
      await deleteClubNewsPost(post.id);
      toast({ title: "Post deleted" });
      navigate(`/team/${post.team_id}/news`);
    } catch (error: any) {
      toast({ title: "Could not delete post", description: error.message, variant: "destructive" });
    }
  };

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
          <Header />
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading post...</div>
        </div>
      </div>
    );
  }

  const selectedMedia = post.media[selectedMediaIndex] || null;

  return (
    <div className="min-h-screen bg-background">
      <div className="min-h-screen w-full bg-background max-w-md mx-auto border-x border-border overflow-x-hidden">
        <Header />
        <div className="px-4 py-6">
          <button onClick={() => navigate(`/team/${post.team_id}/news`)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="mb-4">
            <button
              type="button"
              onClick={() => navigate(`/team/${post.team_id}`)}
              className="inline-flex items-center gap-2 text-left"
            >
              <div className="h-9 w-9 overflow-hidden rounded-full bg-muted">
                {post.club_profile_image_url ? (
                  <img src={post.club_profile_image_url} alt={post.club_name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{post.club_name}</p>
            </button>
            <h1 className="text-2xl font-bold mt-1">{post.title}</h1>
            <p className="text-sm text-muted-foreground mt-2">{formatClubNewsDate(post.created_at)}</p>
          </div>

          {canManage ? (
            <div className="flex gap-2 mb-4">
              <Button size="sm" variant="outline" onClick={() => setComposerOpen(true)}>Edit</Button>
              <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>Delete</Button>
            </div>
          ) : null}

          {selectedMedia ? (
            <div className="mb-5 space-y-3">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {selectedMedia.media_type === "video" ? (
                  <video
                    key={selectedMedia.id}
                    src={selectedMedia.media_url}
                    controls
                    autoPlay
                    muted
                    playsInline
                    className="h-[260px] w-full bg-black object-contain"
                  />
                ) : (
                  <button
                    type="button"
                    className="relative block h-[260px] w-full overflow-hidden bg-muted"
                    onClick={() => setImageViewerOpen(true)}
                  >
                    <img src={selectedMedia.media_url} alt={post.title} className="h-full w-full object-cover" />
                    <div className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white">
                      <Expand className="h-4 w-4" />
                    </div>
                  </button>
                )}
              </div>

              {post.media.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {post.media.map((media, index) => (
                    <button
                      key={media.id}
                      type="button"
                      onClick={() => setSelectedMediaIndex(index)}
                      className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-xl border transition-colors ${
                        selectedMediaIndex === index ? "border-primary ring-1 ring-primary/40" : "border-border"
                      }`}
                    >
                      {media.media_type === "video" ? (
                        <video
                          src={media.media_url}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <img src={media.thumbnail_url || media.media_url} alt={`${post.title} ${index + 1}`} className="h-full w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{post.body}</p>
          </div>

          <ClubNewsComposer
            open={composerOpen}
            onOpenChange={setComposerOpen}
            clubId={post.club_id}
            teamId={post.team_id}
            clubName={post.club_name}
            userId={user?.id || ""}
            city={managedContext?.city || null}
            initialPost={post}
            onSaved={async () => {
              setComposerOpen(false);
              await loadPost();
            }}
          />

          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately remove it from the homepage feed, this detail view, and the club archive.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog open={imageViewerOpen} onOpenChange={setImageViewerOpen}>
            <DialogContent className="max-w-3xl border-border bg-background p-3">
              {selectedMedia?.media_type === "image" ? (
                <div className="max-h-[78vh] overflow-auto rounded-xl bg-black/95 p-3">
                  <img
                    src={selectedMedia.media_url}
                    alt={post.title}
                    className="mx-auto max-w-full object-contain"
                  />
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
};

export default ClubNewsDetailPage;
