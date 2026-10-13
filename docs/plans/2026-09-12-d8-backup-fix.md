# 备份链路修复计划（D8 + FF-1，插队优先）

日期：2026-09-12
状态：**待王先生审阅**（此前的一轮执行**已全部回退**，见第九节）
关联：`docs/plans/2026-09-11-chapters-topics-tag-categories.md` §2.2 的 D8 / D8b
来源：
- D8：2026-09-12 体检时发现（王先生导出的「备份」文件只有 206 字节，是空 manifest）
- **FF-1：同日对王先生真实导出文件跑体检时发现——每个 store 恰好只有 1 条记录**（当时最严重的问题）

---

## 一、完整诊断

### 1.1 四个备份入口，三个产出空壳

| 入口 | 界面 | 实际路径 | 输出文件 |
|---|---|---|---|
| `doSmartBackup`（`ui/backup.ts:17`） | 「☁️ 备份」按钮 | `smartBackup()` → 空壳增量 | `DOCUMENTS/question-bank-backup.json` |
| `saveBackupToDevice`（`ui/backup.ts:135`） | 「💾 保存备份到设备」（`index.html:796`） | `smartBackup()` → 空壳增量 | 同一文件名，**互相覆盖** |
| `doAutoBackup`（`ui/backup.ts:110`） | 无按钮；由**保存题目评语后**触发（`ui/tag-suggest.ts:152`） | `smartBackup()` → 空壳增量 | 同一文件名，**互相覆盖** |
| `doFullBackup`（`ui/backup.ts:52`） | **界面上没有按钮** | `exportFullBackup()` → **真数据** | web 下载 `question-bank-full-<日期>.json` |

另有一条**唯一可靠**的全量数据通道：「📤 导出」→ `exportAllData()`（遗留 `public/db.js:1807`，**有 native 分支**），
输出 `DOCUMENTS/question-bank-backup-<日期>.json`（带日期）。

### 1.2 三层根因

| # | 根因 | 位置 | 后果 |
|---|---|---|---|
| D8-a | `recordChange` 是 changelog 唯一写入点，**全仓无调用者** | `src/data/backup.ts:30` | `dbChangelog` 永远为空 → `exportIncrementalBackup` 永远返回 `changes: []` |
| D8-b | `createFullSnapshot()` 把 13 个 store 填进局部 `data` 后**直接丢弃**，只返回 manifest | `src/data/backup.ts:57` | `base_snapshot_id` 指向**从未存在过的基线**；即使补上埋点，增量在恢复语义上仍不成立 |
| D8-c | 三个空壳入口写**同一个文件名**；唯一真数据入口没有 UI | `ui/backup.ts` ×3、`index.html` | 备份互相覆盖、用户点不到真备份 |

### 1.3 复合后果

- `smartBackup()` 仅在 `shouldForceFullSnapshot()`（无快照 或 距上次 ≥7 天）时才走真数据路径 → **只有每 7 天那一次是真的**
- `restoreFromBackup` 遇到空增量 → `applyIncrementalBackup([])` → `applied = 0`，却弹「**恢复成功: 0 题, 0 标签**」→ **静默的空恢复**
- `updateBackupStatusUI` 的「待同步变更: N 条」永远是 0 → 造成"没有改动待备份"的错觉

### 1.4 体积约束（决定方案形状）

题图以 **base64 data URL 内联在题目记录里**：服务端实测 91 道有效题目中 89 道为
`data:image/jpeg;base64,…`，平均 **103 KB/张**、最大 226 KB（仅题图，未含答案图）。
→ **一次全量约 30–60 MB**。这否决了"每次全量"的无条件可行性，也决定了必须做频率控制。

---

### 1.5 FF-1：所有本地备份/导出通道都在静默截断（本次最严重）

**证据**：王先生提供的真实导出文件 `tmp/question-bank-backup-2026-09-12.json`（309,627 字节）中，
**每一个 store 恰好只有 1 条记录**：

| store | 条数 | | store | 条数 |
|---|---|---|---|---|
| questions | **1** | | topics | **1** |
| tags | **1** | | topic_questions | **1** |
| question_tags | **1** | | question_notes | **1** |
| papers | **1** | | teaching_versions | **1** |
| paper_questions | **1** | | node_questions | **1** |
| pending_link_list | **1** | | similar_question_links | 0 |
| teaching_nodes | **1** | | pending_photos | 0 |

