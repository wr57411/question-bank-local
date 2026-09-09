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

