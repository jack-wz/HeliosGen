# Findings: node-banana → HeliosGen 移植调研

## 两边架构对比（2026-09-11 调研）

### HeliosGen（移植目标）
- 节点组件：components/nodes/ 下 11 个（Prompt/ImageInput/VideoInput/GenerateNode/ImageGen/VideoGen/VideoGenerator/Assistant/Note/Comment/Group）
- 注册：lib/nodeTypes.tsx（注意在 lib 下，不在 components）
- 执行：lib/executor.ts —— topoSort + buildPipelineWaves（generateNode/videoGeneratorNode 分波并行）；resolveInputs 硬编码 handle 语义：image / startFrame / endFrame / resource / videoRef / referenceVideo / audioRef
- resolveInputs 的图片来源回退链：capturedFrameUrl → r2Url → inputImage → imageUrl（**移植要点：处理节点输出写 data.imageUrl 即可被下游自动读取**）
- 模型注册：lib/modelConfig.ts（11 图 + 17 视频，apiInput 字段映射 kie 载荷）
- 持久化：SQLite guest.db（workflows/gallery/settings）+ /generated 媒体目录

### node-banana（移植源）
- 节点约 30 种：src/components/nodes/（含 fork 自研 VideoStitch 转场/调色、VideoTrim removeSilence）
- provider 框架：src/lib/providers/types.ts（ProviderInterface/ProviderModel/ModelParameter/ModelInput）+ cache.ts + /api/models、/api/providers/[provider]/models 路由
- 服务端路由：src/app/api/ 下 generate/llm/transcribe/comfy/providers/models 等 19 个
- i18n 已有中英 821 条对照（后续移植可参考）
- LICENSE: MIT（Copyright William Falloon），fork 自研部分为用户自有

### 第一批移植对象源文件（node-banana）
- ImageResizeNode.tsx —— 图片缩放
- RemoveBackgroundNode.tsx —— 去背景（@imgly/background-removal + onnxruntime-web，纯浏览器）
- SplitGridNode.tsx + components/splitgrid/ —— 宫格拆分
- ImageCompareNode.tsx —— 图片对比（react-compare-slider）

## 风险与注意
- onnxruntime-web 的去背景模型首次使用需从 CDN 下载（NAS  HTTPS 环境 OK，需确认模型 CDN 可达性）
- HeliosGen 无 i18n 体系，移植节点 UI 文案先英文与上游保持一致
- node-banana 节点耦合其 store 字段与执行引擎，逐个适配而非拷贝
