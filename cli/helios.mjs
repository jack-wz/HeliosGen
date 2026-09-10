#!/usr/bin/env node
/**
 * helios — CLI for the HeliosGen NAS deployment.
 * Designed for both humans and AI agents: every data command prints JSON.
 * Run `helios help` for usage.
 */
import { readFile } from "node:fs/promises";
import {
  api, baseUrl, configPath, getConfig, setConfig,
  uploadFile, resolveMedia, waitForJob, downloadAsset, HeliosError,
} from "./lib/client.mjs";

const DEFAULT_IMAGE_MODEL = "nano-banana-2-lite";
const DEFAULT_VIDEO_MODEL = "seedance-2-fast";

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = a.slice(2, eq === -1 ? undefined : eq);
      if (eq !== -1) addOpt(opt, key, a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) addOpt(opt, key, argv[++i]);
      else addOpt(opt, key, true);
    } else {
      pos.push(a);
    }
  }
  return { pos, opt };
}

function addOpt(opt, key, value) {
  if (opt[key] === undefined) opt[key] = value;
  else if (Array.isArray(opt[key])) opt[key].push(value);
  else opt[key] = [opt[key], value];
}

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const out = (data) => process.stdout.write(JSON.stringify(data, null, 2) + "\n");
const err = (msg) => process.stderr.write(msg + "\n");

function req(v, usage) {
  if (!v) throw new HeliosError(`Usage: helios ${usage}`);
  return v;
}

