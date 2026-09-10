/**
 * Shared zero-dependency HTTP client for the HeliosGen NAS deployment.
 *
 * Base URL resolution order:
 *   1. HELIOS_BASE_URL env var
 *   2. ~/.config/helios/config.json  { "baseUrl": "..." }
 *   3. built-in default (the user's Tailscale NAS address)
 *
 * Node's global fetch does not honor HTTP(S)_PROXY env vars, which is what we
 * want: the NAS lives on a Tailscale address that corporate/system proxies
 * cannot reach.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_BASE_URL = "https://fn-evo4-8cad.tail071480.ts.net:9443";
const CONFIG_PATH = join(homedir(), ".config", "helios", "config.json");

export function configPath() {
  return CONFIG_PATH;
}

export async function getConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function setConfig(patch) {
  const cfg = { ...(await getConfig()), ...patch };
  await mkdir(join(homedir(), ".config", "helios"), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  return cfg;
}

export async function baseUrl() {
  const url = process.env.HELIOS_BASE_URL || (await getConfig()).baseUrl || DEFAULT_BASE_URL;
  return url.replace(/\/+$/, "");
}

export class HeliosError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function request(path, { method = "GET", json, raw, mime, timeoutMs = 120_000 } = {}) {
  const url = (await baseUrl()) + path;
  const headers = {};
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    headers["Content-Type"] = mime ?? "application/octet-stream";
    body = raw;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: ctrl.signal });
  } catch (e) {
    throw new HeliosError(
      `Cannot reach HeliosGen at ${url}: ${e.cause?.message ?? e.message}. ` +
        `Check that you are connected to Tailscale and the NAS container is running.`,
      0,
      null,
    );
  } finally {
    clearTimeout(timer);
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const msg = data?.error ?? data?.msg ?? `HTTP ${res.status}`;
    throw new HeliosError(`${method} ${path} failed: ${msg}`, res.status, data);
  }
  return data;
}

// ── Typed helpers ────────────────────────────────────────────────────────────

export const api = {
  models: () => request("/api/models"),
  credit: () => request("/api/credit"),
  keyStatus: () => request("/api/settings/kie-key"),
  keySet: (token) => request("/api/settings/kie-key", { method: "POST", json: { kieApiToken: token } }),
  keyDelete: () => request("/api/settings/kie-key", { method: "DELETE" }),

  jobStatus: (taskId) => request(`/api/job-status?taskId=${encodeURIComponent(taskId)}`),

  gallery: ({ type = "image", source, page = 0 } = {}) => {
    const q = new URLSearchParams({ type, page: String(page) });
    if (source) q.set("source", source);
    return request(`/api/gallery?${q}`);
  },

  assets: ({ category, collection, query } = {}) => {
    const q = new URLSearchParams();
    if (category) q.set("category", category);
    if (collection) q.set("collection", collection);
    if (query) q.set("q", query);
    return request(`/api/assets?${q}`);
  },
  assetImport: (payload) => request("/api/assets/import", { method: "POST", json: payload }),
  assetUpdate: (id, payload) => request(`/api/assets/${encodeURIComponent(id)}`, { method: "PATCH", json: payload }),
  assetReconcile: () => request("/api/assets/reconcile", { method: "POST", timeoutMs: 300_000 }),
  assetCollections: () => request("/api/assets/collections"),
  assetCollectionCreate: (payload) => request("/api/assets/collections", { method: "POST", json: payload }),
  assetCollectionMembership: (payload) => request("/api/assets/collections", { method: "PATCH", json: payload }),

  generateImage: (payload) => request("/api/generate", { method: "POST", json: payload, timeoutMs: 300_000 }),
  generateVideo: (payload) => request("/api/generate-video", { method: "POST", json: payload, timeoutMs: 300_000 }),

  workflows: () => request("/api/workflows"),
  workflowGet: (id) => request(`/api/workflows/${encodeURIComponent(id)}`),
  workflowPut: (id, space) => request(`/api/workflows/${encodeURIComponent(id)}`, { method: "PUT", json: space }),
  workflowDelete: (id) => request(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export function mimeFor(path) {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Upload a local file as a reference/asset. Returns the stored `/generated/...` URL. */
export async function uploadFile(path) {
  if (!existsSync(path)) throw new HeliosError(`File not found: ${path}`, 0, null);
  if (statSync(path).size > 100 * 1024 * 1024) {
    throw new HeliosError(`File exceeds the server's 100 MB upload limit: ${path}`, 0, null);
  }
  const buf = await readFile(path);
  const data = await request("/api/upload-asset", { method: "POST", raw: buf, mime: mimeFor(path) });
  return data.cdnUrl;
}

/**
 * Resolve a user-supplied media reference to a URL the server accepts:
 * local paths are uploaded; `/generated/...` and http(s) URLs pass through.
 */
export async function resolveMedia(ref) {
  if (ref.startsWith("/generated/") || /^https?:\/\//.test(ref) || ref.startsWith("data:")) return ref;
  return uploadFile(ref);
}

/** Poll /api/job-status until the job settles. Returns the final JobResult. */
export async function waitForJob(taskId, { timeoutMs = 15 * 60_000, intervalMs = 3_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await api.jobStatus(taskId);
    if (st.status === "done" || st.status === "error") return st;
    if (st.status === "not_found") throw new HeliosError(`Job not found: ${taskId}`, 404, st);
    if (Date.now() > deadline) throw new HeliosError(`Timed out waiting for job ${taskId}`, 0, st);
    onTick?.(st);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Download a stored or remote asset to disk. Returns the written path. */
export async function downloadAsset(url, destDir = ".", filename) {
  const name = filename ?? basename(url.split("?")[0]) ?? "download";
  // Stored media is fetched directly from the media route — no proxy hop.
  const data = url.startsWith("/generated/")
    ? await request(url)
    : await request(`/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(name)}`);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, name);
  await writeFile(dest, data);
  return dest;
}
