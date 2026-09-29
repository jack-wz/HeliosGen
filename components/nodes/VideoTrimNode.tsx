"use client";
import { useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { Scissors } from "lucide-react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";

type T = Node<NodeData, "videoTrimNode">;
export default function VideoTrimNode({ id, data, selected }: NodeProps<T>) {
  const update = useWorkflowStore((s) => s.updateNodeData);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const [busy, setBusy] = useState(false);
  const input = useMemo(() => resolveInputs(id, nodes, edges).videoUrl ?? data.videoUrl ?? null, [id, nodes, edges, data.videoUrl]);
  const start = data.trimStart ?? 0; const end = data.trimEnd ?? 10;
  const run = async () => { if (!input || busy) return; setBusy(true); update(id,{status:"running",errorMsg:undefined}); try { const r=await fetch("/api/trim-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({videoUrl:input,startTime:start,endTime:end})}); const j=await r.json(); if(!r.ok||!j.cdnUrl) throw new Error(j.error||"Trim failed"); update(id,{videoUrl:j.cdnUrl,trimDuration:Math.max(0,end-start),status:"done"}); } catch(e){update(id,{status:"error",errorMsg:e instanceof Error?e.message:String(e)});} finally{setBusy(false);} };
  const cls="nodrag w-16 px-1 py-0.5 bg-neutral-800 rounded text-[10px] text-neutral-200";
  return <div className={"w-[260px] rounded-xl border bg-neutral-900/95 shadow-lg text-neutral-200 "+(selected?"border-blue-500/70":"border-neutral-700/60")}>
    <Handle type="target" position={Position.Left} id="video" className="node-handle-icon node-handle-icon-image" />
    <Handle type="source" position={Position.Right} id="video" className="node-handle-icon node-handle-icon-out-image" />
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-800 text-xs font-semibold"><Scissors size={13} className="text-sky-400"/>Video Trim</div>
    <div className="p-2 space-y-2"><div className="text-[10px] text-neutral-500 truncate">{input??"Connect a video"}</div><div className="flex items-center gap-1 text-[10px]">Start <input type="number" min="0" className={cls} value={start} onChange={e=>update(id,{trimStart:Number(e.target.value)||0})}/> End <input type="number" min="0" className={cls} value={end} onChange={e=>update(id,{trimEnd:Number(e.target.value)||0})}/></div><button className="nodrag w-full rounded bg-sky-700 px-2 py-1 text-[10px]" onClick={run} disabled={!input||busy}>{busy?"Trimming…":"Run trim"}</button>{data.errorMsg&&<div className="text-[10px] text-red-400">{data.errorMsg}</div>}</div>
  </div>;
}
