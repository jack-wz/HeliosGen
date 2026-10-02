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
{"category": "<one of: ${ASSET_CATEGORIES.join(" | ")}>", "description": "<one sentence, in the same language as the user's note, describing what the image shows>", "tags": ["<3-6 short keywords>"]}

Category meanings:
- Characters: a person, character, avatar or creature is the subject
- Props: a single object, item or product is the subject
- Environments: a place, landscape, interior or backdrop
- Styles: primarily a visual style, palette, texture or abstract artwork
- Scenes: a composition with several subjects or an action taking place`;

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
}): Promise<AssetClassification> {
  const apiKey = getMimoApiKey();
  if (!apiKey) throw new VisionNotConfiguredError();

  const thumb = await getImageThumb(opts.imageUrl, 640);
  if (!thumb) throw new Error("Thumbnail unavailable for this asset");

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
                image_url: { url: `data:${thumb.contentType};base64,${thumb.buffer.toString("base64")}` },
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
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? "")).join("")
          : "";

    const parsed = parseClassification(text);
    if (!parsed) throw new Error("Vision model did not return a usable classification");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
