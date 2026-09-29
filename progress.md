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

## 2026-09-29（设计系统收敛）

### 发现：整套 shadcn 语义 token 层是缺失的
- `components.json` 声明 `cssVariables: true`，但 `app/globals.css` 没有 `@theme` 块、也没有任何 `--background` / `--primary` 定义
- 后果：编译产物里 `bg-background`、`bg-primary`、`text-foreground`、`border-border` 等**出现 0 次**（对照 `.node-card` 出现 19 次）——这些类全是空操作，`Button` 的 default / destructive / outline 等变体渲染结果完全相同，sidebar 没有表面色。影响 11 个文件
- 另一处：没有 `@custom-variant dark`，Tailwind v4 的 `dark:` 编译为 `@media (prefers-color-scheme: dark)`，而应用靠 `class="dark"` 强制暗色 —— 系统为浅色时这些样式静默失效

### 修复
- `app/globals.css` 补齐 `@custom-variant dark (&:is(.dark *))`、`:root` token、`@theme inline` 映射；色值全部取自现有手写系统（`--background:#0B0E14`、`--primary:#2DD4BF`、`--muted-foreground:#A0A0A0`、`--border:#1C2436` 等），不引入新色
- 另加 `html { color-scheme: dark }`，让原生滚动条/表单控件跟随暗色
- 验证：token 类全部生成且解析正确（`bg-primary` → `rgb(45,212,191)`、`text-primary-foreground` → `rgb(6,35,31)`、`border-border` → `rgb(28,36,54)`）；浅色系统偏好下页面仍渲染为暗色（证明 `dark:` 已按 class 生效）

### 顺带修正一处自己引入的回归
- 上一轮压缩 hero 图时先裁切再压缩，且只按 hero 的小盒子算尺寸；而 gallery 空状态用的是**方形 172px**盒子，会偏软
- 改为从原图（commit `3039757^`）重新编码，**保持原始宽高比**、短边取 344（=172px @2x，取两处消费方里最大的盒子）。两处 `object-cover` 的裁切结果与原来一致，只有分辨率变化
- 结果：4 张 4,952KB → 116KB（-97.7%），`public/` 480KB

### 验证
- tsc、`pnpm build`、21 项回归测试 + clipboard 全过；eslint 154 项无新增
- 浏览器实测（Playwright，1440×900）：dashboard / gallery / assets / chat 四页视觉无回归

## 2026-09-29（下）

### 全面 review（功能 / 性能 / 交互 / 设计）
- 方法：静态度量（bundle、文件规模、hex 字面量、shadcn 规则）+ 隔离实例实测（API 延迟、页面体积）+ 浏览器实测（chrome-devtools，截图与 focus 测试）+ 代码走查
- 高：`/api/fetch-url` 是 SSRF 汇点——接受任意 URL、服务端 `redirect:"follow"` 抓取、无白名单/内网拦截。用 loopback-only 服务实测：能被抓取并落盘回吐（`/generated/uploads/40437268-….png`，HTTP 200）。公网无鉴权 + 同机约 30 个容器，影响面大
- 中：非 Docker 构建版本号恒为 `0.0.0`，更新横幅永久误报；`/workflow` 首屏 6.7MB，其中 `public/2.webp` 单文件 4MB，且被塞进 108×162 的框（4 张 hero 图 4.95MB，`loading="eager"` + 裸 `<img>`）；47 条路由全为 `ƒ` 动态（根布局读 cookies）；`app/gallery/page.tsx` 7212 行；i18n 仅覆盖 57 个客户端组件中的 7 个；540 处硬编码 hex 绕过主题；节点正文 8–10px
- 低：`/workflow/<id>` 直链会跳转；10 个表单字段缺 id/name；缺图时显示破图图标；两条横幅叠加占约 90px
- 良好项：focus 可见性实测 0/25 缺失；media-poster 的缓存键/原子写/并发去重都正确；穿越拦截有效；`components/ui` 无裸色值

