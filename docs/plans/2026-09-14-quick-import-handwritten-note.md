# 快速导入栏「手写笔记照片」实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **状态：待用户确认（AGENTS.md 检查清单 Step 4）。确认后才可动手改 src/。**
> 排版样稿：`designs/quick-import-handnote-preview.html`（截图 `.png`）。

**Goal:** 在快速导入栏新增「手写笔记照片」入口（合并进「📎 附加」展开区），拍照后作为**本次导入新建这道题**的另一个图片版本落库。

**Architecture:** 复用 `question_notes` 体系与题目详情已有的「📝 题目图片」多版本展示链路。**关键：线上笔记/同步能力由旧 `public/db.js` 提供**（见下面的修订记录），新功能只需调用已经生效的 `w.dbAddQuestionNote`，不需要改同步链路。

**Tech Stack:** TypeScript（src/ui、src/data）、`src/index.html` 内联 CSS、IndexedDB（localForage）、vitest（unit-tests/）、Playwright（tests/）。

---

## 修订记录（2026-09-14 19:55，本版最重要的一节）

**上一版计划里写的「三处会导致静默丢数据的缺陷」，经实测全部不成立。** 撤回清单：

| 上一版的说法 | 实际情况（实测） |
|---|---|
| 客户端写 `image_url`、读端读 `note_image_url` → 详情页版本图坏掉 | 线上跑的**不是** TS 实现。落库字段实测为 `note_image_url`，读写一致 |
| 服务端 `NOTE_COLUMNS` 是 `note_image_url`、客户端推 `image_url` → 云端被写成 NULL | 线上推送是旧版 `dbBuildSyncPayload`，推的就是 `note_image_url` → **不存在 NULL 污染** |
| pull 端无条件覆盖本地 → 本地图片也没了 | 线上是旧版 `dbApplyRemoteSnapshot`，内含 `_isRemoteNewer` 比较 → **不存在无条件覆盖** |
| 「同步数据完整性检测」从未触发过 | 线上旧版 `dbApplyRemoteSnapshot` **内部就在调** `collectDataFingerprint()` → 兜底是活的 |
| 「📤 导出」按钮 `exportAllData` 是死按钮 | `public/db.js:1807` 定义了它，按钮正常 |

**我的错误根因（一条被忽略的加载顺序）**：

1. `src/index.html` 末尾先加载**经典脚本** `/db.js`、`/ai.js`（`dist/index.html:980-981` 相同）
2. `src/main.ts` 用 `assignIfMissing()` 挂 window，而它的实现是 **`if (typeof w[key] === 'undefined')` 才挂**（`src/main.ts:17-23`）
3. 经典脚本先执行，`db.js` 把 `dbAddQuestionNote` / `dbBuildSyncPayload` / `dbApplyRemoteSnapshot` 等全部挂上了；`<script type="module">` 默认 defer，后执行 → **TS 版本全被跳过，`src/data/` 里的这些函数是影子实现**

我上一版只读了 `src/` 就下结论，没验「谁在跑」。

**实测证据**（探针脚本 `tmp/probe-notes.spec.js` + `tmp/probe.config.js`，可用 `NODE_OPTIONS= npx playwright test --config=tmp/probe.config.js --reporter=list --output=tmp/test-results-probe` 复现）：

```
window.dbAddQuestionNote    → 旧版（源码里就是 note_image_url: imageUrl）
实际落库对象的键             → ["id","question_id","note_image_url","label","text_note","created_at","updated_at"]
window.dbApplyRemoteSnapshot → 旧版，内部含 const fpBefore = await collectDataFingerprint();
window.exportAllData         → function（存在）
window.ensureQuestionNotesMigration → undefined（TS 侧，根本没挂上）
```

这也**解释了你从没看到空白题图**：详情弹窗的图只由 note 提供，而 note 的读写两端线上都是旧版、字段一致。

### 由此产生的两个实质影响

1. **「三处缺陷一起修」这个决定自动失效**——没有缺陷可修。原计划的 Task 1–6（字段迁移、同步门闩、pull 合并、完整性检测、冲突弹窗）**全部取消**。原计划的「上线时序」（关同步 / 逐台升级 / 先推一次修云端）也**取消**——云端没有损坏，**你不需要关同步了**。
2. 剩下一个**真正的、框架级的风险**（新提出，D6）：项目现在处于「两套数据层并存、旧的静默获胜」的状态。任何在 `src/data/` 里改数据行为的动作都可能改到不生效的代码上——**我这次就栽在这里**。

