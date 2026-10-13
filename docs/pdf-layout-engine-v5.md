# PDF 排版引擎 v5 集成（generatePDF TS 重写）

## 背景
- 原状：生产 `generatePDF` 在 `public/db.js` L1571（JS 版，先于 main.ts 加载定义 window.generatePDF）；`src/data/pdf.ts` 原为 75 行简化 TS 版，被 main.ts `assignIfMissing` 策略屏蔽，从未生效（死代码），且签名与 UI 调用契约（spacingCm/noSave/merged）不匹配
- 现存 bug 顺带修复：`generatePaperPDF` 以 `mode:'merged'` 调用，但旧版无 merged 分支 → 试卷导出 PDF 只有标题正文空白；新版 merged 走引擎路径
- 排版引擎来源：www/pdf-text-normalize-prototype.html v4（已浏览器实证的自动分组排版：单栏组前/双栏组后/组间翻页/长图 MIN_SPLIT=25mm 切割/碎片回队）重构为纯函数

## 模块架构
| 模块 | 职责 |
|---|---|
| src/types/pdf.ts | LayoutImage/LayoutCell/LayoutPage/PlanLayoutOptions/PDFGenerateOptions 等类型；PlanLayoutResult.truncated 标记 iter 上限截断 |
| src/data/pdf-layout-engine.ts | planLayout 纯函数（无 DOM）：normScale 中位数归一化 clamp[0.35,1]、分组队列、组间翻页、长图切割、无条件回队（内容零丢失）、crop 区域记录（布局期不生成 dataURL） |
| src/data/pdf-image.ts | estimateTHFromPixels 纯函数（灰度投影+3点平滑+行高 runs 中位数）+ loadImage/loadImageDims/estimateTH/cropImage（Canvas 能力层） |
| src/data/pdf-font.ts | NotoSansSC base64 加载（模块级双缓存，17MB 字体仅首次加载） |
| src/data/pdf.ts | generatePDF 重写：single/merged/separate 走引擎（buildEngineUnits+renderEnginePages 共用）；double 复刻 db.js（UI 已无入口）；原生 Filesystem DOCUMENTS 保存 + Web doc.save；noSave 返回 doc；中文字体注册；题号/答案标签；页码；切割线；留空虚线 |
| src/main.ts | generatePDF: data.generatePDF 加入 assignToWindow 批次（覆盖 db.js 旧版；删除该行即回退） |

## 行为变更与兼容
- single/merged：从"顺序整图放置"变为引擎排版（自动分组、长图切割、页码）——收益：双栏扫描件不再压扁混排、超长题不再丢失/变形
- double：逻辑复刻 db.js（窄图不再放大至槽宽等三处微调；UI 已无入口的死路径，保留向后兼容）
- separate（题目/答案分开）同样走引擎：题目段、答案段分别按 layout_type 自动混排（答案段首页“参考答案”表头 + topReserveMM 25，页码全文连续）；题后留空在 separate 下也画虚线（与挨着模式统一）
- 契约不变：spacing/spacingCm/title/noSave/原生保存路径均与旧版一致（export-pdf-ui.ts 无需改动）
- 栏式判定（已接线）：`lm = lmMap[q.id] || (q.layout_type === 1 ? 'double' : 'single')`；layout_type 为录题表单强制标注（0=仅适合单栏，1=单双栏均可即双栏版式），实测全库无非 0/1 值；lmMap 保留为调用方最高优先级扩展点；OCR 自动判定（原型路线图 v4.2）为可选增强

## 验证
- 单测：pdf-layout-engine 17 条（分组/翻页/切割/归一化/碎片保序/尾段保留/无 crop 丢失）、pdf-image 2 条、pdf-generate 6 条（mock jsPDF + _internals 注入）
- 全量：npm run test 163 passed / 9 skipped；typecheck 0 错误
- CI 四步：typecheck 0 错误；vitest 163 passed / 9 skipped（real-api 无 key 跳过，与基线一致）；build 通过；playwright ui-health 21 passed
- 浏览器冒烟（vite dev localhost:3000）：window.generatePDF 为 TS 新版（调用 generateWithEngine）；端到端生成 3 页 PDF（2 单栏短图 + 1 张 2600px 超长图触发切割），1335ms，含真实字体加载/图片解码/文字高度检测/planLayout 全链路；页面 UI 正常无致命报错

## 已知限制与后续优化
- 性能：引擎路径每图 2 次加载（loadImageDims + estimateTH 各一次解码）且串行；优化方向=单次 loadImage 同时返回 dims+tH，或 8-16 并发分块（注意 200+ 题并发 canvas 内存峰值）
- 导出弹窗布局方式已改为二选：「题目跟答案挨着」（single，引擎按标注自动混排）与「题目/答案分开」（separate）；mode:'double' 分支保留但 UI 不可达；OCR 检测模式见 ocr-server/（localhost:8766）与原型 v4.2 路线
- pdf-font 失败后永久缓存 null（与旧版一致，离线防重复拉取 17MB）
- 回退方式：删除 src/main.ts 中 generatePDF: data.generatePDF 一行
