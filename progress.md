## 2026-10-03（新增「封面」分类 + 全库重跑 ✅ `87ae77f`、`ca8912e`）

### 背景
用户场景是**视频制作**，资产库里**大量是封面参考**。原先没有这个分类，它们只能落进 Characters 或 Scenes —— **主体盖过了这张图真正的用途**。

### 改动
- 新增 `Covers` 分类（词条「封面」），图标 `MonitorPlay`，文件夹 `assets/Covers`
- **关键不只是加分类**：提示词必须说明**封面优先于主体**。否则一张含人物的封面永远会答 Characters。提示词现在明确写了这一点
- TypeScript 的 `Record<Category, …>` 直接指出页面里 3 处遗漏，没靠人肉找

### 上真机前的验证（这次没靠猜）
拿 3 张真实资产直接打线上 API 测新提示词：
- 三张原先答 Characters / Scenes 的，现在都答 **Covers**
- **逐张打开原图核实**：三张都有醒目的中文大标题，是**我看缩略图看漏了**（模型两次都对、我两次都错）
- 样本上**未观察到误判**

### 全库重跑
先**备份数据库**（`guest.db.before-covers`），再 `--overwrite` 重跑 170 个。

| 分类 | 重跑前 | 重跑后 |
|---|---|---|
| **Covers** | — | **74** |
| Characters | 56 | 54 |
| Styles | 21 | 18 |
| Scenes | **72** | **15** |
| Props | 17 | 6 |
| Environments | 4 | 3 |

**Scenes 从 72 掉到 15** —— 原先大量被误判为"场景"的其实是封面。**未分类 0**。

封面描述样例（模型自己点出"封面"）：
- 「科技风**竖版封面**，绿色霓虹光效舞台上…顶部为绿色渐变中文标题与 ColorOS」
- 「**竖版小红书教程封面**：一名男子身旁的纸箱喷涌出悬浮的办公桌椅…顶部有醒目中文标题」

### 顺带修掉的 i18n bug
选中分类后标题显示英文 `Covers`（直接用了存储值，而它同时是文件夹名）。改为走与侧栏相同的翻译。线上双语验证：「封面」/ "Covers"。

### 回滚点
`rollback-20261003-085016`、`-092436`；数据库可回滚：`cp /data/db/guest.db.before-covers /data/db/guest.db`

## 2026-10-03（资产页补齐四项能力 ✅ `0203d61`）

重构后剩下的四项缺口，全部完成。

### ① 按体积排序
`creative_assets` 新增 `size_bytes` 列，在 **import/reconcile 时填充**（那里本来就在 `stat` 文件，不额外增加 IO）。
线上 reconcile 后 **170/170 行已回填**。
排序为**降序**——这个排序存在的意义就是回答"什么东西占地方"。
线上实测：**170 个资产合计 0.56 GB**（WebP 压缩前是 1.01 GB）。

### ② 删除资产
新增 `DELETE /api/assets/<id>`，**删库行 + 删源文件**。

**刻意不提供"仅从库中移除"**：媒体目录是事实来源，reconcile 会把磁盘上还存在的文件重新加回来——只删行的做法会在下次扫描时**悄悄复活**。
而这个目录**与 Seek 共享**，所以确认对话框直接说明后果（"会同时删除共享目录里的源文件，Seek 那边也会消失"），而不是含糊地问"确定吗"。

### ③ AI 分类可撤销
分类接口现在返回**改动前的 category / description / tags**；当覆盖了已有值时，UI 给出**带撤销按钮的 toast**。
覆盖掉手工分类却无法回退，是让人不敢再用这个功能的最快方式。
为此给 toast 加了**可选操作按钮**，并**延长停留时间到 12 秒**——够不着的撤销窗口不算撤销。

### ④ 虚拟化
卡片加 `content-visibility: auto` + `contain-intrinsic-size`（避免滚动条跳动）。
Guidelines 建议 >50 项虚拟化；170 张一个网格已经越线。这是**不引入新依赖**的轻量做法。

### 验证
| 项 | 结果 |
|---|---|
| 体积排序（本地） | ✅ 17.8 → 14.1 → 13.9 → 6.6 MB |
| 删除（本地） | ✅ `fileRemoved: true`，文件 4→3；重复删除 404 |
| 删除确认框 | ✅ 说明后果、Esc 可关 |
| 撤销 toast | ✅ 「识别完成 \| 撤销」→ 点击后「已撤销」 |
| 虚拟化 | ✅ 线上 48/48 卡片启用 |
| 线上排序进 URL | ✅ `?sort=size` |
| JS 错误 | 无 |

tsc ✅ · build ✅ · 21/21 回归测试 + clipboard ✅ · 版本守卫 ✅ · eslint **154**（基线，无新增）✅ · 线上双语验证 ✅

### 回滚点
`rollback-20261003-084119`

## 2026-10-03（资产页重构 ✅ `d85e2b5`）

用户反馈「资产页展示、交互、内容太原始」，要求从 **交互 / 信息密度 / 成熟实践** 三个维度重新评估。

### 评估：原页面每张卡片有 11 项
文件名、model·source、relative_path、prompt 两行、分类下拉、标签、加入合集下拉、AI 按钮、复制、勾选框、视频控件。**170 张铺开就是一面墙**，而用户真正来看的"图"反而是最小的一部分。

### ① 交互
新增**预览灯箱**（`←/→` 切换、`Esc` 关闭、打开时聚焦、锁定 body 滚动）、hover/键盘聚焦才出现的快速操作、排序、搜索防抖进 URL。

