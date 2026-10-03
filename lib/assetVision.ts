/**
 * Classify a stored image with a vision model, so the asset library can be
 * organised by what an image actually shows rather than by which folder it
 * happens to sit in.
 *
 * Uses Xiaomi's MiMo-VL through its OpenAI-compatible endpoint
 * (https://api.xiaomimimo.com/v1). The Kie channel already in the app also
 * serves Gemini models, which are multimodal too — the provider is a constant
 * below rather than something baked into the call, so switching is a one-liner.
 *
 * Input is the pre-generated 640px thumbnail, never the original: originals run
 * 6-18MB and sending one would cost seconds of upload and a large number of
 * image tokens to answer a question that a 640px view answers just as well.
 */
import { getMimoApiKey } from "@/lib/guest/db";
import { getImageThumb } from "@/lib/imageThumb";
import { getVideoPoster } from "@/lib/videoFrame";
import { ASSET_CATEGORIES, type AssetCategory } from "@/lib/assetCategories";

/**
 * Xiaomi runs **two independent auth systems** whose keys and endpoints do not
 * cross: pay-as-you-go keys start `sk-` and only work on `api.xiaomimimo.com`,
 * token-plan keys start `tp-` and only work on a regional token-plan host. A
 * `tp-` key against the `api.` host answers `401 Invalid API Key`, which reads
 * like a bad key rather than a wrong endpoint — measured, not guessed.
 *
 * So the endpoint is chosen from the key itself, and MIMO_BASE_URL overrides
 * both when someone wants to point this somewhere else entirely.
 */
const PAYG_BASE_URL = "https://api.xiaomimimo.com/v1";
const TOKEN_PLAN_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";

function resolveBaseUrl(apiKey: string): string {
  if (process.env.MIMO_BASE_URL) return process.env.MIMO_BASE_URL;
  return apiKey.startsWith("tp-") ? TOKEN_PLAN_BASE_URL : PAYG_BASE_URL;
}

/**
 * `mimo-v2.6-flash` is the one that accepts image input on the token-plan host
 * (verified against the live API: it read a solid-colour test image correctly).
 * `mimo-v2.5-pro` answers "No endpoints found that support image input", so it
 * is not a drop-in substitute.
 */
const MODEL = process.env.MIMO_VISION_MODEL || "mimo-v2.6-flash";
const TIMEOUT_MS = 60_000;

/** Thrown when no key is configured, so callers can say so instead of guessing. */
export class VisionNotConfiguredError extends Error {
  constructor() {
    super("MiMo API key is not configured. Add it in Settings → API Keys.");
    this.name = "VisionNotConfiguredError";
  }
}

export type AssetClassification = {
  category: AssetCategory;
  description: string;
  tags: string[];
};

const SYSTEM_PROMPT = `You organise an AI-generated image library. For each image, reply with JSON only — no prose, no code fences:
{"category": "<one of: ${ASSET_CATEGORIES.join(" | ")}>", "description": "<one sentence under 40 words, in the same language as the user's note, describing what the image shows>", "tags": ["<3-6 short keywords>"]}

Category meanings:
- Covers: a designed cover, thumbnail or poster — prominent title text plus a focal
  subject and a graphic layout, built to be read at a glance in a feed
- Characters: a person, character, avatar or creature is the subject
- Props: a single object, item or product is the subject
- Environments: a place, landscape, interior or backdrop
- Styles: primarily a visual style, palette, texture or abstract artwork
- Scenes: a composition with several subjects or an action taking place

Covers wins over the others. Covers usually contain a character or a scene as well,
so if the image carries a title or headline and reads as a thumbnail for something,
answer Covers — otherwise the subject wins and the cover ends up filed as a
Character or a Scene.`;

/**
 * Best-effort read of a truncated answer.
 *
 * The model sometimes stops mid-sentence with finish_reason "stop" and a
 * description cut off inside the string — the JSON never closes, so a strict
 * parse throws the whole answer away. Category and description both appear
 * before the point where it tends to run out, so they are recovered field by
 * field instead.
 */