其中唯一那 1 道题在服务端确实存在（`01cf130b-…`，创建于 2026-09-01T08:15:51），
即这是**真实数据的残缺导出**，不是测试种子。

**根因**：`localforage.iterate` 的语义是——**回调一旦返回非 `undefined` 就立即终止迭代**。
源码依据 `node_modules/localforage/dist/localforage.js` 的 iterate 实现：

```js
var result = iterator(value, cursor.key, iterationNumber++);
// when the iterator callback returns any (non-`undefined`) value,
// then we stop the iteration immediately
if (result !== void 0) { resolve(result); } else { cursor["continue"](); }
```

而代码写成**表达式体**：

```js
await dbQuestions.iterate((v) => data.questions.push(v));   // ❌
```

`Array.prototype.push()` 返回数组**新长度**（数字，永远非 `undefined`）→ 第一条之后立即停止。

**受影响位置（共 4 处，全部需要修）**：

| # | 文件 | 行 | 函数 | 后果 |
|---|---|---|---|---|
| FF-1-a | `public/db.js` | 1809–1821 | `exportAllData`（「📤 导出」） | **备份每表只 1 条** |
| FF-1-b | `src/ui/backup.ts` | 183–188 | `buildBackupData`（百度网盘备份 `doAutoBaiduBackup`） | **备份每表只 1 条** |
| FF-1-c | `public/db.js` | 1091–1095 | `collectDataFingerprint`（遗留实现） | 计数恒为 1 |
| FF-1-d | `public/db.js` | 2239 | wiki log（功能已移除） | 同上；可顺带修 |

`src/` 侧其余 `iterate` 调用均已核实为**块体**，无此问题（`src/data/sync.ts`、`src/data/tags.ts`、
`src/data/questions.ts`、`src/data/backup.ts`、`src/data/notes.ts`、`src/data/review.ts` 等）。

### 1.6 合并结论：当时没有任何一条可用的备份通道

| 通道 | 入口 | 缺陷 | 产物 |
|---|---|---|---|
| ☁️ 备份 | `doSmartBackup` | D8 | 空 manifest |
| 💾 保存备份到设备 | `saveBackupToDevice` | D8 | 空 manifest |
| 自动备份 | `doAutoBackup`（保存评语后触发） | D8 | 空 manifest |
| **📤 导出** | `exportAllData`（遗留 db.js） | **FF-1-a** | **每表 1 条** |
| **百度网盘备份** | `buildBackupData` | **FF-1-b** | **每表 1 条** |
| 云同步 | `/api/sync/push` | 见 Phase 0（D1/D3 等） | 正常但有缺陷 |
| Supabase 复制 | `replicateToSupabase`（服务端侧） | 未发现截断 | 正常 |

**四条本地通道全部不可用，且全部静默无报错。**
> 更正：此前一度判断"「📤 导出」是唯一可靠通道"，**该结论错误**，它同样残缺。

### 1.7 为什么现有测试没抓住 FF-1

`unit-tests/helpers/load-db.js` 给 localforage 打的 mock 是：

```js
iterate: async (cb) => { for (const [k, v] of store) await cb(v, k); },
```

**它忽略回调返回值，因此不复刻"提前终止"语义** → 用这个 mock 测出来的代码永远是"全量通过"。
→ 新防回归测试必须自带忠实语义的 mock（见第五节）。
> 附带问题：该 helper 读的是 `www/db.js`（历史遗留副本，与 `public/db.js` 已不一致、
> 且不在打包链路里——`capacitor.config.ts` 的 `webDir` 是 `dist`）→ **单测在验证死代码**。见第八节待定项。

---

## 二、修复方案（已选：方案一 · 废除增量，每次全量）