### ② 信息密度：11 → 3
卡片只剩**图 + 名称 + 分类徽标**。勾选/AI/更多菜单移到 hover；prompt、标签、来源（模型·路径）移入灯箱——**详情本就该在详情视图里**。

### ③ 成熟实践（参考 Immich / Eagle / Google Photos 的做法）
- 未分类资产带**「待复核」角标**，侧栏有**「未分类」入口**，头部一键**「AI 识别 N」**只处理这些
- **分类在浏览态是徽标、在详情态才是下拉** —— 原设计让每张卡片都是一个编辑表单

### 顺带修正的 8 处 Guidelines 违规
搜索框无 label、勾选框无 aria-label 且用透明 ✓、`<select>` 无 label 与 `color-scheme`、`outline-none` 无 focus 替代、`window.prompt`/`alert`、**筛选不进 URL**（刷新丢失、不能分享）、硬编码英文、加载态用 `…`。

### 两个我自己想过后改的设计
1. **选中态改为派生**（只保留当前可见集合里的 id），而不是在 effect 里清空 —— "隐藏的资产仍可被操作"这个窗口从结构上消失
2. **灯箱跟踪 id 而非 index** —— 列表变化时 index 会悄悄指向另一张图

### 验证
| 测试 | 结果 |
|---|---|
| 点卡片开灯箱 | ✅ 含分类下拉 |
| `←`/`→` 切换 | ✅ |
| `Esc` 关闭 | ✅ |
| 筛选进 URL | ✅ `?category=Characters` |
| **刷新保持筛选** | ✅ 标题 Characters、7 张 |
| 排序进 URL | ✅ `&sort=name` |
| 线上双语 | ✅ zh/en 标题正确、193 个 aria-label 按钮 |
| JS 错误 | 无 |

（线上「待复核」不显示是**正确的**——170 个资产已全部有分类。）

## 2026-10-02（视频分类完成 · **170/170 全部覆盖** ✅）

### 结果
```
Scenes 72 · Characters 56 · Styles 21 · Props 17 · Environments 4
可分类 170，已分类 170
```
图片与视频**全部有分类**。

### 做法
视频走**封面帧**：把 `media-poster` 路由里的抽帧逻辑抽成 `lib/videoFrame.ts`，**路由与分类器共用**——复制一份会导致两套缓存、两套 ffmpeg 参数各自漂移。

### 过程中修的两个问题
**1. 抽帧逻辑不可复用（`25468b3`）**：原本只在路由里内联，分类器无法调用。抽出共享模块后路由改为委托。

**2. ffmpeg 退出码为 0 却没写出文件（`a781ad0`）**：最后一个视频是 **0.5 秒 / 5 帧**的测试片段，`-ss 0.5` 的定位落在末尾之后——**ffmpeg 返回成功但没产出文件**，旧代码信任退出码就直接 `rename`，抛错后整体报"无封面帧"。
现改为**校验产出文件是否真的存在**，空则回落 `-ss 0`。
手工先验证过：该片段 `-ss 0` 能写出 12.5KB JPEG，`-ss 0.5` 什么也不写。

### 视频分类样例
| 分类 | 描述 |
|---|---|
| Environments | 「晨雾弥漫的翠绿竹林中，一盏红灯笼轻挂枝头，柔和晨光透过竹叶洒落，水彩晕染出静谧空灵的东方意境。」 |
| Scenes | 「夜晚的未来感巨型走廊里，身穿黑色带青色光纹科技风大衣的年轻亚洲男子锁定画面中心，两侧霓虹光带与紫色屏幕向远方尖锐汇聚…」 |
| Styles | 「经典电视彩条测试图，配有时码显示框与彩色斜线，画面叠加数码故障噪点…」 |

### 回滚点
`rollback-20261002-174035`、`-174604`

## 2026-10-02（AI 分类真机验证完成 · 157/157 ✅）

### 结论
**157 张图片全部分类完成**，分布：`Scenes 70、Characters 48、Styles 19、Props 17、Environments 3`。资产页 38 个下拉已带 AI 分类，无 JS 错误。

### 真机排查中发现的 4 个问题（都已修）

**1. 密钥端点不对（`83652d9`）**
小米 MiMo 有**两套独立鉴权系统，密钥与端点互不通用**：`sk-` → `api.xiaomimimo.com`，`tp-` → 区域 token-plan 主机。用 `tp-` 打 `api.` 主机返回 `401 Invalid API Key`，**读起来像密钥错，其实是端点错**。实测该密钥在 `token-plan-cn.xiaomimimo.com` 可用（`-sgp` 拒绝）。现按密钥前缀自动选端点。

**2. 模型名不存在（`83652d9`）**
文档里的 `mimo-vl` 不被服务：返回 `Unsupported model`。逐个实测：`mimo-v2.6-flash` / `v2.5` / `v2.6-pro` 接受图片，**`v2.5-pro` 返回 "No endpoints found that support image input"**。默认改为 `mimo-v2.6-flash`。

**3. 非图片资产被计为失败（`78340a2`）**
首次跑出"10/10 全失败"，看着像模型坏了——其实是**前 10 个资产恰好都是 .mp4**（170 个里 13 个视频）。改为跳过并单独计数，不把视频混进失败数里掩盖真问题。

