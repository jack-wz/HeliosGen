# HeliosGen 改造计划

> 更新：2026-09-24 ｜ 分支 nas-agent-cli ｜ 代码图谱 2481 节点 / 5491 边（codebase-memory-mcp）
> 旧版计划（09-20）中“Phase 1–5 全部完成”不准确，以下为重新实测后的状态。

## 一、实测结论

| 访问路径 | 页面首包 | 3.7 MB 视频 | 说明 |
|---|---|---|---|
| NAS 本机 | 12–18 ms | — | 应用本身很快 |
| 局域网 192.168.1.185:17860 | — | 12.7 MB/s | |
| Tailscale :9443 | 33–178 ms | 25 MB/s | 图片页冷打开 0.55 s |
| 公网 heliosgen.iepose.cn | 9.4–16.6 s | 2.3 MB/s | 飞牛 FN Connect 中继 |

公网慢的主因在中继链路：连空接口 /api/credit 也要约 10 秒。NAS 到中继 211.99.101.104:1713 的隧道持续以约 1.5 MB/s 上传、积压约 3 MB，而同期 HeliosGen 容器几乎没有流量——隧道被 NAS 上其他走 FN Connect 的服务占满。飞牛官方说明只有中继转发限速，局域网、公网直连和 P2P 不限速。

## 二、进度

### 已完成：加载优化（2026-09-24 部署并验证）

| 改动 | 文件 | 验证 |
|---|---|---|
| 资产库分页（每页 48）、图片走缩略图、视频先显示封面且 preload=none | app/assets/page.tsx，app/api/assets/route.ts | 冷打开 ≈1.1 GB → 2.87 MB，视频文件 0 次下载 |
| 通用视频封面接口，缓存在 DATA_DIR/cache/posters | app/api/media-poster/route.ts，lib/mediaPreview.ts | 首次 0.3–3.6 s，之后 4 ms，每张约 60 KB；路径穿越返回 404 |
| 图库、素材选择弹窗、工作流首页、参考视频位的视频改用封面 | app/gallery/page.tsx，components/MediaPickerModal.tsx，components/WorkflowDashboard.tsx | 视频页冷打开 2.45 MB，10/10 显示封面 |
| 图片加载并发 4 → 8；卡片中途卸载时归还名额（原来会泄漏导致卡死） | app/gallery/page.tsx | tsc 通过 |
| 缩略图缓存挂到 NAS 数据盘，重新部署不再冷启动 | compose.nas.yaml | 530 个缓存文件已迁移 |
| 资产索引与 Seek 同步跳过系统目录 posters/、bgremoval/ | lib/guest/creativeAssets.ts，bridge/asset_sync.py | 资产 173 → 163，自动整理 helios=163 seek=163 |

### 待办 A：访问方案（不需要改代码）
1. 自己人改用局域网或 Tailscale；外部少量用户用 Tailscale 设备共享（免费版最多 6 人）。
2. 在飞牛后台查清是哪个服务在占用 FN Connect 上行（影视远程播放、相册、同步等）。
3. 如需免客户端的公网访问：国内或香港云服务器 + frp/Caddy + /generated、/_next/image 反向代理缓存（两者都已带一年期不可变缓存头）。

### 待办 B：素材分类（3–5 天）
> 已细化为 AI 分类方案，见 ASSET_AI_PLAN.md（约 10–12 人日，含角色档案与创作流程打通）。

现状：163 条资产中 158 条未分类，手动分类 0 条，标签 0 条；分类是 5 个英文硬编码类；图库“文件夹”与资产库“分类/集合”是两套互不相通的系统。
注意：自动整理（upsertCreativeAsset）已会保留手动分类，持久化本身没有问题；缺的是整理入口和数据。

1. 左侧加“未分类 / 待整理”入口和计数，支持多选批量归类（后端已有 PATCH）。
2. 标签编辑与筛选：按标签、媒体类型、来源、模型、日期筛选。
3. 分类改为稳定 ID + 可自定义（新增 asset_categories 表），显示名走 i18n。
4. 打通图库文件夹与资产集合（文件夹 = 手动集合），避免两套体系。
5. 可选：按提示词、模型自动建议分类，一键接受。
6. Seek 标签随分类变更同步（bridge 已有 CATEGORY_TAGS 映射，需补齐映射配置）。

### 待办 C：中文化（核心 2–3 人日，完整 5–7 人日）
next-intl 已接入，默认 zh-CN，messages 各 80 行，只有 5 个文件使用翻译。
剩余英文文案（正则粗估）：JSX 文案约 94 处、属性文案约 92 处、提示框约 20 处、API 错误约 49 处、模型/节点标签约 50 处；最集中在 gallery/page.tsx、GenerateNode、SettingsModal、VideoGeneratorNode。API 错误改为稳定 code 由前端本地化，CLI/MCP 仍读取 error 字段。

### 其他遗留
- 20 张图片中 5 张缺少 aspect_ratio，前端仍需用 32px 缩略图探测（开销很小，可后续回填）。
- 图库冷加载时仍会出现一次原图请求（约 6.8 MB），来源未定位。
- 公网域名未带任何凭据即可访问页面和 API；应用本身没有登录，且共用 Kie API Key，需要在飞牛穿透配置中确认“认证访问”是否生效。
