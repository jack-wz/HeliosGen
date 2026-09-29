import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

/** Strip EXIF/IPTC/XMP (images) or metadata tags (video) from a buffer before storage. */
export async function stripMetadata(buffer: Buffer, contentType: string): Promise<Buffer> {
  if (contentType.startsWith("image/")) {
    return sharp(buffer).toBuffer();
  }
  if (contentType.startsWith("video/")) {
    const extension = contentType.includes("webm") ? "webm" : "mp4";
    const tmpDir = await mkdtemp(join(tmpdir(), "strip-meta-"));
    const inputPath  = join(tmpDir, `input.${extension}`);
    const outputPath = join(tmpDir, `output.${extension}`);
    try {
      await writeFile(inputPath, buffer);
      await execFileAsync("ffmpeg", [
        "-i", inputPath,
        "-map_metadata", "-1",
        "-c", "copy",
        "-y", outputPath,
      ]);
      return await readFile(outputPath);
    } finally {
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  }
  return buffer;
}

/** Read pixel dimensions from an image buffer and return the aspect ratio
 *  as a "w:h" string (e.g. "1024:768") for gallery layout without probing. */
export async function getImageAspectRatio(buffer: Buffer): Promise<string | undefined> {
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.width && meta.height && meta.width > 0 && meta.height > 0) {
      return `${meta.width}:${meta.height}`;
    }
  } catch {
    // Not an image, or sharp cannot read it — leave undefined.
  }
  return undefined;
}