**4. token 预算被推理吃光（`8921219`）**
`mimo-v2.6-flash` **先输出 `reasoning_content` 再输出正文**，两者共用 `max_tokens`。400 时模型把预算全用在思考上、**正文为空**（`finish_reason: length`），另一张的 JSON 被截断在半句。提到 2000 后大幅好转。

**5. 截断的答案被整份丢弃（`ff743d2`）**
剩下的顽固个例：`finish_reason: stop` 但 JSON 在描述中途被截断。严格解析会**把整份答案丢掉**——而真正要用的 `category` 就在开头。现在严格解析失败时**逐字段抢救**（category 优先，再取存活的 description/tags）；同时提示词要求描述控制在 40 词内。

### 过程中还修了
- 错误信息带上 `finish_reason` 与原始返回前 200 字符 —— 原来只说"did not return a usable classification"，**无从下手**
- 解析失败**自动重试一次**（模型是随机的，同一张图这次不行下次行）
- `database is locked` 的偶发失败（脚本与运行中的应用竞争 SQLite 锁）——重跑即补上

### 质量样本（真实输出）
| 分类 | 描述 |
|---|---|
| Props | 「一个黑色方形毛绒玩偶…正面绣着两只圆圆的白色大眼睛，旁边摆放着印有"小布点"字样的产品卡片」 |
| Characters | 「名为吴越的男性角色设计参考表，包含正面、侧面、四分之三侧面和背面全身视图…」 |
| Styles | 「一张由红、绿、黄、蓝、洋红、青色竖直色条组成的经典电视测试卡图案，左上角带有时间码」 |

### 未做
- **13 个视频未分类**：视觉模型吃图片，视频需要先抽封面帧。已单独计数而非算作失败，属独立工作量。

### 回滚点
`rollback-20261002-164912`、`-165138`、`-172830`、`-173316`、`-173617`

## 2026-10-02（压缩收尾：缩略图重建 + 精确清理 + 磁盘实况）

压缩改了原图字节 → 缩略图缓存键（含 size/mtime）全部失效。做了两件事：

### 1) 缩略图重建
`128 张新生成（1097 个宽度档）、39 张跳过、0 失败，用时 241s`，负载全程 1.6 左右。

### 2) 精确清理（`388adb3`，新增 `--prune`）
清理前缓存 **2655 个条目 / 158MB**，其中 **1152 个失效（71.9MB）**。

**不能按时间删**：78 个文件（39 个"已是 WebP" + 39 个"未收益"）**没被改动**，它们的缓存仍然有效。所以 `--prune` 的做法是**枚举当前文件真实有效的键**，删掉不在集合里的。
**隔离实例验证**：36 个条目中保留 27 个（3 个未变文件 × 9 档），只删了 9 个（1 个被压缩文件 × 9 档）。

清理后：**1503 个条目 / 83MB**。

### 3) ⚠️ 磁盘实况：总占用**暂时反而增加**
| 目录 | 现在 | 之前 |
|---|---|---|
| 创作资产 | **902M** | 1.5G |
| **原图备份** | **1.1G** | — |
| 缩略图缓存 | 83M | 90M |
| **合计** | **≈2.08G** | **≈1.59G** |

压缩本身省了 **598MB**，但**备份占了 1.1G**，所以**净增约 490MB**。真正的收益要**删除备份**才落地。

备份是回滚安全网（`--rollback` 依赖它）。**删除需用户确认**——建议先用一段时间确认无误再删。

### 线上验证
画廊 47/47、资产 38/38 缩略图，**0 破图**，无 JS 错误；中位 94ms（画廊）。

### 回滚点
`rollback-20261002-164116`

## 2026-10-02（资产功能完善 · 第 2、3 项 ✅）

### 第 2 项：AI 分类与自动识别（`271074f`）
分类此前**只看文件夹路径**（`assets/Characters/…`），只有人手动归过档才准确。现在按**内容**分类。

- **模型**：小米 **MiMo-VL**，走 OpenAI 兼容接口 `https://api.xiaomimimo.com/v1`。选它是因为模型 MIT 开源、接口是标准 chat/completions。模型名与 base URL 是常量，改成 app 已有的 Kie 通道（同样提供多模态 Gemini）只需一行。
- **输入用 640px 预生成缩略图，不是原图**：原图 6–18MB，传它要几秒上传 + 大量图像 token，而 640px 足以回答分类问题。**用桩服务器验证过**：请求里是 90KB 的 WebP data URL，不是 14MB 源文件。
- **三个入口**：设置页密钥字段（自包含组件，避免 props 穿透）、资产卡片按钮、批量栏按钮（顺序执行以避开限流并显示进度）、`scripts/classify-assets.mjs`（`--limit`/`--dry-run`/`--overwrite`，复用同一模块，批量与单击不会走偏）
- **无密钥是一等状态**：接口返回 **409 + `vision_not_configured`**，UI 转成指向设置的提示；脚本打印明确说明后退出
- **顺带重构**：分类词表移到 `lib/assetCategories.ts`——它原在 `lib/guest/creativeAssets.ts`，而后者 import `node:fs`，**客户端组件无法引用**；picker 的筛选需要同一份五个分类名。`creativeAssets` 改为再导出，既有 import 不受影响

### 第 3 项：资产 ↔ 创作打通（`bf1cabd`）
picker 原本只有「上传 / 图像生成 / 视频生成」，**没有资产库**——想复用已有素材得先记住它落在哪个页签。现在**默认打开「资产库」页签**：分类筛选 + 搜索，走 `/api/assets`（分类过的、Seek 同步的资产）。
**端到端验证**：在图像节点打开 picker → 切到资产库 → 点击资产 → 弹窗关闭且节点渲染出该图。

