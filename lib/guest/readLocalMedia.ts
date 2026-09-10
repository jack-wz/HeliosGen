import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { MEDIA_DIR } from "./paths";

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Read stored media without sending a root-relative URL through server fetch. */
export async function readLocalMedia(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  if (!url.startsWith("/generated/")) return null;

  let mediaPath: string;
  try {
    mediaPath = decodeURIComponent(url.slice("/generated/".length).split(/[?#]/)[0]);
  } catch {
    throw new Error("Invalid local media path");
  }
  if (!mediaPath || mediaPath.includes("\0") || mediaPath.includes("\\") ||
      isAbsolute(mediaPath) || mediaPath.split("/").includes("..")) {
    throw new Error("Invalid local media path");
  }

  const root = await realpath(MEDIA_DIR);
  const candidate = resolve(root, mediaPath);
  if (!isInside(root, candidate)) throw new Error("Invalid local media path");

  // Resolve symlinks before reading, so a path inside MEDIA_DIR cannot escape it.
  const actual = await realpath(candidate);
  if (!isInside(root, actual)) throw new Error("Invalid local media path");

  const contentType = extname(actual).toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
  return { buffer: await readFile(actual), contentType };
}
