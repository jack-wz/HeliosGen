#!/usr/bin/env node
/**
 * Classify every asset with the vision model and write the results back.
 *
 * Uses the same lib/assetVision.ts the API route does, so a batch run and a
 * single click cannot drift apart. Requires a MiMo API key — set it in the app
 * under Settings → API Keys, or pass MIMO_API_KEY in the environment.
 *
 * Each call costs one request against your MiMo quota, which is why --limit and
 * --dry-run exist and why the default is to report rather than assume.
 *
 * Usage:
 *   node scripts/classify-assets.mjs [--limit N] [--dry-run] [--overwrite] [--lang zh|en]
 *
 * --overwrite  re-classify assets that already have a category (default: skip them)
 *
 * On the NAS:
 *   docker exec -w /app heliosgen node scripts/classify-assets.mjs --limit 10
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./scripts/_ts-alias-hooks.mjs", pathToFileURL(process.cwd() + "/"));

const { classifyAssetImage, VisionNotConfiguredError } = await import("@/lib/assetVision.ts");
const { getMimoApiKey } = await import("@/lib/guest/db.ts");
const db = await import("@/lib/guest/db.ts");
const { GUEST_USER_ID } = await import("@/lib/guestMode.ts");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const limit = Number(arg("limit", "0")) || 0;
const dryRun = has("dry-run");
const overwrite = has("overwrite");
const language = arg("lang", "zh") === "en" ? "en" : "zh";

if (!getMimoApiKey()) {
  console.error("未配置 MiMo API Key。请在「设置 → API 密钥」中填写，或设置环境变量 MIMO_API_KEY。");
  process.exit(2);
}

const all = db.getCreativeAssets(GUEST_USER_ID);

// The vision model takes an image. Videos are skipped rather than counted as
// failures — the poster frame would work but that is a separate piece of work,
// and reporting 13 phantom errors would hide real ones.
const isImage = (a) => (a.mime_type ?? "").startsWith("image/");
const images = all.filter(isImage);
const nonImages = all.length - images.length;
const pending = overwrite ? images : images.filter((a) => !a.category);

console.log(`资产总数:   ${all.length}（图片 ${images.length}、非图片 ${nonImages} 跳过）`);
console.log(`待分类:     ${pending.length}${overwrite ? "（--overwrite：包含已有分类的）" : "（已有分类的会跳过）"}`);
console.log(`描述语言:   ${language === "zh" ? "中文" : "English"}`);

if (dryRun) {
  for (const a of pending.slice(0, limit || 10)) console.log(`  · ${a.name}`);
  console.log(`\n--dry-run：未调用模型、未写入`);
  console.log(`预计消耗 ${limit ? Math.min(limit, pending.length) : pending.length} 次 MiMo 请求`);
  process.exit(0);
}

const targets = limit ? pending.slice(0, limit) : pending;
if (targets.length === 0) {
  console.log("\n没有需要分类的资产。");
  process.exit(0);
}

let done = 0, failed = 0;
const counts = {};
const started = Date.now();

for (const asset of targets) {
  try {
    const r = await classifyAssetImage({
      imageUrl: asset.url,
      name: asset.name,
      existingPrompt: asset.prompt,
      language,
    });
    db.updateCreativeAsset(asset.id, GUEST_USER_ID, {
      category: r.category,
      description: r.description || asset.description,
      asset_tags: r.tags,
    });
    counts[r.category] = (counts[r.category] ?? 0) + 1;
    done += 1;
  } catch (err) {
    failed += 1;
    if (err instanceof VisionNotConfiguredError) {
      console.error(`\n  密钥失效，中止：${err.message}`);
      break;
    }
    console.error(`\n  失败 ${asset.name}: ${err instanceof Error ? err.message : err}`);
  }
  const seen = done + failed;
  process.stdout.write(`\r  进度 ${seen}/${targets.length}  成功 ${done}  失败 ${failed}   `);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n完成：成功 ${done}、失败 ${failed}，用时 ${secs}s`);
if (done) {
  console.log("分类分布：" + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join("、"));
}
process.exit(failed > 0 && done === 0 ? 1 : 0);
