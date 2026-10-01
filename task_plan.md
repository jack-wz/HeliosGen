# 目标（2026-10-01 立）

**完成 HeliosGen 全部未完成项，逐项交付、逐项验证、逐项上线。**

| # | 目标项 | 完成判据 |
|---|---|---|
| G1 | **API 错误码本地化** | 增量式：`error` 保持英文（CLI/MCP 契约不变）+ 新增 `code`；前端按 code 显示本地化消息，未知 code 回落英文。中文界面下不再出现英文错误 |
| G2 | **6 个强调色 token 化** | 先测感知距离再决定命名/合并（同 B 类方法）；像素 A/B 无可见变化 |
| G3 | **R5 路由静态化** | 评估后给出结论：能安全做则做，不能则给出可执行方案与阻塞点 |
| G4 | **R5 gallery 拆分** | `gallery/page.tsx` 从 7212 行拆出可独立维护的组件；像素 A/B 无回归 |

**每一项的完成判据（不可跳过）**：
1. `npx tsc --noEmit` 通过
2. `pnpm build` 通过
3. 回归测试通过（`node --test scripts/test-*.mjs` + clipboard）
4. eslint **无新增**（基线 154）
5. 等价验证：像素 A/B 差异在噪声带内，或功能断言通过
6. 部署到 NAS 并线上验证（用 `scripts/deploy-nas.sh`）
7. 更新 `task_plan.md` / `progress.md` 并推送

**不许做的事**：为了让测试通过而修改安全策略或降低验证标准；把未验证的项目标成已完成。

---

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

### R2: 设计 token 化（hex → token）— A 类完成，B 类待拍板
- [x] `app/globals.css`：93 处 hex → var()，复用已有 token，新增 16 个变量（`9f285b2`）；A/B 像素比对 0.0000%
- [x] TSX：50 处等值 Tailwind 任意值 → 语义类（`85829d1`）
- [x] **A 类**（16 色 / 273 次）：212 处等值替换（`5c2410f`）。hex 由 **115 色 / 607 次 → 100 色 / 365 次**
  - 像素 A/B：canvas 与 settings **0.0000%**；dashboard 0.67% / gallery 0.81% 在同构建噪声带（0.70% / 0.80%）内
  - assets 的 10.9% 已用**原构建 + 全新数据目录**证明是数据状态（reconcile 时序），非样式
  - 排除三类会破坏的用法：8 位带透明度 hex（`#2DD4BF33`，负向断言避开）、颜色选择器调色板（8 行是数据）、`${ACCENT}44` 拼接（`var()` 无法存活）
- [x] **B 类已完成**（`f3cd984`）：测量改变了方案 —— 14 个灰按 L\* 排序构成 5.8–25 ΔE 的连续色阶，只有 2 对近到不可分辨（`#141C28`↔`#111622` ΔE=3.0、`#1A1A1A`↔`#1A1C1F` ΔE=2.6）。故**命名而非压缩**：新增 12 个 `--neutral-N`（值不变，仅 2 处合并），替换 141 处；hex 100/365 → **84/228**。像素 A/B：canvas 与 settings **0.0000%**，dashboard 0.68%（噪声带内）
- [ ] **6 个强调色**（`#A78BFA` 紫 / `#3B82F6` 蓝 / `#818CF8` 靛 / `#082F49` 深蓝 / `#06B6D4` 青 / `#C04040` 暗红）：同样应先测感知距离再决定命名或合并
- [ ] **API 错误码（暂缓，单独立项）**：29 个路由文件 / 74 处 error、前端 32 处无统一入口、需 64+ code 与 128 条词条；且 `cli/lib/client.mjs` 直接读 `error` 作失败消息 → 动它是**契约变更**。建议**增量式**：`error` 保持英文不变 + 新增 `code` 供前端本地化
- [ ] **R5 架构（暂缓）**：根布局读 `cookies()` 致全动态；`gallery/page.tsx` 7212 行。无测试兜底的大重构，建议单独立项并先补测试
- 旧建议（已否决）：~~14 个灰收敛成文字 4 级 / 背景 4 级~~ —— 5.8+ ΔE 下属重新设计 —— 按用途归类后的实测：
  | 层 | 现有色值（次数） |
  |---|---|
  | 文字 | `#CCCCCC`(13) `#4A4A45`(17) `#6B7280`(10) `#888`(5) |
  | 背景 | `#141C28`(15) `#1A1A1A`(14) `#111622`(10) `#2A2A2A`(6) `#2A2D35`(6) `#1A1C1F`(7) `#777`(6) |
  | 混合 | `#555`(9) `#333`(9) `#000`(5) |
  而 `globals.css` 已有 10 个中性色；**再加 14 个 = 24 个，无法维持**。
  建议：**文字 4 级**（#FFFFFF / #CCCCCC / #888888 吸收 #888+#6B7280 / #4A4A45 单独保留——暖橄榄灰，并入 #A0A0A0 会明显变亮）；**背景 4 级**（#0B0E14 / #0D1119 / #141820 / #1A2235 吸收 4 个深色）；**边框 1 级**（#1C2436 吸收 #2A2A2A / #2A2D35）
  → **需你决定各保留几级**：背景从 7 个深色收到 4 个会改变面板明暗关系，属设计决定