**顺带修掉一个遗留慢路径**：`ImageInputNode` 把本地文件也送进 `<NextImage>`，即让优化器解码 6MB 原图去填一个 ~200px 的节点。远程 URL 仍需要优化器（它服务端取图，对带鉴权/过期的链接会失败），所以分支改为**仅远程**，本地走 `previewImageUrl`。
**未回归**：分辨率徽标读的是存储的 `imageNaturalRatio`（设图时记录的原图尺寸），所以节点仍正确显示 `2480 × 3312`，而实际加载的是 640×855 缩略图——**查证过，不是假设**。

### 部署中发现的遗漏（已修，`5ec77e3`）
`classify-assets.mjs` **没加进 Dockerfile** —— 镜像里有 `lib/assetVision.ts` 却没有批量入口。**是检查部署后的容器发现的**，不是假设 Dockerfile 完整。

### 线上验证
- `/api/settings/mimo-key` → `{"hasKey":false}` ✅
- 分类接口（无密钥）→ **409 + `vision_not_configured`** ✅
- 脚本在镜像内、无密钥时打印明确提示 ✅
- 页面加载无 JS 错误 ✅

### ⚠️ 诚实边界：分类质量未验证
用户尚未提供 MiMo API Key。**链路用桩验证通过**（请求形状、响应解析、写库、降级），但**没有真实模型看过真实图片**。拿到密钥后应先 `docker exec -w /app heliosgen node scripts/classify-assets.mjs --limit 10` 看质量再全量。

### 回滚点
`rollback-20261002-162243`（A2+A3）、`rollback-20261002-162448`（Dockerfile 补漏）

## 2026-10-02（资产功能完善 · 第 1 项：空间压缩 ✅）

用户需求：**占用空间的压缩，且不损害原来的质量**。

### 实测选型（4 个真实资产，6.6–17.8MB）
| 方案 | 结果 | 像素 |
|---|---|---|
| **无损 WebP** | 52.4MB → **23.5MB（省 55%）** | ✅ **逐字节完全一致** |
| PNG 重压（zopfli） | 52.4MB → 50.3MB（省 4%） | ✅ |

结论：无损 WebP 是唯一的收益来源；"无损"**不靠假设**——`lib/assetCompress.ts` 对每个文件在写入前后各解码一次做**原始像素比对**，不一致就拒绝写入。

### 关键约束与解法
工作流节点数据里以**自由 JSON** 存了 `/generated/images/<id>.png`，DB 与资产索引同理——**改成 `.webp` 会破坏无法全部重写的引用**。

解法：**字节就地替换、路径不变**；代价是扩展名不再描述内容，因此服务端改为**按魔数嗅探 Content-Type**（`lib/fileSignature.ts`，读前 12 字节识别 PNG/JPEG/GIF/WebP/AVIF/HEIC/MP4/WebM）。

### 交付物
| 文件 | 作用 |
|---|---|
| `lib/fileSignature.ts` | 按魔数定 Content-Type |
| `lib/assetCompress.ts` | 无损 WebP 转换 + **逐文件像素校验** + temp/rename 原子写入 + 收益阈值 8% |
| `scripts/compress-assets.mjs` | 迁移：**先备份**、幂等、`--dry-run`/`--limit`/`--rollback` |

备份落在 `DATA_DIR/asset-originals-backup`（**媒体目录外**，Seek 与资产索引看不到）。

### NAS 执行结果
```
压缩 123 个、跳过 5（已是 WebP）、未收益 39、失败 0，用时 1058s
体积：1.01 GB -> 0.49 GB  省 51.5%
```
- **全库独立校验：167/167 像素完全一致，0 不一致**（1072MB → 502MB，省 53.2%）
- 创作资产目录：1.5G → **902M**；原图备份 1.1G（可 `--rollback` 还原）
- 39 个"未收益"是守卫正常工作（WebP 对这些文件不省空间，就不动它）

### 上线验证
画廊 47/47、资产页 38/38 缩略图，**0 破图**，无 JS 错误；原图服务 `.png` 路径返回 `Content-Type: image/webp` 且浏览器正常解码（2480×3312）。

### 回滚点
`rollback-20261002-133931`；文件级回滚 `docker exec -w /app heliosgen node scripts/compress-assets.mjs --rollback`

### 待办
- 第 2 项 AI 分类：用**小米 MiMo-VL**（OpenAI 兼容 `https://api.xiaomimimo.com/v1`），**需要用户提供 API Key**
- 第 3 项 资产↔创作打通

## 2026-10-02（更正：Shadowrocket 无需改动，局域网本就可用）

用户要求「帮我添加 Shadowrocket」。查证后发现**无需添加任何东西**，而且**我前两轮的归因都是错的**。

### 查证结果
| 检查项 | 结果 |
|---|---|
| `rule: IP-CIDR \| 192.168.0.0/16 \| DIRECT` | ✅ **早已存在** |
| `general.skip-proxy` 含 `192.168.0.0/16` | ✅ 已排除 |
| `general.tun-excluded-routes` 含 `192.168.0.0/16` | ✅ 已排除 |
| **真实浏览器**（`open` 后用 Comet 打开） | ✅ **建立 6 条到 NAS 的活动连接** |
| **Orca 内嵌 Chromium** | ✅ 稳定持有 5 条连接 |

