# HeliosGen 飞牛 NAS 部署

访问地址：<https://fn-evo4-8cad.tail071480.ts.net:9443/>（设备需连接同一 Tailscale 网络）。

源码：[SegFault42/HeliosGen](https://github.com/SegFault42/HeliosGen)，版本 `1.2.0`，提交 `f4aae3f154474fc73e4e019deabad68fa686552a`。这是基于官方 Next.js 服务的 NAS 适配部署；上游主要发行桌面应用。

## 位置与运行方式

- NAS：`wyai@100.112.104.77`
- Compose 与源码：`/home/wyai/heliosgen`
- 数据库、设置、任务状态：`/vol1/1000/HeliosGen/data/db`
- 上传和生成素材：`/vol1/1000/HeliosGen/data/media`
- Docker 镜像：`heliosgen:nas-f4aae3f`，Linux amd64
- 后端只监听 NAS 回环地址 `127.0.0.1:17860`；Tailscale Serve 在私有 HTTPS 端口 `9443` 代理它。
- 容器以非 root 用户运行，自动重启，内存上限 2 GiB、CPU 上限 2 核，日志滚动保存。

## 首次使用

打开 Settings → API Keys，填写自己的 kie.ai API Key。密钥保存在 NAS SQLite 数据库中。未迁移 Mac 桌面版的密钥、工作流或历史记录。本次部署不包含可选的 Codex CLI 生图环境。

该应用采用共享本地用户，访问同一 NAS 地址的人共用工作流、图库和 API Key。聊天历史及部分界面偏好仍保存在各浏览器本地。

## 常用命令（在 NAS 执行）

```sh
cd /home/wyai/heliosgen
docker compose -f compose.nas.yaml ps
docker compose -f compose.nas.yaml logs --tail=100
docker compose -f compose.nas.yaml restart
```

根据当前目录源码重新构建并启动：

```sh
docker compose -f compose.nas.yaml build
docker compose -f compose.nas.yaml up -d
```

服务停止后备份整个 `/vol1/1000/HeliosGen/data`，可同时保全 SQLite 和媒体；不要只复制正在写入的 `guest.db`。

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

- **CLI**：`helios`（安装在 `~/.local/bin/helios`，源码 [cli/helios.mjs](cli/helios.mjs)，Node 零依赖，JSON 输出）。覆盖 `doctor / models / key / credit / upload / image / video / pipeline / wait / status / gallery / download / workflow`。本地文件路径作为 `--ref`/`--start-frame` 传入时会自动上传；`--debug` 不扣费空跑校验；`--out DIR` 下载产物。
- **MCP**：`cli/mcp/server.mjs` 向 Codex/Claude 等暴露 11 个工具（helios_models / helios_credit / helios_upload / helios_generate_image / helios_generate_video / helios_job_status / helios_gallery / helios_download / helios_workflow_list / helios_workflow_get / helios_base_url），已注册到 `~/.codex/config.toml` 的 `[mcp_servers.heliosgen]`。
- **Codex 技能**：`~/.codex/skills/heliosgen/SKILL.md`，教 agent 标准流程（查余额 → 选模型 → 上传参考 → debug 校验 → 生成 → 落盘）与成本规则。

为支持 agent 接入，服务端新增了两个路由（不影响 Web UI）：

- `GET /api/models`：机器可读的模型目录（与 `lib/modelConfig.ts` 同一注册表，`nasSupported:false` 标记 Veo 等 NAS 不可用的模型）。
- `GET/PUT/DELETE /api/workflows/<id>`：单工作流读写，避免全量替换 `PUT /api/workflows` 删除其他画布的风险。

并修复了 `/api/download` 在反代后自取回源失败（HTTP 502）的问题：本地 `/generated/...` 文件改为直接从媒体目录流式返回，网页 UI 的下载按钮同样受益。

CLI 生成验证记录：`deployment/agent-e2e.json`。
