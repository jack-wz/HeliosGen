/**
 * Shrink stored images without changing a single pixel.
 *
 * Measured on real assets from this library (four PNGs, 6.6-17.8MB): lossless
 * WebP comes out 54-58% smaller and decodes byte-for-byte identically to the
 * source. Re-compressing the PNG instead only buys ~4%. So lossless WebP is the
 * whole win here, and "lossless" is not taken on faith — every file is decoded
 * before and after and compared, and a file that does not match is left alone.
 *
 * The bytes are replaced **at the same path**. That is deliberate: workflow node
 * data holds `/generated/images/<id>.png` as free-form JSON, the DB holds the
 * same strings, and the asset index does too — renaming to `.webp` would break
 * references that cannot all be rewritten. The cost is that the extension stops
 * describing the contents, which is why app/generated/[...path]/route.ts now
 * sniffs the leading bytes instead of trusting the extension.
 */
import { open, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import sharp from "sharp";

/** Below this, the saving is not worth rewriting a file for. */
const MIN_SAVING = 0.08;

export type CompressResult = {
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
  /** Why nothing happened, when nothing happened. */
  reason?: "already-webp" | "unsupported" | "no-saving" | "not-pixel-identical" | "failed";
  error?: string;
};

/** Formats we can re-encode losslessly. GIF is excluded: animated GIFs would
 *  need animation-aware handling and they are not the bulk of the library. */
const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/bmp", "image/tiff"]);

async function detectType(path: string): Promise<string> {
  const meta = await sharp(path).metadata();
  return `image/${meta.format ?? ""}`;
}

/** Decode both and compare pixel data. This is the guarantee, not a heuristic. */
async function pixelsMatch(a: string, b: Buffer): Promise<boolean> {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return false;
  if (ra.info.channels !== rb.info.channels) return false;
  return ra.data.equals(rb.data);
}

/**
 * Re-encode one image in place when that is both safe and worthwhile.
 *
 * Writes to a temp file in the same directory, verifies, then renames — so a
 * failure at any point leaves the original untouched.
 */
export async function compressAsset(actualPath: string): Promise<CompressResult> {
  const { size: beforeBytes } = await stat(actualPath);

  let type: string;
  try {
    type = await detectType(actualPath);
  } catch (err) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "failed", error: String(err) };
  }

  if (type === "image/webp") return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "already-webp" };
  if (!COMPRESSIBLE.has(type)) return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "unsupported" };

  let webp: Buffer;
  try {
    webp = await sharp(actualPath).webp({ lossless: true, effort: 5 }).toBuffer();
  } catch (err) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "failed", error: String(err) };
  }

  if (webp.length >= beforeBytes * (1 - MIN_SAVING)) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "no-saving" };
  }

  let identical: boolean;
  try {
    identical = await pixelsMatch(actualPath, webp);
  } catch (err) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "failed", error: String(err) };
  }
  if (!identical) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "not-pixel-identical" };
  }

  const tmp = `${actualPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, webp);
    await rename(tmp, actualPath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    return { changed: false, beforeBytes, afterBytes: beforeBytes, reason: "failed", error: String(err) };
  }

  return { changed: true, beforeBytes, afterBytes: webp.length };
}

/** Whether a file is already in the compressed form — a cheap pre-check. */
export async function isAlreadyCompressed(actualPath: string): Promise<boolean> {
  const fd = await open(actualPath, "r").catch(() => null);
  if (!fd) return false;
  try {
    const buf = Buffer.alloc(12);
    await fd.read(buf, 0, 12, 0);
    return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  } finally {
    await fd.close();
  }
}

/** Copy a file to `dest` before it is rewritten, so the change is reversible. */
export async function backupFile(actualPath: string, dest: string): Promise<void> {
  const buf = await readFile(actualPath);
  await writeFile(dest, buf);
}
