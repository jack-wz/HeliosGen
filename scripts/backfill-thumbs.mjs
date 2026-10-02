#!/usr/bin/env node
/**
 * Backfill image thumbnails for media that predates prewarming.
 *
 * Existing originals are 7-9MB PNGs and this box has four low-power cores, so a
 * cold gallery re-decodes them on every width it needs. This walks the media
 * directory once and fills the thumbnail cache so the first read is instant.
 *
 * Idempotent and safe to interrupt: it skips widths that are already cached, so
 * re-running resumes rather than redoing. It writes only under
 * DATA_DIR/cache/thumbs — never into the media folder, so Seek and the asset
 * index never see a thumbnail as an asset.
 *
 * Usage (from the repo root, or inside the container at /app):
 *   node scripts/backfill-thumbs.mjs [--widths 48,128,384,640] [--limit N] [--dry-run]
 *
 * On the NAS:
 *   docker exec -w /app heliosgen node scripts/backfill-thumbs.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

register("./scripts/_ts-alias-hooks.mjs", pathToFileURL(process.cwd() + "/"));

const { prewarmImageThumb, THUMB_WIDTHS } = await import("@/lib/imageThumb.ts");
const { MEDIA_DIR, DATA_DIR } = await import("@/lib/guest/paths.ts");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const widths = (arg("widths", "") || "").split(",").map(Number).filter(Boolean);
const limit = Number(arg("limit", "0")) || 0;
const dryRun = has("dry-run");

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase())) yield full;
  }
}

const targets = [];
for await (const file of walk(MEDIA_DIR)) targets.push(file);

console.log(`媒体目录: ${MEDIA_DIR}`);
console.log(`缩略图缓存: ${join(DATA_DIR, "cache", "thumbs")}`);
console.log(`待处理图片: ${targets.length}${limit ? `（限制前 ${limit} 个）` : ""}`);
console.log(`宽度档位: ${(widths.length ? widths : THUMB_WIDTHS).join(", ")}`);

if (dryRun) {
  for (const t of targets.slice(0, limit || 10)) {
    const { size } = await stat(t);
    console.log(`  ${(size / 1048576).toFixed(1)} MB  ${relative(MEDIA_DIR, t)}`);
  }
  console.log("--dry-run：未生成任何文件");
  process.exit(0);
}

let done = 0, skipped = 0, failed = 0, generated = 0;
const started = Date.now();
const list = limit ? targets.slice(0, limit) : targets;

for (const file of list) {
  const url = `/generated/${relative(MEDIA_DIR, file).split("\\").join("/")}`;
  try {
    const n = await prewarmImageThumb(url, widths.length ? widths : undefined);
    if (n > 0) { done += 1; generated += n; }
    else skipped += 1;
  } catch (err) {
    failed += 1;
    console.error(`  失败 ${url}: ${err instanceof Error ? err.message : err}`);
  }
  const seen = done + skipped + failed;
  if (seen % 10 === 0 || seen === list.length) {
    const pct = ((seen / list.length) * 100).toFixed(0);
    process.stdout.write(`\r  进度 ${seen}/${list.length} (${pct}%)  新生成 ${done} 张 / ${generated} 档  跳过 ${skipped}  失败 ${failed}   `);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n完成：${done} 张新生成（${generated} 个宽度档）、${skipped} 张已缓存跳过、${failed} 张失败，用时 ${secs}s`);
process.exit(failed > 0 && done === 0 ? 1 : 0);