配置位置：`~/Library/Containers/com.liguangming.Shadowrocket/Data/Documents/Databases/default.db` 的 `config` 表（`section='rule'` / `'general'`）。用户自己已有 `~/.shadowrocket/import-ai-rules-to-shadowrocket.py` 作为导入范例。

### 我错在哪
1. 第一轮：说「系统代理例外列表不生效」——机制说错了
2. 第二轮：说「TUN 按进程分流」——**规则其实早就放行了局域网**
3. **根本错误：我的测量对象是我自己的工具链，不是用户的机器**

从 `devin` CLI 进程树里拉起的 `python` / `node` / Playwright 的 Chromium 连不上局域网，而 `curl` / `nc` / **真实浏览器** 都通——这是 **macOS 的「本地网络」隐私权限**（macOS 15+，本机 27.0.1）**按进程授权**，与网络、NAS、Shadowrocket 都无关。

### 教训（写给以后的自己）
**验证"用户的浏览器能否访问"时，不能用我自己从 CLI 拉起的无头浏览器当替身**——它和用户的浏览器不在同一权限上下文里。正确做法：用 `open <url>` 交给用户的真实浏览器，再从 `lsof -iTCP:<port>` 看是否有该浏览器进程的活动连接。这一招在本轮一次就给出了定论。

### 已更正
- `README.nas.md` 排障章节重写：改为「先分辨是哪种进程」，并明确记录 Shadowrocket 无需改动 + 配置位置（`d9a0669`）

## 2026-10-02（局域网打不开的真因：代理 TUN 按进程分流）

用户追问「怎么局域网在这台 Mac 上仍然走不通？」——**我上一轮的归因不够准确，这轮查实了**。

### 实测特征（macOS 27.0.1 + Shadowrocket）
**同一台机器、同一时刻、同一地址，按程序分流**：

| 目标 | python / node / openssl / 浏览器 | curl / nc / bash |
|---|---|---|
| NAS 局域网 `192.168.1.185` | ❌ `No route to host` | ✅ 307 |
| 路由器 `192.168.1.1` | ❌ `No route to host` | ✅ 200 |
| NAS Tailscale `100.112.104.77` | ✅ 通 | ✅ 307 |
| 公网 `1.1.1.1` | ✅ 通 | ✅ 400 |

即 **`192.168.1.0/24` 整个网段对部分程序被拒**，Tailscale 网段与公网对所有程序都通。

### 逐一排除的假设
| 假设 | 排除依据 |
|---|---|
| 路由错误 | `route get 192.168.1.185` → `interface: en0` 正确；`192.168.1 → link#15 (en0)` 在表 |
| NAS 侧防火墙 | 同机 curl 能连；NAS 上 80/443/17860 均通 |
| 代理环境变量 | `curl --noproxy '*'` 显式直连仍成功（`Trying… Connected`） |
| 二进制签名 | Apple 签名的 `/usr/bin/python3` **失败**，同为 Apple 签名的 `/usr/bin/curl` **成功** |
| 源地址选择 | python 显式 `bind(('192.168.1.2',0))` 仍失败 |
| 端口 | python 连路由器 `:80` 同样失败 → 与端口无关 |

### 真因
Shadowrocket 的 **TUN（`utun7`，`MacPacketTunnel`，端口 1082）**：
```
default    link#26     UCSg     utun7     ← 抢走默认路由
128.0/1    link#26     UCS      utun7     ← 抢走半个 IPv4 空间
192.168.1  link#15     UCS      en0
```
包隧道在 **IP 层**工作，**能按进程决定放行/丢弃**——这是"同机同址、按程序不同结果"的唯一解释。它**绕过** macOS 系统代理例外列表，所以改系统设置无效。

**我上一轮说"是 Shadowrocket 拦的"方向对，但机制说错了**（说成"系统代理例外列表不生效"）——实为 TUN 的按进程规则。

### 修法（已写入 README.nas.md 排障章节）
```
IP-CIDR,192.168.0.0/16,DIRECT
```
或开「绕过局域网」开关；或临时关 TUN。Tailscale 地址不受影响，可作临时替代。

验证脚本也已写入 README（改前报 `No route to host`，改后打印"局域网通了"）。

## 2026-10-02（局域网可用性：绑定全网卡 + 资产页瘦身）

用户诉求：**局域网内所有人都走局域网链接、更快**。

### 诊断
| 检查 | 结果 |
|---|---|
| NAS 上 17860 监听 | ✅ 绑定 `192.168.1.185` |
| **curl** 访问 `192.168.1.185:80/:443/:17860` | ✅ 302/400/307，连测 5 次全通，~35ms |
| **Chromium** 访问同样三个端口 | ❌ 全部 `ERR_ADDRESS_UNREACHABLE` |
| 到 NAS 的路由 | ✅ `interface: en0`（正确直连） |
| 本机代理 | **Shadowrocket `MacPacketTunnel`（TUN 模式）**，端口 1082 |
| NAS IP 分配方式 | ⚠️ **DHCP 动态**（`scope global dynamic`，租约 ~70 小时） |

**两个结论**：
1. **局域网服务本身正常**——curl 通、浏览器不通是**本机 TUN 拦的**（TUN 在 IP 层截流量，绕过 macOS 系统代理例外列表）
2. **真正的隐患**：compose **硬编码了 `192.168.1.185`**，而该 IP 是 DHCP 分配的——**租约一变容器就绑定失败、起不来，局域网所有人都会打不开**

