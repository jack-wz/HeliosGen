/**
 * Image thumbnails, generated once and cached under DATA_DIR.
 *
 * Why this exists: gallery originals are 7-9MB PNGs, and the box that serves
 * them is an Intel N150 with four low-power cores. Decoding one of those and
 * resizing it takes sharp 0.9-4.7 seconds, and a cold gallery asks for 26 of
 * them at once — twelve of which are 48px icons that still pay the full decode.
 *
 * The fix is to do that work at write time rather than at read time, and to
 * cache the result outside the shared media folder so Seek and the asset index
 * never see the thumbnails as assets. Mirrors lib/videoPoster.ts and the
 * media-poster route, which already do this for video posters.
 *
 * Importable from three places, which is the point: the serving route, the
 * upload/generation paths that prewarm, and the backfill script — the last of
 * which runs as a plain Node process with no server involved.
 */
import { mkdir, readFile, rename, stat, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import { DATA_DIR, MEDIA_DIR as MEDIA_ROOT_FOR_KEYS } from "@/lib/guest/paths";
import { resolveMediaPath } from "@/lib/guest/creativeAssets";
import { THUMB_WIDTHS, snapThumbWidth } from "@/lib/thumbWidths";

export { THUMB_WIDTHS, snapThumbWidth };

const CACHE_DIR = join(DATA_DIR, "cache", "thumbs");

/**
 * WebP quality for thumbnails.
 *
 * Measured against a lossless reference on a hard-edged 2048px test image: at 85
 * the mean channel difference is 0.91/255 and 0.82% of channels move by more
 * than 8 — invisible at the sizes these are displayed. Lossy WebP is lossy at
 * any quality (95 still differs on 0.8% of channels), so the choice is how much
 * fidelity to buy, and 85 sits at the flat part of the curve: 3.1KB where
 * lossless costs 6.6KB on that image, and far more on real photographs.
 *
 * The lightbox shows the original, so this only ever affects grid tiles.
 */
const THUMB_QUALITY = 85;

/** In-flight work, so N concurrent requests for the same thumb cost one decode. */
const inflight = new Map<string, Promise<Buffer>>();

export type Thumb = { buffer: Buffer; contentType: string; width: number };

function cacheKey(relativePath: string, size: number, mtimeMs: number, width: number): string {
  return createHash("sha1").update(`${relativePath}:${size}:${mtimeMs}:${width}`).digest("hex");
}

async function render(actualPath: string, width: number, target: string): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp.webp`;
  try {
    await sharp(actualPath)
      // `withoutEnlargement` matters for the 48px icons: asking for 48 from a
      // 1024px original must not upscale a small source either.
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY, effort: 4 })
      .toFile(tmp);
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return readFile(target);
}

/**
 * Return a cached thumbnail, generating it on first use.
 *
 * Returns null when the URL is not local media or the source cannot be decoded
 * — callers fall back to the original image rather than showing nothing.
 */
export async function getImageThumb(url: string, requestedWidth: number): Promise<Thumb | null> {
  const width = snapThumbWidth(requestedWidth);
  let media: Awaited<ReturnType<typeof resolveMediaPath>>;
  try {
    media = await resolveMediaPath({ url });
  } catch {
    return null;
  }
  if (!media.mimeType.startsWith("image/")) return null;

  const { mtimeMs, size } = await stat(media.actualPath);
  const key = cacheKey(media.relativePath, size, mtimeMs, width);
  const target = join(CACHE_DIR, `${key}.webp`);

  try {
    return { buffer: await readFile(target), contentType: "image/webp", width };
  } catch {
    // fall through to generation
  }

  let job = inflight.get(key);
  if (!job) {
    job = render(media.actualPath, width, target).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    return { buffer: await job, contentType: "image/webp", width };
  } catch {
    return null;
  }
}

/** Whether a thumbnail is already cached — no decode, just a stat. */
export async function hasImageThumb(url: string, requestedWidth: number): Promise<boolean> {
  try {
    const media = await resolveMediaPath({ url });
    const { mtimeMs, size } = await stat(media.actualPath);
    const key = cacheKey(media.relativePath, size, mtimeMs, snapThumbWidth(requestedWidth));
    await stat(join(CACHE_DIR, `${key}.webp`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the thumbnails a gallery tile will need, ahead of the first read.
 * Called after a file lands so the cold cost is paid once, by the writer, and
 * not by whoever opens the gallery next.
 *
 * Decodes the source **once** and clones the pipeline per width. Generating
 * nine widths by calling getImageThumb in a loop would decode the same 9MB PNG
 * nine times, which is most of the cost this module exists to avoid.
 *
 * Best-effort by design: a failure here must never fail the upload that
 * triggered it. Returns how many widths were produced.
 */
export async function prewarmImageThumb(url: string, widths?: number[]): Promise<number> {
  const ladder = [...new Set((widths?.length ? widths : [...THUMB_WIDTHS]).map(snapThumbWidth))].sort((a, b) => a - b);
  let media: Awaited<ReturnType<typeof resolveMediaPath>>;
  try {
    media = await resolveMediaPath({ url });
  } catch {
    return 0;
  }
  if (!media.mimeType.startsWith("image/")) return 0;

  const { mtimeMs, size } = await stat(media.actualPath);
  await mkdir(CACHE_DIR, { recursive: true });

  // Skip widths that are already cached (re-uploads dedupe, so this is common).
  const todo: Array<{ width: number; target: string }> = [];
  for (const width of ladder) {
    const target = join(CACHE_DIR, `${cacheKey(media.relativePath, size, mtimeMs, width)}.webp`);
    try { await stat(target); } catch { todo.push({ width, target }); }
  }
  if (todo.length === 0) return 0;

  let done = 0;
  try {
    const base = sharp(media.actualPath);
    // Cheap first pass to learn the intrinsic size, so withoutEnlargement can
    // be applied per width without upscaling a small source.
    const meta = await base.metadata();
    const sourceWidth = meta.width ?? 0;
    for (const { width, target } of todo) {
      const effective = sourceWidth && width > sourceWidth ? sourceWidth : width;
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp.webp`;
      try {
        await base.clone().resize({ width: effective, withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY, effort: 4 }).toFile(tmp);
        await rename(tmp, target);
        done += 1;
      } catch {
        await unlink(tmp).catch(() => {});
      }
    }
  } catch {
    // unreadable source — the route will simply fall back to the original
  }
  return done;
}

