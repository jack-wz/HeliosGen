"use client";
import { useMemo, useState } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";

type T = Node<NodeData, "videoFrameGrabNode">;
export default function VideoFrameGrabNode({ id, data, selected }: NodeProps<T>) {
  const t = useTranslations("nodes");
  const update=useWorkflowStore((s)=>s.updateNodeData); const nodes=useWorkflowStore((s)=>s.nodes); const edges=useWorkflowStore((s)=>s.edges); const [busy,setBusy]=useState(false);
  const input=useMemo(()=>resolveInputs(id,nodes,edges).videoUrl??data.videoUrl??null,[id,nodes,edges,data.videoUrl]); const time=data.frameTimeSeconds??0;
  const run=async()=>{if(!input||busy)return;setBusy(true);update(id,{status:"running",errorMsg:undefined});try{const r=await fetch("/api/extract-frame",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({videoUrl:input,timeSeconds:time,lastFrame:Boolean(data.lastFrame)})});const j=await r.json();if(!r.ok||!j.cdnUrl)throw new Error(j.error||t("errFrame"));update(id,{imageUrl:j.cdnUrl,status:"done"});}catch(e){update(id,{status:"error",errorMsg:e instanceof Error?e.message:String(e)});}finally{setBusy(false);}};
  return <div className={"w-[240px] rounded-xl border bg-neutral-900/95 shadow-lg text-neutral-200 "+(selected?"border-blue-500/70":"border-neutral-700/60")}><Handle type="target" position={Position.Left} id="video" className="node-handle-icon node-handle-icon-image"/><Handle type="source" position={Position.Right} id="image" className="node-handle-icon node-handle-icon-out-image"/><div className="flex items-center gap-1.5 px-3 py-2 border-b border-neutral-800 text-xs font-semibold"><Camera size={13} className="text-sky-400"/>{t("grabTitle")}</div><div className="p-2 space-y-2"><div className="h-28 rounded bg-neutral-950 flex items-center justify-center overflow-hidden">{data.imageUrl?(
          // eslint-disable-next-line @next/next/no-img-element -- runtime workflow media
          <img src={data.imageUrl} alt="Frame" className="max-h-full max-w-full object-contain"/>
        ):<span className="text-[10px] text-neutral-500">{input?t("ready"):t("connectVideo")}</span>}</div><div className="flex items-center gap-1 text-[10px]">{t("time")} <input type="number" min="0" id={`${id}-frame-time`} name="frameTimeSeconds" aria-label="Frame time (seconds)" className="nodrag w-20 px-1 py-0.5 bg-neutral-800 rounded" value={time} onChange={e=>update(id,{frameTimeSeconds:Number(e.target.value)||0})}/><label className="ml-auto"><input className="nodrag" type="checkbox" id={`${id}-last-frame`} name="lastFrame" checked={Boolean(data.lastFrame)} onChange={e=>update(id,{lastFrame:e.target.checked})}/> {t("last")}</label></div><button className="nodrag w-full rounded bg-sky-700 px-2 py-1 text-[10px]" onClick={run} disabled={!input||busy}>{busy?t("grabbing"):t("grabRun")}</button>{data.errorMsg&&<div className="text-[10px] text-red-400">{data.errorMsg}</div>}</div></div>;
}
