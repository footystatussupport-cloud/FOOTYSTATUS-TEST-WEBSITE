import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared profile-photo editor used everywhere a circular avatar can be changed
 * (player and every other account type, and league logos for the admin).
 *
 * It owns the whole experience so every entry point is identical:
 *   - a hidden `image/*` file input (Photos / Files / Camera on mobile)
 *   - a circular crop dialog with zoom + drag + move sliders
 *   - a canvas-based circular crop that preserves quality (512px, no stretch)
 *   - an upload/loading state
 *
 * The caller only supplies `onSave(croppedFile)` which uploads to storage and
 * persists the resulting URL, returning `true` on success. Callers may render a
 * trigger via the `children` render-prop, and/or open the picker imperatively
 * through the forwarded ref.
 */

const PREVIEW_SIZE = 288;
const OUTPUT_SIZE = 512;

export interface ProfilePhotoCropUploaderHandle {
  open: () => void;
}

interface ProfilePhotoCropUploaderProps {
  /** Uploads the cropped file and persists its URL. Return true on success. */
  onSave: (croppedFile: File) => Promise<boolean>;
  title?: string;
  description?: string;
  /** Optional inline trigger. Receives the picker opener and uploading state. */
  children?: (openPicker: () => void, uploading: boolean) => ReactNode;
}

const clampCropOffset = (value: number, maxOffset = 0) =>
  Math.max(-maxOffset, Math.min(maxOffset, value));

