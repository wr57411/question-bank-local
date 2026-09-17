# 快速导入栏「手写笔记照片」

> 实施日期：2026-09-14 / 2026-09-15
> 实施计划：`docs/plans/2026-09-14-quick-import-handwritten-note.md`
> 排版样稿：`designs/quick-import-handnote-preview.html`（+ 同名 `.png`）
> 关联：`docs/plans/2026-09-14-legacy-js-retirement.md`（影子数据层与退场方案）

## 一、功能目标

在「快速导入栏」新增「📸 手写笔记照片」，**作为本次导入新建这道题的另一个图片版本**落库——直接复用既有的 `question_notes` 多版本体系与题目详情页的「📝 题目图片」下拉展示，不新增数据结构。

入口按用户确认的**方案 B**：第三行原「📝 笔记」按钮改名「📎 附加」，展开区里放两块——上面是原有的「✏️ 文字笔记」，下面新增「📸 手写笔记照片」。

## 二、变更清单（文件级）

| 文件 | 改动 |
|---|---|
| `src/index.html` | 第三行按钮改名「📎 附加」（id/其余属性不动）；`#qi-note-area` 内新增 `#qi-hw-block`（`#qi-hw-count`、`#qi-hw-list`、`📷 拍一张`、`🖼️ 相册`） |
| `src/ui/camera.ts` | 新增通用 `captureImage(source)`：原生走 `Capacitor.Plugins.Camera.getPhoto`，Web 走 `input[type=file]`；取消静默返回 `null` |
| `src/ui/quick-import.ts` | 手写待存列表（`HAND_NOTE_MAX=5`、`addQuickHandNote`/`removeQuickHandNote`/`resetQuickHandNotes`/`readPendingHandNotes`/`handNoteLabel`/`renderQuickHandNotes`）、`onQuickNoteInput` 圆点判定收敛为 `updateNoteDot`、`compress` 改带默认值、退出快速导入前确认、`confirmQuickImport` 逐张挂载 |
| `src/main.ts` | Batch 9 段用 `assignToWindow` 挂载 `takeQuickHandNote` / `pickQuickHandNoteFromGallery` / `removeQuickHandNote` |
| `src/data/notes.ts` + `src/types/question.ts` | 笔记图片字段名 `image_url` → `note_image_url`（对齐线上实现与服务端列名） |
| `src/ui/note-version.ts` | 新增 `sortNoteVersions`（+ `versionRank`）并在 `loadNoteVersionsForDetail` 使用：修复同毫秒写入导致的展示顺序不确定 |
| `unit-tests/note-field-alignment.spec.ts` | 新增 3 例：TS 写端落库字段名与键集合 |
| `unit-tests/quick-import-hand-note.spec.ts` | 新增 11 例：待存列表行为 9 例 + 确认挂载调用序列 1 例 + 失败路径不清空 1 例 |
| `unit-tests/note-version-order.spec.ts` | 新增 7 例：排序规则 6 例 + **展示层接线 1 例**（数据层故意给不利顺序时仍以题图为首） |
| `tests/quick-import-visibility.spec.js` | 追加：手写块三档视口可见性（390/360/320）+ 挂载链路真链路用例（注入假原生层） |

**服务端零改动**。

## 三、关键设计决策

| 决策 | 结论 | 理由 |
|---|---|---|
| 归属 | 挂到**本次快速导入正在创建**的这道题 | 快速导入栏本身就是"建新题"的场域；"给已有题目补图片版本"已有现成路径（题目详情 →「+ 添加版本」→ 拍照） |
| 数据载体 | 复用 `question_notes`，**不新增字段、不改服务端表** | 该体系已纳入同步链路，复用即零同步改动 |
| 版本命名 | `手写笔记` / `手写笔记 2`… | 与题图版本的 `笔记 vN` 在下拉里可区分 |
| 压缩参数 | **1600px / 0.85**（题图是 1200/0.8） | 手写是细笔画、常需放大辨认；`compress()` 改为带默认值，既有题图/答图调用行为不变 |
| 张数上限 | **5 张** | 每张约 350–700KB，全量推送载荷；超限给 toast 提示 |
| 未确认就退出 | **弹确认**「有 N 张手写笔记照片还没保存，要放弃吗？」 | 内存暂存 + 退出即弃 = 白拍，撞"零容忍静默丢失" |
| 拍照成功但导入失败 | **不清空**待存照片 | 同上 |
| 详情页删除版本 | **本次不做** | 见第七节「已知非阻塞项」。**后续更新（2026-09-16）：已实现**，见 `docs/note-image-compress-and-delete.md` |

## 四、必须记录的一件事：数据层有「双实现」，旧 JS 静默获胜

