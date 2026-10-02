import { snapThumbWidth } from "@/lib/thumbWidths";

export interface GalleryItem {
  id: string;
  url: string;
  imageUrls?: string[];
  mediaType: "image" | "video";
  prompt?: string;
  posterUrl?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  azure_resolution?: string;
  source: "generation" | "upload";
  created_at: string;
  referenceImageUrls?: string[];
}

/** Downsized thumbnail URL for displaying `url` at roughly `w` px (2x for retina).
 *
 * Served by /api/image-thumb from thumbnails pre-generated at write time, rather
 * than by /_next/image decoding the original on every cold request. Originals
 * here are 7-9MB PNGs on a four-core box, which is what made grids crawl. */
export function thumbSrc(url: string, w = 96): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("/_next/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `/api/image-thumb?url=${encodeURIComponent(url)}&w=${snapThumbWidth(w * 2)}`;
}

/** Local-only app has no real auth; call sites still gate on a truthy token. */
export async function getToken(): Promise<string | undefined> {
  return "guest";
}

const _galleryCacheMem = new Map<string, { items: GalleryItem[]; hasMore: boolean }>();

export const galleryCache = {
  get(tab: string): { items: GalleryItem[]; hasMore: boolean } | undefined {
    const mem = _galleryCacheMem.get(tab);
    if (mem) return mem;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`nf-gallery-cache-${tab}`) : null;
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { items: GalleryItem[]; hasMore: boolean };
      _galleryCacheMem.set(tab, parsed);
      return parsed;
    } catch { return undefined; }
  },
  set(tab: string, data: { items: GalleryItem[]; hasMore: boolean }) {
    _galleryCacheMem.set(tab, data);
    try {
      if (typeof window !== "undefined") localStorage.setItem(`nf-gallery-cache-${tab}`, JSON.stringify(data));
    } catch { }
  },
};
