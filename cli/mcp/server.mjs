#!/usr/bin/env node
/**
 * MCP server for the HeliosGen NAS deployment.
 *
 * Exposes image/video generation, asset upload, job polling, gallery and
 * canvas-workflow access as MCP tools, backed by the same client as the
 * `helios` CLI (../lib/client.mjs).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  api, baseUrl, uploadFile, resolveMedia, waitForJob, downloadAsset,
} from "../lib/client.mjs";

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: e.message, status: e.status }) }],
});
const wrap = (fn) => async (args) => {
  try {
    return json(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

const server = new McpServer({ name: "heliosgen", version: "1.0.0" });

server.registerTool(
  "helios_models",
  {
    description:
      "List generation models available on the HeliosGen NAS server, with capabilities " +
      "(aspect ratios, durations, reference-image support). Check `nasSupported` — Google Veo " +
      "video models are not supported on this deployment.",
    inputSchema: { type: z.enum(["image", "video"]).optional() },
  },
  wrap(async ({ type }) => {
    const data = await api.models();
    if (type === "image") return data.images;
    if (type === "video") return data.videos;
    return data;
  }),
);

server.registerTool(
  "helios_credit",
  {
    description:
      "Check the kie.ai credit balance on the HeliosGen server. Call this before spending " +
      "credits and report the balance to the user.",
    inputSchema: {},
  },
  wrap(async () => api.credit()),
);

server.registerTool(
  "helios_upload",
  {
    description:
      "Upload a local image/video/audio file to the HeliosGen media library. Returns a " +
      "`/generated/...` URL usable as a reference input for generation tools.",
    inputSchema: { path: z.string().describe("Absolute local file path (max 100 MB)") },
  },
  wrap(async ({ path }) => ({ cdnUrl: await uploadFile(path) })),
);

const waitOpt = z
  .boolean()
  .optional()
  .describe("Wait for completion (default true). Set false to get the taskId immediately.");

server.registerTool(
  "helios_generate_image",
  {
    description:
      "Generate image(s) from a text prompt, optionally with reference images. Spends kie.ai " +
      "credits — confirm the model/quality with the user first when cost matters. Local file " +
      "paths in `refs` are uploaded automatically. Results are stored in the NAS gallery.",
    inputSchema: {
      prompt: z.string(),
      model: z.string().optional().describe("Model id from helios_models (default nano-banana-2-lite)"),
      refs: z.array(z.string()).optional().describe("Reference images: local paths, /generated/... or https URLs"),
      aspectRatio: z.string().optional().describe("e.g. 1:1, 16:9, 9:16 (default 1:1)"),
      quality: z.enum(["1k", "2k", "4k"]).optional().describe("default 1k"),
      wait: waitOpt,
    },
  },
  wrap(async ({ prompt, model, refs, aspectRatio, quality, wait }) => {
    const imageUrls = [];
    for (const r of refs ?? []) imageUrls.push(await resolveMedia(r));
    const res = await api.generateImage({
      model: model ?? "nano-banana-2-lite",
      prompt,
      imageUrls,
      aspectRatio: aspectRatio ?? "1:1",
      quality: quality ?? "1k",
    });
    if (wait === false) return { taskId: res.taskId, status: "pending" };
    return { taskId: res.taskId, ...(await waitForJob(res.taskId)) };
  }),
);

server.registerTool(
  "helios_generate_video",
  {
    description:
      "Generate a video from a prompt, optional start/end frames and reference images. Spends " +
      "kie.ai credits — confirm model/duration with the user first when cost matters. Local " +
      "file paths are uploaded automatically. Google Veo models are NOT supported on this server.",
    inputSchema: {
      prompt: z.string(),
      model: z.string().optional().describe("Video model id from helios_models (default seedance-2-fast)"),
      startFrame: z.string().optional().describe("Local path, /generated/... or https URL"),
      endFrame: z.string().optional(),
      refs: z.array(z.string()).optional().describe("Reference images"),
      duration: z.number().optional().describe("Seconds (default 5)"),
      aspectRatio: z.string().optional().describe("default 16:9"),
      sound: z.boolean().optional(),
      wait: waitOpt,
    },
  },
  wrap(async ({ prompt, model, startFrame, endFrame, refs, duration, aspectRatio, sound, wait }) => {
    const payload = {
      videoModel: model ?? "seedance-2-fast",
      prompt,
      duration: duration ?? 5,
      aspectRatio: aspectRatio ?? "16:9",
    };
    if (startFrame) payload.startFrameUrl = await resolveMedia(startFrame);
    if (endFrame) payload.endFrameUrl = await resolveMedia(endFrame);
    const urls = [];
    for (const r of refs ?? []) urls.push(await resolveMedia(r));
    if (urls.length) payload.referenceImageUrls = urls;
    if (sound) payload.sound = true;
    const res = await api.generateVideo(payload);
    if (wait === false) return { taskId: res.taskId, status: "pending" };
    return { taskId: res.taskId, ...(await waitForJob(res.taskId)) };
  }),
);

server.registerTool(
  "helios_job_status",
  {
    description: "Check the status of a generation task (pending | done | error | not_found).",
    inputSchema: { taskId: z.string() },
  },
  wrap(async ({ taskId }) => api.jobStatus(taskId)),
);

server.registerTool(
  "helios_gallery",
  {
    description: "Browse the NAS media gallery (generations and uploads).",
    inputSchema: {
      type: z.enum(["image", "video"]).optional(),
      source: z.enum(["generation", "upload"]).optional(),
      page: z.number().optional(),
    },
  },
  wrap(async ({ type, source, page }) => api.gallery({ type: type ?? "image", source, page: page ?? 0 })),
);

server.registerTool(
  "helios_download",
  {
    description: "Download a gallery asset (/generated/... or allowed CDN URL) to a local directory.",
    inputSchema: {
      url: z.string(),
      destDir: z.string().optional().describe("Local directory (default current working directory)"),
    },
  },
  wrap(async ({ url, destDir }) => ({ path: await downloadAsset(url, destDir ?? ".") })),
);

const categorySchema = z.enum(["Characters", "Props", "Environments", "Styles", "Scenes"]);

server.registerTool(
  "helios_asset_list",
  {
    description: "List creative assets shared by HeliosGen and Seek, including prompt/model provenance, category counts and collections.",
    inputSchema: {
      category: categorySchema.optional(),
      collection: z.string().optional().describe("Collection id"),
      query: z.string().optional(),
    },
  },
  wrap(async ({ category, collection, query }) => api.assets({ category, collection, query })),
);

server.registerTool(
  "helios_asset_add",
  {
    description: "Upload a local media file once to the NAS and register it as a creative asset usable by gallery and workflow pickers.",
    inputSchema: {
      path: z.string().describe("Absolute local file path"),
      category: categorySchema.optional(),
      name: z.string().optional(), description: z.string().optional(),
      prompt: z.string().optional(), model: z.string().optional(),
    },
  },
  wrap(async ({ path, ...metadata }) => {
    const url = await uploadFile(path);
    return api.assetImport({ url, source: "agent_upload", ...metadata });
  }),
);

server.registerTool(
  "helios_asset_import",
  {
    description: "Register an existing file already inside the NAS shared media directory without copying it. Use relativePath for Seek-to-Helios imports.",
    inputSchema: {
      relativePath: z.string().optional().describe("Path relative to HELIOS_MEDIA_DIR, for example assets/Characters/hero.png"),
      url: z.string().optional().describe("Existing /generated/... URL"),
      category: categorySchema.optional(), name: z.string().optional(),
      description: z.string().optional(), prompt: z.string().optional(), model: z.string().optional(),
      seekGuid: z.string().optional(), source: z.string().optional(),
    },
  },
  wrap(async (input) => api.assetImport(input)),
);

server.registerTool(
  "helios_asset_update",
  {
    description: "Update creative asset metadata or classification; the shared media file remains unchanged.",
    inputSchema: {
      id: z.string(), category: categorySchema.nullable().optional(), name: z.string().optional(),
      description: z.string().nullable().optional(), prompt: z.string().nullable().optional(),
      model: z.string().nullable().optional(), seekGuid: z.string().nullable().optional(),
    },
  },
  wrap(async ({ id, ...updates }) => api.assetUpdate(id, updates)),
);

server.registerTool(
  "helios_asset_reconcile",
  {
    description: "Scan the shared media directory and idempotently register every supported file. Does not copy or modify media bytes.",
    inputSchema: {},
  },
  wrap(async () => api.assetReconcile()),
);

server.registerTool(
  "helios_asset_collection_create",
  {
    description: "Create a manual collection or a smart rule collection over shared creative assets.",
    inputSchema: {
      name: z.string(), kind: z.enum(["manual", "smart"]).optional(),
      category: categorySchema.optional(), source: z.string().optional(),
      mimeType: z.string().optional(), query: z.string().optional(), seekTagGuid: z.string().optional(),
    },
  },
  wrap(async ({ name, kind, seekTagGuid, ...rule }) => api.assetCollectionCreate({
    name, kind: kind ?? "manual", rule: (kind === "smart") ? rule : null, seekTagGuid,
  })),
);

server.registerTool(
  "helios_workflow_list",
  {
    description: "List canvas workflows (spaces) stored on the HeliosGen server.",
    inputSchema: {},
  },
  wrap(async () => {
    const { spaces } = await api.workflows();
    return spaces.map((s) => ({ id: s.id, name: s.name, nodes: s.nodes?.length ?? 0, updatedAt: s.updatedAt ?? s.createdAt }));
  }),
);

server.registerTool(
  "helios_workflow_get",
  {
    description: "Get one canvas workflow with full node/edge JSON.",
    inputSchema: { id: z.string() },
  },
  wrap(async ({ id }) => api.workflowGet(id)),
);

server.registerTool(
  "helios_base_url",
  {
    description: "Show which HeliosGen server this MCP is connected to.",
    inputSchema: {},
  },
  wrap(async () => ({ baseUrl: await baseUrl() })),
);

await server.connect(new StdioServerTransport());