const commands = {
  async config({ pos, opt }) {
    if (pos[0] === "set") {
      const patch = {};
      if (opt["base-url"]) patch.baseUrl = opt["base-url"];
      const cfg = await setConfig(patch);
      out({ ok: true, configPath: configPath(), config: cfg });
    } else {
      out({ configPath: configPath(), baseUrl: await baseUrl(), config: await getConfig() });
    }
  },

  async doctor() {
    const report = { baseUrl: await baseUrl(), checks: {} };
    try {
      const models = await api.models();
      report.checks.server = { ok: true, imageModels: models.images.length, videoModels: models.videos.length };
    } catch (e) {
      report.checks.server = { ok: false, error: e.message };
      out(report);
      process.exitCode = 1;
      return;
    }
    const key = await api.keyStatus();
    report.checks.kieKey = { configured: key.hasToken };
    if (key.hasToken) {
      try {
        report.checks.credit = { ok: true, ...(await api.credit()) };
      } catch (e) {
        report.checks.credit = { ok: false, error: e.message };
      }
    }
    out(report);
  },

  async models({ opt }) {
    const data = await api.models();
    if (opt.type === "image") out(data.images);
    else if (opt.type === "video") out(data.videos);
    else out(data);
  },

  async key({ pos }) {
    const sub = pos[0] ?? "status";
    if (sub === "status") return out(await api.keyStatus());
    if (sub === "delete") return out(await api.keyDelete());
    if (sub === "set") {
      let token = pos[1];
      if (!token || token === "-") {
        token = (await new Promise((r) => {
          let s = "";
          process.stdin.on("data", (d) => (s += d)).on("end", () => r(s));
        })).trim();
      }
      if (!token) throw new HeliosError("Usage: helios key set <token> (or pipe via stdin: helios key set -)");
      await api.keySet(token);
      return out({ ok: true, hasToken: true });
    }
    throw new HeliosError(`Unknown key subcommand: ${sub} (status|set|delete)`);
  },

  async credit() {
    out(await api.credit());
  },

  async upload({ pos }) {
    if (pos.length === 0) throw new HeliosError("Usage: helios upload <file...>");
    const results = [];
    for (const f of pos) results.push({ file: f, cdnUrl: await uploadFile(f) });
    out(results.length === 1 ? results[0] : results);
  },
  async image({ opt }) {
    const prompt = opt.prompt;
    if (!prompt) throw new HeliosError("--prompt is required");
    const refs = [];
    for (const r of list(opt.ref)) refs.push(await resolveMedia(r));
    const payload = {
      model: opt.model ?? DEFAULT_IMAGE_MODEL,
      prompt,
      imageUrls: refs,
      aspectRatio: opt.aspect ?? "1:1",
      quality: opt.quality ?? "1k",
    };
    if (opt.debug) payload.debugOnly = true;
    const res = await api.generateImage(payload);
    if (opt.debug || !res.taskId) return out({ debug: true, response: res });
    await settleAndReport(res.taskId, opt, "image");
  },

  async video({ opt }) {
    const prompt = opt.prompt;
    if (!prompt) throw new HeliosError("--prompt is required");
    const payload = {
      videoModel: opt.model ?? DEFAULT_VIDEO_MODEL,
      prompt,
      duration: num(opt.duration, 5),
      aspectRatio: opt.aspect ?? "16:9",
    };
    if (opt["start-frame"]) payload.startFrameUrl = await resolveMedia(opt["start-frame"]);
    if (opt["end-frame"]) payload.endFrameUrl = await resolveMedia(opt["end-frame"]);
    const refs = [];
    for (const r of list(opt.ref)) refs.push(await resolveMedia(r));
    if (refs.length) payload.referenceImageUrls = refs;
    if (opt.mode) payload.mode = opt.mode;
    if (opt.resolution) payload.resolution = opt.resolution;
    if (opt.sound) payload.sound = true;
    if (opt.seed !== undefined) payload.seed = num(opt.seed);
    if (opt.debug) payload.debugOnly = true;
    const res = await api.generateVideo(payload);
    if (opt.debug || !res.taskId) return out({ debug: true, response: res });
    await settleAndReport(res.taskId, opt, "video");
  },

  async wait({ pos, opt }) {
    const taskId = pos[0];
    if (!taskId) throw new HeliosError("Usage: helios wait <taskId> [--timeout <seconds>]");
    const st = await waitForJob(taskId, { timeoutMs: num(opt.timeout, 900) * 1000 });
    out(st);
    if (st.status === "error") process.exitCode = 1;
  },

  async status({ pos }) {
    if (!pos[0]) throw new HeliosError("Usage: helios status <taskId>");
    out(await api.jobStatus(pos[0]));
  },

  async gallery({ opt }) {
    out(await api.gallery({ type: opt.type ?? "image", source: opt.source, page: num(opt.page, 0) }));
  },

  async download({ pos, opt }) {
    if (!pos[0]) throw new HeliosError("Usage: helios download <url> [--out <dir>] [--name <file>]");
    const dest = await downloadAsset(pos[0], opt.out ?? ".", opt.name);
    out({ ok: true, path: dest });
  },
  async pipeline({ opt }) {
    const prompt = opt.prompt;
    if (!prompt) throw new HeliosError("--prompt is required");
    const aspect = opt.aspect ?? "9:16";
    const imageModel = opt["image-model"] ?? DEFAULT_IMAGE_MODEL;
    const videoModel = opt["video-model"] ?? DEFAULT_VIDEO_MODEL;
    const refs = [];
    for (const r of list(opt.ref)) refs.push(await resolveMedia(r));
    err(`[pipeline] 1/2 image via ${imageModel}…`);
    const img = await api.generateImage({
      model: imageModel, prompt, imageUrls: refs,
      aspectRatio: aspect, quality: opt["image-quality"] ?? "1k",
    });
    const imgDone = await waitForJob(img.taskId);
    if (imgDone.status === "error") {
      out({ status: "error", stage: "image", error: imgDone.error, taskId: img.taskId });
      process.exitCode = 1;
      return;
    }
    const frame = imgDone.imageUrl;
    err(`[pipeline] image done: ${frame} — 2/2 video via ${videoModel}…`);
    const vidPayload = {
      videoModel, prompt: opt["video-prompt"] ?? prompt,
      startFrameUrl: frame,
      duration: num(opt.duration, 5),
      aspectRatio: aspect,
    };
    if (opt.sound) vidPayload.sound = true;
    const vid = await api.generateVideo(vidPayload);
    const vidDone = await waitForJob(vid.taskId);
    const result = {
      status: vidDone.status,
      image: { taskId: img.taskId, url: frame },
      video: { taskId: vid.taskId, url: vidDone.videoUrl, error: vidDone.error },
    };
    if (opt.out && vidDone.status === "done") {
      result.video.path = await downloadAsset(vidDone.videoUrl, opt.out);
      result.image.path = await downloadAsset(frame, opt.out);
    }
    out(result);
    if (vidDone.status === "error") process.exitCode = 1;
  },

  async workflow({ pos, opt }) {
    const sub = pos[0] ?? "list";
    if (sub === "list") {
      const { spaces } = await api.workflows();
      return out(spaces.map((s) => ({
        id: s.id, name: s.name, nodes: s.nodes?.length ?? 0,
        updatedAt: s.updatedAt ?? s.createdAt,
      })));
    }
    if (sub === "get") return out(await api.workflowGet(req(pos[1], "workflow get <id>")));
    if (sub === "delete") return out(await api.workflowDelete(req(pos[1], "workflow delete <id>")));
    if (sub === "export") {
      const space = await api.workflowGet(req(pos[1], "workflow export <id>"));
      const file = opt.out ?? `workflow-${space.id}.json`;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(file, JSON.stringify(space, null, 2) + "\n");
      return out({ ok: true, path: file, id: space.id });
    }
    if (sub === "import") {
      const file = req(pos[1], "workflow import <file>");
      const space = JSON.parse(await readFile(file, "utf8"));
      const id = opt.id ?? space.id ?? `wf-${Date.now().toString(36)}`;
      await api.workflowPut(id, space);
      return out({ ok: true, id });
    }
    if (sub === "create") return workflowCreate(opt);
    throw new HeliosError(`Unknown workflow subcommand: ${sub} (list|get|export|import|delete|create)`);
  },
};

