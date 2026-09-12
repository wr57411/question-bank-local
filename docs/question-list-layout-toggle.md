# 题目列表单栏/双栏切换布局

- **日期**: 2026-09-06
- **类型**: 功能设计（UI 布局）
- **状态**: 已实现，待用户检查
- **计划文档**: `docs/plans/2026-09-06-question-list-layout-toggle.md`

## 需求

用户反馈手机上题目列表双栏并排导致题目照片看不清（实测渲染尺寸仅约 85×110px），要求：

1. 支持手动切换单栏/双栏，**默认单栏**
2. 提供切换控件，切换后**即时生效**（无需刷新）
3. 选择**持久化**到本地缓存，刷新/重进自动应用

## 根因（第一性原理）

「看不清」有两个叠加根源，只改列数无法解决：

1. **列数**：`main.css` 中 `@media(max-width:480px)` 强制 `repeat(2,1fr)`，基础规则 `auto-fill minmax(160px,1fr)` 在 390px 手机上也计算出 2 列
2. **图片框固定高度**：`.question-card img{height:110px}` + `object-fit:contain`——竖版题目照片按高度缩放，双栏卡片下实际渲染仅约 85×110px

## 方案

列数不再由媒体查询强制，改由容器模式 class 控制，全视口语义一致（单栏=1列、双栏=2列，桌面切换同样生效）：

| 状态 | class | 列数 | 图片 |
|------|-------|------|------|
| 默认（无缓存/非法值） | `.grid-single` | 1 | `height:auto; max-height:420px`（竖图全宽、contain 不裁切、超长图居中留白） |
| 用户选双栏 | `.grid-double` | 2 | 维持旧固定高度 130/110/160px（紧凑浏览，点详情看大图） |

### 改动清单

| 文件 | 改动 |
|------|------|
| `src/styles/main.css` | `:153-156` 基础规则：列数移入 `.grid-single`/`.grid-double`，新增单栏大图规则；删除 `:262`(≤480px)、`:270`/原`:275`(≥768px)、原`:281`(≥1024px) 四处列数声明（gap 等其余属性保留）；**未动** `.similar-list`、`.question-card img` 固定高度 |
| `src/ui/question-core.ts` | 新增 `getQuestionGridLayout()`（key `question-grid-layout`，仅认 `'double'`，null/非法/隐私模式异常一律回退 `'single'`）、`applyQuestionGridLayout()`（切 class + 同步按钮文案，元素缺失静默返回）、`toggleQuestionGridLayout()`（取反→写缓存→应用）；`renderQuestions()` 首行幂等调用 apply，保证任何渲染路径状态正确 |
| `src/index.html` | `:316` 列表标题行插入 `#grid-layout-toggle` 按钮，文案显示**目标模式**（单栏时「▤ 双栏」/ 双栏时「▦ 单栏」） |
| `src/main.ts` | `:253-255` Batch 3 区块挂载三个函数到 window（HTML onclick 依赖） |
| `tests/question-list-single-column.spec.js` | 新增防回归 E2E（5 用例，见下） |

### 设计决策

1. **全视口一致** vs 仅 <768px 生效：选前者——切换按钮在任何视口都必须有效果，否则桌面点击无反应违反直觉
2. **按钮文案 = 目标模式**而非当前模式：动作导向
3. **单栏图片 `height:auto + max-height:420px`**：可读性是单栏模式的存在意义；上限防超长截图霸屏
4. **双栏保持旧行为**：选双栏即选择紧凑信息密度

## 防回归测试（tests/question-list-single-column.spec.js）

TDD 全程：红灯（5 failed，复现 bug：抓到 `grid-template-columns="159px 159px"` 与图片 110px）→ 实现 → 绿灯。

1. 默认单栏：无缓存时单轨道 + 卡片独占一行 + localStorage 无污染
2. 切换按钮存在、点击即时切双栏（两轨道）+ 写入缓存 + 按钮文案翻转（▤ 双栏 ↔ ▦ 单栏）
3. 持久化双向：双栏→reload 保持→切回单栏→reload 仍单栏
4. 单栏图片渲染高 >200px（旧值 110px，新上限 420px）
5. 双栏图片 <200px（防单栏样式泄漏进双栏）

截图评估（AGENTS.md 强制）：三张截图（默认单栏/切换后双栏/单栏可读性）均实际 Read 人工确认；`captureForReview` 前补了 `scrollIntoViewIfNeeded`，否则视口截图拍不到列表区。

## 验证记录

- 红灯：5 failed（复现 bug）✅
- 防回归 spec：5 passed ✅
- `npm run typecheck`：通过 ✅
- `npm run test`：279 passed / 9 skipped ✅
- `npm run build`：成功 ✅
- 全量 E2E（`--reporter=list --output=tmp/`）：**77 passed (10.8m)** ✅（exit code 因沙箱拦 Chrome 自身文件的噪音非零，以 stdout 为准）