**原则**：备份的第一目的是"能恢复"，不是"省流量"。可独立恢复 > 省流量。

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/data/backup.ts` | `smartBackup()` 改为始终 `return await exportFullBackup()` |
| 2 | `src/data/backup.ts` | `recordChange` / `exportIncrementalBackup` / `getChangelogSince` / `clearChangelog` 保留但**标注未启用**（注释写明 D8-a/D8-b 原因），避免后来者误以为在运行 |
| 3 | `src/ui/backup.ts` | `doSmartBackup` / `saveBackupToDevice` / `doAutoBackup` 三者统一走全量；文案统一为「全量备份」 |
| 4 | `src/ui/backup.ts` | `doFullBackup` 与 `doSmartBackup` 语义重复 → **合并为一个实现**，消除冗余入口 |
| 5 | `src/ui/backup.ts` | `doFullBackup` **补 native 分支**（当前只有 blob 下载，手机上不可用），使其能在手机上写 Documents |
| 6 | `src/ui/backup.ts` | `updateBackupStatusUI` **删掉「待同步变更: N 条」**（永远为 0，是误导），改为显示上次备份时间 + 数据规模（题数/标签数） |
| 7 | `src/data/backup.ts` | `importBackupData`：增量分支遇空变更集**明确报错**，不再返回"恢复成功 0 条" |
| 8 | `src/ui/backup.ts` | `restoreFromBackup` 前置校验：文件里没有 `questions`/`tags` → 明确报「这不是数据备份文件」（与体检脚本同一套防呆，避免再把 manifest 当数据） |
| 9 | 文件名 | 统一带日期（`question-bank-full-YYYY-MM-DD.json`），消除三个入口互相覆盖 |
| 10 | `src/ui/backup.ts` | `doAutoBackup` **加节流**（见第七节待确认参数）——方案一引入的必要对策 |

### FF-1 修复项（与 D8 同一批改动一起做）

| # | 文件 | 改动 |
|---|---|---|
| 11 | `src/ui/backup.ts`（`buildBackupData`） | 6 处 iterate 回调改**块体**：`(v) => arr.push(v)` → `(v) => { arr.push(v); }`，并加注释说明 localforage 语义 |
| 12 | `public/db.js`（`exportAllData`） | 13 处同上（`1809–1821`） |
| 13 | `public/db.js`（`collectDataFingerprint`） | 5 处同上（`1091–1095`），`() => questions++` → `() => { questions++; }` |
| 14 | `public/db.js`（wiki log，`2239`） | 1 处同上（功能已移除，顺带修） |

> 修法统一为"加花括号并去掉返回值"，不改变任何业务语义。
> **长期方向**（登记为待办，不属本轮）：把「📤 导出」从遗留 `public/db.js` 迁到 TS 实现，
> 彻底摆脱"同一个功能存在两份实现、其中一份是死代码"的局面。

### 本轮一并执行（2026-09-12 王先生指定）

| # | 项目 | 说明 |
|---|---|---|
| **O-1** | **把「📤 导出」从遗留 `public/db.js` 迁到 TS 实现** | 目前 `index.html:87` 的 `onclick="exportAllData()"` 指向遗留 `public/db.js:1807`。在 TS 侧实现同名能力（走 `exportFullBackup` 全量数据 + 既有 native/Web 双路径），并把按钮改指向它。完成后 legacy 的 `exportAllData` 不再被调用（本轮先保留函数体不删，避免动遗留文件的结构） |

> 该项目的价值：消除"同一功能存在两份实现、其中一份是死代码"的局面——
> 这正是 FF-1 能长期潜伏的土壤（与 D7 遗留文件问题同源）。

---

## 三、方案一引入的新风险与对策

| 风险 | 触发 | 对策 |
|---|---|---|
| **自动备份写 50MB 写入放大** | `doAutoBackup` 现由「保存题目评语」后触发；改成全量后，每改一句评语就写一次 30–60 MB | **必须加节流**（#10）；否则会把手机写入量放大到不可接受 |
| 内存峰值 | `JSON.stringify` 50MB + `btoa` 再复制一份 → WebView 内存吃紧 | 备份时给出进度提示；失败时明确报错而非静默（配合 #7） |
| iCloud 同步压力 | Documents 目录自动同步 | 靠节流 + 手动为主控制频率 |

---

## 四、不涉及边界

1. **不动题图存储形态**（base64 内联保持不变）——"题图外置"列入后续待办，见第六节
2. 不动 `exportAllData` 的遗留实现（除非采纳 O-1）
3. 不动 `question_tags` / 同步链路（那是 Phase 0 的范围）
4. 不删除任何已有函数（只标注未启用），避免动 barrel 导出面
5. 不改备份目录（仍为 `DOCUMENTS`）与文件名前缀

---

## 五、验证

1. `npm run typecheck`
2. `npm run test` + **新增单测 `unit-tests/backup-export-completeness.spec.ts`**（3 个用例）：
   - `buildBackupData` 对含 3 条记录的 store 必须导出 **3 条**（防回归 FF-1）
   - `smartBackup()` 返回值必须含 `_meta.is_full === true` 且 `questions` 非空（防回归 D8）
   - **mock 自检**：断言 mock 自身的 iterate 复刻了"提前终止"语义（否则前两条测试形同虚设）
   > 关键点：mock **必须**复刻 localforage 语义，否则这条 bug 会再次逃过测试（见 §1.7）。
   > 已有实现见留档 `tmp/backup-export-completeness.spec.ts.hold`（用 `vi.hoisted` 规避 `vi.mock` 提升问题）。
3. **复现性演练（AGENTS.md 强制）**：把 `buildBackupData` 的 iterate 改回表达式体 →
   确认测试报 `expected 1 to be 3` → 再改回。已实测过一轮，确认测试有效。
4. `npm run build`
5. 手动验证：手机上点「☁️ 备份」→ 文件应为 MB 级（不再是 206 字节）；
   点「📤 导出」→ 文件应含**全部**题目（不再是 1 条）；
   两个文件都能通过 `tmp/tag-link-audit.py` 的防呆校验
6. **端到端恢复演练**：用新备份文件在测试环境走一次 `restoreFromBackup`，
   确认恢复后的题数/标签数/关联数与备份文件一致（不能只看"成功"字样）
7. UI 改动（备份弹窗文案）→ 截图 + `assertVisiblyRendered`

---

## 六、后续待办（本轮不做，已登记）

| # | 待办 | 价值 | 说明 |
|---|---|---|---|
| **B-1** | **题图从 base64 内联改为文件存储** | 备份体积从 30–60 MB 降到几百 KB；同步载荷、渲染内存一并受益 | 独立大工程：存储格式 + 89 张存量图迁移 + 同步 + PDF 导出 + 缩略图渲染适配。**一旦完成，本文档方案一的体积约束随之消失** |
| B-2 | 备份文件加密（可选） | 备份含题图与配置，落 Documents 且走 iCloud | 待评估 |
| **B-4** | **备份文件名改回带日期（多份历史）** | 避免"用好备份覆盖坏备份"；带日期后可保留多份快照 | **依赖 B-1**：题图外置后单文件降到几百 KB 才划算。王先生 2026-09-12 指定 |
| **B-5** | **百度网盘通道的上传载荷只含 6 个 store** | 该通道从网盘恢复时 topics / question_notes / teaching_* 等会**静默缺失**（`importBackupData` 把缺的键当空数组） | 由代码复核 I6 发现。建议上传改走 `smartBackup()` 全量；需评估与历史备份文件的兼容性。**本轮只加了恢复前防呆，未改上传逻辑** |
| **B-6** | 备份模块的遗留清理 | `BackupManifest.format` 全量也写 `'incremental_v1'`（靠顶层 format 避开误判，属潜在陷阱）；`getBackupPath()` 的 `backupPath` 自定义分支全仓无写入者（死分支 + 读写不对称）；`doSmartBackup`/`doFullBackup` 在 UI 上已无按钮（`index.html` 里「☁️ 备份」只开弹窗，真正写入的是「💾 保存备份到设备」），需确认这两个 window API 的定位 | 均为代码复核 Minor 项，不影响正确性 |
| **B-7** | 删除 `www/` 后的 3 处悬空引用 | 指向已不存在的路径，虽当前无害但会误导后来者 | ① `eslint.config.js:25` 的 ignores 里仍有 `'www/'`（删后为 no-op）；② `tests/ai-simulation.spec.js:6` 指向 `www/index.html`（**已被 `playwright.config.js:68` 的 testIgnore 排除**，不进 CI）；③ `.ai-test-harness.json` 的 `aiFunctions:["www/ai.js"]` / `extractFrom:"www/index.html"`（外部 harness 配置）。建议统一改指 `dist/`（`dist/index.html`、`dist/ai.js`、`dist/db.js` 均存在） |

---

## 七、参数决议

### 7.1 `doAutoBackup` 节流策略 —— **已定（2026-09-12，王先生选 A）**

| 选项 | 说明 | 决议 |
|---|---|---|
| **A** | 距上次自动备份 **≥ 24 小时** 且**数据指纹有变化**才写；否则跳过并静默 | ✅ **采纳** |
| B | 距上次自动备份 ≥ 6 小时即写（不看指纹） | ✗ |
| C | 废掉自动备份，只保留手动按钮 | ✗ |

**实现要点**：指纹 = `各 store 记录条数 + 所有题目里最大的 updated_at/deleted_at`（本地小函数实现，
不依赖 `collectDataFingerprint`，避免"条数不变但内容改了"漏判）。
判定顺序必须是**先查时间、再算指纹**——时间未到就直接返回，避免白读一遍 50MB。
新增 localStorage 键：`lastAutoBackupTime`、`lastAutoBackupFingerprint`。

### 7.2 `www/db.js` 的处理 —— **已定：方案 A（2026-09-12，王先生采纳建议）**

| 选项 | 说明 | 决议 |
|---|---|---|
| **A** | **删除 `www/` 目录**，并把 `unit-tests/helpers/load-db.js` 改读 `public/db.js` —— 让单测验证活代码 | ✅ **采纳** |
| B | 保留 `www/db.js` 并同步修 FF-1，helper 不动 | ✗ |
| C | 本轮不动，登记待办 | ✗ |

**理由**：FF-1 之所以能潜伏至今，部分原因就是单测在测一份没人运行的副本。
**风险与处置**：`www/db.js` 与 `public/db.js` 已不一致，helper 切换后可能暴露出其它历史差异
→ 实施时若出现测试失败，**逐个核实是真缺陷还是测试本身依赖了死代码的旧行为**，不掩盖、不跳过。

---

## 八、执行方式与流程约定

### 8.1 流程约定（2026-09-12 王先生要求，已写入 `AGENTS.md`）

> **未经王先生明确说出「开始执行计划」，不得修改任何代码。**
> 允许的动作只有：出计划、写文档、只读排查、跑只读诊断。
> 计划经他审阅并明确批准后，才开始编码。

本节记录一次实际违规：本轮曾在计划尚未获批时先行改动 3 个文件，
经他纠正后**已全部回退**（见 8.2）。

### 8.2 已回退的执行留档

| 留档 | 路径 | 内容 |
|---|---|---|
| 补丁 | `tmp/pending-20260912-d8-ff1.patch` | 412 行 / 3 文件（D8 的 #1–#8、#10 + FF-1 的 #11–#12） |
| 防回归测试 | `tmp/backup-export-completeness.spec.ts.hold` | 3 个用例，含 mock 自检；须放回 `unit-tests/` 才生效 |

**已回退的文件**：`public/db.js`、`src/data/backup.ts`、`src/ui/backup.ts`（均已校验与 HEAD 一致）。
**注意**：该补丁记录的 #9 偏离（文件名保留固定名）理由见下——

| 计划项 | 计划写法 | 最终做法 | 原因 |
|---|---|---|---|
| #9 文件名 | 统一改成带日期 | **本轮保留固定名** `question-bank-backup.json`（设备备份/恢复路径不变），仅 Web 下载用 `question-bank-full-<日期>.json` | `loadBackupFromDevice` 按固定名读取；改带日期需新增"文件选择"UI。且改为全量后，互相覆盖不再造成数据不完整 |

> **王先生 2026-09-12 裁决**：**目前先保留固定名**；**等"题图分离"（B-1）做完后，仍要改回带日期的备份**
> —— 因为题图外置后单个备份文件会降到几百 KB，届时"带日期 + 多份历史"既便宜又安全。
> → 已登记为 **B-4**（见第六节），依赖 B-1 完成。

### 8.3 执行顺序（获批后）

按改动 #1–#14 一次完成 → 跑第五节验证（含复现性演练与端到端恢复演练）→ 汇报 →
**不自动 commit**，等王先生检查后统一提交。

---

## 九、执行结果（2026-09-12 完成）

### 9.1 任务拆分与执行方式

用 `subagent-driven-development` 执行，拆为 4 个任务（每任务：独立实现者 + 规格复核 + 质量复核）：

| Task | 内容 | 结果 |
|---|---|---|
| 1 | 备份链路主体（`src/data/backup.ts`、`src/ui/backup.ts`、`public/db.js`） | ✅ 经一轮规格复核 + 一轮质量复核 + 一轮修复 |
| 2 | 防回归测试 + 测试基建去死代码 | ✅ 复现演练红/绿双证 |
| 3 | O-1：`exportAllData` 迁 TS 并接管（`ui/backup.ts:181`、`main.ts:433`） | ✅ |
| 4 | 截图可见性评估 + 端到端恢复演练 | ✅ |

质量复核提出的 7 项：**接受 6 项**（native 无 Filesystem 的假成功 → 改 throw；自动备份失败不受节流且零信号 → 加 `lastAutoBackupAttemptTime` + 24h 限频告警；`assertBackupHasData` 误伤 tags-only 备份 → 放宽；`createFullSnapshot` 的无用全量读；store 清单三处硬编码 → 抽出单一来源 `collectStoreStats()`；过时文案；百度网盘恢复入口接防呆）。
**驳回 1 项**：复核称"动了 `AGENTS.md` 与 `docs/plans/` 违反约束"——那些是用户/控制方的改动，照办会删掉用户要的东西。

### 9.2 验证结果（全部实测）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm run test` | **343 通过 / 2 失败 / 1 跳过**；两个失败均在 `real-api.spec.js`（真实网络烟雾测试，沙箱网络间歇性，非本次引入） |
| **复现性演练** | 把 `buildBackupData` 改回表达式体 → 测试报 `expected 1 to be 3`（红）；改回块体 → 3 passed（绿） |
| `npm run build` | 通过（vite 275ms，JS 282.34 kB / gzip 86.11 kB） |
| **全量 E2E** | **90 passed (6.7m)**（后台任务状态显示 failed 是沙箱拦截 Chrome code-sign-clone 的 `file-write-unlink`，非测试失败） |
| **截图可见性评估** | 备份弹窗状态行截图已 Read 确认：文案完整可见、无遮挡/截断；`assertVisiblyRendered` 通过；**对比度 3.47**（阈值 ≥3） |
| **端到端恢复演练** | **3 passed**。正向：造 3 题/2 标签/4 关联/1 试卷/3 试卷题 → 导出后断言**确切条数** 3/2/4/1/3 → 清空 → 恢复 → 断言恢复后仍为 3/2/4/1/3 → `refreshAll()` 后列表渲染 3 张卡片。负向：空壳增量 manifest 与非数据文件**均被明确拒绝**（`importBackupData` reject + `#error-modal` 可见 + DB 保持为空 + 不出现「恢复成功」） |

