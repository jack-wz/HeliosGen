# Task Plan: HeliosGen review 收口

## Goal

把 2026-09-29 全面 review（功能 / 性能 / 交互 / 设计）里列出的问题全部落地：设计系统收敛、i18n 全量、交互与可访问性修复、性能与架构项，最后统一验证并部署到 NAS。

## 起点（已完成，勿重做）

| 已修复 | 提交 |
|---|---|
| SSRF（`/api/fetch-url` 内网拦截 + 逐跳校验） | `3039757` |
| 非 Docker 构建版本号恒为 `0.0.0`（更新横幅误报） | `3039757` |
| hero 图 4,952KB → 116KB | `3039757` + `6e5b36f` |
| shadcn token 层缺失（`@theme` / `:root` 补齐） | `6e5b36f` |
| `dark:` 跟随系统而非 class（`@custom-variant`） | `6e5b36f` |
| provider `secretRef` 泄漏 + `configured` 不一致 | `930a762` |
| 分支统一 + 上游 `99dd5b1` 并入 | `5f31a16` |
| NAS 两次部署（含 SSRF 修复） | `46ad83e` |

当前 HEAD：`6e5b36f`，工作区干净，NAS 已跑该版本之前的代码（SSRF 修复已上线）。

## Phases

### R1: 低风险收尾
- [ ] Dockerfile.nas runtime 阶段补 `mkdir -p /app/.next/cache && chown node:node`（消除线上 2 次 EACCES）
- [ ] 统一 `prestart-token.sh` 路径（README 指 `scripts/`，仓库在 `bridge/`）
- **verify:** `pnpm build` 通过；本地 `docker build` 可跳过（NAS 部署时验证）；README 路径与仓库一致

### R2: 设计 token 化（hex → token）
- [ ] `app/globals.css`：把手写系统的 hex 抽成 `:root` 变量（surface / border / text / 角色色），CSS 内部改用 `var()`
- [ ] TSX 中与调色板重复的 hex 换成 token 或 `var(--...)`
  - 批次 1（可审）：`WorkflowHero` 25、`WorkflowDashboard` 20、`AppSidebar` 22、`MediaPickerModal` 13、`WorkflowCanvas` 13
  - 批次 2（量大）：`gallery/page.tsx` 139、`GenerateNode` 94、`VideoGeneratorNode` 62、`PromptNode` 45
- **verify:** 每批次后 `tsc` + `pnpm build`；Playwright 截图与改前逐页比对无视觉差异；`grep -c '#[0-9a-fA-F]\{6\}'` 计数下降

### R3: i18n 全量
- [ ] 首屏优先：`WorkflowDashboard`、`WorkflowHero`（当前中英混排最明显处）
- [ ] 其余：`MediaPickerModal`、`CanvasToolbar`、节点组件文案、设置弹窗余量、API 错误码
- [ ] `messages/zh-CN.json` / `en.json` 键集保持一致
- **verify:** 键集 diff 为空；浏览器在 `hg_locale=zh-CN` / `en` 下首屏无英文残留；CLI/MCP 读取的 `error` 字段仍为英文稳定 code

### R4: 交互与可访问性
- [ ] 节点正文 8–10px 提升到可读字号（先确认对画布观感的影响）
- [ ] 10 个表单字段补 `id` / `name`
- [ ] 缺图 fallback（`onError` 回落到占位）
- [ ] `/workflow/<id>` 直链跳转问题
- **verify:** 浏览器实测；`grep` 确认无缺 id 的 input；直链可打开

### R5: 性能与架构
- [ ] 评估 47 条路由全动态（根布局读 cookies）：给出可静态化的边界与代价，做安全的部分
- [ ] `app/gallery/page.tsx` 7212 行拆分：先做无行为变化的机械拆分，再评估
- **verify:** 每步 `tsc` + `build` + 截图无回归；页面首屏体积不增

### R6: 验证与部署
- [ ] tsc / `pnpm build` / 21 项回归测试 + clipboard / eslint 不新增
- [ ] Playwright 全页截图比对
- [ ] 部署到 NAS（回滚点 + 同步 + build + `--no-deps` recreate）
- **verify:** 线上实测各修复点；asset-bridge 不受影响；数据完好

## Decisions

| 决策 | 理由 |
|---|---|
| 分批次提交，每批可独立回滚 | 540 处 hex + 全量 i18n 属高风险面，大爆炸式改动无法审 |
| 优先首屏（dashboard / hero / 节点） | 用户感知最强；先建立 token 与 i18n 的样板 |
| token 值只从现有手写系统取，不引入新色 | 避免「设计系统收敛」变成重新设计 |
| 不做无行为变化的机械拆分以外的重构 | 无测试框架兜底，重构风险高 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| 读错 CSS chunk 判定 token 缺失 | 1 | CSS 被拆成 3 个 chunk，需逐个查而非 `head -1` |
| `fit:"inside"` 让长边而非短边落在 344 | 1 | 改 `fit:"outside"`（方形裁切约束的是短边） |
| 从 `HEAD` 取原图拿到的是压缩版 | 1 | 压缩已提交，需从 `3039757^` 取 |

---

# 附录：历史计划 — node-banana → HeliosGen 功能节点对齐移植

## Goal

把 node-banana（/Users/wuzhu/orca/node-banana，MIT，fork 含自研剪辑功能）的高价值功能节点分阶段移植进 HeliosGen，每阶段完成「本地测试 → NAS 部署 → 浏览器实测」，最终形成「AI 生成 → 图像处理 → 视频剪辑」的画布闭环。

## Context

- HeliosGen（目标）：Next.js 16 + React 19 + @xyflow/react + zustand，9-11 种节点；生成走服务端 API（kie.ai 轮询 + SQLite 密钥），已部署飞牛 NAS。
- node-banana（源）：同栈，约 30 种节点，MIT 许可。
- 评估结论：框架不整体搬，按节点分层移植；处理类节点输出写 `data.imageUrl` 即可被 `resolveInputs` 自动衔接下游。

### Phase 0: 基线与代码图谱 — complete
### Phase 1: 纯客户端图像处理节点 — complete（Resize / RemoveBG / SplitGrid / Compare，已 NAS 实测）
### Phase 2: 媒体与文本节点 — 代码完成（VideoTrim / FrameGrab / LLMGenerate / PromptConstructor）；NAS 实测待做
### Phase 3: 视频剪辑管线 — pending（VideoStitch / SubtitleBurn / Transcribe）
### Phase 4: 多 provider 与重集成 — pending
### Phase A/B/C: Agent 基础设施 — foundation complete；fal 真实执行适配 pending

## 历史错误记录

| Error | Attempt | Resolution |
|-------|---------|------------|
| playwright_evaluate 返回 undefined | 2 | 改用 get_visible_text + click + screenshot |
| /workflow/p1test 直达被重定向首页 | 1 | useSpaceSync 异步加载，需先进首页再进工作流 |
| RemoveBackground 报 Invalid format: text/html | 1 | 默认 staticimgly CDN 不可达，改自托管模型 |
| NAS 直下 CDN 403 | 1 | CDN 按 UA 拦截；本机带浏览器 UA 下载后传输 |
| 模型块下载截断（61/86） | 2 | 改 curl -C - 断点续传 + 按偏移量校验 |
| compose up --force-recreate 波及 asset-bridge | 1 | 改为指定服务名 |