---

## 0. 现在的事实（本版唯一依据）

| 项 | 事实 | 证据 |
|---|---|---|
| 笔记读/写实现 | 旧 `public/db.js` | 探针：落库键 `note_image_url` |
| 笔记读写字段 | 两端都是 `note_image_url`，一致 | `public/db.js:900-910` 写入 / `src/ui/note-version.ts:50` 读取 |
| 笔记自动补建 | 旧版也有（`public/db.js:944`），且详情页打开时也会经 `w.dbAddQuestionNote` 补 | 同上 |
| 同步 push/pull | 旧版；pull 有 `_isRemoteNewer` 保护；内含完整性检测 | 探针源码片段 + `public/db.js:1449-1463` |
| 复习链路 | 不读笔记（`src/data/review.ts:2` 的 import 无使用） | grep 全文 |
| TS `src/data/sync.ts` | 影子层，运行时不被调用 | 探针 + `assignIfMissing` |
| TS `src/data/notes.ts` | 几乎全影子；**唯一活路径**是 `src/init-app.ts:16-18` 的一次性 backfill（直接 import），它写 `image_url` | grep 直接调用点 |

唯一残留的不一致：`init-app.ts` 的 backfill 若创建了 note，那条 note 只有 `image_url`，而旧版 reader 不做字段映射（`_normalizeQuestionNoteRecord` 在 `public/db.js:880-889`，只补 id/text_note/label/时间戳）→ 那条会在详情页显示坏图。你从没见过坏图，说明它没有在你机器上触发过（当时题目都已有 note）。**这个一致性修复保留为一个 2 行的小 Task（Task 1）。**

## 0.1 已确认决策

| 决策点 | 结论 |
|---|---|
| 归属 | **A**：手写笔记照片挂到本次快速导入正在创建的这道题，作为另一个图片版本 |
| 栏内排版 | **方案 B**：合并为单个「📎 附加」入口，展开区内含「文字笔记」+「手写笔记照片」两块 |
| 存量图片损失 | **不管**（用户 2026-09-14：自该功能设计以来没添加过多版本笔记图片），且实测无损失痕迹 |
| ~~三处缺陷一起修~~ | **作废**：实测不存在这些缺陷 |
| ~~暂时关掉同步~~ | **不需要了**：云端没有被写坏，无需停同步、无需逐台升级的时序安排 |
| D6 / D1 / D2 / B1 / B2 / B3 | **全部按建议采纳**（用户 2026-09-14 确认）：影子层只加约定不改架构；张数上限 5；命名「手写笔记 N」；压缩 1600px/0.85；未确认退出前弹确认；笔记文字双端同改本次不动 |
| B4 | **本次不做，并入旧 JS 退场的 E 批**（用户 2026-09-14 确认）。理由见下方专节 |

## 0.2 待你拍板的项

| # | 待定项 | 我的建议 | 若你不选建议，会发生什么 |
|---|---|---|---|
| D6 | **影子数据层**：`src/data/` 里改数据行为不生效，怎么办 | 本次**只加一条约定**：改数据层前先验「谁在跑」（写进 `AGENTS.md`）；不动架构 | 下一次还会有人（很可能是我）改到影子代码上；彻底收敛（迁走 db.js）是独立的大工程 |
| D1 | 单题手写笔记张数上限 | **5 张**，超出给 toast 提示 | 无上限时可在内存里堆任意多张 dataURL，确认时一次性落库并进入全量推送载荷 |
| D2 | 版本命名 | **「手写笔记」/「手写笔记 2」…**，与题图的「笔记 vN」在下拉里可区分 | 统一编号则下拉里分不清哪条是手写照片 |
| B1 | 手写照片压缩参数 | **1600px / 0.85**（题图是 1200/0.8） | 手写是细笔画、常要放大辨认，1200 长边偏糊 |
| B2 | 拍了没确认就退出 | **弹确认**「有 N 张手写笔记照片还没保存，要放弃吗？」 | 内存暂存 + 退出即弃 = 白拍，撞「零容忍静默丢失」 |
| B3 | 笔记文字双端同改 | **本次不动**（旧 db.js 的 note 合并是"远端较新即整行覆盖"）。要做就得改 83KB 的旧 db.js，且它同时被 `www/`、`dist/`、`android assets` 三份拷贝使用 | 两台设备同时改同一条笔记文字时，后同步的一方静默覆盖另一方（当前场景概率低，但确实存在） |
| B4 | 详情页能否删除手写版本 | **本次不做**，但要理解真实原因：不是"顺手不顺手"，而是**删除在当前同步协议里表达不出来**（见下方说明）。候补做法：并入旧版 JS 退场项目的 E 批（那一批本来就要动同步） | 现在做的话只能做出"删了会被下一次同步复活"的假删除，比没有更让人困惑 |