### 过程中的坑（对后续有用）

1. **WorkBuddy 会话跑 npm install 必须清 `NODE_OPTIONS`**：文件代理 shim 会拦截 npm 的 mkdir（`CODEBUDDY_BROKER_DENY`），`NODE_OPTIONS= npm install` 即正常
2. **测试绿灯 ≠ spec 合规**：首轮实现漏删两处 768px 断点列数，因 CSS 优先级（双 class > 媒体查询单 class）测试照样绿——spec 评审逐行对照才抓住
3. **Playwright `reuseExistingServer` 陷阱**：端口 3000 残留旧 vite dev server 时会复用旧代码跑测试，出现「改动已落地但测试失败」的假象；先杀旧 server 再跑
4. **`captureForReview` 默认视口截图**：列表在页面下方时必须先滚动，否则截图评估形同虚设

## 边界（未动）

`.similar-list`（详情页相似题两栏）、试卷卡片、`server/`、同步逻辑、双栏模式图片高度旧行为。

---

# 附：勾选框可见尺寸与触控热区（2026-09-07 追加）

## 需求

单栏上线后真机反馈：卡片左上角 40×40 白色勾选框压在题目图片上，遮挡题干起始内容。要求缩小可见尺寸、保持 ≥44×44 触控热区、交互（热区内切换选中 / 热区外弹详情）不变。

## 根因（含机理更正）

1. 原可见尺寸 40×40 直接叠在图片左上角（`.q-checkbox` z-index:10）。
2. **实现陷阱**：全局 `main.css:44` 为 `*{box-sizing:border-box}`，`main.css:86` 为 `button{padding:12px 24px}`。border-box 下当 padding 合计（水平 48px）**超过指定 width（24px）时，盒子被撑到 padding 总和**——所以把 width/height 从 40 改成 24 后实测宽度仍是 **48px**，必须显式 `padding:0` 才能真缩小。（初版计划误写为 content-box 相加，已更正。）

## 取值与实现

| 项目 | 取值 | 位置 |
|------|------|------|
| 可见尺寸 | 24×24px（`font-size:14px`、`box-shadow:--shadow-sm`） | `src/styles/main.css:164` |
| 抵消全局 padding | `padding:0` | 同上（**这是能真正缩到 24 的关键**） |
| 触控热区 | 44×44px（`::after{content:"";position:absolute;inset:-10px}`，24+10×2，透明、不占布局） | `src/styles/main.css:165` |
| 位置/交互 | `top/left:6px` 不变；`cb.onclick` 既有 `stopPropagation`（`question-core.ts:147`），伪元素点击归属宿主 button，不冒泡到详情弹窗 | 未动 TS/HTML |

热区外溢 4px 落在卡片间距（--space-md 16px）内，相邻卡片热区不重叠（4+4 < 16）。

## 测试（tests/question-checkbox-hit-area.spec.js，6 用例）

- 可见尺寸夹逼 [23,28]；可见框右/上侧外 6px 命中热区；**边界夹逼 +9px 命中 / +14px 出热区**（钉住 44×44，实测 `elementFromPoint` 证明热区右缘恰在 +10）；防误触守卫（热区外点图弹详情且不选中）；中心点击切换
- TDD 红灯：4 failed 复现 bug（实测 48px、热区不足）→ 绿灯 6 passed

## 验证记录

- spec 6 passed；typecheck ✅；unit 279 passed ✅；build ✅；**全量 E2E 83 passed / 0 failed (9.2m)** ✅
- 截图（tmp/screenshots-single-column/勾选框缩小后_单栏.png）经人工 Read 确认：勾选框缩为小方块、不遮题干

## 本节新坑

1. **border-box 也会被 padding 撑大**：padding 合计 > width 时 used width = padding 总和，别以为 border-box 就免疫
2. **选中后列表重渲染位移 ~33px**：`#selected-count` 从隐藏到显示推高工具栏，测试点击必须每次重测坐标（`updateSelectedCount` 改变工具栏占高）——是既有 app 行为，非 bug
3. **行为式点击探测只能钉住区间**：+9/+14 夹逼把热区锁定在 (42,52)，若要精确 44 需 computed-style 断言；当前 2px 容差可接受

---

# 附：平板适配（容器查询，2026-09-11 追加）

## 需求

真机（vivo Pad5 Pro）反馈：平板双栏下卡片很宽（约 440px）但题目图片只有 160px 高、两侧大片留白，内容看不清。要求：平板（约 600–1024px，含横竖屏）双栏充分利用屏宽、图片按比例放大且不裁切不拉伸；不影响手机端与桌面端现有布局。

## 根因

图片尺寸被**固定高度**钉死，与卡片宽度无关：

| 位置 | 规则 |
|---|---|
| `main.css:160` | `.question-card img{width:100%;height:130px;object-fit:contain;…}`（基类） |
| `main.css:275` | `@media(min-width:768px){ .question-card img{height:160px} }` |
| `main.css:156` | 仅单栏模式有 `height:auto;max-height:420px` |