function salvageClassification(text: string): AssetClassification | null {
  const categoryMatch = text.match(/"category"\s*:\s*"([^"]+)"/);
  if (!categoryMatch) return null;
  const category = ASSET_CATEGORIES.find(
    (c) => c.toLowerCase() === categoryMatch[1].trim().toLowerCase(),
  );
  if (!category) return null;

  const descMatch = text.match(/"description"\s*:\s*"([^"]*)/);
  const tagsBlock = text.match(/"tags"\s*:\s*\[([^\]]*)/);
  const tags = tagsBlock
    ? [...tagsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    category,
    description: (descMatch?.[1] ?? "").trim(),
    tags,
  };
}

function parseClassification(text: string): AssetClassification | null {
  // The model is asked for bare JSON, but tolerate fences or leading prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const category = ASSET_CATEGORIES.find(
    (c) => c.toLowerCase() === String(obj.category ?? "").trim().toLowerCase(),
  );
  if (!category) return null;

  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : [];

  return { category, description, tags };
}

/**
 * Ask the vision model what an asset is.
 *
 * `imageUrl` is the stored `/generated/...` path; the thumbnail is generated on
 * demand if it is not cached yet. Throws VisionNotConfiguredError when no key is
 * set, and a plain Error when the model is unreachable or answers unusably.
 */
export async function classifyAssetImage(opts: {
  imageUrl: string;
  name?: string | null;
  existingPrompt?: string | null;
  language?: "zh" | "en";
  /** Internal: how many attempts have been made. Callers should not set this. */
  attempt?: number;
}): Promise<AssetClassification> {
  try {
    return await classifyOnce(opts);
  } catch (err) {
    // The model is stochastic — the same image can come back unparseable on one
    // call and fine on the next. One retry turns a flaky batch into a reliable
    // one; a missing key or a transport error is not retried.
    const retryable = err instanceof Error && err.message.startsWith("Vision model did not return");
    if (retryable && (opts.attempt ?? 0) < 1) {
      return classifyAssetImage({ ...opts, attempt: (opts.attempt ?? 0) + 1 });
    }
    throw err;
  }
}

async function classifyOnce(opts: {
  imageUrl: string;
  name?: string | null;
  existingPrompt?: string | null;
  language?: "zh" | "en";
}): Promise<AssetClassification> {
  const apiKey = getMimoApiKey();
  if (!apiKey) throw new VisionNotConfiguredError();

  // Images use their pre-generated thumbnail; videos fall back to a poster
  // frame. Both are small, and both are already cached by the time a library
  // gets classified — the alternative is sending a 6MB original or not
  // classifying video at all, which would leave 13 of 170 assets unlabelled.
  const frame = (await getImageThumb(opts.imageUrl, 640)) ?? (await getVideoPoster(opts.imageUrl, 720));
  if (!frame) throw new Error("No thumbnail or poster frame available for this asset");

  const hint: string[] = [];
  if (opts.name) hint.push(`Filename: ${opts.name}`);
  if (opts.existingPrompt) hint.push(`Generation prompt: ${opts.existingPrompt.slice(0, 400)}`);
  hint.push(
    opts.language === "en"
      ? "Write the description in English."
      : "用中文写描述。",
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${resolveBaseUrl(apiKey)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: hint.join("\n") },
              {
                type: "image_url",
                image_url: { url: `data:${frame.contentType};base64,${frame.buffer.toString("base64")}` },
              },
            ],
          },
        ],
        temperature: 0.2,
        // Generous on purpose. mimo-v2.6-flash emits reasoning_content before the
        // answer, and that is billed against the same budget — at 400 the model
        // spent the lot thinking and returned empty content, which surfaced as
        // "did not return a usable classification" on a handful of images.
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Vision model returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? "")).join("")
          : "";

    const parsed = parseClassification(text) ?? salvageClassification(text);
    if (!parsed) {
      // Carry the raw answer: "did not return a usable classification" on its own
      // is unactionable, and the model is stochastic enough that the reason
      // varies between runs.
      throw new Error(
        `Vision model did not return a usable classification (finish=${data.choices?.[0]?.finish_reason ?? "?"}, ` +
        `content=${JSON.stringify(text).slice(0, 200)})`,
      );
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