新增测试文件：
`unit-tests/backup-export-completeness.spec.ts`、`tests/backup-roundtrip.spec.js`、`tests/backup-status-visibility.spec.js`

### 9.3 执行中发现并登记的新事项

| # | 事项 | 处置 |
|---|---|---|
| B-7 补充 | `dbClearAllData` **未挂到 window**，且只清 5 个 store（D7），因此恢复演练改用直接清 IndexedDB | 已记入 B-6/D7 |
| B-8 | **`www/` 里 3 个无副本文件**（`gemma4-plugin.ts`、两个 `pdf-text-normalize-prototype*.html`）已归档到 **`docs/attic/www-removed-20260912/`**（git 跟踪）并配 20K 字的 `README.md`，写明来源、git 历史（`gemma4-plugin.ts` 首次加入 `1ed0940` 2026-04-20、最后改动 `27ad465` 2026-07-10；两个原型首次即最后 `fa49568` 2026-08-29）、引用情况、为何不能草率删、如何复活、决策建议 | 王先生要求"先归档 + 写清历史背景"，已完成 |

> ⚠️ 王先生的判断被证实是对的：`gemma4-plugin.ts` **"按接口被使用、按文件名未被引用"**——运行时所有调用方都通过 `window.Capacitor.Plugins.Gemma4` 使用该插件（原生实现 `android/.../Gemma4Plugin.java` 仍在），所以它属于「暂时没找到引用」而非死代码。