> 这一节写给下一个改这个仓库的人（很可能还是 AI）——本次开发中我因为漏看它，误判了三处"缺陷"。

- `src/index.html` 先加载**经典脚本** `/db.js`、`/ai.js`，再加载 `<script type="module" src="/main.ts">`（`dist/index.html:980-981` 相同）
- `src/main.ts` 有两个挂载函数：`assignToWindow()` = `w[key] = value`（**强制覆盖 → TS 赢**，已接管 271 个名字）；`assignIfMissing()` = 仅当 `typeof w[key] === 'undefined'` 才挂（**旧 JS 赢**，99 行起 62 个名字）
- `<script type="module">` 默认 defer、后执行 → **`db.js` 里定义过的名字，TS 实现运行时从不生效**

**结论**：`src/data/sync.ts` 是影子层；`src/data/notes.ts` 几乎全影子（唯一活路径是 `src/init-app.ts:16-18` 的一次性 backfill，直接 import）。要改同步/笔记行为，改的是 `public/db.js`，而它还有 `www/`、`dist/`、`android/app/src/main/assets/public/` 三份拷贝。

**判定方法（别靠读代码猜）**：

```bash
NODE_OPTIONS= npx playwright test --config=tmp/probe.config.js --reporter=list --output=tmp/test-results-probe -g "线上实际生效"
# 打印 window.dbAddQuestionNote 的源码片段 + 实际落库对象的键
```

## 五、本次修掉的两个真实缺陷

### 5.1 笔记图片字段名不一致（TS 写端）

- 现象：TS 写端写 `image_url`，而读端 `src/ui/note-version.ts` 读 `note.note_image_url`，旧版归一化 `_normalizeQuestionNoteRecord` 也不做映射
- 影响面：**只影响 `init-app.ts` 的一次性 backfill 路径**（线上 UI 路径走 `w.dbAddQuestionNote`，是旧实现、字段本来正确）——这也解释了为什么用户从未见过空白题图
- 修法：`src/types/question.ts` + `src/data/notes.ts` 统一为 `note_image_url`（对齐旧实现、服务端列名、已有数据）
- 验证：`unit-tests/note-field-alignment.spec.ts` 3 例 + 复现性演练

### 5.2 同毫秒写入导致「打开题目默认显示的可能不是题图」

- 机制：快速导入现在一次写多条笔记（题图 + 手写照片），**同一毫秒**内写入 → 旧 `dbGetQuestionNotes` 按 `created_at` 升序排序在毫秒相同时退化为 localforage 按随机 UUID 的迭代顺序 → 详情页下拉默认选中第一项 → 可能把手写笔记当作默认显示
- 约束：排序源头在旧 `public/db.js` 四份拷贝里，**不能改**
- 修法：展示层（我们自己的 TS）新增纯函数 `sortNoteVersions`：`created_at` 升序 → 撞车时 `笔记 v1` 恒为 0 排最前、`手写笔记`/`手写笔记 N` 按序号 → 其它 label 归后 → 最后用 `id` 兜底保证确定性
- 验证：`unit-tests/note-version-order.spec.ts` 7 例（含展示层接线 1 例，构造"数据层把 手写笔记 排在前"的不利顺序）

## 六、用户可见的预期行为

- 快速导入栏第三行：`组合 ▾ | 双 | 📎 附加 | ✅ 确认`；展开「📎 附加」后可输入文字笔记 + 拍/选最多 5 张手写照片，缩略图可逐张删除
- 点「✅ 确认」后：这道题有 2 个图片版本——`笔记 v1`（题图，带文字笔记）与 `手写笔记`（及 `手写笔记 2`…）
- 题目详情「📝 题目图片」下拉：**题图版本恒在首位、默认显示题图**；切到手写笔记版本即显示该照片，下方文字框显示**该版本自己的** `text_note`（通常为空）
- 手写照片随题目一起同步；复习链路不读笔记，故不影响复习界面

## 七、已知非阻塞项（诚实记录，未处理）

