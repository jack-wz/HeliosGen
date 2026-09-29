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

### R1: 低风险收尾 — complete（`3653d3a`）
- [x] Dockerfile.nas runtime 阶段补 `mkdir -p /app/.next/cache && chown node:node`（线上实测 EACCES 0 次，属主 node:node）
- [x] 统一 `prestart-token.sh` 路径（README 改为 `bridge/`，与仓库一致）

### R2: 设计 token 化（hex → token）— 部分完成
- [x] `app/globals.css`：93 处 hex → var()，复用已有 token，新增 16 个变量（`9f285b2`）；A/B 像素比对 0.0000%
- [x] TSX：50 处等值 Tailwind 任意值 → 语义类（`85829d1`）
- [ ] 批次 2 未做：剩余 119 处任意值 + gallery/节点内联 hex 属**调色板外的一次性色**，收敛需先决定新色值（属设计决策，非重构）
- **Status:** 可安全机械替换的部分已完成；余下需设计决策

### R3: i18n 全量 — 首屏 + 侧栏完成
- [x] 首屏：`WorkflowDashboard`（5 个子组件）+ `WorkflowHero`，新增 `dashboard` 命名空间 15 条（`994c74f`）；实测 zh-CN 无英文残留、en 无中文
- [x] ICU 复数替换了 `s` 拼接；品牌名加 `translate="no"`
- [x] 侧栏 `AppSidebar`：Folders / New folder / Chats / New chat / No chats yet / Purchase Kie Credits（`126ef2a`）
- [x] `timeAgo` 改用 `Intl.RelativeTimeFormat`（线上实测 `16天前` / `16D AGO`）
- [x] 模板徽标 `4× Image → 4× Video` 入 `messages/extra`
- [ ] 未做：其余 40+ 组件（节点文案、MediaPickerModal、CanvasToolbar、API 错误码）
- **Status:** 首屏与侧栏完成，其余待续

### R4: 交互与可访问性 — 完成（除节点字号）
- [x] 10 个节点表单字段补 `id`/`name`/`aria-label`（`e172b16`）
- [x] `/workflow/<id>` 直链：`useSpaceSync` 新增 `loaded` 信号，守卫等它再判定（`58a4b53`）。实测直链不再跳转、不存在的 id 仍回首页
- [x] 缺图 fallback：`ThumbnailMosaic` 记录加载失败并回落占位（`58a4b53`）
- [ ] 未做：节点正文 8–10px 提字号 —— 会改变画布观感，需先确认
- **Status:** 除字号外完成

### R5: 性能与架构 — 未做（评估后暂缓）
- [ ] 47 条路由全动态：根因是根布局读 `cookies()`（sidebar 状态 + locale），静态化需重构布局与状态来源，风险高于收益
- [ ] `app/gallery/page.tsx` 7212 行拆分：无测试兜底，机械拆分收益有限、回归风险高
- **Status:** 评估完成，建议单独立项

### R6: 验证与部署 — complete
- [x] tsc / build / 21 项回归测试 + clipboard / 版本守卫 / lint 154 无新增 / i18n 键集一致
- [x] 部署：回滚点 `rollback-20260929-3` + 源码备份 → 同步 → build（确认重新编译）→ `--no-deps` recreate
- [x] 线上实测：EACCES 0 次、首屏中文、170 条资产、asset-bridge `helios=170 seek=170`

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