### 关于 B4「详情页能否删除手写版本」的完整理由

不是"做起来顺手不顺手"，而是**"删除"这件事在当前同步协议里表达不出来**（三条实测依据）：

1. 服务端 `question_notes` 表只有 8 个列、**没有 `deleted_at`**（`server/src/db/schema.ts:118-129`），且 `upsertQuestionNote` 的配置是 `hasDeletedAt: false`、`NOTE_COLUMNS` 里也不含它（`server/src/services/sync-upsert.ts:110,122-129`）→ 客户端就算写个 `deleted_at` 也传不上去
2. 客户端 pull 对笔记的判断是 `_isRemoteNewer(nextNote, localNote)`，而它的实现是 **`if (!localRecord) return true;`**（`public/db.js:165-170`）→ 本机删掉后 `localNote` 为 null，云端那一行必然被写回来
3. 题目**有**墓碑机制（`purged_at` + `purged_question_ids`，服务端收到后 `DELETE` 并回报 id 让客户端删本地），笔记**没有**对应的东西

所以现在只做 UI 的话，只能做出一个**"删了会被下一次同步复活"的假删除**——比没有这个按钮更让人困惑。

**而"拍糊了"的主场景其实不需要它**：手写照片在点「✅ 确认」之前一直待在「📎 附加」区里，那时本来就有 × 删除（Task 3）。真正需要"事后删版本"的是确认之后才发现拍错——而那个处境和你现有的**题目图片版本完全一样**（现在也删不掉任何版本）。

**要真正支持，最小改动是对齐题目的墓碑做法**，涉及：服务端加列 + `NOTE_COLUMNS` 收录 + 已存在库的 `ALTER TABLE` 迁移、客户端旧 `db.js`（四份拷贝）的删除/过滤/apply 三处、详情页 UI、两侧测试。这是一个跨端协议项目，建议并入 `docs/plans/2026-09-14-legacy-js-retirement.md` 的 E 批（那一批本来就要动同步），而不是塞进本次功能。

---

## 变更清单（文件级）

**客户端**
- Modify `src/data/notes.ts:16` + `src/types/question.ts:44`（`image_url` → `note_image_url`，Task 1）
- Modify `src/ui/camera.ts`（新增通用 `captureImage(source)`）
- Modify `src/ui/quick-import.ts`（附加区、手写待存列表、拍照/相册、删除、确认挂载、重置）
- Modify `src/index.html`（第三行按钮改名 + 展开区新增手写块）
- Modify `src/ui/index.ts`、`src/main.ts`（导出与 window 挂载）

**服务端 / 旧 db.js**：**零改动**

**测试**：`unit-tests/quick-import-hand-note.spec.ts`（Create）、`unit-tests/note-field-alignment.spec.ts`（Create）、`tests/quick-import-visibility.spec.js`、`tests/modal-anchor-overlap.spec.js`

**文档**：`docs/quick-import-handwritten-note.md`（交付文档）、本文、`AGENTS.md` 索引

---

## Task 1：TS 写端字段名对齐（唯一的"修复"类改动，2 行）

**Files:**
- Modify: `src/data/notes.ts:16`
- Modify: `src/types/question.ts:44`
- Test: `unit-tests/note-field-alignment.spec.ts`（Create）

**Step 1: 写失败测试**

`src/data/notes.ts` 经 `stores.ts` 在模块加载期调 `localforage.createInstance`，所以先 stub 再动态 import（照 `unit-tests/questions-normalize.spec.js:3-11` 的写法）：

