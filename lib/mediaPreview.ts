/**
 * Client-safe URL helpers for lightweight media previews.
 *
 * Grids and pickers should never load original files: images come from
 * /api/image-thumb (pre-generated at write time), videos get a cached JPEG
 * still from /api/media-poster.
 */
import { snapThumbWidth } from "@/lib/thumbWidths";

/** Resized image URL for a stored image. Blob/data/remote URLs are returned unchanged. */
export function previewImageUrl(url: string, cssWidth = 320): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("/_next/")) return url;
  // Remote URLs have no local file to thumbnail, and the optimizer would answer
  // 400 "url parameter is not allowed" for any host not in remotePatterns — so
  // pass them through untouched rather than silently breaking them.
  if (/^https?:\/\//i.test(url)) return url;
  return `/api/image-thumb?url=${encodeURIComponent(url)}&w=${snapThumbWidth(cssWidth * 2)}`;
}

/** JPEG still for a stored video; undefined for blob/remote URLs we cannot extract. */
export function videoPosterUrl(url: string, existingPoster?: string | null, cssWidth = 240): string | undefined {
  if (existingPoster) return existingPoster;
  if (!url || !url.startsWith("/generated/")) return undefined;
  const w = cssWidth * 2 <= 240 ? 240 : cssWidth * 2 <= 480 ? 480 : 720;
  return `/api/media-poster?url=${encodeURIComponent(url)}&w=${w}`;
}