| 项 | 说明 | 处置建议 |
|---|---|---|
| E2E 对"默认显示题图"是**弱守门人** | 实测 5 次运行中仅 2 次两条笔记 `created_at` 撞毫秒；不撞车时即使没有修复 E2E 也会通过（因为题图总是先创建）。已在用例里加"两张图必须不同"的前提断言与"渲染的是题图本身"的完整 URL 比较，但这仍不能确定性地守住 `versionRank` 兜底 | 确定性守门人是 `unit-tests/note-version-order.spec.ts` 的 7 例；E2E 仅作集成证据 |
| `assertVisiblyRendered` 对**渐变背景按钮是假阴性** | `tests/helpers/visibility.js` 只读 `background-color`；`.upload-btn.camera` 的橙色渐变写在 `background-image` → 算出对比度 1.11。本次对「📷 拍一张」用 `{ skipContrast: true }` 绕过 | 可给助手增加 `background-image` 采样（本次**未改助手**，避免影响其它用例） |
| `手写笔记2`（无空格）落入 rank 1000 | 生成器始终输出带空格的 `手写笔记 2`；仅当用户手填该 label 时才会与预期不同 | 非缺陷，可忽略 |
| 旧 `public/app.js:2177` 等四份拷贝有同源排序问题 | 属旧 JS 独立工程 | 并入 `docs/plans/2026-09-14-legacy-js-retirement.md` 的 B 批 |
| 详情页**不能删除**图片版本 | 删除在当前同步协议下表达不出来：服务端 `question_notes` 无 `deleted_at` 列、`upsertQuestionNote` 是 `hasDeletedAt: false`，而客户端 pull 的 `_isRemoteNewer` 在本地缺失时返回 `true` → 本地删了会被下一次同步写回。题目有墓碑机制（`purged_at`），笔记没有 | **并入旧 JS 退场项目的 E 批**（那批本就要动同步协议） |
| 多 worktree **端口劫持** | `playwright.config.js` 的 `reuseExistingServer: !process.env.CI`，而本机多个 worktree 并行时谁先起 vite 谁占 3000。实测撞到过别的 worktree 的服务器，E2E 会**静默测错代码** | 用本 worktree 的独立端口配置（如 `tmp/e2e3100.config.js`），或跑 E2E 时 `CI=1`（端口被占直接报错） |

## 八、不涉及边界

- 不改 `public/db.js` 及其 `www/`、`dist/`、`android` 三份拷贝
- 不改服务端表结构、列名、路由
- 不做手写照片的裁剪/旋转/滤镜
- 不做笔记删除入口（`dbDeleteQuestionNote` 仍无调用点）
- 不重构 `note-version.ts` 里既有的两份拍照实现
- 不改复习链路
- 不做"给已有题目补手写照片"的入口

## 九、验证记录（2026-09-15）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test` | **355 passed / 9 skipped / 0 failed**（`real-api.spec.js` 因无 API key 干净跳过） |
| `npm run build` | 通过（仅既有 `INEFFECTIVE_DYNAMIC_IMPORT` 提示） |
| 全量 E2E（主配置，端口 3000） | **99 passed / 0 failed** |
| 全量 E2E（自有端口 3100） | 94 passed / 5 failed —— 其中 4 条 `tablet-grid-layout` 是该 spec **硬编码 `BASE_URL="http://127.0.0.1:3000"`**（`tests/tablet-grid-layout.spec.js:19`）导致的换端口副作用；1 条 `ui-health` 是**本次 UI 改动暴露的真回归**（见下） |
| `ui-health` 回归修复 | 新增的「🖼️ 相册」按钮（默认隐藏于快速导入栏）在 DOM 顺序上早于添加题目表单的同名按钮，使 `button:has-text("相册").first()` 匹配到隐藏元素 → 断言失败。**修法：把断言限定到 `#question-form` 作用域**，而不是放松断言或改产品文案（`tests/ui-health.spec.js:31`） |
| 复现性演练 ① | 笔记字段名改回 `image_url` → `note-field-alignment` 必失败 |
| 复现性演练 ② | 相册按钮去掉 `color` → 可见性用例 FAIL（对比度 1.11，复刻 2026-08-29 白字白底事故）→ 还原后 PASS |
| 复现性演练 ③ | 撤销 `sortNoteVersions` → `note-version-order` **5 failed**，报错 `expected [ '手写笔记', '笔记 v1' ] to deeply equal [ '笔记 v1', '手写笔记' ]` → 还原后 7 passed（md5 指纹确认零残留） |
| 截图 | `tmp/screenshots-handnote/`（AI 已实际 Read 确认 320px 下第三行与手写块渲染正常） |

## 十、后续待办

1. **Task 5 之外的独立评审**：本次 Task 1–5 与排序修复均已通过独立评审；旧 JS 退场的批次尚未开始
   - **后续更新（2026-09-16）**：笔记版本删除（含服务端 `deleted_at` 列 + 客户端墓碑）已交付，见 `docs/note-image-compress-and-delete.md`；其余 A–E 批仍未开始
2. `docs/plans/2026-09-14-legacy-js-retirement.md` 的 A–E 批（含笔记删除墓碑机制、旧拷贝排序同源问题）
3. `tests/helpers/visibility.js` 增加渐变背景采样（消除假阴性，让「拍一张」这类按钮也能用完整对比度检查）