### 处置
**1) 绑定全网卡**（`822214c`，用户选 A 方案）
```yaml
ports:
  - "17860:3000"      # 原为 127.0.0.1:17860 + 192.168.1.185:17860
```
- 实测绑定变为 `0.0.0.0:17860` + `[::]:17860`
- **顺带新增 Tailscale IP 直连**：`http://100.112.104.77:17860/` → 307（不再依赖 9443 代理）
- **权衡（已确认接受）**：17860 也暴露在 Tailscale 与隧道网卡上

**2) 资产页瘦身**（同提交）
- 卡片 `previewImageUrl(asset.url, 360)` → `320`：`360×2=720→828 档` 改为 `320×2=640 档`
- 实测：**2546KB → 1937KB（-24%）**，宽度档确认为 `['640']`

### 访问方式（按速度排序）
1. 局域网 `http://<NAS IP>:17860/`
2. Tailscale 直连 `http://100.112.104.77:17860/`
3. Tailscale HTTPS `https://fn-evo4-8cad.tail071480.ts.net:9443/`
4. 公网中继

### 本机排障（已写入 README.nas.md）
浏览器打不开局域网地址时，在 **Shadowrocket 内**加规则（TUN 模式必须在工具内加，改系统例外无效）：
```
IP-CIDR,192.168.0.0/16,DIRECT
```

### 复测（经 Tailscale）
| 页面 | HTTP | DCL | 缩略图 | 中位 | 合计 | 破图 |
|---|---|---|---|---|---|---|
| 画廊·图像 | 200 | 156ms | 47 | 71ms | 1016KB | 0 |
| 画廊·视频 | 200 | 83ms | — | — | — | 0 |
| 资产 | 200 | 52ms | 38 | 828ms | 1937KB | 0 |
| 工作流 | 200 | 64ms | — | — | — | 0 |
| 对话 | 200 | 59ms | — | — | — | 0 |

无 JS 错误。部署回滚点 `rollback-20261002-121236`。

### 清理
已按要求关闭浏览器预览与 `ssh -L 17860` 隧道（确认 `127.0.0.1:17860` 返回 000）。

## 2026-10-02（方案 1 完成 ✅ —— 缩略图改为写入时预生成）

### 问题与实测根因
用户报告「打开后素材加载很慢」。实测：
- 原图 **5.7–17.8 MB PNG**（167 张）
- NAS CPU **Intel N150，4 核低功耗**
- `/_next/image` 每次请求都**完整解码**原图：单张冷缓存 **0.9–4.7s**
- 首屏 **26 个**图片请求，其中 **12 个只是 `w=48` 图标**，却同样解码 9MB+
- 8 张并发 1080px 墙钟 **4.67s**
- 缓存 TTL 是 4 小时（Next 16 默认）→ **排除** churn 嫌疑

### 实现
| 文件 | 作用 |
|---|---|
| `lib/thumbWidths.ts` | 宽度阶梯（客户端安全；`imageThumb` 依赖 sharp 不能进客户端包） |
| `lib/imageThumb.ts` | 生成 + 缓存；**单次解码 + `clone()` 出 9 档** |
| `app/api/image-thumb/route.ts` | 服务端点，immutable 头，错误带 `code` |
| `scripts/backfill-thumbs.mjs` | 回填：幂等、可中断、`--dry-run`/`--limit`/`--widths` |
| `scripts/_ts-alias-hooks.mjs` | 教 Node 认识 `@/` 别名与**无扩展名相对导入**，使脚本能直接 import 真实模块而非复制逻辑 |

接入点在 **`uploadBuffer()`**——所有写入的单一收口点，**刻意不 await**。

### 两个关键发现
1. **运行时镜像不含 `scripts/` 与 TS 源码** → 回填脚本无处可跑。而**回填必不可少**：`/_next/image` 本来就缓存，只换端点的话既有文件仍是「首次慢」。已把维护工具 + `lib/` 打进镜像（仅 `docker exec` 可达）。
2. **WebP 质量取舍是量出来的**：对照无损参照，q=95 仍有 0.8% 通道差——有损在任何档位都有损。选 **q=85**（均值差 0.91/255），注释写明权衡。

### 实测对比（同一测法）
| 指标 | 前 | 后 | 提升 |
|---|---|---|---|
| 单张（服务端冷缓存） | 0.9–4.7 s | **~2–4 ms** | ~1000× |
| 8 张并发 1080px（墙钟） | 4.67 s | **0.060 s** | **~78×** |
| 浏览器单张中位数 | 150–190 ms | **53 ms** | ~3× |
| 26 张合计字节 | — | 1016 KB | — |

回填：**167 张 / 174 秒**，缓存 88MB / 1503 文件，负载全程 1.5–2.6（未压垮 NAS）。
浏览器验证：47/47 缩略图成功解码、宽高比正确、无 JS 错误。

### 部署
三次（`c1136cb` 实现 → `209eb40` 镜像含维护工具 → 回填执行），回滚点 `rollback-20261002-110615`。

### 验证清单
tsc ✅ build ✅ 21/21 回归测试 + clipboard ✅ 版本守卫 ✅ eslint **154**（基线，无新增）✅

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

## 2026-10-01（目标模式：G1–G4 全部收口）

用户要求「立目标 → 全部完成」。四项结果与判据如下。

