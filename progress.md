# Progress Log

## 2026-09-11

### 计划模式
- 读取 planning-with-files 技能，创建 task_plan.md / findings.md / progress.md
- 前序调研（评估轮）结论已沉淀到 findings.md
- 待办：Phase 0 代码图谱索引 → Phase 1 移植

### Phase 0 — complete
- HeliosGen 代码图谱已建（codebase-memory：2023 节点 / 4323 边）
- 基线确认：tsc 通过；eslint 存量问题仅 WorkflowCanvas 的 react-hooks/refs（8 个，早于本次改动，不动）
- node-banana 四个源节点 + utils（imageResize/backgroundRemoval/gridSplitter/splitGridExecutor）已读透

### Phase 1 — in_progress（实现完成，待部署验证）
- 新增 lib/imageResize.ts、lib/backgroundRemoval.ts、lib/gridSplitter.ts（精简版，去掉自动检测）、lib/nodeOutput.ts（处理结果回传 /api/upload 换 r2Url）
- 新增 4 节点组件：ImageResizeNode / RemoveBackgroundNode / SplitGridNode（点击格子选输出）/ ImageCompareNode（A/B 滑杆，纯查看）
- 接线：store.ts NodeData 字段 + getNodeLabel；nodeTypes.tsx NODE_META/NODES/NODE_SIZE（新 category "processors"）；WorkflowCanvas nodeTypes 注册；NodePickerMenu sourceNodeTypesFor/targetHandleFor 放行图像来源互通
- 依赖：@imgly/background-removal 1.7.0 + onnxruntime-web 1.21.0（锁定，peer 要求）+ react-compare-slider 3.1.0
- 验证：tsc OK；DESKTOP_BUILD=1 build OK；新增代码 eslint 0 error
- 决策：SplitGrid 不搬 node-banana 的"格子变子画布"机制，改为格子弹选（HeliosGen executor 单 imageUrl 模型）；处理节点手动 Run，不进 pipeline waves

### Phase 1 — complete（NAS 实测通过）
- 部署：NAS 重建镜像并重建 heliosgen 容器（asset-bridge 未受影响，刻意指定服务名）
- 实测（Playwright 驱动 NAS 9443）：Resize 输出 640x360；Split Grid 2x2 选格输出；Compare 双图滑杆渲染；Remove BG 经自托管模型修复后产出透明 PNG
- 关键修复：@imgly/background-removal 默认 CDN（staticimgly.com）在本网络/浏览器不可达（Invalid format: text/html），自托管 86 个模型分块（272MB）到共享素材目录 /vol1/@team/AIGC 创作/创作资产/bgremoval/，经 /generated/bgremoval/ 提供
- 发现并适配：另一会话已把 /data/media 改挂到共享团队目录（asset-bridge 同步源），模型目录随之放到该目录
- 已知取舍：SplitGrid 的格子预览存在组件 state，刷新页面后需重新 Split（选中输出已持久化）；处理节点不进入 pipeline 自动波次，需点节点上的 Run
- 清理：测试工作流 P1 Node Test 已删除（其余空间保留）

## 2026-09-29

### 分支统一与提交
- 工作区 45 个改动文件 + 32 个新增文件分两个提交落在 `nas-agent-cli`：`0426a3e`（节点 / i18n / registry / HTTP 兼容）与 `99eacdf`（计划文档）
- `main` 快进到 `nas-agent-cli`，再并入上游 `upstream/main`（`99dd5b1`，PR #28 音频 MIME 修复 + codex 修复），无冲突自动合并 → 合并提交 `5f31a16`
- `nas-agent-cli` 与 `dulse` 一并指向 `5f31a16`，三条分支内容一致
- 版本号随上游升到 `1.2.1`；新增依赖（@imgly/background-removal、onnxruntime-web、react-compare-slider、next-intl、@noble/hashes）与上游依赖改动均已保留
- 验证：`npx tsc --noEmit` 通过
- 文档：README.nas.md 更新版本/提交并新增「功能总览」；README.md 更新 Features / Nodes / Supported Models / Tech Stack；AGENTS.md 补充目录说明与验证命令
- Lint：清掉本分支新增的 11 个问题（prefer-const、no-explicit-any ×5、no-img-element ×3、no-unused-vars ×2、exhaustive-deps、react-hooks/immutability），eslint 154 项 vs 上游 156 项，未新增；tsc 与 `pnpm build` 通过