### 本轮修复
1. SSRF：新增 `lib/ssrfGuard.ts`（内网/回环/链路本地/CGNAT/组播地址拦截 + 逐跳校验重定向），`/api/fetch-url` 改用它。实测：loopback、`169.254.169.254`、`192.168.1.185:17860`、`localhost:5666`、`[::1]` 全部拒绝；公网 URL 仍正常（未误伤）。补 `scripts/test-ssrf-guard.mjs`（6 项）
2. 版本号：`next.config.ts` 回退读取 `package.json` 版本（显式 env 仍优先）。实测 `currentVersion` 由 `0.0.0` 变为 `1.2.1`，误报横幅消失
3. hero 图：用 sharp 按「显示尺寸 ×2 DPR」裁切重编码，4 张合计 4,952KB → 46KB；`public/` 5.2MB → 408KB；`/workflow` 首屏 6,678KB → 1,457KB（-78%）
- 验证：tsc、`pnpm build`、21 项回归测试 + clipboard 全过

## 2026-09-29（review 收口 · 三）

### 本轮完成
- **R3c** `7b0bcb8`：**7 个处理器节点全部翻译**（Resize / Remove BG / Split Grid / Compare / Video Trim / Frame Grab / LLM Generate），新增 `nodes` 命名空间 51 条
  - 覆盖：表头、按钮与忙碌态（Splitting…/Trimming…/Extracting…/Generating…/Resizing…）、空态提示、Resize 模式页签与字段标签、Remove BG 模型档位与进度行、Split Grid 行/列、以及各节点的失败提示
  - 两处需改结构而非换字符串：`MODEL_OPTIONS` 原本在模块级数组里存显示文案（不能调 hook），改为存 message key、渲染时经 `formatModelLabel(model, t)` 解析；「Output produced with {model}」改为 ICU
  - 有意保留英文：PNG/JPEG/WebP（格式标识）、contain/cover/stretch（CSS 关键字）
  - 实测：一张画布放全部 7 个节点，zh-CN **20/20**、en **20/20** 命中，无缺失
- **R6c**：验证 + 部署（回滚点 `rollback-20260929-5`）。线上确认 messages 已带 9 个命名空间、nodes 51 条、134/134 键集一致；EACCES 0、170 条资产、asset-bridge Up 5 days
- 过程中发现并修正：我第一轮 grep 漏了节点里的表头/模型档位/按钮（模式匹配只覆盖 `>Text<`，漏了数组与三元里的字符串字面量），用更宽的扫描补全

### 仍未做（附原因）
- R2 批次 2（119 处调色板外的一次性色）——需先做设计决策
- R3 其余：生成类节点（GenerateNode 等，各 6–12 条）、MediaPickerModal、CanvasToolbar、WorkflowCanvas、API 错误码
- R4 节点字号（会改变画布观感，需确认）
- R5（动态路由、gallery 7212 行拆分）——建议单独立项

## 2026-09-29（review 收口 · 续）

### 本轮完成
- **R3b** `126ef2a`：侧栏 6 条文案（Folders / New folder / Chats / New chat / No chats yet / Purchase Kie Credits）入 `sidebar` 命名空间；`timeAgo` 改用 `Intl.RelativeTimeFormat`（实测 `16天前` / `16D AGO`，替代手写英文）；模板徽标入 `extra`
- **R4b** `58a4b53`：
  - **直链修复**：`/workflow/<id>` 一直跳首页的根因是守卫在挂载时同步读 `spaces`，而 spaces 是 hydration 后才异步 fetch 的，此刻必为空 → 误判"不存在"。给 `useSpaceSync` 加 `loaded` 信号，守卫等它再判定。实测直链停留并渲染节点，不存在的 id 仍正确回首页
  - **缺图 fallback**：`ThumbnailMosaic` 记录加载失败并回落占位，不再显示浏览器破图图标
- **R6b**：验证 + 部署。回滚点 `rollback-20260929-4`；线上实测侧栏中英双语正确、EACCES 0、170 条资产、asset-bridge Up 5 days

### 仍未做（附原因）
- R2 批次 2（119 处调色板外的一次性色）——需先做设计决策
- R3 其余（40+ 组件的节点文案 / 弹窗 / 工具栏 / API 错误码）
- R4 节点字号（会改变画布观感，需确认）
- R5（动态路由、gallery 7212 行拆分）——建议单独立项

## 2026-09-29（review 收口：计划 + 执行）

### 计划
- 按 `planning-with-files` 建 `task_plan.md`（R1–R6），原 node-banana 移植计划移入附录