```ts
import { describe, it, expect, vi } from 'vitest';

const stores = new Map<string, Map<string, any>>();
function bucket(name: string) {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name)!;
}
vi.stubGlobal('localforage', {
  createInstance: ({ storeName }: any) => {
    const s = bucket(storeName);
    return {
      getItem: async (k: string) => s.get(k) ?? null,
      setItem: async (k: string, v: any) => { s.set(k, v); return v; },
      iterate: async (cb: any) => { for (const [k, v] of s) await cb(v, k); },
      removeItem: async (k: string) => { s.delete(k); },
      clear: async () => { s.clear(); },
    };
  },
});
const noteStore = bucket('question_notes');
const { dbAddQuestionNote } = await import('../src/data/notes');

describe('TS 写端的笔记图片字段必须与线上（旧 db.js）一致', () => {
  it('写入 note_image_url，不写 image_url', async () => {
    const note = await dbAddQuestionNote('q1', 'data:image/jpeg;base64,AAA', '笔记 v1', '');
    expect(note.note_image_url).toBe('data:image/jpeg;base64,AAA');
    expect((note as any).image_url).toBeUndefined();
    expect(Object.keys(noteStore.get(note.id))).toContain('note_image_url');
  });

  it('imageUrl 为 null 时字段为 null（不落成 undefined）', async () => {
    const note = await dbAddQuestionNote('q2', null, '空图', '');
    expect(note.note_image_url).toBeNull();
  });

  it('与线上实现的落库键集合一致', async () => {
    const note = await dbAddQuestionNote('q3', 'data:image/jpeg;base64,BBB', 'x', '');
    expect(Object.keys(noteStore.get(note.id)).sort()).toEqual(
      ['created_at', 'deleted_at', 'id', 'label', 'note_image_url', 'question_id', 'text_note', 'updated_at'].sort()
    );
  });
});
```

**Step 2: 跑测试确认失败**

```bash
npm run test -- unit-tests/note-field-alignment.spec.ts
```
Expected: FAIL — `expected undefined to be 'data:image/jpeg;base64,AAA'`。

**Step 3: 改两处**

`src/types/question.ts`：
```ts
export interface QuestionNote {
  id: string;
  question_id: string;
  note_image_url: string | null;   // 原 image_url：与线上实现（public/db.js）和服务端列名一致
  label: string;
  text_note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

`src/data/notes.ts:16`：
```ts
const note: QuestionNote = { id, question_id: questionId, note_image_url: imageUrl, label: label || '', text_note: textNote || '', created_at: now, updated_at: now, deleted_at: null };
```

**Step 4: 跑测试 + 类型检查**

```bash
npm run test -- unit-tests/note-field-alignment.spec.ts && npm run typecheck
```
Expected: PASS；typecheck 无错（若报出别的读 `.image_url` 的笔记代码，那是漏网消费点，一并改）。

**Step 5: 无残留自检**

```bash
grep -rn "image_url" src/data/notes.ts src/ui/note-version.ts
```
Expected：`notes.ts` 只剩 `note_image_url`；`note-version.ts:50` 本来就是 `note.note_image_url`，不动。

> ⚠️ **别顺手改 `src/data/sync.ts`**：它是影子层（§修订记录）。真要动同步行为，改的是 `public/db.js`，并且要同步 `www/`、`dist/`、`android/app/src/main/assets/public/` 三份拷贝 —— 那是独立工程，不在本次范围。

---

## Task 2：快速导入栏 DOM 改造（方案 B）

**Files:**
- Modify: `src/index.html:50-63`

**Step 1: 第三行按钮改名（id 不变，避免连带改动测试与函数名）**

`src/index.html:53`，把「📝 笔记」文案改为「📎 附加」，`title` 改为「点击展开/收起文字笔记与手写笔记照片」，其余属性一律不动：

```html
<button type="button" id="qi-note-btn" onclick="toggleQuickNote()" style="flex-shrink:0;padding:7px 12px;border:1.5px dashed var(--accent);border-radius:var(--radius-md);background:var(--accent-light);color:var(--accent-dark);font-size:13px;font-weight:700;cursor:pointer" title="点击展开/收起文字笔记与手写笔记照片">📎 附加<span id="qi-note-dot" style="display:none;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:4px;vertical-align:2px"></span></button>
```

`#qi-combo-btn` 的 `max-width:calc(100% - 132px)` **不动**：实测「📝 笔记」与「📎 附加」同为 82px（1 emoji + 2 汉字 @13px），第三行几何完全不变。

**Step 2: 展开区插入手写块（`src/index.html:56-63` 内，`qi-note-input` 之后）**

