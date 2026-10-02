/**
 * Video poster frames, extracted with ffmpeg and cached under DATA_DIR.
 *
 * Extracted from app/api/media-poster/route.ts so the same code can serve the
 * HTTP endpoint and feed a frame to the vision model — a video cannot be
 * classified without one, and reimplementing the extraction for that would mean
 * two caches and two sets of ffmpeg flags to keep in step.
 *
 * Cached outside the media folder, so Seek and the asset index never see a
 * poster as an asset.
 */
import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, readFile, rename, stat } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { DATA_DIR } from "@/lib/guest/paths";
import { resolveMediaPath } from "@/lib/guest/creativeAssets";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(DATA_DIR, "cache", "posters");

/** Widths the endpoint serves. Snapped up, so the cache stays finite. */
export const POSTER_WIDTHS = [240, 480, 720] as const;

export function snapPosterWidth(requested: number): number {
  const w = Number.isFinite(requested) && requested > 0 ? requested : POSTER_WIDTHS[0];
  return POSTER_WIDTHS.find((s) => s >= w) ?? POSTER_WIDTHS[POSTER_WIDTHS.length - 1];
}

const inflight = new Map<string, Promise<Buffer>>();

async function extract(actualPath: string, width: number, target: string): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp.jpg`;
  const run = (seek: string) =>
    execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-ss", seek, "-i", actualPath,
      "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "5",
      "-y", tmp,
    ], { timeout: 20_000 });
  // Seek a little way in first: frame 0 of a generated clip is often a fade-in
  // from black, which tells a vision model nothing.
  try { await run("0.5"); } catch { await run("0"); }
  await rename(tmp, target);
  return readFile(target);
}

export type Poster = { buffer: Buffer; contentType: string; width: number };

/** Cached poster frame for a stored video, extracted on first use. */
export async function getVideoPoster(url: string, requestedWidth: number): Promise<Poster | null> {
  const width = snapPosterWidth(requestedWidth);
  let media: Awaited<ReturnType<typeof resolveMediaPath>>;
  try {
    media = await resolveMediaPath({ url });
  } catch {
    return null;
  }
  if (!media.mimeType.startsWith("video/")) return null;

  const { mtimeMs, size } = await stat(media.actualPath);
  const key = createHash("sha1").update(`${media.relativePath}:${size}:${mtimeMs}:${width}`).digest("hex");
  const target = join(CACHE_DIR, `${key}.jpg`);

  try {
    return { buffer: await readFile(target), contentType: "image/jpeg", width };
  } catch {
    // fall through to extraction
  }

  let job = inflight.get(key);
  if (!job) {
    job = extract(media.actualPath, width, target).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    return { buffer: await job, contentType: "image/jpeg", width };
  } catch {
    return null;
  }
}

/** Resolve a stored video URL to its on-disk path and mime type, or null. */
export async function resolveVideo(url: string) {
  try {
    const media = await resolveMediaPath({ url });
    return media.mimeType.startsWith("video/") ? media : null;
  } catch {
    return null;
  }
}

export const POSTER_CACHE_DIR = CACHE_DIR;