### 完成
- **R1** `3653d3a`：Dockerfile runtime 补 `mkdir -p /app/.next/cache && chown node:node`（线上 EACCES 由 2 次归零，属主 node:node）；README 的 `prestart-token.sh` 路径改为 `bridge/`（与仓库一致）
- **R2a** `9f285b2`：`globals.css` 93 处 hex → `var()`，复用已有 token、新增 16 个变量。A/B 像素比对 **0.0000%**（过程中一度看到 4.6% 差异，查实是媒体冷/热态：旧 CSS 自比也复现同样 4.6%）
- **R2b** `85829d1`：50 处等值 Tailwind 任意值 → 语义类。只替换与 token 完全等值的（`text-[#f87171]` 是 `--danger-soft`，换成 `text-destructive` 会变 `#ef4444`，故保留）
- **R3** `994c74f`：首屏 i18n（dashboard 5 个子组件 + hero），新增 `dashboard` 命名空间 15 条；ICU 复数替换 `s` 拼接；品牌名 `translate="no"`
- **R4a** `e172b16`：10 个节点表单字段补 `id`/`name`/`aria-label`
- **R6**：验证 + 部署。回滚点 `rollback-20260929-3`；线上实测 EACCES 0、首屏中文、170 条资产、asset-bridge `helios=170 seek=170`

### 未完成（附原因）
- R2 批次 2：剩余 119 处任意值属**调色板外的一次性色**（`#4a4a45`×17、`#141c28`×13…），收敛需先决定新色值——是设计决策，不是重构
- R3 其余：侧栏 FOLDERS/CHATS、`timeAgo`、`lib/templates.ts` 标签、其余 40+ 组件
- R4 其余：节点字号、缺图 fallback、`/workflow/<id>` 直链
- R5：47 条路由全动态（根布局读 cookies）与 gallery 7212 行拆分——评估后建议单独立项

### 环境发现（非部署问题）
- 公网域名 `heliosgen.iepose.cn` 走「节点小宝」穿透服务，当前弹**身份验证页**（"请使用域名创建人微信扫码验证身份"）。从 NAS 访问中继仍是 200 且 i18n 正确；我本机因该验证墙拿到 404/验证页
- 本机 shell 与浏览器均走代理（`http_proxy` 等已设置），排查公网问题需注意区分

### 遗留
- Phase 2 四个节点的 NAS 实测未做（节点代码已在线上，只是没点过）
- 2026-09-29 二次部署（含 review 修复）：同步 → build（确认重新编译）→ `up -d --force-recreate --no-deps heliosgen`，asset-bridge 未受影响
- 线上实测：SSRF 拦截生效（`http://127.0.0.1:3000/2.webp`、`/api/workflows`、`169.254.169.254` 全部拒绝；公网 URL 正常未误伤）；`currentVersion` 1.2.1 且无误报横幅；hero 图 46KB；169 资产 / 20 张图库图完好；asset-bridge `helios=169 seek=169`
- 回滚点：镜像 `heliosgen:rollback-20260929-2`、源码 `/home/wyai/heliosgen-src-backup-20260929-2.tar.gz`
- 2026-09-29 已重新部署：同步源码（tar over ssh，排除 .env.sync / secrets / node_modules / .next / data）→ build → `up -d --force-recreate --no-deps heliosgen`，asset-bridge 未受影响（Up 4 days，reconcile helios=169 seek=169）
- 部署后实测：`/api/providers` 不再回显 `secretRef`；nested/top-level `configured` 一致；15 节点 / 8 provider / 7 skill；`lang=zh-CN`；169 条资产与两张测试图完好；上游音频 MIME 修复生效
- 回滚点：镜像 `heliosgen:rollback-20260929`、源码 `/home/wyai/heliosgen-src-backup-20260929.tar.gz`
- 已知存量问题（非本次引入，重建前后镜像一致）：`/app/.next/cache` 不存在而 compose 把 `data/cache/next-images` 挂到其子目录，Docker 以 root 建出该目录，`node` 用户无法再建 `fetch-cache`，日志出现 2 次 EACCES（不影响功能）。修法：runtime 阶段加 `mkdir -p /app/.next/cache && chown node:node`。
