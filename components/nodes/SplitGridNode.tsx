"use client";
// Split-grid node — cuts a contact-sheet image into rows x cols cells in the
// browser; clicking a cell makes it the node output. Ported from node-banana
// (MIT), simplified: cells live in component state, the selected cell is
// persisted via /api/upload so it can feed downstream generation nodes.
import { useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { splitWithDimensions } from "@/lib/gridSplitter";
import { persistNodeImage } from "@/lib/nodeOutput";

type SplitGridNodeType = Node<NodeData, "splitGridNode">;

const MAX_GRID = 6;

function clampGrid(n: number): number {
  return Math.min(MAX_GRID, Math.max(1, Math.round(n) || 1));
}

export default function SplitGridNode({ id, data, selected }: NodeProps<SplitGridNodeType>) {
  const t = useTranslations("nodes");
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const [cells, setCells] = useState<string[]>([]);

  const upstreamImage = useMemo(
    () => resolveInputs(id, nodes, edges).imageUrls[0] ?? null,
    [id, nodes, edges],
  );

  const rows = clampGrid(data.gridRows ?? 2);
  const cols = clampGrid(data.gridCols ?? 2);
  const running = data.status === "running";

  const run = async () => {
    if (!upstreamImage || running) return;
    updateNodeData(id, { status: "running", errorMsg: undefined });
    try {
      const { images } = await splitWithDimensions(upstreamImage, rows, cols);
      setCells(images);
      updateNodeData(id, { status: "idle" });
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e) });
    }
  };

 const pick = async (index: number) => {
   const cell = cells[index];
   if (!cell) return;
   updateNodeData(id, { selectedCell: index });
   await persistNodeImage(updateNodeData, id, cell, { selectedCell: index });
 };

  // Changing the grid geometry invalidates both the cached cell previews and
  // any previously selected output cell.
  const setGrid = (patch: { gridRows?: number; gridCols?: number }) => {
    setCells([]);
    updateNodeData(id, { ...patch, selectedCell: undefined, imageUrl: undefined, r2Url: undefined, status: "idle" });
  };

  const inputCls = "nodrag flex-1 min-w-0 px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-200 text-[10px]";

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
        <LayoutGrid size={13} className="text-sky-400" />
        Split Grid
      </div>

      <div className="p-2 flex flex-col gap-2">
        <div className="flex items-center gap-1 text-[10px] text-neutral-400 nodrag">
          <span>{t("rows")}</span>
          <input type="number" min={1} max={MAX_GRID} id={`${id}-rows`} name="rows" aria-label={t("ariaRows")} className={inputCls} value={rows}
            onChange={(e) => setGrid({ gridRows: clampGrid(Number(e.target.value)) })} />
          <span>{t("cols")}</span>
          <input type="number" min={1} max={MAX_GRID} id={`${id}-cols`} name="cols" aria-label={t("ariaColumns")} className={inputCls} value={cols}
            onChange={(e) => setGrid({ gridCols: clampGrid(Number(e.target.value)) })} />
          <button
            onClick={run}
            disabled={!upstreamImage || running}
            className="ml-auto px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors"
          >
            {running ? t("splitting") : t("split")}
          </button>
        </div>

        {cells.length > 0 ? (
          <div
            className="grid gap-0.5 nodrag"
            style={{ gridTemplateColumns: "repeat(" + cols + ", minmax(0, 1fr))" }}
          >
            {cells.map((cell, i) => (
              <button
                key={i}
                onClick={() => pick(i)}
                title={"Use cell " + (i + 1) + " as output"}
                className={
                  "relative rounded overflow-hidden border transition-colors " +
                  (data.selectedCell === i && data.imageUrl
                    ? "border-blue-500"
                    : "border-neutral-700 hover:border-neutral-500")
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- runtime workflow media */}
                <img src={cell} alt={"Cell " + (i + 1)} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <div className="h-24 bg-neutral-950/60 rounded flex items-center justify-center">
            <span className="text-[10px] text-neutral-500 text-center px-4">
              {upstreamImage ? t("splitHint") : t("connectImage")}
            </span>
          </div>
        )}

        {data.imageUrl && (
          <div className="text-[10px] text-neutral-500">
            Output: cell {(data.selectedCell ?? 0) + 1} of {cells.length || rows * cols}
          </div>
        )}

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
