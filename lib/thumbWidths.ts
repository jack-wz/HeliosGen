/**
 * The thumbnail width ladder, shared by the client and the server.
 *
 * Kept separate from lib/imageThumb.ts because that module imports sharp and so
 * cannot be pulled into a client bundle. Both sides snapping to the same ladder
 * is what makes a prewarm actually cover what the browser asks for.
 */

/** Retina-aware: the gallery snaps a display width to 2x, then up to a rung. */
export const THUMB_WIDTHS = [48, 96, 128, 256, 384, 640, 828, 1080, 1200] as const;

export function snapThumbWidth(requested: number): number {
  const w = Number.isFinite(requested) && requested > 0 ? requested : THUMB_WIDTHS[0];
  return THUMB_WIDTHS.find((s) => s >= w) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}