### G1 API 错误码本地化 ✅ `e525e7b`
增量式：每个错误响应在 `error` 旁加 `code`，**`error` 英文原文一字未改**（CLI/MCP 契约不动）。30 路由 / 93 处；前端 11 文件 / 27 处经 `lib/useApiError.ts`；未知 code 回落英文。`errors` 词条 69 条。
**顺带发现**：`MediaPickerModal` 的 URL 占位符与 `Attach` 按钮**从未被翻译**；看似覆盖它的 `pasteUrl` 是**死键**。已修。
**端到端**：picker URL 输入框（唯一不生成任何东西就能触发 API 错误的入口）实测 zh「URL 无效」/ en「Invalid URL」。

### G2 强调色 token 化 ✅ `f92a17d`
**先修我自己的漏洞**：A/B 两轮扫描都只 glob 了 `lib/*.ts`，**漏掉 `lib/*.tsx`** —— `lib/nodeTypes.tsx` 整个节点配色目录（30 处 / 17 色）从未被处理。我之前报的 84/228 是**基于漏扫的口径**，真实值当时是 95/258。已更正。

9 个 accent + 8 个 node-bg token（值不变）。**前置改造**：17 处用 `${accent}28` 这类拼接做半透明，`var(--x)28` 是无效 CSS，故先迁移到 `color-mix(in srgb, X N%, transparent)`（N 由原字节精确换算）。
**像素 A/B：canvas 0.0000%，最大通道差 0** —— 迁移与替换合计**一个像素都没变**；settings 0.0000%。
hex：95/258 → **75/186**。

### G3 路由静态化 ⚠️ 评估后判定不可安全做
根因 `app/layout.tsx:47` 读 `cookies()`。实测启用 Cache Components **构建失败 15 错**（3 个 `force-dynamic` + 11 个 `runtime=nodejs` 不兼容），且开启后 GET 处理器语义改变（会被预渲染）。另两条路：`/[locale]/` 改全部 URL；客户端决定 locale 则有 FOUC 回归。**结论与建议已写入 task_plan.md。**

### G4 gallery 拆分 ✅ 部分完成 `1759c5b`
7215 → **6941** 行。抽出 `lib/gallery/types.ts`（8 个类型）与 `components/gallery/GalleryChrome.tsx`（PendingGenTile / EmptyFan / GalleryLoggedOut / VideoFan / LoopingVideo + 常量）。
**未动**：`GalleryInner`(4194 行)、`GalleryPage` —— 拆它们要把大量状态穿进新 props，截图能抓布局回归但**抓不到状态接线错误**。诚实顺序是先写测试。

**像素 A/B（stash 对照）**：
| 页面 | 同构建噪声 | 改前 vs 改后 | 判定 |
|---|---|---|---|
| gallery-images | 0.84% | 0.84% | 同一噪声带 ✓ |
| gallery-videos | **6.33%** | 4.52% | 改后**小于**噪声 → 非本次改动 ✓ |
| workflow | 0.79% | 0.79% | 同一噪声带 ✓ |
| assets | 3.42% | 10.87% | 已知 reconcile 数据态问题（早前已用原构建证明） |

`gallery-videos` 那次 4.5% 一度像是回归，同构建连拍两次才看清它的噪声底就有 6.33%。

### 每项的验证清单（全部满足）
tsc ✅ · build ✅ · 21/21 回归测试 + clipboard ✅ · 版本守卫 ✅ · eslint **154**（基线，无新增）✅ · 像素 A/B 或端到端断言 ✅ · 部署并线上验证 ✅

### 部署（三次）
| 目标 | 回滚点 |
|---|---|
| G1 | `rollback-20261002-060615` |
| G2 | `rollback-20261002-061305` |
| G4 | `rollback-20261002-062212` |

均经 `scripts/deploy-nas.sh`（走 Tailscale），容器 healthy、API 200、170 资产、EACCES 0、桥接 Up 7 days。

## 2026-10-01（G1 完成 ✅ —— API 错误码本地化）

### 做法：增量式，`error` 一字未改
每个错误响应在 `error` 旁新增 `code`：
```json
{ "error": "File exceeds 100 MB limit", "code": "file_too_large_100mb" }
```
`error` 保持英文原文——**那是 CLI/MCP 的契约**（`cli/lib/client.mjs` 直接读它给 agent）。新增字段纯增量，那些客户端无需改动。

- **API 侧**：30 个路由文件 / **93 处**错误响应加了 code（68 处字面量手工映射，25 处变量拼接或裸 500）
- **前端**：`lib/useApiError.ts`
  ```ts
  if (code && t.has(code)) return t(code);
  return payload?.error ?? fallback;
  ```
  **未知 code 回落英文原文**，所以服务端加 code 永远不会弄坏旧客户端
- **11 个文件 / 27 处**展示点改用它；`useApiError` 按 `t` memo 化（next-intl 的 `t` 按 locale 稳定），可安全进依赖数组
- 词条新增 `errors` 命名空间 **69 条**，总词条 353 / 键集一致

### 顺带发现的两个漏译（已修）
- `MediaPickerModal` 的 URL 占位符与 `Attach` 按钮**从来没被翻译过**
- 看起来覆盖占位符的 `pasteUrl` 词条是**死键**——没有任何地方引用它。已删死键、改用真正被引用的 key

### 端到端验证
picker 的 URL 输入框是用户**不生成任何东西就能触发 API 错误**的唯一入口，正好做探针：
| 语言 | 结果 |
|---|---|
| zh-CN | 显示 `URL 无效`，全文**无** `Invalid URL` ✓ |
| en | 显示 `Invalid URL`，全文**无** `URL 无效` ✓ |

### 线上验证
`kie-key` / `collections` / `fetch-url` 均返回 code；353 词条 / 键集一致 / errors 69 条。