---

## 十、P0 新缺陷：导出/备份**闪退**（2026-09-14 王先生实测报告）

> 状态：**根因已定位并量化，修复方案待王先生批准**（按 AGENTS.md 硬规则，未获批不动代码）

### 10.1 现象

真机上点「📤 导出」**闪退**；备份设置里点「💾 保存备份到设备」**也闪退**。

### 10.2 根因（已实测量化）

**导出链路的 `btoa(unescape(encodeURIComponent(jsonStr)))` 会同时持有 4 份数据副本，峰值需要 ~244MB JS 堆，手机 WebView 直接 OOM 被杀。**

王先生设备上的真实数据规模（服务端实测）：题图+答案图 **16.4 MB** + 笔记图片 **33.6 MB** ≈ **50 MB base64**。
按此规模实测（`tmp/measure-export-memory.mjs`）：

| 步骤 | rss | heapUsed |
|---|---|---|
| 基线 | 39 MB | 3 MB |
| 数据对象图 | 54 MB | 11 MB |
| + `JSON.stringify`（53.9M 字符） | 233 MB | 66 MB |
| + `encodeURIComponent`（55.5M 字符） | 345 MB | 121 MB |
| + `unescape` | 420 MB | 175 MB |
| **+ `btoa`（71.9M 字符，还要过 Capacitor 桥）** | **489 MB** | **244 MB** |

