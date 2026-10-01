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

## 2026-10-01（`connectedNodes` 未验证项 —— **已关闭 ✅**）

### 为什么之前一直复现不了
三个原因叠加，**全部是测试方法问题**，不是代码问题：

1. **测试污染了被测状态**。`PromptNode` 的 textarea 是**非受控**的，且 `handleChange` 会把内容写回 store（`updateNodeData(id, { prompt })`）。我前几次输入的 `@` **被持久化**，下次打开时初始值变成 `hello @@@@@@@`。于是 `getMentionQuery`（正则 `/@(\S*)$/`）匹配到的是 `@@@@@@@` 而非空串，`filteredMentions` 过滤后为空 → `menuOpen=false`。
   - 这解释了当时「zh 命中一次、立刻复测就失败」的诡异现象：**只有第一次是干净的**。
2. **空文本时点击被空态遮罩拦截**。prompt 为空时节点显示 `Describe what you want to generate…` 占位层，`click()` 落在遮罩上，按键根本没进 textarea（实测 `value` 始终为 `''`）。改用 `focus()` 显式聚焦即可。
3. **判据没考虑 CSS `uppercase`**。菜单标题用 `uppercase` 渲染，`inner_text` 返回大写 `CONNECTED NODES`，而我断言的是 `Connected nodes`。

### 修正后的复现步骤
```
reset(prompt="a")                                        # 每次都从干净状态开始
pg.focus('.react-flow__node[data-id="n0"] textarea')      # 绕过空态遮罩
pg.keyboard.press("End"); pg.keyboard.type(" @")
```
图结构：`promptNode → generateNode`，另有 `imageInputNode → generateNode`（与 prompt 共享下游 → 可提及）。

### 结果（两种语言均通过）
| 语言 | 菜单标题 | 候选项 |
|---|---|---|
| zh-CN | `已连接节点` ✓ | `@Img A` ✓ |
| en | `CONNECTED NODES` ✓ | `@Img A` ✓ |

节点实测渲染：`PROMPT A | JSON/YAML |  @a | 3/10,000 | | 已连接节点 | | @Img A | ↵`

**至此 R3 i18n 组件侧全部字符串均已在浏览器中验证，无遗留未验证项。**

## 2026-09-30（NAS 恢复 + A 类线上最终验证 ✅）

### 过载自行解除
| 指标 | 过载时 | 恢复后 |
|---|---|---|
| load (1min) | 82.0 | **0.83** |
| 可用内存 | 938MB | **9593MB** |
| 内存已用 | 14Gi | **6.0Gi** |
| `/api/workflows` | 连续 3 次 30s 超时 | **HTTP 200** |

约 8GB 内存被释放（其他服务重启或回收）。`heliosgen` Up 3 hours healthy。

### A 类线上最终验证（局域网直连 NAS）
| 检查 | 结果 |
|---|---|
| 局域网 `/` | HTTP 307（0.26s） |
| `/api/workflows` | HTTP 200 |
| 资产 | 170 ✓ |
| EACCES | 0 ✓ |
| asset-bridge | Up 5 days ✓ |
| 浏览器 zh-CN / en | `lang` 正确切换；`--primary`=#2dd4bf、`--danger-soft`=#f87171、body=rgb(11,14,20) ✓ |
| **A 类用到的 14 个 token** | **全部有解析值，无 `var()` 断链** ✓ |
| JS 错误 | 无 ✓ |

**结论：A 类色值替换（212 处）已上线且完全正确。**

## 2026-09-30（NAS 再次过载 — **与本次改动无关**）

写完 `scripts/deploy-nas.sh` 后跑 `--check`，**脚本立刻报警**：

| 检查项 | 值 | 阈值 |
|---|---|---|
| load (1min) | **43.8 → 82.0**（持续上升） | < 20 |
| 可用内存 | **938MB** | > 3072MB |
| unhealthy 容器 | **2** | 0 |

