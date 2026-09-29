import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { readLocalMedia } from "@/lib/guest/readLocalMedia";
import { uploadBuffer } from "@/lib/storage";

const execFileAsync = promisify(execFile);

/** Extract the first frame of a video and store it as a small JPEG poster.
 *  Returns the poster URL, or undefined if the extraction fails. */
export async function generateVideoPoster(videoUrl: string): Promise<string | undefined> {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  try {
    const localVideo = await readLocalMedia(videoUrl);
    let videoBuffer: Buffer;
    if (localVideo) {
      videoBuffer = localVideo.buffer;
    } else {
      const res = await fetch(videoUrl);
      if (!res.ok) return undefined;
      videoBuffer = Buffer.from(await res.arrayBuffer());
    }

    const tmpDir  = await mkdtemp(join(tmpdir(), "poster-"));
    inputPath  = join(tmpDir, "input.mp4");
    outputPath = join(tmpDir, "poster.jpg");
    await writeFile(inputPath, videoBuffer);

    // Extract a frame at 0s, resize to 320px wide (sufficient for thumbnails), quality 75
    await execFileAsync("ffmpeg", [
      "-ss", "0", "-i", inputPath,
      "-frames:v", "1",
      "-vf", "scale=320:-2",
      "-q:v", "5",
      "-y", outputPath,
    ]);

    const frameBuffer = await readFile(outputPath);
    const cdnUrl = await uploadBuffer(frameBuffer, "image/jpeg", "posters");
    return cdnUrl;
  } catch {
    return undefined;
  } finally {
    await Promise.all([
      inputPath  ? unlink(inputPath).catch(() => {})  : Promise.resolve(),
      outputPath ? unlink(outputPath).catch(() => {}) : Promise.resolve(),
    ]);
  }
}
