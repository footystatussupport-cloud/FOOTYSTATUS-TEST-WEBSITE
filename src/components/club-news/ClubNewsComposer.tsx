import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CLUB_NEWS_MAX_IMAGES,
  CLUB_NEWS_MAX_MEDIA_ITEMS,
  CLUB_NEWS_MAX_VIDEOS,
  ClubNewsMediaItem,
  ClubNewsPostDetail,
  createClubNewsPost,
  deleteClubNewsMedia,
  getCachedViewerCoordinates,
  updateClubCoordinates,
  updateClubNewsCoverMedia,
  updateClubNewsPost,
  uploadClubNewsMediaFiles,
} from "@/lib/clubNews";

interface ClubNewsComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  teamId: string;
  clubName: string;
  userId: string;
  city?: string | null;
  initialPost?: ClubNewsPostDetail | null;
  onSaved: () => void;
}

const ClubNewsComposer = ({
  open,
  onOpenChange,
  clubId,
  teamId,
  clubName,
  userId,
  city,
  initialPost,
  onSaved,
}: ClubNewsComposerProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [existingMedia, setExistingMedia] = useState<ClubNewsMediaItem[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [coverSelection, setCoverSelection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initialPost?.title || "");
    setBody(initialPost?.body || "");
    setExistingMedia(initialPost?.media || []);
    setRemovedMediaIds([]);
    setNewFiles([]);
    setCoverSelection(initialPost?.media?.[0]?.id ? `existing:${initialPost.media[0].id}` : null);
  }, [open, initialPost]);

  const visibleExistingMedia = useMemo(
    () => existingMedia.filter((item) => !removedMediaIds.includes(item.id)),
    [existingMedia, removedMediaIds]
  );

  const totalMediaCount = visibleExistingMedia.length + newFiles.length;
  const totalImageCount =
    visibleExistingMedia.filter((item) => item.media_type === "image").length +
    newFiles.filter((file) => file.type.startsWith("image/")).length;
  const totalVideoCount =
    visibleExistingMedia.filter((item) => item.media_type === "video").length +
    newFiles.filter((file) => file.type.startsWith("video/")).length;

  const handlePickFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) {
      event.target.value = "";
      return;
    }

    const nextTotal = totalMediaCount + selectedFiles.length;
    const nextImages = totalImageCount + selectedFiles.filter((file) => file.type.startsWith("image/")).length;
    const nextVideos = totalVideoCount + selectedFiles.filter((file) => file.type.startsWith("video/")).length;

    if (nextTotal > CLUB_NEWS_MAX_MEDIA_ITEMS) {
      toast({
        title: "Too many files",
        description: `You can attach up to ${CLUB_NEWS_MAX_MEDIA_ITEMS} media items per post.`,
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (nextVideos > CLUB_NEWS_MAX_VIDEOS) {
      toast({
        title: "Too many videos",
        description: `Each club news post can include up to ${CLUB_NEWS_MAX_VIDEOS} videos.`,
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    if (nextImages > CLUB_NEWS_MAX_IMAGES) {
      toast({
        title: "Too many photos",
        description: `Each club news post can include up to ${CLUB_NEWS_MAX_IMAGES} photos.`,
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    const startingIndex = newFiles.length;
    setNewFiles((prev) => [...prev, ...selectedFiles].slice(0, CLUB_NEWS_MAX_MEDIA_ITEMS));
    if (!coverSelection && selectedFiles[0]) {
      setCoverSelection(`new:${startingIndex}`);
    }
    event.target.value = "";
  };

  const handleRemoveExistingMedia = (mediaId: string) => {
    setRemovedMediaIds((prev) => [...prev, mediaId]);
    if (coverSelection === `existing:${mediaId}`) {
      setCoverSelection(null);
    }
  };

  const handleRemoveNewFile = (index: number) => {
    setNewFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
    if (coverSelection === `new:${index}`) {
      setCoverSelection(null);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title and body required", description: "Please add both before posting.", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const coordinates = await getCachedViewerCoordinates();
      let postId = initialPost?.id || null;

      if (postId) {
        await updateClubNewsPost(postId, {
          title,
          body,
          city: city || null,
          latitude: coordinates?.latitude ?? null,
          longitude: coordinates?.longitude ?? null,
        });
      } else {
        postId = await createClubNewsPost({
          clubId,
          teamId,
          clubName,
          title,
          body,
          userId,
          city: city || null,
          latitude: coordinates?.latitude ?? null,
          longitude: coordinates?.longitude ?? null,
        });
      }

      if (coordinates) {
        await updateClubCoordinates(clubId, coordinates);
      }

      if (removedMediaIds.length) {
        await deleteClubNewsMedia(removedMediaIds);
      }

      const uploadedMedia = newFiles.length ? await uploadClubNewsMediaFiles(postId, userId, newFiles) : [];
      const remainingMedia = [...visibleExistingMedia, ...uploadedMedia];

      let coverMediaId =
        remainingMedia[0]?.id || null;

      if (coverSelection?.startsWith("existing:")) {
        coverMediaId = coverSelection.replace("existing:", "");
      } else if (coverSelection?.startsWith("new:")) {
        const selectedIndex = Number(coverSelection.replace("new:", ""));
        coverMediaId = uploadedMedia[selectedIndex]?.id || remainingMedia[0]?.id || null;
      }

      await updateClubNewsCoverMedia(postId, coverMediaId);

      toast({ title: initialPost ? "Post updated" : "Post published" });
      onOpenChange(false);
      onSaved();
    } catch (error: any) {
      toast({ title: "Could not save post", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initialPost ? "Edit News/Update" : "Post News/Update"}</DialogTitle>
          <DialogDescription>
            Only Team / Club accounts can publish updates. Keep it concise and useful for your players and families.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your update..." className="min-h-[140px]" />

          <div className="rounded-xl border border-border p-3 space-y-3">
            <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Media</p>
            <span className="text-xs text-muted-foreground">
                {totalMediaCount}/{CLUB_NEWS_MAX_MEDIA_ITEMS} items
              </span>
            </div>
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handlePickFiles}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2"
              onClick={() => mediaInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Add Photos / Video
            </Button>
            <p className="text-xs text-muted-foreground">
              Up to {CLUB_NEWS_MAX_IMAGES} photos and {CLUB_NEWS_MAX_VIDEOS} videos per post.
            </p>

            {visibleExistingMedia.length > 0 || newFiles.length > 0 ? (
              <div className="space-y-2">
                {visibleExistingMedia.map((media) => (
                  <div key={media.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <button type="button" className="min-w-0 text-left flex-1" onClick={() => setCoverSelection(`existing:${media.id}`)}>
                      <p className="text-sm font-medium">{media.media_type === "video" ? "Video" : "Image"}</p>
                      <p className="text-xs text-muted-foreground">{coverSelection === `existing:${media.id}` ? "Cover image selected" : "Tap to use as cover"}</p>
                    </button>
                    <Button size="sm" variant="outline" onClick={() => handleRemoveExistingMedia(media.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {newFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <button type="button" className="min-w-0 text-left flex-1" onClick={() => setCoverSelection(`new:${index}`)}>
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {coverSelection === `new:${index}` ? "Cover image selected" : file.type.startsWith("video/") ? "Video" : "Image"}
                      </p>
                    </button>
                    <Button size="sm" variant="outline" onClick={() => handleRemoveNewFile(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                <Upload className="h-4 w-4 mx-auto mb-1" />
                Add up to {CLUB_NEWS_MAX_IMAGES} photos and {CLUB_NEWS_MAX_VIDEOS} videos for this post.
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : initialPost ? "Save Changes" : "Publish"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClubNewsComposer;