进一步确认：
- unhealthy 的是 **`topic-xhs-rss`、`topic-web-monitor-rss`**（用户的其他服务，**非 heliosgen**）
- `heliosgen` 容器 Docker 报 healthy，但 `/api/workflows` **连续 3 次 30 秒超时（HTTP 000）**
- **Swap 再次 8.0Gi / 8.0Gi 全部用尽**
- 内存大户：node 1116MB、bun 790MB、dockerd 649MB、bun ×3 各 ~333MB

**结论：这是 NAS 的慢性容量问题，与我的改动无关**——本次我是在**本地**构建后传输镜像的，没有在 NAS 上跑构建。该机 15GB 物理内存跑 6+ 个服务（含多个 `bun`、`WeKnora`、RSS 服务），swap 长期耗尽，heliosgen 被连带饿死。

**这解释了上一轮事故的真实性质**：我的构建是触发点，但**根因是容量不足**。即使我不构建，这台机器也会因为其他服务而反复进入该状态。

### 已产出：`scripts/deploy-nas.sh`
把验证过的安全流程固化（`6b38e60` 之后新增）：
- 本地 `buildx --platform linux/amd64` 构建 → `docker save | gzip` → 局域网传输 → NAS `docker load` → **只重建 heliosgen**
- **部署前资源前置检查**（load / 可用内存 / unhealthy 容器），不达标会明确警告
- 自动建回滚镜像 + 源码备份
- 部署后验证（health / API / 资产 / EACCES / 桥接 / 负载）
- `--check` 仅检查不部署；`--skip-build` 复用本地镜像

## 2026-09-30（NAS 事件 — 已定位并恢复 ✅）

### 进入方式
Tailscale 已断、公网中继不通，最终通过**局域网 SSH + `~/.ssh/fnos_nas_key`** 进入（`wyai@192.168.1.185`）。注意：我的默认密钥只授权给 Tailscale SSH，局域网普通 SSH 需用 `fnos_nas_key`。

### 根因（比预想复杂）
| 指标 | 值 |
|---|---|
| load average | **158.71** |
| 内存 | 15Gi 总量 / 14Gi 已用，可用 621Mi |
| **Swap** | **8.0Gi 全部用尽** |
| CPU 首位 | **`kswapd0` 30%** —— swap 抖动才是 load 来源 |
| heliosgen | Up 9 hours (**unhealthy**) |

**所有进程 RSS 合计 15.1 GB > 物理内存**。主机上多个服务累积占用（`xhs-rss-server` 1103MB、`dockerd` 622MB、`WeKnora` 504MB、多个 `bun` 各 ~335MB…），**我 09:10 启动的构建是压垮的最后一根稻草**——但**不是主因**。

我的构建进程已卡死 3 小时、CPU 仅 0.2%、无产出，是唯一的无用进程。

### 处置（经用户确认）
1. `kill` 卡死的构建进程（PID 3493526 / 3493475 / 3493455）
2. `docker compose ... restart heliosgen`（**未触碰 asset-bridge**）
3. 结果：容器 **healthy**，load 由 158 → 63 并继续回落

### 恢复验证
| 检查 | 结果 |
|---|---|
| 局域网 `/` | HTTP 307 |
| `/api/workflows` | HTTP 200 |
| 资产 | 170 ✓ |
| 词条 | 282 / 键集一致 ✓ |
| EACCES | 0 ✓ |
| asset-bridge | Up 5 days ✓ |

### 教训
- **不应在小型 NAS 上跑 Next.js 生产构建**：它需要 ~2GB 内存，而该机已运行 6+ 个服务。11 次成功是运气，这次撞上了累积内存压力。
- 后续部署应改为**本地构建 linux/amd64 镜像再传过去**（本地 Docker daemon 当前未运行，需先启动），或**构建前先检查 NAS 的 load 与可用内存**。
- 部署脚本缺一道**前置资源检查**。