```html
<div id="qi-hw-block" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:700;color:var(--accent-dark)">📸 手写笔记照片（本题另一图片版本）</span>
        <span id="qi-hw-count" style="font-size:10px;color:var(--accent-dark)">0/5</span>
    </div>
    <div class="upload-buttons">
        <button type="button" class="upload-btn camera" onclick="takeQuickHandNote()" style="font-size:12px;padding:10px">📷 拍一张</button>
        <button type="button" class="upload-btn" onclick="pickQuickHandNoteFromGallery()" style="background:var(--surface-dim);color:var(--text-secondary);box-shadow:0 2px 0 var(--border);font-size:12px;padding:10px">🖼️ 相册</button>
    </div>
    <div id="qi-hw-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
    <div style="padding:6px 0 0;font-size:10px;color:var(--text-secondary)">保存后可在题目详情「📝 题目图片」下拉中切换查看，并随同步上传</div>
</div>
```

**⚠️ 白字白底陷阱（`AGENTS.md` 记录的真实事故）**：`src/styles/main.css:86` 的全局 `button{...color:#fff...}` 要求每个新按钮**显式**声明 `color`。上面「🖼️ 相册」照抄了 `note-version` 弹窗里可用的写法。Task 5 必须对这两个按钮跑 `assertVisiblyRendered`（含对比度 ≥3），不能只断言文本存在。

**Step 3: 手写块不另设底色**

展开区底色是 `var(--accent-light)`，手写块只加 `border-top: 1px dashed var(--border)` 分隔，不嵌套第二层底色，避免「浅紫底 + 浅紫块」的对比度陷阱。

**宽度实测**（脚本 `tmp/measure-qi-row3.mjs`）：固定控件 = 双栏 36 + 附加 82 + 确认 78 + 4×6 间距 = 220px。430/390/360/320 四档下「组合」分别剩 186/146/116/76px，均 ≥ 它自身需要的 74px → **不需要响应式兜底**。

---

## Task 3：通用拍照入口 + 手写待存列表

**Files:**
- Modify: `src/ui/camera.ts`（新增 `captureImage`）
- Modify: `src/ui/quick-import.ts`
- Test: `unit-tests/quick-import-hand-note.spec.ts`（Create）

**Step 1: 写失败测试**

复用 `unit-tests/quick-import-note.spec.ts` 的 DOM 挂载法，BAR_HTML 补上手写块：

```ts
describe('手写笔记待存列表', () => {
  it('添加一张后计数为 1/5，缩略图出现在列表里', ...);
  it('超过 5 张被拒绝并提示', ...);
  it('删除第 2 张后剩下顺序不变', ...);
  it('resetQuickHandNotes 清空列表与计数', ...);
  it('DOM 缺失时不抛异常', ...);
});
```

**Step 2: 实现 `src/ui/camera.ts` 追加**

```ts
export async function captureImage(source: 'CAMERA' | 'PHOTOS'): Promise<string | null> { /* native: Capacitor Camera.getPhoto({ source, resultType:'dataUrl' })；web: input[type=file]（CAMERA 时带 capture="environment"）+ FileReader；用户取消返回 null；失败 showStatus */ }
```
（`note-version.ts` 里那两份同类实现本次**不动**，避免连带回归；已记入「不涉及边界」。）

**Step 3: 实现 `src/ui/quick-import.ts`**

```ts
const HAND_NOTE_MAX = 5;                      // D1
let pendingHandNotes: string[] = [];

function hwList(): HTMLElement | null { return document.getElementById('qi-hw-list'); }

export async function takeQuickHandNote(): Promise<void> {
  const url = await captureImage('CAMERA');
  if (url) await addQuickHandNote(url);
}
export async function pickQuickHandNoteFromGallery(): Promise<void> {
  const url = await captureImage('PHOTOS');
  if (url) await addQuickHandNote(url);
}
export async function addQuickHandNote(dataUrl: string): Promise<void> {
  if (pendingHandNotes.length >= HAND_NOTE_MAX) { showStatus(`最多添加 ${HAND_NOTE_MAX} 张手写笔记照片`, 'error'); return; }
  pendingHandNotes.push(await compress(dataUrl));   // 复用本文件已有 compress()；分辨率按 D2/B1 决策
  renderQuickHandNotes();
}
export function removeQuickHandNote(idx: number): void { pendingHandNotes.splice(idx, 1); renderQuickHandNotes(); }
function renderQuickHandNotes(): void { /* 更新 #qi-hw-count、圆点、#qi-hw-list（72×72 缩略图 + 右上角 × + 底部角标「笔记 v{i+2}」），末尾调 applyQuickBarBodyPadding() */ }
export function resetQuickHandNotes(): void { pendingHandNotes = []; renderQuickHandNotes(); }
export function readPendingHandNotes(): string[] { return [...pendingHandNotes]; }
export function handNoteLabel(i: number): string { return i === 0 ? '手写笔记' : `手写笔记 ${i + 1}`; }   // D2
```

