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

### 遗留
- Phase 2 四个节点的 NAS 部署实测未做
- NAS 上运行的仍是上一版镜像（`heliosgen:nas-http-20260915`），需重新构建部署才会生效