### A 类部署（改用「别处构建」流程，已完成 ✅）
经用户选定方案 A：**不在 NAS 上构建**。
1. 本地启动 Docker Desktop → `docker buildx build --platform linux/amd64 -f Dockerfile.nas --build-arg APP_VERSION=1.2.1 --load`（QEMU 模拟，Next.js 编译 30s）
2. `docker save | gzip -1` → **472MB 镜像 / 447MB 压缩包**
3. 局域网传输 **9.5 秒**（NAS load 此时已回落至 1.28）
4. NAS 侧建回滚点 `rollback-20260930-6` → `docker load` → `up -d --force-recreate --no-deps heliosgen`
5. 容器 healthy（20s）

**验证**：
| 检查 | 结果 |
|---|---|
| 镜像架构 | `amd64/linux` ✓ |
| 容器内 chunk 含 `var(--primary)` | **9 个** ✓（A 类改动已上线） |
| chunk 残留 `#2DD4BF` | 3 处（正是刻意保留的排除项） |
| 浏览器实测 `--primary` / `--background` | `#2dd4bf` / `#0b0e14`，body 解析为 `rgb(11,14,20)` ✓ |
| JS 错误 | 无 ✓ |
| `/api/workflows` | HTTP 200 |
| 资产 | 170 ✓ |
| EACCES | 0 ✓ |
| asset-bridge | Up 5 days ✓ |
| NAS load | 158 → **3.26** |

**部署流程已改进**：`README.nas.md` 现以「别处构建再传输」为推荐路径，并附「若坚持在 NAS 上构建」的前置资源检查（load < 20、available > 3Gi、无 unhealthy 容器）与卡死构建的识别方法。

## 2026-09-30（NAS 失联 — 复测诊断更新）

用户提示"NAS 在线"，复测结果**确认机器在线、但服务不可用**：

| 检查项 | 结果 | 含义 |
|---|---|---|
| ping `192.168.1.185`（局域网） | ✅ 0% 丢包 / 3.8ms | **NAS 机器活着** |
| ping `100.112.104.77`（Tailscale） | ❌ 100% 丢包 | 其 Tailscale 已断 |
| tailnet 状态 | `offline, last seen 1h ago` | Tailscale 进程已停 |
| 局域网 22 端口 | 开，但 `Permission denied (publickey,password)` | SSH 服务在，但我的密钥只授权给 Tailscale SSH |
| 局域网 17860 端口 | TCP 可连（有时） | 应用在监听 |
| `http://192.168.1.185:17860/api/health` | ❌ 20s 与 60s 均超时（HTTP 000） | **连得上但完全不响应** |
| TCP 层直连测试 | ❌ 超时（exit 124） | 时通时不通 |
| 公网中继 | 000 | — |

**结论**：NAS **通电且在网**，但**应用与 Tailscale 均无响应**。TCP 端口有时能连上、但 60 秒拿不到任何 HTTP 响应，且 SSH 也不通 —— 与"构建把主机资源耗尽 / 服务卡死"一致。

**我无法远程介入**：局域网 SSH 拒绝我的公钥，Tailscale 已断。

**建议你在 NAS 控制台或可用 SSH 上执行**：
```
docker ps -a                          # 看 heliosgen 状态、有无卡住的构建
docker compose --env-file .env.sync -f compose.nas.yaml logs --tail=30 heliosgen
docker compose --env-file .env.sync -f compose.nas.yaml restart heliosgen
```
若确认有卡住的构建，先中断它再重启容器。**注意**：不要 `docker compose down`（会连 asset-bridge 一起停）。

## 2026-09-30（⚠️ NAS 失联事件）

### 经过
- A 类色值替换已提交并推送（`5c2410f`），随后按流程部署：
  1. 建回滚镜像 `rollback-20260930-5` ✅
  2. 备份 NAS 源码 `heliosgen-src-backup-20260930-5.tar.gz` ✅
  3. 同步源码到 NAS ✅（`EXTRACT_OK`）
  4. 执行 `docker compose build heliosgen` —— **构建进行到 "Creating an optimized production build" 时 NAS 失去响应**
- 构建日志停在 `#12 7.732 Creating an optimized production build ...`，此后无进展