- [ ] **C 类（76 色 / 136 次）建议保留**：低频一次性，多为状态色与局部渐变
- **Status:** A 类完成；B 类待设计决策；C 类建议不动

### R3: i18n 全量 — 首屏 + 侧栏完成
- [x] 首屏：`WorkflowDashboard`（5 个子组件）+ `WorkflowHero`，新增 `dashboard` 命名空间 15 条（`994c74f`）；实测 zh-CN 无英文残留、en 无中文
- [x] ICU 复数替换了 `s` 拼接；品牌名加 `translate="no"`
- [x] 侧栏 `AppSidebar`：Folders / New folder / Chats / New chat / No chats yet / Purchase Kie Credits（`126ef2a`）
- [x] `timeAgo` 改用 `Intl.RelativeTimeFormat`（线上实测 `16天前` / `16D AGO`）
- [x] 模板徽标 `4× Image → 4× Video` 入 `messages/extra`
- [x] 7 个处理器节点全部翻译（`7b0bcb8`）：表头、按钮与忙碌态、空态提示、模式页签、模型档位、进度行、失败提示；`MODEL_OPTIONS` 改为存 message key（模块级数组不能调 hook）；「Output produced with {model}」改为 ICU
- [x] 画布周边组件（`4de1fc8`）：`CanvasToolbar`（含 ⌘ 快捷键的 7 个 tooltip）、`NodeActionBar`、`SelectionToolbar`、`MediaPickerModal`（页签/上传/失败提示）、`QuickAssist`、`UpdateBanner`
- [x] `AssistantNode` / `ImageInputNode` / `PromptNode`（`901b1c7`）：句柄标签、显示输入/输出切换、复制/展开/删除标题、剪贴板失败提示等；实测 11/12（两种语言）
- [x] `GenerateNode` / `VideoGeneratorNode` / `VideoInputNode`（`36c7c4d`）：句柄标签、生成状态（等待/排队/生成中/完成/失败/过期）、Azure 画质与分辨率、自定义尺寸、NSFW 警告、取消/删除/自定义、视频输入拖放区与播放控制、各类校验提示
  - 三个模块级数组（`BASE_HANDLES` / `SOURCE_HANDLES` / `VIDEO_SOURCE_HANDLES`）改为存 message key；按模型动态覆盖的「Reference images (up to N)」改为 ICU `{n}` 插值
- [x] `WorkflowCanvas`（`0aa06ac`）：空态标题与三张起始卡片、运行日志、导出/剪贴板 toast、校验错误；实测两种语言 7/7
- [ ] **API 错误码（评估后暂缓，需你决策）**：62 条唯一 error 文案，被 CLI/MCP（`cli/lib/client.mjs` 直接读 `error`）与前端 32 处展示消费。改成本地化会**动接口契约**；建议做成**增量**方案（`error` 保持英文可读消息不变，另加 `code` 供前端本地化），但涉及 62 处路由 + 124 条词条 + 32 处前端，属独立工作量
- **Status:** R3 组件侧完成；仅 API 错误码待决策
- ⚠️ 未验证：`PromptNode` 的 @ 提及菜单标题 `connectedNodes` —— 位于内联提及浮层，需要特定输入序列 + 兄弟节点共享下游的图形结构，headless 下未能稳定复现（键存在、tsc 通过，但**未见其渲染**）
- **Status:** 首屏 + 侧栏 + 处理器节点 + 画布周边 + 3 个生成类节点完成

### R4: 交互与可访问性 — 完成
- [x] 10 个节点表单字段补 `id`/`name`/`aria-label`（`e172b16`）
- [x] `/workflow/<id>` 直链：`useSpaceSync` 新增 `loaded` 信号，守卫等它再判定（`58a4b53`）。实测直链不再跳转、不存在的 id 仍回首页
- [x] 缺图 fallback：`ThumbnailMosaic` 记录加载失败并回落占位（`58a4b53`）
- [x] 节点字号（`030a737`，已获确认）：8–11px 统一 +1px，157 处 / 19 个文件
  - 实测影响：Resize +5px 高、VideoInput +3px 高；RemoveBG / SplitGrid / Generate / Prompt 尺寸不变；宽度全不变
  - 验证：12 种节点同画布，无文本溢出、无 JS 错误，zh-CN 与 en 一致
- **Status:** 完成

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

## 未验证项（已清零）

- [x] **`connectedNodes` 已验证**（2026-10-01）：zh-CN `已连接节点` / en `CONNECTED NODES` 均在浏览器确认渲染。此前复现不了是测试方法问题（持久化文本污染 + 空态遮罩拦截点击 + 判据未考虑 CSS uppercase），非代码问题