/** Write a thumbnail buffer straight to the cache (used by the backfill script). */
export async function cacheThumbFromBuffer(url: string, width: number, buffer: Buffer): Promise<void> {
  const media = await resolveMediaPath({ url });
  const { mtimeMs, size } = await stat(media.actualPath);
  const key = cacheKey(media.relativePath, size, mtimeMs, snapThumbWidth(width));
  await mkdir(CACHE_DIR, { recursive: true });
  const target = join(CACHE_DIR, `${key}.webp`);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp.webp`;
  await writeFile(tmp, buffer);
  await rename(tmp, target);
}

/**
 * Every cache filename that is currently valid — one per (file, width) pair for
 * the files as they are on disk right now.
 *
 * Used by the backfill's --prune: after a pass that rewrites source bytes (the
 * lossless WebP migration), the cache holds entries keyed to the old size and
 * mtime that can never be requested again. Deleting by age alone would also drop
 * entries for files that did *not* change, so the valid set is enumerated rather
 * than guessed.
 */
export async function validThumbCacheKeys(
  relativePaths: string[],
  widths: readonly number[] = THUMB_WIDTHS,
): Promise<Set<string>> {
  const valid = new Set<string>();
  for (const rel of relativePaths) {
    const actual = join(MEDIA_ROOT_FOR_KEYS, rel);
    let size: number, mtimeMs: number;
    try {
      ({ size, mtimeMs } = await stat(actual));
    } catch {
      continue;
    }
    for (const width of widths) valid.add(`${cacheKey(rel, size, mtimeMs, snapThumbWidth(width))}.webp`);
  }
  return valid;
}

export const THUMB_CACHE_DIR = CACHE_DIR;