### 当前状态（约 5 分钟后复测）
| 路径 | 结果 |
|---|---|
| ping 100.112.104.77 | 100% 丢包 |
| SSH | `Operation timed out` |
| 局域网 `192.168.1.185:17860` | HTTP 000 |
| Tailscale HTTPS | HTTP 000 |
| 公网 `heliosgen.iepose.cn` | HTTP 404（「节点小宝」网关响应，非本应用） |
| tailnet 状态 | `active; relay "sfo", tx 15288 rx 0` —— 发得出去、收不到 |

### 我做了什么 / 没做什么
- **做了**：建回滚点、备份源码、同步源码、启动 `docker compose build`
- **没做**：**从未执行 `up -d --force-recreate`**，即**没有停止或替换正在运行的容器**
- **未触碰**：`.env.sync`、`secrets/seek-token`、`.seek-token.bak`、数据库与媒体目录

### 因果关系的诚实判断
同一个构建此前已成功执行 11 次。但 Next.js 生产构建是 CPU/内存密集型，NAS 是小型设备，**我无法排除这次构建导致其资源耗尽（如 OOM）从而失去响应**。不排除是我的操作触发。

### 需要你处理
- NAS 需要**物理或控制台介入**（可能需重启），我无法远程做到
- 恢复后我可以：**A)** 继续完成本次部署；**B)** 用 `rollback-20260930-5` 回滚
- 回滚点与源码备份均在失联前创建完成，可用

## 2026-09-30（review 收口 · 八）

### 本轮完成
- **R4 节点字号**（`030a737`，已获确认）：画布正文字号原为 8–11px（10px × 83、11px × 65、9px × 8、8px × 1），对需要持续阅读的标签偏小。统一 +1px（10→11、11→12、9→10、8→9），共 **157 处 / 19 个文件**；12px 以上不动
  - **改动前先测量**（这是画布密集视觉改动）：
    | 节点 | 改前 | 改后 | Δ |
    |---|---|---|---|
    | Resize | 336×348 | 336×353 | +5 高 |
    | VideoInput | 224×170 | 224×173 | +3 高 |
    | RemoveBG / SplitGrid / Generate / Prompt | — | — | 0 |
  - 宽度全部不变；12 种节点同画布复测：**无文本溢出、无 JS 错误**，zh-CN 与 en 一致。跨节点边界的只有 React Flow 自身的连接手柄与缩放控制点（本就压在边缘）
  - **过程教训（值得记）**：我两次目视「改后」截图，都判断 Generate 的底部控件被挤出节点，据此下了错误结论。实测高度前后都是 558。最后查 DOM 才定案：底部按钮在 y=977–1053、节点范围 541–1099，完全正常。**缩略图里的小字不能当证据**

### 部署
- 回滚点 `rollback-20260930-4`；线上字号已生效（容器内源码 `11px × 83 / 12px × 68 / 10px × 8`）、282 词条一致、EACCES 0、170 资产、桥接 Up 5 days

## 2026-09-30（回归复查 · 发现并修掉自己引入的 lint 回归）

### 背景
连续 9 次部署后做了一次完整回归，除了常规项还发现**我自己引入的 lint 回归**。

### 回归结果
| 项 | 结果 |
|---|---|
| 回归测试（4 个脚本） | 21/21 通过 |
| clipboard | PASS |
| 版本守卫 | 1.2.1 OK |
| tsc / build | 通过 |
| i18n 键集 | 282/282 一致 |
| **eslint** | ❌ **154 → 164**（错误 66 不变，警告 +10） |

### 根因与修复（`4bbca4b`）
- 我在 `useCallback` / `useEffect` 里用了 `t(...)`，却没把翻译函数加进依赖数组 → `react-hooks/exhaustive-deps` 从 23 涨到 33
- 给 13 处真正引用 `t` / `tCanvas` / `tNodes` 的依赖数组补上；next-intl 的翻译函数按 locale 稳定，补上是正确且不改行为的
- **过程中我自己踩的两个坑（都记下来）**：
  1. 第一版脚本判断用 `name in deps` 子串匹配，而 `"t" in "updateNodeData"` 为真 → 全部被误判为"已含"，一个都没修
  2. 修正后又把 `t` 加到了**不使用它的** hook 上，同时漏掉真正使用它的那个 —— lint 报出"多余的依赖"与"缺失的依赖"并列，才发现
