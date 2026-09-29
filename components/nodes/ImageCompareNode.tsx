"use client";
// Image compare node — slider view over two upstream images (A/B).
// Viewer only: no output handle. Ported from node-banana (MIT), adapted.
import { useMemo } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";

type CompareNodeType = Node<NodeData, "imageCompareNode">;

export default function ImageCompareNode({ id, selected }: NodeProps<CompareNodeType>) {
  const t = useTranslations("nodes");
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const images = useMemo(() => resolveInputs(id, nodes, edges).imageUrls, [id, nodes, edges]);
  const imageA = images[0] ?? null;
  const imageB = images[1] ?? null;

  return (
    <div
      className={
        "w-[400px] rounded-xl border bg-neutral-900/95 shadow-lg text-neutral-200 " +
        (selected ? "border-blue-500/70" : "border-neutral-700/60")
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "50%" }}
        className={"node-handle-icon node-handle-icon-image" + (imageA ? " node-handle-connected" : "")}
      />

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-800 text-xs font-semibold">
        <ArrowLeftRight size={13} className="text-sky-400" />
        Compare
        <span className="ml-auto text-[11px] font-normal text-neutral-500">connect two images</span>
      </div>

      <div className="p-2">
        {imageA && imageB ? (
          <div className="rounded overflow-hidden nodrag nowheel" style={{ touchAction: "none" }}>
            <ReactCompareSlider
              itemOne={<ReactCompareSliderImage src={imageA} alt="Image A" style={{ objectFit: "contain", background: "#0a0a0a" }} />}
              itemTwo={<ReactCompareSliderImage src={imageB} alt="Image B" style={{ objectFit: "contain", background: "#0a0a0a" }} />}
              style={{ width: "100%", height: 280 }}
            />
          </div>
        ) : (
          <div className="h-40 bg-neutral-950/60 rounded flex items-center justify-center">
            <span className="text-[11px] text-neutral-500 text-center px-4">
              {imageA ? t("compareConnectSecond") : t("compareConnectBoth")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
