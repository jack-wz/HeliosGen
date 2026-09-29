"use client";
// Background removal node — client-side AI via IMG.LY/onnxruntime-web (WASM),
// no server round-trip. Ported from node-banana (MIT), adapted to HeliosGen.
import { useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { removeImageBackground, type BackgroundRemovalModel } from "@/lib/backgroundRemoval";
import { persistNodeImage } from "@/lib/nodeOutput";

type RemoveBgNodeType = Node<NodeData, "removeBackgroundNode">;

/** Model tiers are labelled at render time so they follow the active locale. */
function formatModelLabel(m: BackgroundRemovalModel, t: (key: string) => string): string {
  const opt = MODEL_OPTIONS.find((o) => o.value === m);
  return opt ? t(opt.labelKey) : m;
}

const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "#262626",
  backgroundImage:
    "linear-gradient(45deg, #404040 25%, transparent 25%), linear-gradient(-45deg, #404040 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #404040 75%), linear-gradient(-45deg, transparent 75%, #404040 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};

const MODEL_OPTIONS: { value: BackgroundRemovalModel; labelKey: string }[] = [
  { value: "isnet_quint8", labelKey: "modelFast" },
  { value: "isnet_fp16", labelKey: "modelBalanced" },
  { value: "isnet", labelKey: "modelQuality" },
];

export default function RemoveBackgroundNode({ id, data, selected }: NodeProps<RemoveBgNodeType>) {
  const t = useTranslations("nodes");
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const [progress, setProgress] = useState(0);

  const upstreamImage = useMemo(
    () => resolveInputs(id, nodes, edges).imageUrls[0] ?? null,
    [id, nodes, edges],
  );

  const model: BackgroundRemovalModel = data.bgModel ?? "isnet_fp16";
  const running = data.status === "running";

  const run = async () => {
    if (!upstreamImage || running) return;
    setProgress(0);
    updateNodeData(id, { status: "running", errorMsg: undefined });
    try {
      const result = await removeImageBackground(upstreamImage, { model, onProgress: setProgress });
      await persistNodeImage(updateNodeData, id, result);
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e) });
    }
  };

  const tabCls = (active: boolean) =>
    "flex-1 px-2 py-1 rounded text-xs font-medium transition-colors " +
    (active ? "bg-blue-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-neutral-200");

  return (
    <div
      className={
        "w-[320px] rounded-xl border bg-neutral-900/95 shadow-lg text-neutral-200 " +
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
        <Eraser size={13} className="text-sky-400" />
        {t("removeBgTitle")}
      </div>

      <div className="p-2 flex flex-col gap-2">
        <div className="relative h-40 rounded overflow-hidden" style={CHECKERBOARD}>
          {data.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- runtime workflow media
            <img src={data.imageUrl} alt="Background removed" className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center border border-dashed border-neutral-600 rounded">
              <span className="text-[11px] text-neutral-400 text-center px-4">
                {upstreamImage ? t("removeBgRun") : t("removeBgConnect")}
              </span>
            </div>
          )}
          {running && (
            <div className="absolute inset-0 bg-neutral-900/70 flex flex-col items-center justify-center gap-1">
              <span className="text-white text-xs">
                {progress > 0 ? t("processing") + " " + progress + "%" : t("loadingModel")}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-1 nodrag">
          {MODEL_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => updateNodeData(id, { bgModel: option.value })}
              className={tabCls(model === option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        {data.imageUrl && !running && (
          <div className="text-[11px] text-neutral-500">
            {t("removeBgOutputNote", { model: formatModelLabel(data.bgModel ?? "isnet_fp16", t) })}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            onClick={run}
            disabled={!upstreamImage || running}
            className="nodrag px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors"
          >
            {running ? t("processing") : t("removeBgRunBtn")}
          </button>
        </div>

        {data.status === "error" && data.errorMsg && (
          <div className="px-2 py-1.5 bg-red-900/30 border border-red-700/50 rounded">
            <p className="text-[11px] text-red-400 break-words">{data.errorMsg}</p>
          </div>
        )}
        {data.persistWarning && (
          <div className="px-2 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded">
            <p className="text-[11px] text-amber-400 break-words">{data.persistWarning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