- 修复后 eslint 回到 **154**（66 错误 / 88 警告），与 i18n 之前完全一致，无任何翻译函数相关告警

### 部署
- 回滚点 `rollback-20260930-3`；线上 282 词条 / 键集一致 / EACCES 0 / 170 资产 / 桥接 Up 5 days

### 仍未验证
- `PromptNode` 的 @ 提及菜单标题 `connectedNodes` 依旧未在浏览器里验证到（见「收口 · 五」）

## 2026-09-30（review 收口 · 七）

### 本轮完成
- **R3g** `0aa06ac`：`WorkflowCanvas` 翻译，`ui.canvas` +14 —— 空态（标题 + 三张起始卡片及其描述）、运行日志（Running workflow… / Complete）、导出与剪贴板 toast、校验错误（无输入图片 / 格子越界 / 等待超时）
  - 实测走**真实用户路径**（在首页点"新建工作流"让应用自己建空间）：两种语言 **7/7**
  - **测试构造的教训**：第一次我用 `PUT /api/workflows` 造了个空空间再直链打开，页面跳到了 gallery。原因是**应用既有行为**——客户端用全量替换的 `PUT /api/workflows` 同步，本地 store 不认识的画布会在下次保存时被删掉（这正是 README.nas.md 里记着、也是 `/api/workflows/<id>` 存在的原因）。改成从 UI 创建即正常
- **R6g**：验证 + 部署（回滚点 `rollback-20260930-2`）。线上 **282 条词条 / 键集一致**；EACCES 0；170 资产；asset-bridge Up 5 days

### API 错误码：评估后暂缓（需你决策）
- 现状：**62 条唯一 error 文案**，消费方两类——CLI/MCP 直接读 `error` 作为失败消息给 agent（`cli/lib/client.mjs:82`），前端 **32 处**直接展示
- 影响：改成本地化会**改变接口契约**（agent 拿到的不再是可读消息）
- 建议：做成**增量**方案——`error` 保持英文可读消息不变（CLI/MCP 契约稳定），另加 `code` 字段供前端本地化。但代价是 62 处路由 + 124 条词条 + 32 处前端改动，属独立工作量，且需要你先认可这个契约方向
- **本轮未做**，等你拍板

## 2026-09-30（review 收口 · 六）

### 本轮完成
- **R3f** `36c7c4d`：`GenerateNode` / `VideoGeneratorNode` / `VideoInputNode` 翻译，`nodes` +71 条、`ui.generic` +1
  - 覆盖：句柄标签、生成状态、Azure 画质/分辨率、自定义尺寸、NSFW 警告、取消/删除/自定义、视频输入拖放区与播放控制、校验提示
  - 三个模块级数组改为存 message key；按模型动态覆盖的「Reference images (up to N)」改为 ICU `{n}` 插值
  - **验证过程中的教训**：第一次测出 1/24，看着像失败——其实是我把"各分支才出现的字符串"（生成中 / 仅 Azure / 自定义尺寸）拿去比对默认态节点。节点渲染正常、翻译也已生效
  - 但那次 dump 暴露了**真漏项**：无引号的 JSX 文本节点、以及跨元素拆分的串（`Drop video or` + 带下划线的 `browse`）。已补译，拆分那处保留了下划线样式
  - 复验：zh-CN 三个节点**无任何未翻译英文**；默认态可见的字符串（拖放区、体积上限、声音开关）两种语言 **4/4**

### 部署（先受阻后恢复）
- 首次尝试时本机 **Tailscale 已停止**（`tailscale status` → "Tailscale is stopped."），SSH 被拒（`kex_exchange_identification: Connection closed`）；公网域名又被「节点小宝」验证墙拦截，两条路径都不可用
- 运行 `tailscale up` 后恢复，部署完成：回滚点 `rollback-20260930-1` → 同步 → build（18.6s）→ `--no-deps` 只重建 heliosgen
- 线上确认：**10 命名空间 / 268 条词条 / 键集一致**；EACCES 0；170 资产；asset-bridge Up 5 days