### 功能验证与 code review
- 本地隔离实例（`HELIOS_DATA_DIR`/`HELIOS_MEDIA_DIR` 指向 /tmp，不碰真实 data/ 与 public/generated/），`env -u KIE_API_KEY` 保证 provider 判定可复现
- 接口层 87 项断言全过：capabilities / providers / skills / models / workflows（summary·validate·patch）/ upload / media-poster / extract-frame / trim-video / gallery / assets / i18n，含路径穿越与非法入参
- 回归脚本：`node --test scripts/test-http-hash.mjs scripts/test-browser-id.mjs`（9 项）、`scripts/test-http-clipboard.mjs`（1 项）、新增 `scripts/test-provider-api.mjs`（6 项，已验证在修复前会失败 3 项）
- 浏览器实测（chrome-devtools，NAS 同款 HTTP 入口）：/workflow/nodetest 载入 10 个节点，8 个新节点标签与 handle 正确；Resize 把 400×300 源图输出 200×100 PNG 并落盘（ffprobe 复核 `png,200,100`）；Split Grid 2×2 出 4 格、选中 cell 2 后输出持久化；无 React/hydration 报错
- 已知无害告警：无 Key 时 `/api/credit` 返回 401（浏览器记为 error）；DevTools 提示 10 个表单字段缺 id/name

#### 修复（本轮 review 发现）
1. `lib/providerRegistry.ts`：`listProviders()` 的 `{ ...p, secretRef: undefined }` 根本没脱敏——`secretRef` 在 `auth` 下，且顶层 `undefined` 会被 JSON 丢弃。`GET /api/providers` 与 `/api/capabilities` 一直回显内部 settings 键名（`kie_api_token` 等）。改为显式构造 `PublicProvider`（不含 secretRef），另加内部 `getProviderDefinition()` 供路由查密钥。
2. `configured` 三处不一致：`configured()` 只认 kie/azure，其他 provider 即使存了 Key 也报 false；`/api/providers/<id>` 又只读 DB 设置、忽略 env 回退，导致同一响应里 `provider.configured` 与顶层 `configured` 自相矛盾（fal 实测 false/true 并存）。统一为单一 `isConfigured()`。
3. `app/api/skills` POST 硬编码 `configured: true`（技能并无配置概念，字段无意义）——移除。
4. `lib/mediaPreview.ts`：`previewImageUrl()` 未拦截绝对 http(s) URL，而 `/_next/image` 对不在 `images.remotePatterns` 的主机返回 400（实测 `cdn.kie.ai` → `"url" parameter is not allowed`）。当前资产 URL 均为本地，属潜在问题，加一行放行。

### 遗留
- Phase 2 四个节点的 NAS 实测未做（节点代码已在线上，只是没点过）
- 2026-09-29 已重新部署：同步源码（tar over ssh，排除 .env.sync / secrets / node_modules / .next / data）→ build → `up -d --force-recreate --no-deps heliosgen`，asset-bridge 未受影响（Up 4 days，reconcile helios=169 seek=169）
- 部署后实测：`/api/providers` 不再回显 `secretRef`；nested/top-level `configured` 一致；15 节点 / 8 provider / 7 skill；`lang=zh-CN`；169 条资产与两张测试图完好；上游音频 MIME 修复生效
- 回滚点：镜像 `heliosgen:rollback-20260929`、源码 `/home/wyai/heliosgen-src-backup-20260929.tar.gz`
- 已知存量问题（非本次引入，重建前后镜像一致）：`/app/.next/cache` 不存在而 compose 把 `data/cache/next-images` 挂到其子目录，Docker 以 root 建出该目录，`node` 用户无法再建 `fetch-cache`，日志出现 2 次 EACCES（不影响功能）。修法：runtime 阶段加 `mkdir -p /app/.next/cache && chown node:node`。
