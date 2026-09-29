"use client";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useMemo } from "react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
type T=Node<NodeData,"promptConstructorNode">;
export default function PromptConstructorNode({id,data,selected}:NodeProps<T>){const update=useWorkflowStore(s=>s.updateNodeData);const nodes=useWorkflowStore(s=>s.nodes);const edges=useWorkflowStore(s=>s.edges);const upstream=useMemo(()=>resolveInputs(id,nodes,edges).prompt??"",[id,nodes,edges]);const template=data.promptTemplate??"{input}";const output=template.replaceAll("{input}",upstream);return <div className={"w-[280px] rounded-xl border bg-neutral-900/95 text-neutral-200 "+(selected?"border-blue-500/70":"border-neutral-700/60")}><Handle type="target" position={Position.Left} id="prompt"/><Handle type="source" position={Position.Right} id="prompt"/><div className="px-3 py-2 border-b border-neutral-800 text-xs font-semibold">Prompt Constructor</div><div className="p-2 space-y-2"><textarea className="nodrag w-full h-20 bg-neutral-800 rounded p-1 text-[11px]" value={template} onChange={e=>update(id,{promptTemplate:e.target.value,outputText:e.target.value.replaceAll("{input}",upstream)})}/><div className="text-[11px] text-neutral-400 break-words">{output}</div></div></div>}