## 2026-09-29（review 收口 · 五）

### 本轮完成
- **R3e** `901b1c7`：`AssistantNode` / `ImageInputNode` / `PromptNode` 翻译，`nodes` 命名空间 +15 条
  - AssistantNode：输出句柄标签、显示输入/输出切换（含"先生成后才能看到输出"态）、复制/删除标题、生成失败文案
  - ImageInputNode：图像/文本输入与图像输出句柄标签、Input alt、完整画质 alt
  - PromptNode：复制提示词/展开编辑器/删除/复制标题、文本输出句柄、剪贴板失败 toast、提及菜单标题
  - 实测：三个节点同画布，zh-CN **11/12**、en **11/12**
- **R6e**：验证 + 部署（回滚点 `rollback-20260929-7`）。线上 **10 命名空间 / 180 条 / 键集一致**；EACCES 0、170 资产、asset-bridge Up 5 days

### ⚠️ 一条未验证（如实记录）
- `PromptNode` 的 @ 提及菜单标题 `connectedNodes` **我没能让它在浏览器里渲染出来**。它位于内联提及浮层，条件是「输入 @」+「存在兄弟节点与 prompt 节点共享下游目标」（`mentionableNodes` 的过滤条件）。我按这个条件构造了图形并驱动 textarea，但浮层只在一次 zh-CN 运行中偶发打开，立刻复测即失败。键在两种语言里都存在、tsc 也通过，但**我没有看到它渲染**，因此不声称它可用。

### 仍未做（附原因）
- R2 批次 2（119 处调色板外的一次性色）——需先做设计决策
- R3 其余：`GenerateNode` / `VideoGeneratorNode` / `VideoInputNode`（各 12–16 条，文件 1300–2300 行）、`WorkflowCanvas`、API 错误码
- R4 节点字号（会改变画布观感，需确认）
- R5（动态路由、gallery 7212 行拆分）——建议单独立项

## 2026-09-29（review 收口 · 四）

### 本轮完成
- **R3d** `4de1fc8`：**画布周边组件翻译**，新增 `ui` 命名空间（picker / canvas / assist / banner）
  - `CanvasToolbar`：添加节点 / 选择 / 抓手 / 撤销 / 重做 / 运行全部 / 导出工作流（含 ⌘ 快捷键提示）
  - `NodeActionBar`：打开预览 / 复制节点 / 删除节点 / 保存到本地 / 下载中…
  - `SelectionToolbar`：自动排列 / 编组 / 复制所选 / 删除所选
  - `MediaPickerModal`：三个页签（上传 / 图像生成 / 视频生成）、上传按钮、URL 抓取失败提示
  - `QuickAssist`：助手胶囊、输入框占位、新建对话、请求失败文案
  - `UpdateBanner`：有可用更新 / 忽略 / 关闭 / 无更新说明
  - 实测：tooltip 7/8（第 8 条是更新横幅，无更新时不渲染——属正确行为）；用 `NEXT_PUBLIC_UPDATE_CHECK_FORCE=1` 强制渲染后横幅 **2/2** 通过
- **R6d**：验证 + 部署（回滚点 `rollback-20260929-6`）。线上确认 **10 个命名空间 / 165 条 / 键集一致**；EACCES 0、170 条资产、asset-bridge Up 5 days

### 仍未做（附原因）
- R2 批次 2（119 处调色板外的一次性色）——需先做设计决策
- R3 其余：生成类节点（`GenerateNode` / `VideoGeneratorNode` 各 12 条、`VideoInputNode` 7、`PromptNode` 6、`AssistantNode` 2）、`WorkflowCanvas`、API 错误码
- R4 节点字号（会改变画布观感，需确认）
- R5（动态路由、gallery 7212 行拆分）——建议单独立项

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
