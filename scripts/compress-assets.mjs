#!/usr/bin/env node
/**
 * Re-encode stored images to lossless WebP, in place, without changing a pixel.
 *
 * Real assets here are 6-18MB PNGs and the library is ~1GB. Lossless WebP cuts
 * 54-58% off each file and decodes identically; lib/assetCompress.ts verifies
 * that per file and refuses to write anything that does not match.
 *
 * Bytes are replaced at the same path so every existing `/generated/...`
 * reference keeps working — workflow node data, the DB, the asset index. The
 * server sniffs the leading bytes for Content-Type now, since the extension no
 * longer describes the contents.
 *
 * Safety:
 *   - originals are copied to DATA_DIR/asset-originals-backup before being
 *     touched, outside the media dir so Seek and the asset index never see them
 *   - `--rollback` restores every file from that backup
 *   - `--dry-run` reports what would happen and writes nothing
 *   - idempotent: files already in WebP form are skipped
 *
 * Usage:
 *   node scripts/compress-assets.mjs [--dry-run] [--limit N] [--rollback]
 *
 * On the NAS:
 *   docker exec -w /app heliosgen node scripts/compress-assets.mjs --dry-run
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { readdir, stat, mkdir, copyFile, rename } from "node:fs/promises";
import { join, extname, relative, dirname } from "node:path";

register("./scripts/_ts-alias-hooks.mjs", pathToFileURL(process.cwd() + "/"));

const { compressAsset, isAlreadyCompressed } = await import("@/lib/assetCompress.ts");
const { MEDIA_DIR, DATA_DIR } = await import("@/lib/guest/paths.ts");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]);
const BACKUP_DIR = join(DATA_DIR, "asset-originals-backup");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const limit = Number(arg("limit", "0")) || 0;
const dryRun = has("dry-run");
const rollback = has("rollback");

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase())) yield full;
  }
}

const files = [];
for await (const f of walk(MEDIA_DIR)) files.push(f);
const targets = limit ? files.slice(0, limit) : files;

console.log(`媒体目录:   ${MEDIA_DIR}`);
console.log(`备份目录:   ${BACKUP_DIR}`);
console.log(`候选图片:   ${files.length}${limit ? `（本次限制前 ${limit} 个）` : ""}`);

// ── rollback ────────────────────────────────────────────────────────────────
if (rollback) {
  let restored = 0, missing = 0;
  for (const file of targets) {
    const rel = relative(MEDIA_DIR, file);
    const bak = join(BACKUP_DIR, rel);
    try {
      await stat(bak);
      await rename(bak, file);
      restored += 1;
    } catch {
      missing += 1;
    }
  }
  console.log(`\n已回滚 ${restored} 个文件${missing ? `，${missing} 个在备份中不存在（跳过）` : ""}`);
  process.exit(0);
}

// ── dry run ─────────────────────────────────────────────────────────────────
if (dryRun) {
  let total = 0, compressible = 0;
  for (const file of targets) {
    const { size } = await stat(file);
    total += size;
    if (!(await isAlreadyCompressed(file))) compressible += 1;
  }
  console.log(`\n总体积: ${(total / 1073741824).toFixed(2)} GB`);
  console.log(`可压缩: ${compressible} 个（其余已是 WebP）`);
  console.log(`预估: 按实测 55% 计算，约可省 ${((total * 0.55) / 1073741824).toFixed(2)} GB`);
  console.log("--dry-run：未写入任何文件");
  process.exit(0);
}

// ── compress ────────────────────────────────────────────────────────────────
await mkdir(BACKUP_DIR, { recursive: true });

let changed = 0, skipped = 0, refused = 0, failed = 0;
let beforeTotal = 0, afterTotal = 0;
const started = Date.now();

for (const file of targets) {
  const rel = relative(MEDIA_DIR, file);
  let res;
  try {
    const { size } = await stat(file);
    beforeTotal += size;
    if (await isAlreadyCompressed(file)) {
      skipped += 1; afterTotal += size; continue;
    }
    // Back up before the first write. If a backup already exists, keep it —
    // it holds the true original, not an intermediate result.
    const bak = join(BACKUP_DIR, rel);
    try { await stat(bak); } catch {
      await mkdir(dirname(bak), { recursive: true });
      await copyFile(file, bak);
    }
    res = await compressAsset(file);
    afterTotal += res.afterBytes;
    if (res.changed) changed += 1;
    else if (res.reason === "failed") failed += 1;
    else refused += 1;
  } catch (err) {
    failed += 1;
    console.error(`\n  失败 ${rel}: ${err instanceof Error ? err.message : err}`);
    continue;
  }
  const seen = changed + skipped + refused + failed;
  if (seen % 10 === 0 || seen === targets.length) {
    const saved = beforeTotal > 0 ? ((1 - afterTotal / beforeTotal) * 100).toFixed(1) : "0";
    process.stdout.write(
      `\r  进度 ${seen}/${targets.length}  已压缩 ${changed}  跳过 ${skipped}  未收益 ${refused}  失败 ${failed}  省 ${saved}%   `,
    );
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
const savedPct = beforeTotal > 0 ? ((1 - afterTotal / beforeTotal) * 100).toFixed(1) : "0";
console.log(
  `\n完成：压缩 ${changed} 个、跳过 ${skipped}（已是 WebP）、未收益 ${refused}、失败 ${failed}，用时 ${secs}s`,
);
console.log(
  `体积：${(beforeTotal / 1073741824).toFixed(2)} GB -> ${(afterTotal / 1073741824).toFixed(2)} GB  省 ${savedPct}%`,
);
console.log(`回滚：node scripts/compress-assets.mjs --rollback`);
process.exit(failed > 0 && changed === 0 ? 1 : 0);