async function settleAndReport(taskId, opt, kind) {
  if (opt["no-wait"]) return out({ taskId, status: "pending" });
  err(`[helios] task ${taskId} submitted, waiting…`);
  const st = await waitForJob(taskId, { timeoutMs: num(opt.timeout, 900) * 1000 });
  const result = { taskId, ...st };
  if (opt.out && st.status === "done") {
    const urls = kind === "video" ? [st.videoUrl] : (st.imageUrls ?? [st.imageUrl]);
    result.downloads = [];
    for (const u of urls.filter(Boolean)) result.downloads.push(await downloadAsset(u, opt.out));
  }
  out(result);
  if (st.status === "error") process.exitCode = 1;
}
async function workflowCreate(opt) {
  const name = opt.name ?? `Agent pipeline ${new Date().toISOString().slice(0, 16)}`;
  const imagePrompt = opt["image-prompt"] ?? opt.prompt;
  const videoPrompt = opt["video-prompt"] ?? opt.prompt;
  if (!imagePrompt) throw new HeliosError("workflow create needs --image-prompt (or --prompt)");
  const id = `wf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const edge = (eid, source, target, targetHandle, color, width = 2) => ({
    id: eid, source, target, targetHandle, animated: false,
    style: { stroke: color, strokeWidth: width },
  });
  const nodes = [
    {
      id: `${id}-pt-img`, type: "promptNode", position: { x: 0, y: 640 },
      style: { width: 260, height: 390 },
      data: { label: "Text #1", status: "idle", prompt: imagePrompt },
    },
    {
      id: `${id}-ig`, type: "generateNode", position: { x: 0, y: 0 },
      style: { width: 280, height: 280 },
      data: {
        label: "Image Generator #1", status: "idle",
        model: opt["image-model"] ?? DEFAULT_IMAGE_MODEL,
        aspectRatio: opt.aspect ?? "9:16", quality: opt["image-quality"] ?? "1k",
      },
    },
    {
      id: `${id}-pt-vid`, type: "promptNode", position: { x: 620, y: -430 },
      style: { width: 260, height: 390 },
      data: { label: "Text #2", status: "idle", prompt: videoPrompt ?? imagePrompt },
    },
    {
      id: `${id}-vg`, type: "videoGeneratorNode", position: { x: 620, y: 0 },
      style: { width: 320, height: 220 },
      data: {
        label: "Video Generator #1", status: "idle",
        videoModel: opt["video-model"] ?? DEFAULT_VIDEO_MODEL,
        aspectRatio: opt.aspect ?? "9:16",
        ...(opt.sound ? { sound: true } : {}),
      },
    },
  ];
  const edges = [
    edge(`${id}-e1`, `${id}-pt-img`, `${id}-ig`, "prompt", "#2DD4BF"),
    edge(`${id}-e2`, `${id}-ig`, `${id}-vg`, "startFrame", "#818cf8", 2.5),
    edge(`${id}-e3`, `${id}-pt-vid`, `${id}-vg`, "prompt", "#2DD4BF"),
  ];
  if (opt.ref) {
    const refUrl = await resolveMedia(opt.ref);
    nodes.push({
      id: `${id}-ref`, type: "imageInputNode", position: { x: -380, y: 160 },
      style: { width: 260 },
      data: { label: "Reference", status: "idle", r2Url: refUrl },
    });
    edges.push(edge(`${id}-e4`, `${id}-ref`, `${id}-ig`, "image", "#fb923c", 2.5));
  }
  const space = {
    id, name, nodes, edges,
    nodeCounters: { promptNode: 2, generateNode: 1, videoGeneratorNode: 1, imageInputNode: opt.ref ? 1 : 0 },
    createdAt: Date.now(),
  };
  await api.workflowPut(id, space);
  out({ ok: true, id, name, url: `${await baseUrl()}/workflow/${id}` });
}
const HELP = [
  "helios — CLI for the HeliosGen NAS deployment",
  "",
  "Setup:",
  "  helios doctor                        connectivity + key + credit check",
  "  helios config                        show base URL and config file",
  "  helios config set --base-url <url>   point at another HeliosGen server",
  "  helios key status|set <t>|delete     manage the server-side kie.ai key",
  "",
  "Generate (JSON output; local file paths are uploaded automatically):",
  "  helios models [--type image|video]",
  "  helios credit",
  "  helios upload <file...>",
  "  helios image --prompt P [--model M] [--ref X]... [--aspect 1:1] [--quality 1k]",
  "               [--out DIR] [--no-wait] [--debug]",
  "  helios video --prompt P [--model M] [--start-frame X] [--end-frame X] [--ref X]...",
  "               [--duration 5] [--aspect 16:9] [--sound] [--out DIR] [--no-wait] [--debug]",
  "  helios pipeline --prompt P [--image-model M] [--video-model M] [--aspect 9:16]",
  "               [--duration 5] [--sound] [--out DIR]     text→image→video chain",
  "  helios wait <taskId> [--timeout 900]",
  "  helios status <taskId>",
  "",
  "Library:",
  "  helios gallery [--type image|video] [--source generation|upload] [--page N]",
  "  helios download <url> [--out DIR] [--name FILE]",
  "",
  "Workflows (canvas):",
  "  helios workflow list | get <id> | export <id> [--out FILE]",
  "  helios workflow import <file> [--id ID] | delete <id>",
  "  helios workflow create --image-prompt P [--video-prompt P] [--name N]",
  "               [--image-model M] [--video-model M] [--ref FILE] [--aspect 9:16] [--sound]",
  "",
  "Notes:",
  "  --debug validates and prints the payload server-side without spending credits.",
  "  Defaults: image model nano-banana-2-lite, video model seedance-2-fast.",
  "  Google Veo video models are not supported on this NAS deployment.",
  "",
].join("\n");

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return;
  }
  const fn = commands[cmd];
  if (!fn) throw new HeliosError(`Unknown command: ${cmd}. Run 'helios help'.`);
  await fn(parseArgs(rest));
}

main().catch((e) => {
  if (e instanceof HeliosError) {
    err(JSON.stringify({ error: e.message, status: e.status }));
  } else {
    err(e.stack ?? String(e));
  }
  process.exit(1);
});
