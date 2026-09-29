"use client";
// Image resize node — browser-side canvas processing, no external API.
// Ported from node-banana (MIT) and adapted to the HeliosGen store/executor.
import { useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { Scaling } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import {
  resizeImage,
  type ImageResizeMode,
  type ImageResizeFit,
  type ImageResizeFormat,
} from "@/lib/imageResize";
import { persistNodeImage } from "@/lib/nodeOutput";

type ResizeNodeType = Node<NodeData, "imageResizeNode">;

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export default function ImageResizeNode({ id, data, selected }: NodeProps<ResizeNodeType>) {
  const t = useTranslations("nodes");
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const [busy, setBusy] = useState(false);

  const upstreamImage = useMemo(
    () => resolveInputs(id, nodes, edges).imageUrls[0] ?? null,
    [id, nodes, edges],
  );

  const mode: ImageResizeMode = data.resizeMode ?? "maxEdge";
  const fit: ImageResizeFit = data.resizeFit ?? "contain";
  const format: ImageResizeFormat = data.resizeFormat ?? "keep";
  const quality = data.resizeQuality ?? 0.9;
  const running = busy || data.status === "running";
  const preview = data.imageUrl ?? upstreamImage;

  const run = async () => {
    if (!upstreamImage || running) return;
    setBusy(true);
    updateNodeData(id, { status: "running", errorMsg: undefined });
    try {
      const result = await resizeImage(upstreamImage, {
        mode,
        width: data.resizeWidth ?? 1024,
        height: data.resizeHeight ?? 1024,
        maxEdge: data.resizeMaxEdge ?? 1024,
        scalePct: data.resizeScalePct ?? 50,
        fit,
        format,
        quality,
      });
      await persistNodeImage(updateNodeData, id, result.dataUrl, {
        outputWidth: result.width,
        outputHeight: result.height,
        outputBytes: result.bytes,
      });
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const tabCls = (active: boolean) =>
    "flex-1 px-1.5 py-1 rounded text-[10px] font-medium transition-colors " +
    (active ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200");
  const inputCls = "nodrag flex-1 min-w-0 px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-200 text-[10px]";

  return (
    <div
      className={
        "w-[300px] rounded-xl border bg-neutral-900/95 shadow-lg text-neutral-200 " +
        (selected ? "border-blue-500/70" : "border-neutral-700/60") +
        (data.status === "error" ? " border-red-700/70" : "")
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "50%" }}
        className={"node-handle-icon node-handle-icon-image" + (upstreamImage ? " node-handle-connected" : "")}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ top: "50%" }}
        className={"node-handle-icon node-handle-icon-out-image" + (data.imageUrl ? " node-handle-connected" : "")}
      />

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-800 text-xs font-semibold">
        <Scaling size={13} className="text-sky-400" />
        Resize
      </div>

      <div className="p-2 flex flex-col gap-2">
        <div className="relative h-36 bg-neutral-950/60 rounded overflow-hidden flex items-center justify-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- runtime workflow media
            <img src={preview} alt="Resize preview" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[10px] text-neutral-500">{t("connectImage")}</span>
          )}
          {running && (
            <div className="absolute inset-0 bg-neutral-900/70 flex items-center justify-center">
              <span className="text-[10px] text-white">{t("resizing")}</span>
            </div>
          )}
        </div>

        <div className="flex gap-1 nodrag">
          <button className={tabCls(mode === "exact")} onClick={() => updateNodeData(id, { resizeMode: "exact" })}>{t("modeExact")}</button>
          <button className={tabCls(mode === "maxEdge")} onClick={() => updateNodeData(id, { resizeMode: "maxEdge" })}>{t("modeMaxEdge")}</button>
          <button className={tabCls(mode === "scale")} onClick={() => updateNodeData(id, { resizeMode: "scale" })}>{t("modeScale")}</button>
        </div>

        {mode === "exact" && (
          <div className="flex items-center gap-1 text-[10px] text-neutral-400 nodrag">
            <span>W</span>
            <input type="number" min={1} id={`${id}-width`} name="width" aria-label={t("ariaWidth")} className={inputCls} value={data.resizeWidth ?? 1024}
              onChange={(e) => updateNodeData(id, { resizeWidth: Number(e.target.value) || 1 })} />
            <span>H</span>
            <input type="number" min={1} id={`${id}-height`} name="height" aria-label={t("ariaHeight")} className={inputCls} value={data.resizeHeight ?? 1024}
              onChange={(e) => updateNodeData(id, { resizeHeight: Number(e.target.value) || 1 })} />
          </div>
        )}
        {mode === "maxEdge" && (
          <div className="flex items-center gap-1 text-[10px] text-neutral-400 nodrag">
            <span>{t("modeMaxEdge")}</span>
            <input type="number" min={1} id={`${id}-max-edge`} name="maxEdge" aria-label={t("ariaMaxEdge")} className={inputCls} value={data.resizeMaxEdge ?? 1024}
              onChange={(e) => updateNodeData(id, { resizeMaxEdge: Number(e.target.value) || 1 })} />
            <span>px</span>
          </div>
        )}
        {mode === "scale" && (
          <div className="flex items-center gap-1 text-[10px] text-neutral-400 nodrag">
            <span>{t("scale")}</span>
            <input type="number" min={1} max={400} id={`${id}-scale`} name="scalePct" aria-label={t("ariaScalePercent")} className={inputCls} value={data.resizeScalePct ?? 50}
              onChange={(e) => updateNodeData(id, { resizeScalePct: Math.min(400, Math.max(1, Number(e.target.value) || 1)) })} />
            <span>%</span>
          </div>
        )}

        {mode === "exact" && (
          <div className="flex gap-1 nodrag">
            {(["contain", "cover", "stretch"] as ImageResizeFit[]).map((f) => (
              <button key={f} className={tabCls(fit === f)} onClick={() => updateNodeData(id, { resizeFit: f })}>{f}</button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 text-[10px] text-neutral-400 nodrag">
          <select
            className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-200"
            value={format}
            onChange={(e) => updateNodeData(id, { resizeFormat: e.target.value as ImageResizeFormat })}
          >
            <option value="keep">{t("formatKeep")}</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
          {(format === "jpeg" || format === "webp") && (
            <>
              <span>{t("quality")}</span>
              <input type="range" min={0.1} max={1} step={0.05} value={quality} id={`${id}-quality`} name="quality" aria-label={t("quality")} className="flex-1"
                onChange={(e) => updateNodeData(id, { resizeQuality: Number(e.target.value) })} />
              <span className="w-7 text-right text-neutral-500">{quality.toFixed(2)}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-neutral-500">
            {data.outputWidth ? data.outputWidth + "×" + data.outputHeight + " · " + formatBytes(data.outputBytes) : ""}
          </span>
          <button
            onClick={run}
            disabled={!upstreamImage || running}
            className="nodrag px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors"
          >
            {running ? t("resizing") : t("resizeRun")}
          </button>
        </div>

        {data.status === "error" && data.errorMsg && (
          <div className="px-2 py-1.5 bg-red-900/30 border border-red-700/50 rounded">
            <p className="text-[10px] text-red-400 break-words">{data.errorMsg}</p>
          </div>
        )}
        {data.persistWarning && (
          <div className="px-2 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded">
            <p className="text-[10px] text-amber-400 break-words">{data.persistWarning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
