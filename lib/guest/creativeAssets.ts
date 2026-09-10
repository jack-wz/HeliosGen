import { readdir, realpath, stat, mkdir } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { MEDIA_DIR } from "./paths";
import * as guestDb from "./db";

export const ASSET_CATEGORIES = ["Characters", "Props", "Environments", "Styles", "Scenes"] as const;
export type AssetCategory = typeof ASSET_CATEGORIES[number];

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function normalizeCategory(value?: string | null): AssetCategory | null {
  if (!value) return null;
  return ASSET_CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase()) ?? null;
}

function categoryFromPath(path: string): AssetCategory | null {
  const parts = path.split("/");
  return parts[0] === "assets" ? normalizeCategory(parts[1]) : null;
}

function encodeMediaUrl(path: string): string {
  return `/generated/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function ensureAssetDirectories(): Promise<void> {
  await Promise.all(ASSET_CATEGORIES.map((category) => mkdir(resolve(MEDIA_DIR, "assets", category), { recursive: true })));
}

export async function resolveMediaPath(input: { relativePath?: string; url?: string }): Promise<{
  relativePath: string;
  actualPath: string;
  url: string;
  mimeType: string;
}> {
  let rel = input.relativePath?.trim();
  if (!rel && input.url?.startsWith("/generated/")) {
    try { rel = decodeURIComponent(input.url.slice("/generated/".length)); }
    catch { throw new Error("Invalid generated media URL"); }
  }
  if (!rel || rel.includes("\0") || rel.includes("\\") || isAbsolute(rel) || rel.split("/").includes("..")) {
    throw new Error("relativePath must point to a file inside the shared media directory");
  }
  const root = await realpath(MEDIA_DIR);
  const candidate = resolve(root, rel);
  if (!inside(root, candidate)) throw new Error("Asset path escapes the shared media directory");
  const actualPath = await realpath(candidate);
  if (!inside(root, actualPath)) throw new Error("Asset symlink escapes the shared media directory");
  const fileStat = await stat(actualPath);
  if (!fileStat.isFile()) throw new Error("Asset path is not a file");
  const relativePath = relative(root, actualPath).split(sep).join("/");
  const mimeType = MIME_BY_EXT[extname(actualPath).toLowerCase()];
  if (!mimeType) throw new Error(`Unsupported asset type: ${extname(actualPath) || "no extension"}`);
  return { relativePath, actualPath, url: encodeMediaUrl(relativePath), mimeType };
}

export async function importCreativeAsset(input: {
  relativePath?: string;
  url?: string;
  name?: string;
  category?: string | null;
  source?: string;
  description?: string | null;
  prompt?: string | null;
  model?: string | null;
  seekGuid?: string | null;
}): Promise<guestDb.CreativeAsset> {
  const media = await resolveMediaPath(input);
  const generation = guestDb.findGenerationByMediaUrl(media.url);
  const category = normalizeCategory(input.category) ?? categoryFromPath(media.relativePath);
  const source = input.source ?? (generation ? "generation" : media.relativePath.startsWith("assets/") ? "seek" : "upload");
  const asset = guestDb.upsertCreativeAsset({
    user_id: GUEST_USER_ID,
    relative_path: media.relativePath,
    url: media.url,
    name: input.name?.trim() || basename(media.relativePath),
    category,
    mime_type: media.mimeType,
    source,
    description: input.description ?? null,
    prompt: input.prompt ?? generation?.prompt ?? null,
    model: input.model ?? generation?.model ?? null,
    seek_guid: input.seekGuid ?? null,
  });
  guestDb.ensureUploadForAsset(asset.url, asset.mime_type, source === "seek" ? "seek_import" : "asset_import");
  return asset;
}

async function walk(root: string, rel = ""): Promise<string[]> {
  const entries = await readdir(resolve(root, rel), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await walk(root, child));
    else if (entry.isFile() && MIME_BY_EXT[extname(entry.name).toLowerCase()]) found.push(child);
  }
  return found;
}

export async function reconcileCreativeAssets(): Promise<guestDb.CreativeAsset[]> {
  await ensureAssetDirectories();
  const root = await realpath(MEDIA_DIR);
  const paths = await walk(root);
  const results: guestDb.CreativeAsset[] = [];
  for (const relativePath of paths) results.push(await importCreativeAsset({ relativePath }));
  guestDb.deleteCreativeAssetsMissingFromDisk(GUEST_USER_ID, new Set(paths));
  return results;
}
