# 笔记图片压缩统一 + 笔记版本删除 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **状态：待用户确认（AGENTS.md 检查清单 Step 4）。确认后才可动手改代码。**
> 关联：`docs/quick-import-handwritten-note.md`（上一轮交付）、`docs/plans/2026-09-14-legacy-js-retirement.md`（本计划提前实施了其中 E 批的"笔记墓碑"部分）

**Goal:** ① 补齐两条**未压缩**的笔记图路径（统一 1600/0.85）；② 快速导入题图/答图压缩参数 1200/0.8 → **1600/0.85**；③ 题目详情页支持**删除图片版本**（墓碑机制，删除会同步到所有设备）。

**Architecture:** ①② 纯客户端：services 层新增 `compressNoteImage`（1600/0.85，失败回退原图），两个未压缩写路径接入，题/答默认参数上调。③ 是跨端协议变更：服务端 `question_notes` 加 `deleted_at` 列（复用既有幂等迁移 `ensureColumn`）→ 客户端活数据层（旧 `public/db.js`）把"删除"从硬删改为写墓碑、查询过滤墓碑、pull 透传墓碑 → 详情页加删除按钮。**部署顺序敏感：服务端必须先于（或同时）新客户端上线。**

**Tech Stack:** TypeScript（src/**）、`public/db.js`（活数据层）、Express 5 + better-sqlite3、vitest（客户端 unit-tests/ 与 server/test/）、Playwright。

---

## 0. 已确认决策（2026-09-16 拷问会话）

| 决策 | 结论 |
|---|---|
| "原图上服务端 + 服务端压缩双份存储 + 按需下载" | **整体放弃**（用户 2026-09-16：维持客户端压缩现状）。之前批过的"按需下载接口"随之作废 |
| 未压缩的笔记图路径 | 有**两条**：详情页「+ 添加版本」落库（`note-version.ts:138`）、表单「额外版本」取图（`note-version.ts:171-198` → `question-core.ts:59`）。本期补压缩 |
| 压缩参数 | 笔记版本图统一 **1600/0.85**（与手写笔记一致，同为"要看笔画的整页笔记"）；**题图/答图从 1200/0.8 提到 1600/0.85**（用户明确"压缩比率太高"） |
| 笔记版本删除 | **本期做**（用户实际遇到"添加后无法删除"）。采用墓碑机制，真删除（全设备消失、服务端图片清空、**不可恢复**） |
| 存量数据 | **不回填**（用户确认：存量没有原图，也找不回）；题/答新参数只对**新导入**生效 |

## 0.1 关键事实（全部已核实，file:line）

| # | 事实 | 证据 |
|---|---|---|
| 1 | 服务端有幂等迁移助手 `ensureColumn(table, column, definition)`，schema.ts 已有 5 个先例 | `server/src/db/schema.ts:15-25, 175-179` |
| 2 | pull 路由 `SELECT * FROM question_notes WHERE user_id = ?`，**不过滤** → 墓碑行会自然下发（设计如此：新客户端靠 `deleted_at` 识别） | `server/src/routes/sync.ts:101` |
| 3 | 旧 `dbDeleteQuestionNote` = `removeItem` **硬删** → 会被下一次 pull 原样复活（`_isRemoteNewer(next, null)` 恒真，`db.js:165-166`） | `public/db.js:923-925` |
| 4 | 旧 `collectDataFingerprint` **不统计笔记**（questions/tags/questionTags/papers/teachingNodes）→ 删除笔记**不会**误报"同步数据丢弃" | `public/db.js:1089-1096` |
| 5 | 旧 `dbApplyRemoteSnapshot` 的笔记分支是**显式字段列表**，**不含 `deleted_at`** → 不改的话，墓碑拉回来会丢标记、"复活"成一条空图版本 | `public/db.js:1449-1463` |
| 6 | 旧 `dbGetQuestionNotes` 按 `created_at` 排序、不过滤 `deleted_at` | `public/db.js:891-898` |
| 7 | 线上 `w.compressImage`（`db.js:41`）签名 `(input, maxWidth=800, quality=0.7)`：只缩不放（`width > maxWidth` 才缩）、重编码 JPEG；与 `src/services/image.ts` 的 TS 版是同一段代码的两份拷贝 | 两处均已读 |
| 8 | 未压缩写路径共两条（见上），其余 5 个 `dbAddQuestionNote` 调用点的图片来源已是压缩/裁剪图 | grep 全部调用点逐一核对 |
| 9 | `unit-tests/helpers/load-db.js` 目前加载的是 **`www/db.js`（陈旧死拷贝，最新停在 8-30，webDir 已是 dist 不再使用）** → 本计划把它参数化，新测试指到 `public/db.js`（真源） | helper 第 3-5 行 |
| 10 | 删光某题的所有版本后，详情页自动补建 `笔记 v1`（用题图）——**既有分支**，删除功能可依赖它自愈 | `note-version.ts:39-43` |

## 0.2 部署顺序（硬前提，违反 = 删除功能失效）

1. 本计划的**服务端改动**合并进主仓（`/Users/john/question-bank-local`）并**重启服务端**（PID 2565 跑的是主仓代码；`ensureColumn` 在启动时自动补列）
2. **然后**安装新 APK
3. 顺序颠倒的后果：新客户端在旧服务端上删除 → 服务端没有 `deleted_at` 列、收到的字段被忽略 → 下一次 pull 把原行发回 → **删除被"复活"**

**版本组合矩阵**（写进交付文档）：

| 服务端 | 新 APK | 旧行为 |
|---|---|---|
| 新 | 新 | ✅ 删除全设备生效 |
| 旧 | 新 | ❌ 删除被复活（禁止此组合） |
| 新 | 旧 | ⚠️ 删除的设备生效；**其它未升级设备**上该版本残留为"空图条目"（旧客户端不识别墓碑、也不过滤），升级后消失 |

---

## Task 1：服务端——`question_notes.deleted_at`

**Step 0（先行，测试基建缺口修复）**：`server/test/setup.ts`（`DB_PATH=':memory:'`）**目前没有被任何测试引用** —— 不修的话，跑服务端测试会直接打开所在目录的 `data.db`（在主仓跑就是**生产库**）。修法（新建 `server/vitest.config.ts`）：

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { setupFiles: ['test/setup.ts'] } });
```

`setupFiles` 在测试文件 import 之前执行 → `DB_PATH` 先于 `connection.ts` 生效 ✓。**验证方式**：跑一次既有 `sync.test.ts`，确认服务端目录下**没有**生成/变化 `data.db` 文件。

**Files:**
- Modify: `server/src/db/schema.ts`（`ensureColumn` 调用区，175-179 行旁追加一行）
- Modify: `server/src/services/sync-upsert.ts:110,122-129`（`NOTE_COLUMNS` + `hasDeletedAt`）
- Test: `server/test/sync.test.ts`（追加用例）

**Step 1: 先写失败测试**（照 `server/test/sync.test.ts` 既有 supertest 模式）

```ts
it('笔记墓碑：push 带 deleted_at 应落库并在 pull 原样返回', async () => {
  const note = { id: 'note-t1', question_id: 'q-x', note_image_url: 'data:image/jpeg;base64,AAA',
                 label: '手写笔记', text_note: '', created_at: '2026-09-16T08:00:00.000Z',
                 updated_at: '2026-09-16T08:00:00.000Z', deleted_at: '2026-09-16T09:00:00.000Z' };
  await request(app).post('/api/sync/push').set(authHeaders(tokenA)).send({ question_notes: [note] });
  const pull = await request(app).get('/api/sync/pull').set(authHeaders(tokenA));
  const row = pull.body.question_notes.find((n: any) => n.id === 'note-t1');
  expect(row.deleted_at).toBe('2026-09-16T09:00:00.000Z');
});

it('旧客户端 push 不带 deleted_at 应存为 null（向后兼容）', async () => {
  const note = { id: 'note-t2', question_id: 'q-x', note_image_url: 'data:image/jpeg;base64,BBB',
                 label: '笔记 v1', text_note: '', created_at: '2026-09-16T08:00:00.000Z',
                 updated_at: '2026-09-16T08:00:00.000Z' };
  await request(app).post('/api/sync/push').set(authHeaders(tokenA)).send({ question_notes: [note] });
  const pull = await request(app).get('/api/sync/pull').set(authHeaders(tokenA));
  const row = pull.body.question_notes.find((n: any) => n.id === 'note-t2');
  expect(row.deleted_at ?? null).toBeNull();
});
```

**Step 2: 跑测试确认失败**

```bash
cd server && npx vitest run test/sync.test.ts
```
Expected: 第 1 条 FAIL（`deleted_at` 未落库/未返回）；第 2 条可能 PASS。

**Step 3: 实现**

- `server/src/db/schema.ts`（175-179 行的 `ensureColumn` 调用区追加）：
  ```ts
  ensureColumn('question_notes', 'deleted_at', 'TEXT');
  ```
- `server/src/services/sync-upsert.ts`：
  ```ts
  const NOTE_COLUMNS = ['id', 'user_id', 'question_id', 'note_image_url', 'label', 'text_note', 'created_at', 'updated_at', 'deleted_at'];
  export function upsertQuestionNote(userId: string, note: Record): boolean {
    return upsertRecord(userId, note, {
      table: 'question_notes', requiredFields: [], columns: NOTE_COLUMNS, hasDeletedAt: true,
    });
  }
  ```
  **副作用审查（已做）**：`hasDeletedAt: true` 使 `upsertRecord` 的 `updatedAtPath` 变为 `updated_at || deleted_at || created_at` —— 笔记行 `updated_at` 恒有值，**行为不变**；`deletedAt = record.deleted_at ? normalize : null` → 旧客户端（无该字段）存 `null` ✓ 向后兼容。

**Step 4: 跑测试**

```bash
cd server && npx vitest run test/sync.test.ts
```
Expected: 全 PASS（含既有用例）。

**设计说明（写进代码评审要点）**：pull **不过滤**墓碑——新客户端靠 `deleted_at` 识别并隐藏；若在服务端过滤，曾同步过该笔记的设备会**永远保留本地副本**（pull 不下发"缺失"信号，客户端无从得知被删）。墓碑随 pull 下发是唯一能让其它设备感知删除的方式。

---

## Task 2：活数据层（旧 `public/db.js`）——墓碑三处 + 影子层对齐

**Files:**
- Modify: `public/db.js`（三处：891-898 查询过滤、923-925 删除改墓碑、1449-1463 apply 透传）
- Modify: `src/data/notes.ts:27`（影子层 `dbDeleteQuestionNote` 对齐为墓碑语义，防后人踩坑）
- Modify: `unit-tests/helpers/load-db.js`（参数化 db 路径，默认仍是 `www/db.js`，新测试传 `public/db.js`）
- Test: `unit-tests/note-tombstone.spec.ts`（新建，加载 `public/db.js`）

**Step 1: 先写失败测试**（用 `loadDbFunctions` 模式，见 `unit-tests/helpers/load-db.js`；新测试传 `{ dbPath: 'public/db.js' }`）

```ts
it('dbDeleteQuestionNote 应写墓碑（deleted_at + 清空图片 + 推进 updated_at），而非 removeItem', async () => {
  await funcs.dbAddQuestionNote('q1', 'data:image/jpeg;base64,AAA', '手写笔记', '');
  const notes = await funcs.dbGetQuestionNotes('q1');
  await funcs.dbDeleteQuestionNote(notes[0].id);
  const raw = await storeGet('question_notes', notes[0].id);   // 直接读存储桶
  expect(raw.deleted_at).toBeTruthy();
  expect(raw.note_image_url).toBeNull();
  expect(raw.updated_at >= raw.deleted_at || raw.updated_at).toBeTruthy();
  expect(await funcs.dbGetQuestionNotes('q1')).toHaveLength(0);   // 查询应过滤墓碑
});

it('applyRemoteSnapshot 应透传 deleted_at（否则墓碑拉回来会复活）', async () => {
  await funcs.dbAddQuestionNote('q2', 'data:image/jpeg;base64,BBB', '手写笔记', '');
  const live = (await funcs.dbGetQuestionNotes('q2'))[0];
  const tombstone = { ...live, note_image_url: null, deleted_at: '2026-09-16T09:00:00.000Z',
                      updated_at: '2026-09-16T09:00:00.000Z' };
  await funcs.dbApplyRemoteSnapshot({ question_notes: [tombstone] });
  const raw = await storeGet('question_notes', live.id);
  expect(raw.deleted_at).toBe('2026-09-16T09:00:00.000Z');
  expect(await funcs.dbGetQuestionNotes('q2')).toHaveLength(0);
});
```

（`storeGet` 用 helper 暴露的内存 store；若 helper 不暴露，则在测试里用 `localforage.createInstance({name:'questionBank', storeName:'question_notes'})` 直读。）

**Step 2: 跑测试确认失败** → `deleted_at` undefined / 查询不过滤。

**Step 3: 实现（public/db.js 三处）**

```js
// db.js:891-898  查询过滤墓碑
await dbQuestionNotes.iterate((v, key) => {
  const note = _normalizeQuestionNoteRecord(v, key);
  if (note && !note.deleted_at && note.question_id === questionId) notes.push(note);
});

// db.js:923-925  删除 = 写墓碑（图片清空，顺带在所有设备释放空间）
async function dbDeleteQuestionNote(noteId) {
  const note = await dbQuestionNotes.getItem(noteId);
  if (!note) return;
  await dbQuestionNotes.setItem(noteId, { ...note, note_image_url: null,
    deleted_at: _nowIso(), updated_at: _nowIso() });
}

// db.js:1449-1463  apply 透传 deleted_at（否则墓碑拉回来丢标记）
const nextNote = {
  id: note.id,
  question_id: note.question_id,
  note_image_url: note.note_image_url,
  label: note.label || '',
  text_note: note.text_note || '',
  created_at: note.created_at || note.updated_at || _nowIso(),
  updated_at: note.updated_at || note.created_at || _nowIso(),
  deleted_at: note.deleted_at || null
};
```

**⚠️ 这三处都在 `public/db.js`（活数据层）**：改完由构建再生 `dist/` 与 `android/app/src/main/assets/public/`；**`www/db.js` 是陈旧死拷贝（webDir 已是 dist），本次不动**，但要在交付文档里标注"www/ 与 public/ 已分叉，www 不参与打包"。

**Step 4: 影子层对齐（`src/data/notes.ts:27`）**

```ts
export async function dbDeleteQuestionNote(noteId: string): Promise<void> {
  const note = await dbQuestionNotes.getItem<QuestionNote>(noteId);
  if (!note) return;
  const now = nowIso();
  await dbQuestionNotes.setItem(noteId, { ...note, note_image_url: null, deleted_at: now, updated_at: now });
}
```

**Step 5: 跑测试**

```bash
npm run test -- unit-tests/note-tombstone.spec.ts && npm run typecheck
```

---

## Task 3：详情页「删除当前版本」按钮

**Files:**
- Modify: `src/index.html`（详情弹窗笔记版本条，约 440-448 行：在版本下拉旁加删除按钮）
- Modify: `src/ui/note-version.ts`（新增 `deleteCurrentNoteVersion`）
- Modify: `src/main.ts`（`assignToWindow` 挂载，供 onclick 调用）
- Test: `unit-tests/note-version-order.spec.ts` 追加接线用例（或独立文件）

**Step 1: 先写失败测试**（jsdom，复用 `note-version-order.spec.ts` 的 DETAIL_HTML 模式，补删除按钮元素）

断言：`deleteCurrentNoteVersion()` → `w.dbDeleteQuestionNote` 被调用且参数是**当前选中的 note id** → 重载后该版本不在下拉里。

**Step 2: 实现**

```ts
export async function deleteCurrentNoteVersion(): Promise<void> {
  const select = document.getElementById('modal-note-version-select') as HTMLSelectElement;
  const noteId = select?.value;
  if (!noteId) return;
  if (!confirm('删除这个图片版本？\n\n将同步到所有设备，且不可恢复。\n（若删光所有版本，会自动用题图重建「笔记 v1」）')) return;
  await w.dbDeleteQuestionNote(noteId);
  w.dbSetLastViewedNote(w.currentQuestionId, '');
  await loadNoteVersionsForDetail(w.currentQuestionId);
}
```

- `index.html` 按钮（**显式 color**，避开白字白底陷阱；用 danger 色）：
  ```html
  <button type="button" onclick="deleteCurrentNoteVersion()" style="padding:6px 10px;font-size:11px;background:var(--danger-light);color:var(--danger-dark);border:1px solid var(--danger);border-radius:var(--radius-sm);cursor:pointer" title="删除当前显示的图片版本（同步到所有设备，不可恢复）">🗑 删除此版本</button>
  ```
- **删光自愈**：`loadNoteVersionsForDetail` 的既有分支（`:39-43`）会在 0 条时用题图重建 `笔记 v1` ✓ 无需额外逻辑
- **lastViewed 悬挂**：指向已删 note 时既有兜底（`:56-58` 找不到就选第一项）✓；删除后显式清空更干净

**Step 3: 跑测试 + typecheck**

---

## Task 4：压缩统一（1600/0.85）

**Files:**
- Modify: `src/services/image.ts`（新增 `compressNoteImage`）
- Modify: `src/ui/note-version.ts:138`（详情页添加版本落库前压缩）
- Modify: `src/ui/question-core.ts:59`（表单额外版本落库前压缩）
- Modify: `src/ui/quick-import.ts:395`（`compress` 默认参数 `(1200, 0.8)` → `(1600, 0.85)`，覆盖 :357/:358 的题/答）
- Test: `unit-tests/note-image-compress.spec.ts`（新建）

**Step 1: 先写失败测试**

`compressNoteImage` 的可测性设计：它内部调 `compressImage`（同模块，走 `new Image()` + canvas）。jsdom 无法解码图片，所以：
- **回退路径**可直接测：stub `global.Image` 为立即 `onerror()` 的假类 → `compressImage` reject → `compressNoteImage` 应回退原图
- **成功路径与接线**用 `vi.mock('../src/services/image', ...)` 在调用点测试中伪造 `compressNoteImage` → 断言两条写路径把**压缩结果**传给 `dbAddQuestionNote`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/image', () => ({
  compressNoteImage: async (img: string) => (img.startsWith('BAD') ? img : 'COMPRESSED::' + img),
}));

const { confirmAddNoteVersion } = await import('../src/ui/note-version');

describe('两条未压缩的笔记图路径接入 compressNoteImage（1600/0.85）', () => {
  it('详情页「+ 添加版本」落库前压缩', async () => { /* stub w.dbAddQuestionNote，断言收到 'COMPRESSED::…' */ });
  it('压缩失败回退原图，绝不丢图', async () => { /* mock 返回原图 → 断言落库原样 */ });
});
```

（`question-core.ts:59` 的表单提交链路较重，接线断言以 `confirmAddNoteVersion` 为代表 + 代码评审核对；表单路径用 grep + code review 验证。）

**Step 2: 实现**

```ts
// src/services/image.ts
export async function compressNoteImage(image: string): Promise<string> {
  try {
    return await compressImage(image, 1600, 0.85);
  } catch {
    return image;
  }
}
```
```ts
// src/ui/note-version.ts:138 附近
const image = await compressNoteImage(addNoteVersionImage);
const note = await w.dbAddQuestionNote(w.currentQuestionId, image, label, textNote);
```
```ts
// src/ui/question-core.ts:59 附近
const image = await compressNoteImage(ev.image);
await w.dbAddQuestionNote(newQuestion.id, image, label, '');
```
```ts
// src/ui/quick-import.ts:395
async function compress(dataUrl: string, maxSize = 1600, quality = 0.85): Promise<string> {
```
（:166 手写笔记已是显式 1600/0.85，不变；:357/:358 题/答走新默认值。）

**Step 3: 跑测试 + typecheck + 全量单测**

**Step 4: 复现性演练（硬规则）**
1. 把 `compressNoteImage` 临时改成直接 `return image` → 接线用例必 FAIL
2. 把题/答默认参数临时改回 `1200, 0.8` → 参数断言必 FAIL（若有参数断言）或以 grep 自检 + code review 替代（如实记录验证方式）

---

## Task 4b（2026-09-16 追加：评审抓出的前提纠正）

**评审发现 + 我已源码验证**：题图/答图真正 stored 的压缩参数**不在快速导入层**——`public/db.js` 的 `dbCreateQuestion` 内部对传入图**再压一次**：`:427/429/431` 的 `compressImage(questionFile)` / `compressImage(answerFile)` / `compressImage(blankFile)` **不传参数 = 默认 (800, 0.7)**。因此：

- Task 4 把快速导入的 1200/0.8 改成 1600/0.85 **对最终存储无净效果**（被下游 800/0.7 抵消），且多一代 JPEG 损失
- 另发现：同步开启时题/答图经 `_uploadImage()` POST 到 `/api/upload` 存为**服务器文件**，行里存 URL（`_normalizeServerAssetUrl`）——"题/答文件化"基础设施早已存在

**修正（本 Task 的规格）**：

1. **`public/db.js:427/429/431`**：三处 `compressImage(x)` → `compressImage(x, 1600, 0.85)`（题/答/空图）——**这才是题/答质量的真闸门**
2. **`src/ui/quick-import.ts:357/358`**：**撤销本地预压缩**——`const qUrl = await compress(await getGalleryImageDataUrl(...))` 改为 `const qUrl = await getGalleryImageDataUrl(...)`（题/答把原图交给 `dbCreateQuestion`，压缩只在下游发生一次，消除双代损失）；`:395` 的 `compress` 默认参数**改回 `(1200, 0.8)`**（此后只剩 :166 手写笔记显式调用，默认值已无实际调用方，保持最小 diff）
3. **笔记部分不动**：Task 4 的 `compressNoteImage`(1600/0.85) 对笔记有效（`dbAddQuestionNote` 不做二次压缩，评审已核实）
4. **测试策略（如实记录）**：`dbCreateQuestion` 内的 `compressImage` 是同文件内部调用、且 jsdom 无法解码图片 → **无法用单测断言该参数**。验证放在 **Task 5 的 E2E**：注入 3000×2000 的 canvas 图 → 确认导入 → 用页面里的 `new Image()` 量新建题目图片的真实尺寸，断言 **`naturalWidth <= 1600`** + dataURL 长度显著小于原图。这才是有区分力的断言。

**影响**：新导入的题/答单张约 300–600KB（现 ~190KB），同步上传/服务器文件同量级；pull 不受影响（题/答存 URL）；存量不追溯。

---

## Task 5：E2E + 复现性演练

**Files:**
- Modify: `tests/quick-import-visibility.spec.js`（追加"添加版本 → 删除 → 消失/自愈"用例）

**Step 1: 删除流程用例**（注入假原生层复用既有 `injectNativeGallery`）

流程：详情页「+ 添加版本」→ 拍一张 → 确认 → 下拉出现「手写笔记」→ 点「🗑 删除此版本」→ confirm 接受 → 断言：下拉只剩「笔记 v1」→ 再删「笔记 v1」→ 断言自动补建的「笔记 v1」仍在（自愈）。

**Step 2: 压缩断言**（有区分力，吸取上次教训）：注入的相机图改为**大尺寸 canvas**（如 3000×2000 红图）→ 断言落库的 `note_image_url` 长度 **< 原图 dataURL 长度**（压缩真实发生），且**两图完整 dataURL 不相等**。

**Step 3: 复现性演练**
1. 撤销 `dbGetQuestionNotes` 的墓碑过滤 → 删除用例必 FAIL（版本"复活"）
2. 撤销 apply 的 `deleted_at` 透传 → 用例必 FAIL
3. 撤销 `compressNoteImage` 接入 → 压缩断言必 FAIL

**Step 4: 全量 E2E**（跑前 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 确认占用者 cwd 是本 worktree）

---

## Task 6：CI 全量 + 文档 + 打包

1. `npm run typecheck && npm run test && npm run build`
2. `cd server && npx vitest run`（服务端全量，含新增墓碑用例）
3. 全量 E2E → `tmp/test-results-<名字>`
4. 更新 `docs/quick-import-handwritten-note.md`（"已知非阻塞项"中"详情页不能删除"改为已实现；补压缩参数表）
5. 新建交付文档 `docs/note-image-compress-and-delete.md`
6. `AGENTS.md` 索引追加 + 打包规则保持（`BUILD_SOURCE=current`）
7. `BUILD_SOURCE=current npm run ship -- "笔记图片压缩统一；题图/答图提清晰度至1600px；笔记版本可删除"`
8. **不自动提交**

---

## 风险与对抗性评审

| 风险 | 判据 | 处理 |
|---|---|---|
| **服务端未升级就装新 APK 并删除** | 删除被"复活" | 部署顺序是硬前提（§0.2）；交付文档置顶 |
| 未升级的**其它设备**上删除不生效 | 旧客户端收到墓碑行不过滤 → 残留"空图条目" | 文档写明；两台设备都升级后消失 |
| **真删除不可恢复** | 服务端与所有设备的该图都被清空 | UI confirm 文案写明"不可恢复"；这是用户选定的语义（他因无法删除而提的需求） |
| `hasDeletedAt: true` 改变 `updatedAtPath` | 既有笔记行 `updated_at` 恒有值 → 行为不变 | Task 1 副作用审查已核 |
| 旧客户端把墓碑"顶掉" | 旧设备在删除后又编辑同一条笔记的 text_note（updated_at 更新）→ 推上去会覆盖墓碑 | 概率极低（需同题同版本双端同时操作）；真发生 = 版本回来，可再删；文档记录 |
| 题/答图片变大 2-3 倍 | 新导入的题/答 ~200-400KB/张（vs 60-120KB） | pull 预算：现 questions 17.6MB → 新题按 2-3 倍涨，数百题内仍 < 200MB 上限；超限前有"图片文件化"待办 → **⚠️ 本行结论已被证伪并更正**：同步开启时题/答走服务器文件 + URL（`_uploadImage`），不占 pull 载荷，"撞 200MB"不成立。见 `docs/note-image-compress-and-delete.md` §四 |
| 删除按钮误触 | 真删除不可恢复 | confirm 文案 + danger 配色 + 标题提示 |
| **这个方案什么时候是错的** | 如果你其实想要"删除只在本地隐藏、云端保留"（防误删） | 那是另一种产品语义（软隐藏 vs 真删除），当前实现是**真删除**；confirm 文案必须让用户知情 |

## 验证清单

- [ ] 服务端测试通过（含墓碑 2 例 + 既有全量）
- [ ] 客户端单测通过（355+ 新增）
- [ ] `typecheck` / `build` 通过
- [ ] 全量 E2E 通过（3000 端口、跑前核 cwd）
- [ ] 三处复现性演练各 FAIL 一次后还原
- [ ] 截图 AI 实际 Read
- [ ] 交付文档 + AGENTS.md 索引
- [ ] 重新 ship（APK 覆盖验证）
- [ ] 不自动提交；提示用户部署顺序（服务端先、APK 后）