**Step 4: 重置语义收敛**

- `resetQuickNote()` 末尾调用 `resetQuickHandNotes()`（两处调用点：确认成功 / 退出快速导入模式，自动覆盖）
- `onQuickNoteInput()` 的圆点判定改为「有文字 **或** 有手写照片」
- **B2（若采纳）**：`toggleQuickImportMode()` 退出前，若 `pendingHandNotes.length > 0` 且 `!confirm('有 N 张手写笔记照片还没保存，要放弃吗？')` → 中止退出

**Step 5: 跑测试**

```bash
npm run test -- unit-tests/quick-import-hand-note.spec.ts unit-tests/quick-import-note.spec.ts
```
Expected: 全 PASS（含既有字数/圆点用例）。

---

## Task 4：确认时挂载为额外图片版本

**Files:**
- Modify: `src/ui/quick-import.ts:263-305`（`confirmQuickImport`）

**Step 1: 写失败测试**（mock `w.dbCreateQuestion` / `w.dbAddQuestionNote`）

断言：手写照片 2 张时，`dbAddQuestionNote` 依次被调用为 (`题图`, '笔记 v1', 文字笔记)、(`手写图1`, '手写笔记', '')、(`手写图2`, '手写笔记 2', '')。

**Step 2: 改 `confirmQuickImport`**

```ts
    const noteText = readQuickNoteText();
    const handNotes = readPendingHandNotes();     // 确认前快照，避免异步过程中列表被改
    ...
    if (created?.question_image_url) {
      await w.dbAddQuestionNote(created.id, created.question_image_url, '笔记 v1', noteText);
    }
    for (let i = 0; i < handNotes.length; i++) {
      await w.dbAddQuestionNote(created.id, handNotes[i], handNoteLabel(i), '');
    }
```
`resetQuickNote()` 已在原流程里（会连带清空手写列表）。失败路径**不清空**（已拍的照片不能丢）。

**Step 3: 跑测试 + typecheck**

```bash
npm run test -- unit-tests/quick-import-hand-note.spec.ts && npm run typecheck
```

**预期行为（写进交付文档）**：手写照片版本在详情页下拉里与题图版本并列；切到它时下方「📝 文字笔记」文本框显示该版本自己的 `text_note`（为空）。文字笔记仍绑在「笔记 v1」上 —— 这是"沿用现有展示方式"的直接结果，不是 bug。

---

## Task 5：E2E + 可见性 + 复现性演练

**Files:**
- Modify: `tests/quick-import-visibility.spec.js`、`tests/modal-anchor-overlap.spec.js`；`tests/fixtures/` 新增 `handnote.png`

**Step 1: 可见性用例（含新控件），三档视口各跑一遍（390×844 / 360×800 / 320×640）**

```js
await assertVisiblyRendered(page, '#qi-note-btn', '附加按钮');
await assertVisiblyRendered(page, '#qi-hw-block', '手写笔记块', { skipContrast: true });
await assertVisiblyRendered(page, '#qi-hw-block button:nth-of-type(1)', '拍一张按钮');
await assertVisiblyRendered(page, '#qi-hw-block button:nth-of-type(2)', '相册按钮');
await assertVisiblyRendered(page, '#qi-combo-btn', '组合按钮');   // 改名后的重点回归：文案不被截断
await captureForReview(page, 'quick-import-handnote');
```

**Step 2: 挂载链路用例（注入假原生相册，跑真链路，不需要真机）**

浏览器里 `fetchLatestMedias` 直接返回 `null`（`src/ui/camera.ts:112-113` 要求 `isNativePlatform()`），所以现有 E2E 从不触发 `confirmQuickImport` 成功分支。用 `addInitScript` 注入假原生层即可（`nativeFlags()` 调用时求值，注入有效）：

