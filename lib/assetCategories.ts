/**
 * The asset category list, in a module both sides can import.
 *
 * Split out of lib/guest/creativeAssets.ts, which pulls in `node:fs` and so
 * cannot be reached from a client component. The gallery-side picker needs the
 * same five names for its filter, and duplicating them would be two sources of
 * truth for something the database also stores.
 */

/** Canonical display names — these are also the folder names under assets/. */
export const ASSET_CATEGORIES = ["Characters", "Props", "Environments", "Styles", "Scenes"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Stable IDs decoupled from display labels and disk paths. */
export const CATEGORY_IDS = ["character", "prop", "environment", "visual_style", "scene"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Map legacy English display names to stable IDs. */
export const CATEGORY_LABEL_TO_ID: Record<string, CategoryId> = {
  characters: "character",
  props: "prop",
  environments: "environment",
  styles: "visual_style",
  scenes: "scene",
};

/** Case-insensitive lookup used when accepting a category from a caller. */
export function normalizeCategory(value?: string | null): AssetCategory | null {
  if (!value) return null;
  return ASSET_CATEGORIES.find((c) => c.toLowerCase() === value.toLowerCase()) ?? null;
}