OOM 是**进程级被杀**，`try/catch` 抓不住，所以表现为闪退而非报错。

### 10.3 为什么以前不闪退（两个 bug 意外地"保护"了它）

| 路径 | 修复前 | 修复后 |
|---|---|---|
| 「📤 导出」 | **FF-1 截断** → 每表只 1 条，实测导出文件仅 **309,627 字节** → 内存无压力 | 全量 → 50MB → **崩溃** |
| 「💾 保存备份到设备」 | **D8** → 多数时候走空 manifest（**206 字节**）→ 内存无压力 | 恒走全量 → 50MB → **崩溃** |

即：**这条"全量备份"路径从未在真实数据规模下成功运行过**——FF-1 的截断与 D8 的空壳各自掩盖了它。
我的修复移除了两个掩盖，缺陷便暴露出来。

**我的失误**：计划 §三 风险表里我确实写了"内存峰值：`JSON.stringify` 50MB + `btoa` 再复制一份 → WebView 内存吃紧"，
但对策只写了"给出进度提示；失败时明确报错而非静默"——**这两条对 OOM 都无效**，因为进程被杀时任何 JS 代码都不会执行。
正确做法应是先测峰值内存，或直接采用下面的 utf8 写法。

### 10.4 修复方案（待批准）

**方案 A（推荐，最小改动）**：写入时使用 `encoding: 'utf8'` 直写字符串。

