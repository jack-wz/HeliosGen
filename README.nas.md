# HeliosGen 飞牛 NAS 部署

访问地址：<https://fn-evo4-8cad.tail071480.ts.net:9443/>（设备需连接同一 Tailscale 网络）。

源码：[SegFault42/HeliosGen](https://github.com/SegFault42/HeliosGen)，版本 `1.2.0`，提交 `f4aae3f154474fc73e4e019deabad68fa686552a`。这是基于官方 Next.js 服务的 NAS 适配部署；上游主要发行桌面应用。

## 位置与运行方式

- NAS：`wyai@100.112.104.77`
- Compose 与源码：`/home/wyai/heliosgen`
- 数据库、设置、任务状态：`/vol1/1000/HeliosGen/data/db`
- 上传、生成及创作资产：`/vol1/@team/AIGC 创作/创作资产`（HeliosGen 与 Seek 共用同一批文件）
- 同步桥接状态：`/vol1/1000/HeliosGen/data/bridge`
- Docker 镜像：`heliosgen:nas-f4aae3f`，Linux amd64
- 后端只监听 NAS 回环地址 `127.0.0.1:17860`；Tailscale Serve 在私有 HTTPS 端口 `9443` 代理它。
- HeliosGen 主容器以非 root 用户运行；`asset-bridge` 仅以只读方式挂载媒体，监听 inotify 事件并同步两个索引。两者均自动重启并滚动保存日志。

## 首次使用

打开 Settings → API Keys，填写自己的 kie.ai API Key。密钥保存在 NAS SQLite 数据库中。未迁移 Mac 桌面版的密钥、工作流或历史记录。本次部署不包含可选的 Codex CLI 生图环境。

该应用采用共享本地用户，访问同一 NAS 地址的人共用工作流、图库和 API Key。聊天历史及部分界面偏好仍保存在各浏览器本地。

## 常用命令（在 NAS 执行）

```sh
cd /home/wyai/heliosgen
docker compose --env-file .env.sync -f compose.nas.yaml ps
docker compose --env-file .env.sync -f compose.nas.yaml logs --tail=100
docker compose --env-file .env.sync -f compose.nas.yaml restart
```

根据当前目录源码重新构建并启动：

```sh
docker compose --env-file .env.sync -f compose.nas.yaml build
docker compose --env-file .env.sync -f compose.nas.yaml up -d
```

服务停止后分别备份 `/vol1/1000/HeliosGen/data` 与 `/vol1/@team/AIGC 创作/创作资产`。不要只复制正在写入的 `guest.db`。

## Seek 创作资产同步

Seek 当前通过 `AIGC 创作/创作资产` 索引同一个媒体根目录，文件不会上传、复制或生成第二份。目录 `assets/Characters`、`assets/Props`、`assets/Environments`、`assets/Styles`、`assets/Scenes` 对应五类创作资产；生成素材仍保留在 `images/`、`videos/`，通过数据库元数据进行虚拟分类，避免移动后破坏历史工作流 URL。

`asset-bridge` 在以下事件后约 4 秒同步：

- Seek 或文件管理器写入共享目录：调用 `/api/assets/import`/reconcile 注册到 HeliosGen，随后可在 Assets、Gallery 和工作流素材选择器使用。
- HeliosGen 生成、上传或删除文件：触发 Seek folder scan，写回模型、提示词、路径、资产类型标签和图像/视频生产环节标签。
- 容器每 5 分钟进行一次兜底核对；磁盘不存在的文件会从 HeliosGen 创作资产索引移除。

Seek token 只保存在 NAS 的 `/home/wyai/heliosgen/secrets/seek-token`（`0600`），不进入 Compose、Git 或日志。`.env.sync` 保存项目/目录 GUID 与标签映射，不保存 token。

### token 自愈

fnOS 重启后可能把 bind mount 源文件重建为 root 所有的空目录，导致 `asset-bridge` 启动时报 `Seek token file not found`。启动容器前先运行 `scripts/prestart-token.sh` 自愈：

```sh
sh /home/wyai/heliosgen/scripts/prestart-token.sh
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
- HTTPS 为上传哈希、随机 ID、剪贴板等浏览器功能提供安全上下文。

验证结果记录在本地 `deployment/deployment.json` 与 `deployment/smoke-results.json`。无 API Key 时不进行付费生成验证。

## CLI 与智能体接入

部署包含一套 agent 客户端（本地 `cli/` 目录，不在容器内）：

- **CLI**：`helios`（安装在 `~/.local/bin/helios`，源码 [cli/helios.mjs](cli/helios.mjs)，Node 零依赖，JSON 输出）。除生成、图库和工作流命令外，新增 `asset list/add/import/update/reconcile` 与 `asset collection list/create/add/remove`。`asset import` 只注册 NAS 已有路径，不复制文件。
- **MCP**：`cli/mcp/server.mjs` 向 Codex/Claude 等暴露原有 11 个工具，并新增 `helios_asset_list / helios_asset_add / helios_asset_import / helios_asset_update / helios_asset_reconcile / helios_asset_collection_create`。
- **Codex 技能**：`~/.codex/skills/heliosgen/SKILL.md`，教 agent 标准流程（查余额 → 选模型 → 上传参考 → debug 校验 → 生成 → 落盘）与成本规则。

为支持 agent 接入，服务端新增了两个路由（不影响 Web UI）：

- `GET /api/models`：机器可读的模型目录（与 `lib/modelConfig.ts` 同一注册表，`nasSupported:false` 标记 Veo 等 NAS 不可用的模型）。
- `GET/PUT/DELETE /api/workflows/<id>`：单工作流读写，避免全量替换 `PUT /api/workflows` 删除其他画布的风险。
- `GET /api/assets`、`POST /api/assets/import|reconcile`、`PATCH /api/assets/<id>`：零拷贝资产注册、磁盘核对及分类/元数据更新。
- `GET/POST/PATCH /api/assets/collections`：手动集合与按分类、来源、MIME、关键词匹配的智能集合。

并修复了 `/api/download` 在反代后自取回源失败（HTTP 502）的问题：本地 `/generated/...` 文件改为直接从媒体目录流式返回，网页 UI 的下载按钮同样受益。

CLI 生成验证记录：`deployment/agent-e2e.json`。