```js
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function injectNativeGallery(page) {
  await page.addInitScript(({ png }) => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        MediaGallery: {
          getMedias: async () => ({ medias: [
            { identifier: 'content://a.jpg', data: png },
            { identifier: 'content://b.jpg', data: png },
          ] }),
          getFullImage: async () => ({ data: png, mimeType: 'image/png' }),
        },
      },
    };
  }, { png: PNG });
}

test('手写笔记照片随确认落库为该题的另一个图片版本', async ({ page }) => {
  await injectNativeGallery(page);
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('quickImportMode', '1'); localStorage.removeItem('quickImportImportedIds'); });
  await page.reload();
  await expect(page.locator('#qi-thumb-question')).toBeVisible();
```

**⚠️ 两处必须遵守的修正（2026-09-14 Task 2 评审实测得出）**

**修正 1：不要用 filechooser —— 注入了原生层就得注入 `Camera`。** `captureImage('CAMERA')` 在 `isNativePlatform()` 为真时走 `Capacitor.Plugins.Camera.getPhoto`，**不会**创建 `input[type=file]`，所以 `page.on('filechooser')` 永远收不到事件。既然为了相册配对已经注入了假原生层，就把 `Camera` 一起注进去（更贴近真机行为）：

```js
Plugins: {
  Camera: { getPhoto: async () => ({ dataUrl: 'data:image/png;base64,' + png }) },
  MediaGallery: { /* 见上 */ },
}
```

**修正 2：「📷 拍一张」按钮不能用默认的对比度检查（假阴性）。** 实测：该按钮背景是 `.upload-btn.camera` 的**橙色渐变**（`background-image`），而 `tests/helpers/visibility.js` 只读 `background-color` → 背景被当成透明、向上冒泡到浅色祖先 → 算出对比度 **1.11** → 断言 FAIL，但按钮肉眼完全正常（与全 app 既有的「拍照」按钮同一写法）。

- 所以对该按钮用 `assertVisiblyRendered(page, sel, '拍一张按钮', { skipContrast: true })`
- **但「🖼️ 相册」按钮必须保留完整对比度检查**（它的底是实色 `var(--surface-dim)`，实测对比度 3.13）。它也正是复现性演练的有效靶子：把它的 `color` 删掉 → 实测降到 1.11 → 断言正确 FAIL（Task 2 评审已实测验证）
- 这条助手盲区（渐变背景不采样）要写进交付文档，供后续改进

```js
  // 接上面的用例：注入 Camera 后点「拍一张」
  await page.click('#qi-hw-block button:nth-of-type(1)');
  await expect(page.locator('#qi-hw-list img')).toHaveCount(1);
  await expect(page.locator('#qi-hw-count')).toHaveText('1/5');

  await page.click('#qi-confirm-btn');
  await expect(page.locator('#toast-msg')).toContainText('题目已导入');

  const rows = await page.evaluate(async () => {
    const qs = await window.dbGetAllQuestions();
    return await window.dbGetQuestionNotes(qs[0].id);
  });
  expect(rows.map((n) => n.label)).toEqual(['笔记 v1', '手写笔记']);
  expect(rows[1].note_image_url).toMatch(/^data:image\//);
  expect(rows[1].image_url).toBeUndefined();
});
```

**Step 3: 复现性演练（AGENTS.md 硬规则）**

1. 把 `src/data/notes.ts` 写端改回 `image_url` → Task 1 单测必 FAIL
2. 把「📎 附加」按钮临时改成 `background:var(--surface)` 且不声明 `color`（复刻 2026-08-29 白字白底事故）→ 可见性用例必须 FAIL；验完立即还原
3. 临时把 `handNoteLabel` 的第二张返回写成与第一张相同 → 挂载用例的 label 断言必 FAIL

**Step 4: 运行（绕开批量删除保护）**

```bash
NODE_OPTIONS= npx playwright test tests/quick-import-visibility.spec.js tests/modal-anchor-overlap.spec.js --reporter=list --output=tmp/test-results-handnote
```
Expected: 全绿。`modal-anchor-overlap.spec.js` 里 `196/312` 只是注释里的设计参考值、断言走实时 `rect`（`:231`），但手写块会改展开态高度 —— 若有用例失败，按 `docs/fix-modal-anchor-flaky.md` 的 `waitModalSynced` 泛化法补齐插入点，**不要改断言阈值糊过去**。

