/**
 * Client-safe URL helpers for lightweight media previews.
 *
 * Grids and pickers should never load original files: images go through the
 * Next image optimizer, videos get a cached JPEG still from /api/media-poster.
 */

const NEXT_IMG_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];

/** Resized image URL for a stored image. Blob/data URLs are returned unchanged. */
export function previewImageUrl(url: string, cssWidth = 320): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("/_next/")) return url;
  const target = cssWidth * 2;
  const w = NEXT_IMG_WIDTHS.find((s) => s >= target) ?? NEXT_IMG_WIDTHS[NEXT_IMG_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;
}

/** JPEG still for a stored video; undefined for blob/remote URLs we cannot extract. */
export function videoPosterUrl(url: string, existingPoster?: string | null, cssWidth = 240): string | undefined {
  if (existingPoster) return existingPoster;
  if (!url || !url.startsWith("/generated/")) return undefined;
  const w = cssWidth * 2 <= 240 ? 240 : cssWidth * 2 <= 480 ? 480 : 720;
  return `/api/media-poster?url=${encodeURIComponent(url)}&w=${w}`;
}