### 部署
`scripts/deploy-nas.sh`（走 Tailscale）→ 回滚点 `rollback-20261002-060615`；容器 healthy、API 200、170 资产、EACCES 0、桥接 Up 7 days、load 1.63。

### 验证清单
tsc ✅ · build ✅ · 21/21 回归测试 + clipboard ✅ · 版本守卫 ✅ · eslint **154**（基线，无新增）✅

## 2026-10-01（用户授权后自行拍板：B 类执行 / API 错误码与 R5 暂缓）

用户授权「按最合适的方案来，你来拍版」。三项决定如下。

### 1) B 类 —— **执行**（`f3cd984`）
**测量改变了方案**。把 14 个灰按明度 L\* 排序后，它们构成一条从 82 到 0 的**近似连续色阶**，相邻步长 **5.8–25 ΔE**；只有两对近到不可分辨：

| 组合 | ΔE | 处置 |
|---|---|---|
| `#141C28` ↔ `#111622` | 3.0 | 合并 |
| `#1A1A1A` ↔ `#1A1C1F` | 2.6 | 合并 |

**我否掉了自己此前的建议**（"收敛成文字 4 级 / 背景 4 级"）——在 5.8+ ΔE 的间距下，那些是**肉眼可见的不同颜色**，合并就是**披着重构外衣的重新设计**。

改为：**命名而非压缩**。新增 12 个 `--neutral-N` token，**值与原字面量完全一致**，只做那 2 处合并；替换 **141 处**。hex 由 100 色 / 365 次降至 **84 色 / 228 次**。
（12 级灰并不异常——Tailwind 自己的灰阶有 11 级。）

**验证**：像素 A/B（对照 stash 前构建）——canvas **0.0000%**（最大通道差 2，即那 2 处合并确实不可见）、settings **0.0000%**、dashboard 0.68%（等于 0.67–0.70% 的缩略图噪声带）。

### 2) API 错误码 —— **暂缓，单独立项**
- 改的是 **agent 消费的契约**（`cli/lib/client.mjs` 直接读 `error` 作为失败消息）
- 涉及 **29 个路由文件 / 74 处 error**，前端 **32 处**各写各的 `data.error ?? fallback`（**无统一入口**）
- 需 64+ 条 code 与 128 条词条
- 当前英文错误**功能可用**；仓促做会破坏 CLI/MCP 的错误上报
- 建议方案已写入 `task_plan.md`：**增量式**（`error` 保持英文不变 + 新增 `code` 供前端本地化）

### 3) R5 架构 —— **暂缓**
无测试兜底的大重构（根布局读 `cookies()` 导致全动态；`gallery/page.tsx` 7212 行），回归风险 > 收益。建议单独立项并先补测试。

### 部署（`scripts/deploy-nas.sh` 首次实战，暴露 3 个脚本 bug 并修复）
| bug | 现象 | 修复 |
|---|---|---|
| `$NAS_SSH。` | 中文句号紧跟变量名，bash 把 `NAS_SSH。` 当变量 → `unbound variable` | 改为 `${NAS_SSH}`（同类共 3 处） |
| 注释里的反引号 | 远端 shell 把 `up -d` 当命令执行 → `up: command not found` | 反引号改双引号 |
| **未同步源码** | 只传镜像不传源码 → NAS 源码陈旧、源码备份抓的是过期树 | 补上源码同步步骤 |

**部署结果**：回滚点 `rollback-20261002-051727`；容器 healthy、`/api/workflows` 200、170 资产、EACCES 0、桥接 Up 7 days、load 1.20。
**线上验证**：`--neutral-1/6/10/11/12`、`--primary`、`--background`、`--danger-soft` **全部解析正确**，无 JS 错误。

## 2026-10-01（`connectedNodes` 未验证项 —— **已关闭 ✅**）

### 为什么之前一直复现不了
三个原因叠加，**全部是测试方法问题**，不是代码问题：

1. **测试污染了被测状态**。`PromptNode` 的 textarea 是**非受控**的，且 `handleChange` 会把内容写回 store（`updateNodeData(id, { prompt })`）。我前几次输入的 `@` **被持久化**，下次打开时初始值变成 `hello @@@@@@@`。于是 `getMentionQuery`（正则 `/@(\S*)$/`）匹配到的是 `@@@@@@@` 而非空串，`filteredMentions` 过滤后为空 → `menuOpen=false`。
   - 这解释了当时「zh 命中一次、立刻复测就失败」的诡异现象：**只有第一次是干净的**。
2. **未选中的节点上，`click()` 不会聚焦 textarea**（我最初误判为"空态遮罩拦截"，**已更正**）。
   - 实测：`elementFromPoint` 在 textarea 中心命中的就是 `TEXTAREA` 本身；占位层带 `pointer-events-none`，**并不拦截点击**。
   - 真正原因是 `PromptNode` 里**有意为之**的 `mousedown` 处理器（第 390–400 行）：
     ```js
     if (selectedRef.current) e.stopPropagation();   // 已选中：允许放置光标 / 选文本
     else e.preventDefault();                        // 未选中：交给 ReactFlow 拖拽，同时阻止文本选择手势
     ```
     未选中时 `preventDefault()` 会**阻止浏览器默认的 mousedown 聚焦**。点节点本体可正常聚焦（选中流程会聚焦），所以**功能无损，不是 bug**。
   - 测试上用 `focus()` 显式聚焦即可绕过。
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