**Step 5: AI 必须实际 Read 三档截图确认**（只看测试变绿不算通过）。

---

## Task 6：CI 循环、文档、打包

**Step 1: 本地 CI 全量**

```bash
npm run typecheck && npm run test && npm run build
NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-handnote-full
```

**Step 2: 交付文档** → `docs/quick-import-handwritten-note.md`，必须包含：这次"影子数据层"误判的经过与判定方法（供以后参考）、新功能的挂载语义、「预期行为」那条、以及「不涉及边界」。

**Step 3: `AGENTS.md`** 索引追加一行；并按 D6（若采纳）在编码规则里加一条：**改数据层前先验「谁在跑」**（`index.html` 加载 `/db.js` → `assignIfMissing` 只填 undefined → 旧版赢），并附探针命令。

**Step 4: 打包验证**（先加载 `ship-feature` skill）

```bash
npm run ship -- "快速导入支持手写笔记照片"
```

**Step 5: 不自动提交**，等用户检查后统一提交推送（项目硬规则）。

---

## 不涉及边界

- **不改 `public/db.js` 及其 `www/`、`dist/`、`android assets` 三份拷贝**（改它属于独立工程）
- 不改服务端表结构、列名、路由
- 不做手写照片的裁剪/旋转/滤镜（沿用 `compress()`）
- 不做笔记删除入口（`dbDeleteQuestionNote` 仍无调用点）
- 不重构 `note-version.ts` 里已有的两份拍照实现
- 不改复习链路（不读笔记）
- 不做「给已有题目补手写照片」的入口（那是归属 B；现有路径是题目详情 →「+ 添加版本」）

## 风险与对抗性评审

| 风险 | 判据 | 处理 |
|---|---|---|
| **再次改到影子代码** | 改动目标函数名在 `public/db.js` 里是否存在 | Task 6 Step 3 把判定方法写进 `AGENTS.md`；改动前跑一次探针 |
| 白字白底（历史事故） | 新按钮是否显式声明 `color` | Task 5 Step 1 的对比度断言 + Step 3 的复现性演练 |
| 栏高变化引发 modal-anchor 竞态 | `tests/modal-anchor-overlap.spec.js` 全量串行 | 必须跑全量；失败按既有文档修，不改阈值 |
| 同步载荷膨胀 | 5 张 × 约 350–700KB ≈ 2–3.5MB/题 | 已有 200mb 上限与 413 提示；D1 的上限就是为它设的 |
| 手写照片只在内存、退出即弃 | B2 是否采纳 | 采纳则退出前弹确认；不采纳需明确接受白拍 |
| E2E 注入假原生层在某些环境不稳 | Task 5 Step 2 是否稳定通过 | 降级方案：E2E 只断言 UI 层，挂载链路交给 Task 4 的单测，并在交付文档写明降级 |

**这个方案什么情况下是错的：**

1. **如果你的真实场景是"给已有的老题补手写照片"（归属 B）** —— 那 Task 2–4 的位置就是错的，应该做在题目详情页。你已选 A；如果真机试用后发现从来不会为了补手写笔记而进快速导入模式，那是失效信号，及时叫停。
2. **如果 B3 的取舍不可接受** —— 认为"笔记文字双端同改会静默覆盖"必须本次解决，那要改的是 `public/db.js`（带三份拷贝），计划范围和风险都会显著变大，需要单独立项。
3. **如果 D6 你选择彻底收敛影子层**（例如把 db.js 的能力迁进 TS 并删掉旧脚本）—— 那是个独立大工程，本次功能应该在它之后做，否则又要基于现状返工。

## 验证清单（照 AGENTS.md 执行）

- [ ] `npm run typecheck` 通过
- [ ] `npm run test` 通过（新增 2 个 spec + 既有 279 例）
- [ ] `npm run build` 通过
- [ ] `NODE_OPTIONS= npx playwright test` 全量通过，产物落 `tmp/`
- [ ] 三档截图 AI 实际 Read 确认（390/360/320）
- [ ] 三处复现性演练各 FAIL 一次后还原
- [ ] `docs/quick-import-handwritten-note.md` 已写，`AGENTS.md` 索引已更新
- [ ] `npm run ship -- "..."` 打包通过
- [ ] 不自动 commit，等用户检查
