/**
 * GET /api/media-poster?url=/generated/<path>.mp4[&w=480]
 *
 * Returns a small JPEG still for a locally stored video so grids can show a
 * preview without downloading the video itself. Posters are extracted once
 * with ffmpeg and cached under DATA_DIR (outside the shared media folder, so
 * Seek and the asset index never see them).
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, readFile, rename, stat } from "fs/promises";
import { join } from "path";
import { DATA_DIR } from "@/lib/guest/paths";
import { resolveMediaPath } from "@/lib/guest/creativeAssets";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CACHE_DIR = join(DATA_DIR, "cache", "posters");
const ALLOWED_WIDTHS = [240, 480, 720];
const inflight = new Map<string, Promise<Buffer>>();

async function extract(actualPath: string, width: number, target: string): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp.jpg`;
  const run = (seek: string) => execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", seek, "-i", actualPath,
    "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "5",
    "-y", tmp,
  ], { timeout: 20_000 });
  try { await run("0.5"); } catch { await run("0"); }
  await rename(tmp, target);
  return readFile(target);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const requested = Number(req.nextUrl.searchParams.get("w") ?? 480);
  const width = ALLOWED_WIDTHS.find((w) => w >= requested) ?? ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1];
  if (!url.startsWith("/generated/")) return NextResponse.json({ error: "url must be a /generated/ video" }, { status: 400 });

  let media: Awaited<ReturnType<typeof resolveMediaPath>>;
  try { media = await resolveMediaPath({ url }); }
  catch { return NextResponse.json({ error: "Video not found" }, { status: 404 }); }
  if (!media.mimeType.startsWith("video/")) return NextResponse.json({ error: "Not a video" }, { status: 400 });

  const { mtimeMs, size } = await stat(media.actualPath);
  const key = createHash("sha1").update(`${media.relativePath}:${size}:${mtimeMs}:${width}`).digest("hex");
  const target = join(CACHE_DIR, `${key}.jpg`);

  let body: Buffer;
  try {
    body = await readFile(target);
  } catch {
    let job = inflight.get(key);
    if (!job) {
      job = extract(media.actualPath, width, target).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    try { body = await job; }
    catch { return NextResponse.json({ error: "Poster extraction failed" }, { status: 500 }); }
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