`@capacitor/filesystem` v6.0.4 的 `WriteFileOptions` / `ReadFileOptions` 均支持 `encoding?: Encoding`，
注释原文：*"If not provided, data is written as base64 encoded. Pass Encoding.UTF8 to write data as string."*

- 去掉 `btoa(unescape(encodeURIComponent(jsonStr)))` 整条链 → 峰值由 **244MB 降到 ~66MB**（只剩对象图 + jsonStr）
- 需同步改动 4 处：`src/ui/backup.ts` 的三处写入（`writeFullBackup` / `doAutoBackup` / `exportAllData`）
  + `loadBackupFromDevice` 的读取（当前用 `atob(result.data)`，须改为 `readFile({ encoding: 'utf8' })` 后直接 `JSON.parse`）
- **注意兼容**：改动后新备份文件仍是 UTF-8 JSON，与旧文件格式兼容；但**旧代码写的文件**用新读法也能读（同为 UTF-8 文本）

**方案 B（进一步压峰值）**：逐 store 序列化 + `appendFile` 分批写。峰值可降到单 store 规模，
但需自己处理 JSON 拼接与文件完整性校验，复杂度明显上升。**建议先 A，不够再 B。**

**方案 C（根治）**：先做 **B-1 题图外置** → JSON 从 50MB 降到 ~1MB → 所有内存问题自然消失，
连 A 都可以不做。属独立大工程，已登记。

**推荐**：**先 A 救急（本轮）**，同时把 C 的优先级提到备份可用性之后。

### 10.5 尚未验证的次级风险（必须真机验证，不能假设）

`encoding: 'utf8'` 后仍需把 **50MB 字符串**经 Capacitor 的 JS→Native 桥传给原生写入。
桥能否承受、耗时多久、会不会 ANR —— **我在本机无法验证**（模拟器/Web 与真机行为不同）。
→ 方案 A 实施后**必须在真机上实测**该按钮，才算修好。

### 10.6 紧迫性

当前状态：**王先生没有任何一条可用的备份通道**（四条本地通道此前全部残缺，修好后又因 OOM 崩溃）。
在 A 或 C 落地前，唯一的留档手段是**云同步链路**（`/api/sync/push`，走 `fetch` 不用 btoa，峰值仅 2 份副本）与服务端库本身。
