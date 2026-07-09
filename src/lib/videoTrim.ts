import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// Single-threaded ffmpeg core: produces standard H.264/AAC MP4 that plays on
// every platform (including iOS Safari) and, unlike the multi-threaded core,
// does NOT require SharedArrayBuffer / COOP+COEP cross-origin isolation. That
// means no hosting header changes are needed on Netlify/Vercel.
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

const getFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpegInstance) return ffmpegInstance;
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      // Load the core as blob URLs so the cross-origin CDN assets run locally.
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }
  return loadPromise;
};

const getExtension = (fileName: string) => {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  return /^[a-z0-9]{2,4}$/.test(ext) ? ext : "mp4";
};

export interface TrimVideoResult {
  file: File;
  durationSeconds: number;
}

/**
 * Cuts the selected segment out of the original recording entirely in the
 * browser and returns a small standard MP4 containing only that segment. Only
 * this trimmed file is ever uploaded, so unused footage in the original
 * recording never counts toward the storage size limit.
 *
 * A fast stream copy is attempted first (no quality loss, near-instant); if the
 * source codec cannot be copied into MP4 it falls back to a re-encode.
 */
export const trimVideoToMp4 = async (
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress?: (ratio: number) => void
): Promise<TrimVideoResult> => {
  const start = Math.max(0, startSeconds);
  const end = Math.max(start + 0.1, endSeconds);
  const duration = end - start;

  const ffmpeg = await getFFmpeg();

  const inputName = `input.${getExtension(file.name)}`;
  const outputName = "output.mp4";

  const handleProgress = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
  };
  ffmpeg.on("progress", handleProgress);

  const cleanup = async () => {
    ffmpeg.off("progress", handleProgress);
    try { await ffmpeg.deleteFile(inputName); } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* ignore */ }
  };

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // Fast path: copy the streams (no re-encode) for the selected time range.
    const copyArgs = [
      "-ss", start.toFixed(3),
      "-to", end.toFixed(3),
      "-i", inputName,
      "-c", "copy",
      "-movflags", "+faststart",
      "-y", outputName,
    ];

    let succeeded = false;
    try {
      const code = await ffmpeg.exec(copyArgs);
      succeeded = code === 0;
    } catch {
      succeeded = false;
    }

    // Fallback: re-encode to H.264/AAC MP4 when the source cannot be stream-copied.
    if (!succeeded) {
      try { await ffmpeg.deleteFile(outputName); } catch { /* ignore */ }
      const encodeArgs = [
        "-ss", start.toFixed(3),
        "-to", end.toFixed(3),
        "-i", inputName,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", outputName,
      ];
      const code = await ffmpeg.exec(encodeArgs);
      if (code !== 0) {
        throw new Error("Video could not be trimmed.");
      }
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (!bytes.length) {
      throw new Error("Trimmed video was empty.");
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "clip";
    const trimmedFile = new File([bytes], `${baseName}.mp4`, { type: "video/mp4" });

    return { file: trimmedFile, durationSeconds: duration };
  } finally {
    await cleanup();
  }
};
