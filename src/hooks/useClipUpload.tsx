import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useToast } from "./use-toast";

interface UploadClipData {
  title: string;
  description?: string;
  videoFile: File;
  thumbnailFile?: File;
}

export const useClipUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { user } = useAuth();
  const { toast } = useToast();

  const uploadClip = async (data: UploadClipData) => {
    if (!user) {
      toast({ title: "Error", description: "You must be logged in to upload clips.", variant: "destructive" });
      return null;
    }

    setUploading(true);
    setProgress(0);

    try {
      const fileExt = data.videoFile.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      setProgress(20);

      const { error: uploadError } = await supabase.storage
        .from('clips')
        .upload(fileName, data.videoFile, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      setProgress(60);

      const { data: urlData } = supabase.storage.from('clips').getPublicUrl(fileName);
      const videoUrl = urlData.publicUrl;

      let thumbnailUrl: string | null = null;
      if (data.thumbnailFile) {
        const thumbExt = data.thumbnailFile.name.split('.').pop();
        const thumbName = `${user.id}/${Date.now()}_thumb.${thumbExt}`;
        const { error: thumbError } = await supabase.storage
          .from('clips')
          .upload(thumbName, data.thumbnailFile, { cacheControl: '3600', upsert: false });
        if (!thumbError) {
          const { data: thumbUrlData } = supabase.storage.from('clips').getPublicUrl(thumbName);
          thumbnailUrl = thumbUrlData.publicUrl;
        }
      }

      setProgress(80);

      const { data: clip, error: insertError } = await supabase
        .from('clips')
        .insert({
          title: data.title,
          description: data.description || null,
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          player_id: null,
          user_id: user.id,
          review_status: "pending_review",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setProgress(100);
      toast({ title: "Clip submitted for review", description: "Footy Status will review it before it goes live." });
      return clip;
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      return null;
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return { uploadClip, uploading, progress };
};
