# HeliosGen 飞牛 NAS 部署

局域网访问：`http://<NAS 的 IP>:17860/`（设备与 NAS 在同一局域网；NAS 地址由 DHCP 分配，可在路由器上查看或用 DHCP 保留固定）。

HTTPS 访问：<https://fn-evo4-8cad.tail071480.ts.net:9443/>（设备需连接同一 Tailscale 网络）。

源码：[SegFault42/HeliosGen](https://github.com/SegFault42/HeliosGen)，版本 `1.2.1`。这是基于官方 Next.js 服务的 NAS 适配部署；上游主要发行桌面应用。

> 部署状态（2026-09-29 实测）：NAS 已重建至本分支当前状态。`/api/capabilities` 返回 15 种节点（含 8 个新节点）、8 个 provider、7 个 skill；`/api/providers`、`/api/skills`、`/api/media-poster` 在线；页面 `<html lang="zh-CN">`；上游 `99dd5b1`（音频 MIME 修复）与 provider 修复均已生效（`/api/providers` 不再回显 `secretRef`）。
>
> 同批上线的还有：`/api/fetch-url` 的 SSRF 防护（实测内网/回环/元数据地址一律拒绝，公网 URL 正常）、非 Docker 构建的版本号修复（`0.0.0` → `1.2.1`，误报更新横幅消失）、hero 图按显示尺寸重编码（4 张 4,952KB → 46KB）。
>
> 回滚：镜像 `heliosgen:rollback-20260929-2`（本次重建前）与 `heliosgen:rollback-20260929`（更早一版）；源码备份 `/home/wyai/heliosgen-src-backup-20260929-2.tar.gz` 与 `...-20260929.tar.gz`。重建时只 recreate `heliosgen` 服务（`--no-deps`），`asset-bridge` 不受影响。

## 位置与运行方式

- NAS：`wyai@100.112.104.77`
- Compose 与源码：`/home/wyai/heliosgen`
- 数据库、设置、任务状态：`/vol1/1000/HeliosGen/data/db`
- 上传、生成及创作资产：`/vol1/@team/AIGC 创作/创作资产`（HeliosGen 与 Seek 共用同一批文件）
- 同步桥接状态：`/vol1/1000/HeliosGen/data/bridge`
- Docker 镜像：`heliosgen:nas-http-20260915`，Linux amd64
- 后端**绑定全部网卡**（`0.0.0.0:17860`）。此前写死为 `127.0.0.1:17860` + `192.168.1.185:17860`，但 NAS 的地址是 **DHCP 动态分配**（`scope global dynamic`，租约约 70 小时）——租约一变 Docker 就会绑定失败、容器起不来，**局域网所有人都会打不开**。改为绑定全部网卡后不再受 IP 变化影响，同时顺带覆盖了 Tailscale Serve 代理所用的回环入口。
  - **访问方式**（按速度排序）：局域网 `http://<NAS 的 IP>:17860/` → Tailscale 直连 `http://100.112.104.77:17860/` → Tailscale HTTPS `https://fn-evo4-8cad.tail071480.ts.net:9443/` → 公网中继
  - **权衡（已确认接受）**：`0.0.0.0` 意味着 17860 也暴露在 Tailscale 与隧道网卡上，不再只限局域网
  - 若需要收窄，可在 NAS 上用 ufw/iptables 只放行 `192.168.1.0/24`
- HeliosGen 主容器以非 root 用户运行；`asset-bridge` 仅以只读方式挂载媒体，监听 inotify 事件并同步两个索引。两者均自动重启并滚动保存日志。

## 首次使用

打开 Settings → API Keys，填写自己的 kie.ai API Key。密钥保存在 NAS SQLite 数据库中。未迁移 Mac 桌面版的密钥、工作流或历史记录。本次部署不包含可选的 Codex CLI 生图环境。

该应用采用共享本地用户，访问同一 NAS 地址的人共用工作流、图库和 API Key。聊天历史及部分界面偏好仍保存在各浏览器本地。

## 功能总览

按当前分支源码梳理。标 **新增** 的是本次合并（相对上游 `f4aae3f`）带进来的能力。

### 画布节点（16 种，选择器 15 种 + Group）

生成与输入

- Prompt、Image Input、Video Input —— 提示词与参考素材入口
- Image Generator（`generateNode`）、Video Generator（`videoGeneratorNode`）—— 多模型生成，按波次并行/串行执行
- Assistant（`assistantNode`）—— 提示词优化助手
- LLM Generate（`llmGenerateNode`）**新增** —— 调 `/api/assistant` 产出文本，可接下游提示词

图像处理（`processors` 分类，浏览器本地执行，不消耗积分）**新增**

- Resize（`imageResizeNode`）—— 精确尺寸 / 最长边 / 按比例缩放，输出 PNG/JPEG/WebP
- Remove BG（`removeBackgroundNode`）—— `@imgly/background-removal` + `onnxruntime-web` 端上推理，模型自托管在 `/generated/bgremoval/`
- Split Grid（`splitGridNode`）—— 宫格拆分，点击格子选定输出
- Compare（`imageCompareNode`）—— A/B 对比滑杆（`react-compare-slider`），只读

视频处理 **新增**

- Video Trim（`videoTrimNode`）→ `/api/trim-video`
- Frame Grab（`videoFrameGrabNode`）→ `/api/extract-frame`，支持指定时间点或末帧

其他

- Prompt Constructor（`promptConstructorNode`）**新增** —— 模板化提示词构造（`{input}` 变量）
- Note、Comment、Group —— 画布注释与分组

处理类节点手动 Run，不进入 pipeline 自动波次；输出写入 `data.imageUrl` / `videoUrl`，下游通过 `resolveInputs` 自动衔接。

### 模型（`lib/modelConfig.ts`）

- 图片 11 个：Nano Banana、Nano Banana 2、Nano Banana Pro、Nano Banana 2 Lite、Z-Image、Seedream 5.0 Lite / Pro、Grok Imagine、GPT Image 2、GPT Image 2.5 Flare / Sunburst
- 视频 17 个：Veo 3.1 Lite / Fast / Quality、Gemini Omni Video、Kling 3.0 / 3.0 Turbo、Grok Imagine / 1.5 preview、Seedance 2.0 / 2.0 Fast / 2.0 Mini / 2.5 / 2.5 Edit、HappyHorse、H3、Motion Control 2.6 / 3.0

机器可读目录：`GET /api/models`（同一注册表，NAS 不可用模型标 `nasSupported:false`）。

### 页面与媒体加载

- Gallery、Assets 资产库、Chat、Workflows 首页、Settings
- 加载优化 **新增**：资产库分页（每页 48）、图片走 `/_next/image` 缩略图、视频先显示封面且 `preload=none`、图片并发 8（卸载时归还名额）、封面缓存落在 NAS 数据盘

### 多语言 **新增**

`next-intl` 接入，入口 `app/i18n/request.ts`，语言由 cookie `hg_locale` 决定，默认 `zh-CN`、可选 `en`，文案在 `messages/*.json`。当前覆盖导航、资产库、设置等 5 个文件，其余界面文案仍在逐步迁移。

### 服务端接口（28 个路由）

- 生成：`/api/generate`、`/api/generate-image`、`/api/generate-video`、`/api/job-status`、`/api/job-stream`、`/api/models`、`/api/credit`
- 媒体：`/api/upload`、`/api/upload-video`、`/api/upload-asset`、`/api/download`、`/api/fetch-url`、`/api/extract-frame`、`/api/trim-video`、`/api/generated/[...path]`、`/api/media-poster` **新增**
- 资产：`/api/assets`、`/api/assets/[id]`、`/api/assets/import`、`/api/assets/reconcile`、`/api/assets/collections`、`/api/lookup-asset`
- 工作流：`/api/workflows`、`/api/workflows/[id]`
- 其它：`/api/settings`、`/api/assistant`、`/api/folders`、`/api/folder-items`、`/api/gallery`、`/api/open-external`、`/api/update-check`
- Agent **新增**：`/api/capabilities`（紧凑能力目录）、`/api/providers` 与 `/api/providers/[id]`（provider 列表、密钥读写，响应脱敏）、`/api/skills`（技能注册表）

### CLI 与 MCP

- **CLI** `helios`（`cli/helios.mjs`，Node 零依赖，JSON 输出）：`doctor` / `config` / `key`、`models` / `credit` / `upload` / `image` / `video` / `pipeline` / `wait` / `status`、`gallery`、`asset list|add|import|update|reconcile`、`asset collection list|create|add|remove`、`workflow list|get|export|import|delete|create`、`download`
- **MCP** `cli/mcp/server.mjs`：27 个工具，除原有生成/图库/资产/工作流工具外 **新增** `helios_capabilities`、`helios_providers`、`helios_provider_get` / `_configure` / `_delete_key`、`helios_skills`、`helios_workflow_summary` / `_validate` / `_patch`

### 部署与运维

- `Dockerfile.nas` + `compose.nas.yaml`（`heliosgen` 与 `asset-bridge` 两个服务）
- `asset-bridge`：inotify 监听共享媒体目录，HeliosGen ↔ Seek 双向索引同步，每 5 分钟兜底核对
- `bridge/prestart-token.sh`：fnOS 重启后自愈 Seek token
- HTTP（非安全上下文）兼容：SHA-256 走 `@noble/hashes` 回退、UUID 用 `getRandomValues`、剪贴板走兼容路径

## 常用命令（在 NAS 执行）

```sh
cd /home/wyai/heliosgen
docker compose --env-file .env.sync -f compose.nas.yaml ps
docker compose --env-file .env.sync -f compose.nas.yaml logs --tail=100
docker compose --env-file .env.sync -f compose.nas.yaml restart
```

### 构建方式（**优先在别处构建，不要在这台 NAS 上 build**）

> **2026-09-30 事故**：在这台 NAS 上执行 `docker compose build` 时，主机被压到 load **158**、**8GB swap 全部用尽**、`kswapd0` 占 30% CPU，`heliosgen` 变 unhealthy，Tailscale 也断开。原因是**累积内存压力**——该机同时运行 6+ 个服务（`xhs-rss-server` 1.1GB、`dockerd` 622MB、`WeKnora` 504MB、多个 `bun` 各 ~335MB），所有进程 RSS 合计 **15.1GB** 已超过 15GB 物理内存。Next.js 生产构建需要 ~2GB，是压垮的最后一根稻草。处置：kill 卡死的构建 + `restart heliosgen`（未碰 asset-bridge），load 由 158 回落至 3。

**推荐流程**：在开发机构建 `linux/amd64` 镜像再传过去，完全不占用 NAS 资源。

```sh
# 1) 开发机（Docker Desktop 需运行）
docker buildx build --platform linux/amd64 -f Dockerfile.nas \
  --build-arg APP_VERSION=1.2.1 -t heliosgen:nas-http-20260915 --load .
docker save heliosgen:nas-http-20260915 | gzip -1 > /tmp/heliosgen-amd64.tar.gz

# 2) NAS：先建回滚点，再加载、重建容器
docker tag heliosgen:nas-http-20260915 heliosgen:rollback-<日期>
cat /tmp/heliosgen-amd64.tar.gz | ssh wyai@192.168.1.185 'cat > /tmp/i.tar.gz'
docker load -i /tmp/i.tar.gz
docker compose --env-file .env.sync -f compose.nas.yaml up -d --force-recreate --no-deps heliosgen
```

镜像约 472MB（压缩 447MB），局域网传输约 10 秒。

**若坚持在 NAS 上构建**，先确认资源充足：

```sh
uptime                     # 1 分钟 load 应 < 20
free -h                    # available 应 > 3Gi
docker ps --format '{{.Names}} {{.Status}}' | grep -c unhealthy   # 应为 0
```

不满足就先别构建。构建后若卡住（`next build` 进程 CPU 长期 ~0%），kill 该进程并 `restart heliosgen`。

**只重建 heliosgen**，不要用 `up -d`（会连带重建 `asset-bridge`），更不要 `down`。

服务停止后分别备份 `/vol1/1000/HeliosGen/data` 与 `/vol1/@team/AIGC 创作/创作资产`。不要只复制正在写入的 `guest.db`。

## Seek 创作资产同步

Seek 当前通过 `AIGC 创作/创作资产` 索引同一个媒体根目录，文件不会上传、复制或生成第二份。目录 `assets/Characters`、`assets/Props`、`assets/Environments`、`assets/Styles`、`assets/Scenes` 对应五类创作资产；生成素材仍保留在 `images/`、`videos/`，通过数据库元数据进行虚拟分类，避免移动后破坏历史工作流 URL。

`asset-bridge` 在以下事件后约 4 秒同步：

- Seek 或文件管理器写入共享目录：调用 `/api/assets/import`/reconcile 注册到 HeliosGen，随后可在 Assets、Gallery 和工作流素材选择器使用。
- HeliosGen 生成、上传或删除文件：触发 Seek folder scan，写回模型、提示词、路径、资产类型标签和图像/视频生产环节标签。
- 容器每 5 分钟进行一次兜底核对；磁盘不存在的文件会从 HeliosGen 创作资产索引移除。

Seek token 只保存在 NAS 的 `/home/wyai/heliosgen/secrets/seek-token`（`0600`），不进入 Compose、Git 或日志。`.env.sync` 保存项目/目录 GUID 与标签映射，不保存 token。

### token 自愈

fnOS 重启后可能把 bind mount 源文件重建为 root 所有的空目录，导致 `asset-bridge` 启动时报 `Seek token file not found`。启动容器前先运行 `bridge/prestart-token.sh` 自愈：

```sh
sh /home/wyai/heliosgen/bridge/prestart-token.sh
docker compose --env-file .env.sync -f compose.nas.yaml up -d
```

脚本行为：

- token 路径是目录：删除该目录（需要 `wyai` 能通过 Docker helper 容器执行，因为目录归 root 所有）。
- token 文件不存在或为空：从 `/home/wyai/heliosgen/.seek-token.bak`（`0600` 备份）恢复。
- 两者都不可用：报错退出，此时需要重新从浏览器 Cookie 或 `loginByPassword` 获取 token。

token 备份在 NAS 本地 `/home/wyai/heliosgen/.seek-token.bak` 和本地机器 `~/.config/heliosgen/seek-token` 两处，均为 `0600` 权限，不进入 Git。

## NAS 适配

- Node 24，按上游 pnpm 锁文件安装；容器内提供 FFmpeg/FFprobe。
- 使用 Next standalone 入口及完整生产依赖，避免上游记录的 pnpm 文件跟踪缺漏。
- 构建变量 `NEXT_PUBLIC_HELIOS_WEB=1`：外部链接由访问者的浏览器打开。
- 运行变量 `HELIOS_WEB=1`：停用 NAS 服务器上的桌面 URL 打开接口。
- 抽帧和裁剪接口支持 NAS 保存的 `/generated/...` 视频路径，并检查路径及符号链接边界。
- 局域网 HTTP 支持文件上传哈希、工作流媒体导出、创建文件夹/聊天和复制文本。SHA-256 在缺少 Web Crypto 时使用 `@noble/hashes`；UUID 使用 `getRandomValues`；复制文本在按钮点击或快捷键中使用兼容路径，并在失败时明确提示。
- HTTPS 入口仍然可用。HTTP 兼容不会改变浏览器的安全设置，也不为要求安全上下文的其他浏览器功能提供豁免。

HTTP 兼容回归：`node --test scripts/test-http-hash.mjs scripts/test-browser-id.mjs` 与 `node scripts/test-http-clipboard.mjs`。NAS 原版本及配置备份位于 `/home/wyai/heliosgen-http-backup-20260915`。

验证结果记录在本地 `deployment/deployment.json` 与 `deployment/smoke-results.json`。无 API Key 时不进行付费生成验证。

## CLI 与智能体接入

部署包含一套 agent 客户端（本地 `cli/` 目录，不在容器内）：

- **CLI**：`helios`（安装在 `~/.local/bin/helios`，源码 [cli/helios.mjs](cli/helios.mjs)，Node 零依赖，JSON 输出）。除生成、图库和工作流命令外，新增 `asset list/add/import/update/reconcile` 与 `asset collection list/create/add/remove`。`asset import` 只注册 NAS 已有路径，不复制文件。
- **MCP**：`cli/mcp/server.mjs` 共 27 个工具。除原有生成、图库、资产、工作流工具外，新增 `helios_capabilities`、`helios_providers`、`helios_provider_get` / `_configure` / `_delete_key`、`helios_skills`、`helios_workflow_summary` / `_validate` / `_patch`，以及 `helios_asset_list / _add / _import / _update / _reconcile / _collection_create`。
- **Codex 技能**：`~/.codex/skills/heliosgen/SKILL.md`，教 agent 标准流程（查余额 → 选模型 → 上传参考 → debug 校验 → 生成 → 落盘）与成本规则。

为支持 agent 接入，服务端新增了以下路由（不影响 Web UI）：

- `GET /api/models`：机器可读的模型目录（与 `lib/modelConfig.ts` 同一注册表，`nasSupported:false` 标记 Veo 等 NAS 不可用的模型）。
- `GET/PUT/DELETE /api/workflows/<id>`：单工作流读写，避免全量替换 `PUT /api/workflows` 删除其他画布的风险。
- `GET /api/assets`、`POST /api/assets/import|reconcile`、`PATCH /api/assets/<id>`：零拷贝资产注册、磁盘核对及分类/元数据更新。
- `GET/POST/PATCH /api/assets/collections`：手动集合与按分类、来源、MIME、关键词匹配的智能集合。
- `GET /api/capabilities`：紧凑能力目录（provider 能力、skill 列表、节点类型），一次调用拿全。
- `GET/POST /api/providers`、`GET/POST/DELETE /api/providers/<id>`：provider 列表、密钥读写；`GET` 只返回 `configured` 布尔值，密钥不回显。
- `GET/POST /api/skills`：按 id/scope 列出或解析服务端注册的技能。
- `GET /api/media-poster?url=/generated/<path>.mp4[&w=480]`：视频封面 JPEG（ffmpeg 抽帧 + 磁盘缓存，缓存放在 `DATA_DIR` 之外，Seek 与资产索引看不到）。

并修复了 `/api/download` 在反代后自取回源失败（HTTP 502）的问题：本地 `/generated/...` 文件改为直接从媒体目录流式返回，网页 UI 的下载按钮同样受益。

CLI 生成验证记录：`deployment/agent-e2e.json`。

## 排障：局域网地址在浏览器里打不开

若 `curl http://<NAS IP>:17860/` 能通、但**浏览器**报 `ERR_ADDRESS_UNREACHABLE`，是**本机代理**拦的，不是 NAS 问题。常见于 Shadowrocket / Clash / Surge 的 **TUN（增强）模式**——它在 IP 层截流量，会**绕过** macOS 系统代理的例外列表。

修法（TUN 模式必须在工具内部加规则）：

```
IP-CIDR,192.168.0.0/16,DIRECT
```

或临时关闭 TUN 模式。Tailscale 地址不受影响。
