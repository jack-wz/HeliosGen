# Task Plan: node-banana → HeliosGen 功能节点对齐移植

## Goal

把 node-banana（/Users/wuzhu/orca/node-banana，MIT，fork 含自研剪辑功能）的高价值功能节点分阶段移植进 HeliosGen，每阶段完成「本地测试 → NAS 部署 → 浏览器实测」，最终形成「AI 生成 → 图像处理 → 视频剪辑」的画布闭环。

## Current Phase

Phase A/B/C — provider registry, Skill runtime and compact Agent APIs (foundation implemented; real fal execution remains pending)

## Branch state (2026-09-29)

所有分支已统一到 `main` @ `5f31a16`：`nas-agent-cli`、`dulse` 与 `main` 指向同一提交，
并已并入上游 `99dd5b1`（PR #28 音频 MIME 修复 + codex 修复）。Phase 1 与 Phase 2 的节点代码、
i18n、provider/skill registry 均在该提交内；Phase 2 的 NAS 实测尚未进行。

## Context

- HeliosGen（目标）：Next.js 16 + React 19 + @xyflow/react + zustand，9-11 种节点；生成走服务端 API（kie.ai 轮询 + SQLite 密钥），已部署飞牛 NAS（https://fn-evo4-8cad.tail071480.ts.net:9443/，镜像 heliosgen:nas-f4aae3f，数据 /vol1/1000/HeliosGen/data）。
- node-banana（源）：同栈（Next.js 16 + @xyflow/react + zustand），约 30 种节点，MIT 许可，fork 内有自研转场/调色/去静音。
- 评估结论：框架不整体搬，按节点分层移植；executor 的 handle 语义需逐个适配；处理类节点的输出写入 data.imageUrl 即可被 resolveInputs 自动衔接下游。
- 部署链路：改代码 → pnpm tsc/build/测试 → 重传 NAS /home/wyai/heliosgen → docker compose -f compose.nas.yaml build && up -d --force-recreate → 9443 实测。

## Phases

### Phase 0: 基线与代码图谱
- [x] codebase-memory 索引 HeliosGen（2023 节点 / 4323 边）
- [x] 确认 HeliosGen 基线：tsc / build 可跑
- [x] 盘点第一批节点的源文件与依赖清单
- **Status:** complete

### Phase 1: 纯客户端图像处理节点（无服务端依赖）
- [x] ImageResize 图片缩放
- [x] RemoveBackground 去背景（onnxruntime-web 浏览器本地推理，模型自托管）
- [x] SplitGrid 宫格拆分（简化为格子弹选输出）
- [x] ImageCompare 图片对比（react-compare-slider）
- [x] 注册 nodeTypes + AddNodeMenu/NodePicker 入口 + store 字段 + 连线衔接
- [x] tsc + build（HeliosGen 无测试框架，以类型检查+构建+浏览器实测代替单元测试）
- [x] NAS 部署 + 浏览器实测（四节点截图确认，输出落盘共享素材库）
- **Status:** complete

### Phase 2: 媒体与文本节点（接现有 API）
- [x] VideoTrim 视频裁剪 → /api/trim-video
- [x] VideoFrameGrab 抽帧 → /api/extract-frame（支持指定时间点与末帧）
- [x] LLMGenerate 文本生成 → /api/assistant
- [x] PromptConstructor 变量提示词构造（`{input}` 模板）
- [x] 接线：executor 新增 `videoUrl` handle 与文本节点下游提示词传递；nodeTypes 注册
- [ ] NAS 部署 + 浏览器实测
- **Status:** 代码完成（tsc 通过）；NAS 实测待部署后进行

### Phase 3: 视频剪辑管线
- [ ] VideoStitch 视频拼接（转场 + 调色，来自 fork 自研）
- [ ] SubtitleBurn 字幕烧录
- [ ] Transcribe 转写（参考 node-banana /api/transcribe）
- [ ] 测试 + NAS 部署验证
- **Status:** pending

### Phase 4（按需启动）: 多 provider 与重集成
- [ ] Replicate / fal.ai / Gemini 直连（搬 providers/types + 调用实现，接 modelConfig）
- [ ] ComfyUI 节点 / 3D 生成（评估后再定）
- **Status:** pending

### Phase A/B/C: Agent 基础设施（新增）
- [x] Provider registry 与 provider 状态接口（Kie/fal/Replicate/Gemini/OpenAI/WaveSpeed/Azure/Codex）
- [x] 服务端 provider key 配置/删除接口，响应脱敏
- [x] Skill registry、按 id/scope 解析与白名单元数据
- [x] capabilities 紧凑目录
- [x] workflow summary/validate/patch API
- [x] CLI/MCP provider、skill、capabilities、workflow 紧凑工具
- [ ] fal 真实 createJob/getJob 与 fallback 执行适配
- [ ] 自定义 provider 持久化、签名校验与隔离 worker
- **Status:** foundation complete; execution adapters pending

## Decisions

| 决策 | 理由 |
|------|------|
| 按节点移植而非合并代码库 | 两边 store/handle 语义不同，整体合并风险高 |
| 保留 HeliosGen 服务端密钥+轮询架构 | NAS 多设备共享场景下优于 node-banana 的 BYOK |
| 第一批只做纯客户端节点 | 零服务端依赖，可独立验证，快速见效 |
| 每阶段都部署到 NAS 实测 | 用户偏好「实现 + 验证」而非只交付代码 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| playwright_evaluate 返回 undefined | 2 | 改用 get_visible_text + click + screenshot 验证 |
| /workflow/p1test 直达被重定向首页 | 1 | useSpaceSync 异步加载，需先进首页再进工作流 |
| RemoveBackground 报 Invalid format: text/html | 1 | 默认 staticimgly CDN 不可达，改为自托管模型到 /generated/bgremoval/ |
| NAS 直下 CDN 403 | 1 | CDN 按 UA 拦截；本机带浏览器 UA 下载后 scp 传输 |
| 模型块下载截断（61/86 块不完整） | 2 | urllib 断流不续传；改 curl -C - 断点续传 + 按 resources.json 偏移量校验，全部修复 |
| compose up --force-recreate 会波及 asset-bridge | 1 | 改为指定服务名：up -d --force-recreate heliosgen |
