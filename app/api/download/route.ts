/**
 * GET /api/download?url=<encoded-url>&filename=<name>
 *
 * Server-side proxy that fetches the asset and returns it with
 * Content-Disposition: attachment so the browser saves it to disk.
 * Only allowed origins are proxied.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { join, normalize, extname } from "path";
import { Readable } from "stream";
import { MEDIA_DIR } from "@/lib/guest/paths";

const ALLOWED_ORIGINS = [
  "https://cdn.kie.ai",
  "https://api.kie.ai",
  "https://replicate.delivery",
  "https://pbxt.replicate.delivery",
].map((o) => o.replace(/\/$/, ""));

function isAllowed(url: string): boolean {
  if (url.startsWith("/generated/")) return true; // local disk, served same-origin
  return ALLOWED_ORIGINS.some((origin) => url.startsWith(origin));
}

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Serve stored local media straight from MEDIA_DIR (no same-origin self-fetch,
 *  which fails behind reverse proxies where the public origin isn't reachable
 *  from inside the container). */
function localDownload(url: string, filename: string): NextResponse | null {
  if (!url.startsWith("/generated/")) return null;
  const rel = normalize(decodeURIComponent(url.slice("/generated/".length).split("?")[0]));
  if (rel.startsWith("..") || rel.includes("\0")) return new NextResponse("Forbidden", { status: 403 });
  const filePath = join(MEDIA_DIR, rel);
  if (!filePath.startsWith(normalize(MEDIA_DIR)) || !existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const { size } = statSync(filePath);
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "download";

  if (!url) return new NextResponse("Missing url", { status: 400 });
  if (!isAllowed(url)) return new NextResponse("Forbidden", { status: 403 });

  const local = localDownload(url, filename);
  if (local) return local;

  let fetchUrl = url;

  let upstream: Response;
  try {
    upstream = await fetch(fetchUrl);
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse("Upstream error", { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
