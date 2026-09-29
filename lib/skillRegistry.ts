export type SkillScope = "prompt" | "workflow" | "generation" | "asset" | "all";
export type SkillDefinition = {
  id: string; name: string; description: string; version: string; enabled: boolean;
  scope: SkillScope; instructions: string; allowedNodeTypes?: string[]; allowedTools?: string[];
  defaults?: Record<string, unknown>; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>;
};

const SKILLS: SkillDefinition[] = [
  { id: "prompt-engineering", name: "Prompt Engineering", description: "构造和优化生成提示词", version: "1.0.0", enabled: true, scope: "prompt", instructions: "保持用户意图，输出结构化、可复用提示词。" },
  { id: "image-generation", name: "Image Generation", description: "图像生成编排", version: "1.0.0", enabled: true, scope: "generation", instructions: "选择已配置的图像 provider/model，并保留异步 job 状态。", allowedTools: ["helios_generate_image"] },
  { id: "video-generation", name: "Video Generation", description: "视频生成编排", version: "1.0.0", enabled: true, scope: "generation", instructions: "校验时长、比例、参考帧和付费边界。", allowedTools: ["helios_generate_video"] },
  { id: "image-processing", name: "Image Processing", description: "图像处理节点编排", version: "1.0.0", enabled: true, scope: "workflow", instructions: "优先使用客户端处理节点，避免重复上传。" },
  { id: "workflow-builder", name: "Workflow Builder", description: "创建和增量修改工作流", version: "1.0.0", enabled: true, scope: "workflow", instructions: "使用 workflowSpec 和 JSON Patch，先校验再运行。", allowedTools: ["helios_workflow_summary", "helios_workflow_validate", "helios_workflow_patch"] },
  { id: "asset-library", name: "Asset Library", description: "资产库检索和引用", version: "1.0.0", enabled: true, scope: "asset", instructions: "优先返回 asset id 或 /generated URL。" },
  { id: "seek-sync", name: "Seek Sync", description: "Seek 与 HeliosGen 资产同步", version: "1.0.0", enabled: true, scope: "asset", instructions: "同步前保留来源和 seekGuid，操作必须幂等。" },
];

export function listSkills() { return SKILLS.map(({ instructions: _instructions, ...s }) => s); }
export function getSkill(id: string) { return SKILLS.find((s) => s.id === id) ?? null; }
export function resolveSkills(ids: string[], scope?: SkillScope) { return ids.map(getSkill).filter((s): s is SkillDefinition => !!s && s.enabled && (!scope || s.scope === scope || s.scope === "all")); }