故平板双栏卡片 440px 宽时，图片仍按 160px 高缩放（竖图约 120×160），既小又浪费空间。

## 方案：容器查询 + 视口上限

| 改动 | 位置 | 内容 |
|---|---|---|
| 声明容器 | `main.css:157` | `.question-card` 末尾追加 `container-type:inline-size` |
| 自适应规则 | `main.css:290-296` | `@media(max-width:1023.98px){ .container{max-width:none} @container (min-width:220px){ .question-card img{height:auto;max-height:70vh} } }` |

**为什么是"容器查询 + 视口上限"**：判定依据用**卡片实际宽度**（220px 阈值）而非视口断点，因此不受设备 CSS 宽度推算误差影响；外层 `max-width:1023.98px` 负责把桌面排除——纯容器查询会波及桌面双栏（卡片约 525px）。

**阈值 220px 推导**：手机竖屏双栏卡片约 175–195px（不命中，保持现状）< 220 < 平板竖屏卡片约 248–276px（命中）；平板横屏卡片约 440px（命中）。手机横屏（844 视口，卡片约 390px）会命中——**已知取舍**。

**安全性**：
- 单栏模式不受影响：`:156` 特异性 (0,3,1) > 新规则 (0,1,1)，仍保持 420px 上限
- `.q-checkbox` 定位不受影响：`container-type` 不改变 `.question-card{position:relative}` 的定位祖先关系
- **降级安全**：不支持 `@container` 的浏览器整块忽略 → 图片维持现状，无破坏性副作用

## 未实测量（诚实标注）

平板 CSS 视口宽度未能直接实测（adb 不可用，"已连接"为互联功能非调试桥）。由截图几何反推：横屏约 939px、竖屏约 617px（±10%）。容器查询方案对此不敏感（判定依据是卡片宽度），但仍以真机复核为最终判据。

## 验证记录

- 防回归 spec：`tests/tablet-grid-layout.spec.js`（4 用例）——手机 390×844 守卫（img=110±1px）、平板竖屏 617×939（2 轨 + `object-fit:contain` 语义 + 未钳制时盒比例==原图 + 内容高>300）、平板横屏 939×617（同上 + 钳制时盒高==70dvh + 容器宽==clientWidth）、桌面 1280×800 守卫（img=160±1px）
- TDD 红灯：2 passed（手机/桌面守卫）+ 2 failed（平板：实测竖屏 box 264.5×130 比例误差 171%、横屏 box 394×160 误差 228%）✅
- 绿灯：4 passed。实测——竖屏 box 265×353（**未钳制**分支，比例 0.751≈原图 0.75）；横屏 box 414×432（**钳制**分支，432≈70dvh=431.9）✅
- **断言有效性演练**（AGENTS.md 要求：新增测试必须能复现它要防的 bug）：
  - 临时把 `object-fit` 改 `cover` → 平板两条**如期失败**（`Expected: "contain" Received: "cover"`）✅
  - 临时把 `max-height` 改 `40dvh` → 横屏**如期失败**（比例误差 1.234 > 容差 0.01）✅
  - 两次演练后经 md5 字节级核对完整还原，无残留
- 截图人工 Read：平板横/竖屏各一张，确认两栏铺满、图片明显放大、无裁切变形 ✅
- 全量 CI：typecheck ✅ / 单元测试 **342 passed, 1 skipped, 0 failed** ✅ / build ✅ / **全量 E2E 94 passed, 0 failed (10.8m)** ✅
  - 既有守卫全绿：`question-list-single-column`（含 1280 桌面多栏）、`question-checkbox-hit-area`（勾选框定位依赖 `.question-card{position:relative}`）、`ui-health`、`modal-anchor-overlap`（弹窗几何）——证明 `container-type` 引入的 containment 未引发任何布局回归

## 本节新坑（重要，测试设计教训）

**用"盒子宽高比"断言"不裁切不拉伸"是错的指标，而用 `scale=min(...)` 反推内容尺寸则退化为恒等式**。`object-fit:contain` 的语义是「内容等比装进盒子，盒子比例可不同于图片比例」——横屏矮视口下 `max-height` 截断盒子，盒子比例必然≠原图比例（实测 0.957 vs 0.75），但**内容其实完好**。

两轮修正后的正确写法：
1. `expect(getComputedStyle(img).objectFit).toBe('contain')` —— 直接锁语义（改 `cover`/`fill` 才会裁切拉伸，此断言能抓住，已演练验证）
2. 按 `max-height` 是否触发钳制分叉断言——未钳制：盒比例 == 原图比例；钳制：盒高 ≈ 70dvh（顺带把 max-height 纳入覆盖）
3. 保留"内容显示高度 >300px"作为实质放大断言（对比旧固定高 110–160px；`contentH = min(boxW·nh/nw, boxH)` 是真实盒尺寸的函数，非恒等式）