const ProfilePhotoCropUploader = forwardRef<ProfilePhotoCropUploaderHandle, ProfilePhotoCropUploaderProps>(
  (
    {
      onSave,
      title = "Crop Profile Photo",
      description = "Adjust the photo so it fits neatly inside the profile circle across the app.",
      children,
    },
    ref
  ) => {
    const { toast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<
      { pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null
    >(null);

    const [showDialog, setShowDialog] = useState(false);
    const [sourceFile, setSourceFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [uploading, setUploading] = useState(false);

    const metrics = useMemo(() => {
      if (!imageSize) return null;
      const baseScale = Math.max(PREVIEW_SIZE / imageSize.width, PREVIEW_SIZE / imageSize.height);
      const drawWidth = imageSize.width * baseScale * zoom;
      const drawHeight = imageSize.height * baseScale * zoom;
      const maxOffsetX = Math.max(0, (drawWidth - PREVIEW_SIZE) / 2);
      const maxOffsetY = Math.max(0, (drawHeight - PREVIEW_SIZE) / 2);
      const clampedOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX));
      const clampedOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY));
      return {
        drawWidth,
        drawHeight,
        maxOffsetX,
        maxOffsetY,
        clampedOffsetX,
        clampedOffsetY,
        drawX: (PREVIEW_SIZE - drawWidth) / 2 + clampedOffsetX,
        drawY: (PREVIEW_SIZE - drawHeight) / 2 + clampedOffsetY,
      };
    }, [imageSize, offsetX, offsetY, zoom]);

    const setClampedOffsets = (nextX: number, nextY: number) => {
      setOffsetX(clampCropOffset(nextX, metrics?.maxOffsetX ?? 0));
      setOffsetY(clampCropOffset(nextY, metrics?.maxOffsetY ?? 0));
    };

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
      if (!metrics) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: metrics.clampedOffsetX,
        offsetY: metrics.clampedOffsetY,
      };
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      const dragState = dragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId || !metrics) return;
      setClampedOffsets(
        dragState.offsetX + (event.clientX - dragState.startX),
        dragState.offsetY + (event.clientY - dragState.startY)
      );
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = null;
      }
    };

    // Keep the stored offsets clamped whenever zoom/image bounds change.
    useEffect(() => {
      if (!metrics) return;
      setOffsetX(metrics.clampedOffsetX);
      setOffsetY(metrics.clampedOffsetY);
    }, [metrics]);

    const resetState = () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setShowDialog(false);
      setSourceFile(null);
      setPreviewUrl(null);
      setImageSize(null);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      if (inputRef.current) inputRef.current.value = "";
    };

    const openPicker = () => inputRef.current?.click();

    useImperativeHandle(ref, () => ({ open: openPicker }), []);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast({ title: "Upload failed", description: "Please choose an image file.", variant: "destructive" });
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const nextPreviewUrl = URL.createObjectURL(file);
      try {
        const nextImageSize = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.width, height: image.height });
          image.onerror = () => reject(new Error("We couldn't load that image. Please try another one."));
          image.src = nextPreviewUrl;
        });

        setSourceFile(file);
        setPreviewUrl(nextPreviewUrl);
        setImageSize(nextImageSize);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        setShowDialog(true);
      } catch (error: any) {
        URL.revokeObjectURL(nextPreviewUrl);
        toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        if (inputRef.current) inputRef.current.value = "";
      }
    };

    const buildCroppedBlob = async () => {
      if (!previewUrl) {
        throw new Error("No image selected.");
      }

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("We couldn't load that image. Please try another one."));
        nextImage.src = previewUrl;
      });

      const canvas = document.createElement("canvas");
      const size = OUTPUT_SIZE;
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("We couldn't prepare that image for upload.");
      }

      const baseScale = Math.max(size / image.width, size / image.height);
      const drawWidth = image.width * baseScale * zoom;
      const drawHeight = image.height * baseScale * zoom;
      const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
      const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
      const previewToCanvasScale = size / PREVIEW_SIZE;
      const scaledOffsetX = offsetX * previewToCanvasScale;
      const scaledOffsetY = offsetY * previewToCanvasScale;
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
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("We couldn't finish cropping that image."));
              return;
            }
            resolve(blob);
          },
          "image/jpeg",
          0.92
        );
      });
    };

    const handleSave = async () => {
      try {
        const croppedBlob = await buildCroppedBlob();
        const originalExtension = sourceFile?.name.split(".").pop()?.toLowerCase();
        const fileExt = originalExtension === "png" ? "png" : "jpg";
        const croppedFile = new File([croppedBlob], `profile-photo.${fileExt}`, {
          type: croppedBlob.type || `image/${fileExt}`,
        });
        setUploading(true);
        const succeeded = await onSave(croppedFile);
        if (succeeded) {
          resetState();
        }
      } catch (error: any) {
        toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      } finally {
        setUploading(false);
      }
    };

    return (
      <>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {children?.(openPicker, uploading)}

        <Dialog open={showDialog} onOpenChange={(open) => !open && !uploading && resetState()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div
                className="mx-auto relative overflow-hidden rounded-full bg-muted ring-1 ring-border"
                style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, cursor: "grab", touchAction: "none" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {previewUrl && metrics ? (
                  <img
                    src={previewUrl}
                    alt="Profile photo crop preview"
                    className="absolute left-0 top-0 max-w-none select-none"
                    style={{
                      width: metrics.drawWidth,
                      height: metrics.drawHeight,
                      maxWidth: "none",
                      left: metrics.drawX,
                      top: metrics.drawY,
                    }}
                  />
                ) : null}
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Zoom</span>
                    <span>{zoom.toFixed(1)}x</span>
                  </div>
                  <Slider
                    min={1}
                    max={2.5}
                    step={0.05}
                    value={[zoom]}
                    onValueChange={(value) => setZoom(value[0] ?? 1)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Move Left / Right</span>
                    <span>{Math.round(offsetX)}px</span>
                  </div>
                  <Slider
                    min={-(metrics?.maxOffsetX ?? 140)}
                    max={metrics?.maxOffsetX ?? 140}
                    step={1}
                    value={[metrics?.clampedOffsetX ?? offsetX]}
                    onValueChange={(value) => setClampedOffsets(value[0] ?? 0, offsetY)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Move Up / Down</span>
                    <span>{Math.round(offsetY)}px</span>
                  </div>
                  <Slider
                    min={-(metrics?.maxOffsetY ?? 140)}
                    max={metrics?.maxOffsetY ?? 140}
                    step={1}
                    value={[metrics?.clampedOffsetY ?? offsetY]}
                    onValueChange={(value) => setClampedOffsets(offsetX, value[0] ?? 0)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetState} disabled={uploading}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={uploading}>
                {uploading ? "Saving..." : "Save Photo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

ProfilePhotoCropUploader.displayName = "ProfilePhotoCropUploader";

export default ProfilePhotoCropUploader;
