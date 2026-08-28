# 快速导入题目模式 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 加一个「⚡ 快速导入」常驻模式：开启后顶部悬浮一条确认栏，除标签外所有字段走默认值，切回 App 自动读取相册最新两张照片（第 1 张＝答案、第 2 张＝题目），输完标签点确认即建题，并自动载入下一对照片。

**Architecture:** 新增两个 services 纯逻辑模块（`version-combo.ts` 管版本组合的 localStorage 读写，`quick-import.ts` 管照片配对算法与已导入指纹），一个 UI 模块（`ui/quick-import.ts`）负责悬浮条渲染、标签输入、组合面板、确认建题与前后台刷新。UI 层通过 `window` 调 data 层（与 `camera.ts` 一致），services 层保持纯函数以便 vitest 单测。顶部条只做**摘要预览 + 快捷切换**，完整的版本勾选框与单双栏 radio 仍保留在表单原位置不动。

**Tech Stack:** TypeScript（strict）、Vite、localForage（data 层）、localStorage（组合/指纹/开关状态）、Capacitor `MediaGallery` 原生插件、`document.visibilitychange` 生命周期、Vitest（jsdom）+ Playwright。

---

## 需求确认（来自用户）

| 项 | 结论 |
|---|---|
| 取图规则 | 相册最近两张：**第 1 张（最新）＝答案图，第 2 张（次新）＝题目图** |
| 导入粒度 | **逐题**：每对图各自输标签，确认一次建 1 道题 |
| 下一组 | 确认后**重新刷新相册**，再取最新的两张 |
| 版本组合 | 用户自建「组合一 / 组合二 / …」，**在顶部条点组合徽标弹小面板管理** |
| 单双栏 | 顶部条**可直接点切换**（单栏 ⇄ 双栏），持久化到 localStorage，并同步表单原位置的 radio |
| 设置持久化 | **组合、单双栏都缓存上次选择，确认提交后绝不清空**；只有标签清空 |
| 顶部条 | **悬浮固定顶部**，快速模式常驻；元素＝缩略图（含交换）＋标签＋组合下拉＋**栏数切换**＋确认 |
| 顶部标签输入 | **有**，在顶部条第二行；交互**完全对齐 `src/ui/tag-manage.ts:58-163` 的表单标签选择器** |
| 确认后标签 | **清空**——每题独立，绝不把上一题的标签带到下一题 |

---

## 关键约束（务必遵守，否则会踩历史坑）

1. **禁止用 `<label>` 包裹 checkbox**（`docs/fix-version-checkbox-double-toggle.md`）：Android WebView 会双触发。一律 `div` + 手动 `if (e.target === cb) return;`，照抄 `src/ui/version-skin.ts:138-165`。
2. **原生门控现场自算**，不要信 `w.isNative`（`docs/fix-migration-native-gating-regression.md` 根因 1）：照抄 `src/ui/camera.ts:4-9` 的 `nativeFlags()`。
3. **Android WebView 的 `oninput` 不可靠**（`docs/fix-android-cursor-jump-to-end.md`）：标签联想输入框必须配 150ms `setInterval` 轮询补偿，照抄 `src/ui/tag-manage.ts:18-25`。
4. **项目要求源码不写注释**（`AGENTS.md` 第 82 行）。
5. **新 UI 函数三处接线**：`src/ui/index.ts` 加 `export *`、`src/main.ts` 的 `assignToWindow({...})` 挂 window（HTML `onclick="fn()"` 只能走全局）、`src/init-app.ts` 初始化。
6. **提交前 CI 循环**（`AGENTS.md` 第 23-28 行）：`npm run typecheck` → `npm run test` → `npm run build` → `npx playwright test tests/ui-health.spec.js`，全绿才算完成。

---

## 文件清单

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/services/version-combo.ts` | 新建：组合类型 + localStorage CRUD（纯逻辑，可单测） |
| 2 | `src/services/quick-import.ts` | 新建：照片配对算法 + 已导入指纹 + 建题入参组装（纯逻辑） |
| 3 | `src/ui/camera.ts` | 修改：抽出 `fetchLatestMedias()` / `getGalleryImageDataUrl()`，`galleryThumbClick` 改为复用 |
| 4 | `src/index.html` | 修改：toolbar 加开关按钮；body 下加 `#quick-import-bar` 容器 + `#quick-combo-panel` 面板容器 |
| 5 | `src/ui/quick-import.ts` | 新建：核心 UI（开关、渲染、拉图、标签、组合面板、确认建题、前后台刷新） |
| 6 | `src/ui/index.ts` | 修改：追加 `export * from './quick-import';` |
| 7 | `src/main.ts` | 修改：`assignToWindow` 追加新函数 |
| 8 | `src/init-app.ts` | 修改：`initApp()` 末尾调 `ui.initQuickImportMode()` |
| 9 | `unit-tests/quick-import.spec.ts` | 新建：vitest 单测 |
| 10 | `tests/ui-health.spec.js` | 修改：追加 E2E 用例 |
| 11 | `docs/quick-import-mode.md` + `AGENTS.md` | 新建/追加：开发文档 + 索引条目 |

---

## Task 1: 版本组合数据层（services）

**Files:**
- Create: `src/services/version-combo.ts`
- Create: `unit-tests/quick-import.spec.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadVersionCombos, saveVersionCombos, createVersionCombo,
  updateVersionCombo, deleteVersionCombo, getComboById,
  getActiveComboId, setActiveComboId, resolveActiveCombo, comboVersionNames,
} from '../src/services/version-combo';

beforeEach(() => localStorage.clear());

describe('version-combo', () => {
  it('creates a combo with unique id and persists', () => {
    const c = createVersionCombo('组合一', ['peiyou', 'gaosan']);
    expect(c.name).toBe('组合一');
    expect(c.versionIds).toEqual(['peiyou', 'gaosan']);
    expect(loadVersionCombos()).toHaveLength(1);
  });

  it('renames and replaces version ids', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    updateVersionCombo(c.id, { name: '高三专用', versionIds: ['gaosan', 'tongblian'] });
    expect(loadVersionCombos()[0].name).toBe('高三专用');
    expect(loadVersionCombos()[0].versionIds).toEqual(['gaosan', 'tongblian']);
  });

  it('deletes combo and clears active pointer when deleted', () => {
    const c = createVersionCombo('组合一', ['peiyou']);
    setActiveComboId(c.id);
    deleteVersionCombo(c.id);
    expect(loadVersionCombos()).toHaveLength(0);
    expect(getComboById(c.id)).toBeNull();
  });

  it('resolveActiveCombo falls back to creating 组合一 with all versions', () => {
    const combo = resolveActiveCombo(() => ['peiyou', 'gaosan', 'tongblian']);
    expect(combo.name).toBe('组合一');
    expect(combo.versionIds).toEqual(['peiyou', 'gaosan', 'tongblian']);
    expect(getActiveComboId()).toBe(combo.id);
  });

  it('resolveActiveCombo reuses existing active combo', () => {
    const c = createVersionCombo('自定义', ['gaosan']);
    setActiveComboId(c.id);
    expect(resolveActiveCombo(() => ['peiyou']).id).toBe(c.id);
  });

  it('comboVersionNames maps ids to names and drops unknown ids', () => {
    const c = createVersionCombo('组合一', ['peiyou', 'ghost']);
    expect(comboVersionNames(c, (id) => ({ peiyou: '培优版' }[id] ?? null))).toEqual(['培优版']);
  });
});
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run unit-tests/quick-import.spec.ts`
Expected: FAIL，模块不存在。

**Step 3: 写实现**

```ts
export interface VersionCombo {
  id: string;
  name: string;
  versionIds: string[];
  created_at: string;
  updated_at: string;
}

const COMBOS_KEY = 'versionCombos';
const ACTIVE_COMBO_KEY = 'activeVersionComboId';

export function loadVersionCombos(): VersionCombo[] {
  const raw = localStorage.getItem(COMBOS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c: VersionCombo) => c && typeof c.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveVersionCombos(combos: VersionCombo[]): void {
  localStorage.setItem(COMBOS_KEY, JSON.stringify(combos));
}

export function getComboById(id: string): VersionCombo | null {
  return loadVersionCombos().find((c) => c.id === id) || null;
}

export function getActiveComboId(): string {
  return localStorage.getItem(ACTIVE_COMBO_KEY) || '';
}

export function setActiveComboId(id: string): void {
  localStorage.setItem(ACTIVE_COMBO_KEY, id);
}

export function createVersionCombo(name: string, versionIds: string[]): VersionCombo {
  const now = new Date().toISOString();
  const combo: VersionCombo = {
    id: 'combo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || '新组合',
    versionIds: [...versionIds],
    created_at: now,
    updated_at: now,
  };
  saveVersionCombos([...loadVersionCombos(), combo]);
  return combo;
}

export function updateVersionCombo(id: string, patch: Partial<Pick<VersionCombo, 'name' | 'versionIds'>>): VersionCombo | null {
  const combos = loadVersionCombos();
  const idx = combos.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const next: VersionCombo = { ...combos[idx], ...patch, updated_at: new Date().toISOString() };
  if (patch.name !== undefined) next.name = patch.name.trim() || combos[idx].name;
  if (patch.versionIds !== undefined) next.versionIds = [...patch.versionIds];
  combos[idx] = next;
  saveVersionCombos(combos);
  return next;
}

export function deleteVersionCombo(id: string): VersionCombo[] {
  const next = loadVersionCombos().filter((c) => c.id !== id);
  saveVersionCombos(next);
  if (getActiveComboId() === id) setActiveComboId(next[0]?.id ?? '');
  return next;
}

export function resolveActiveCombo(allVersionIds: () => string[]): VersionCombo {
  const activeId = getActiveComboId();
  const existing = activeId ? getComboById(activeId) : null;
  if (existing) return existing;
  const first = loadVersionCombos()[0];
  if (first) { setActiveComboId(first.id); return first; }
  const created = createVersionCombo('组合一', allVersionIds());
  setActiveComboId(created.id);
  return created;
}

export function comboVersionNames(combo: VersionCombo | null, nameById: (id: string) => string | null): string[] {
  if (!combo) return [];
  return combo.versionIds.map(nameById).filter((n): n is string => !!n);
}
```

**Step 4: 跑测试确认通过**

Run: `npx vitest run unit-tests/quick-import.spec.ts`
Expected: PASS（6 个用例）。

**Step 5: Commit**

```bash
git add src/services/version-combo.ts unit-tests/quick-import.spec.ts
git commit -m "快速导入题目 - 新增版本组合数据层与单测"
```

---

## Task 2: 照片配对与已导入指纹（services 纯逻辑）

**Files:**
- Create: `src/services/quick-import.ts`
- Modify: `unit-tests/quick-import.spec.ts`（追加 describe 块）

**Step 1: 追加失败测试**

```ts
import {
  pickQuestionAnswerPair, countFreshMedias,
  loadImportedIds, markImportedIds, clearImportedIds,
  buildQuickCreateArgs, loadQuickLayoutType, saveQuickLayoutType,
  toggleLayoutType, layoutLabel,
} from '../src/services/quick-import';

const M = (id: string) => ({ identifier: id });

describe('quick-import pairing', () => {
  it('picks newest as answer and second newest as question', () => {
    const pair = pickQuestionAnswerPair([M('a'), M('b'), M('c')], new Set());
    expect(pair!.answer.identifier).toBe('a');
    expect(pair!.question.identifier).toBe('b');
  });

  it('skips already imported medias', () => {
    const pair = pickQuestionAnswerPair([M('a'), M('b'), M('c'), M('d')], new Set(['a', 'b']));
    expect(pair!.answer.identifier).toBe('c');
    expect(pair!.question.identifier).toBe('d');
  });

  it('returns null when fewer than two fresh medias', () => {
    expect(pickQuestionAnswerPair([M('a')], new Set())).toBeNull();
    expect(pickQuestionAnswerPair([], new Set())).toBeNull();
    expect(pickQuestionAnswerPair([M('a'), M('b')], new Set(['a', 'b']))).toBeNull();
  });

  it('countFreshMedias counts medias not yet imported', () => {
    expect(countFreshMedias([M('a'), M('b')], new Set(['a']))).toBe(1);
  });
});

describe('quick-import imported fingerprint', () => {
  beforeEach(() => localStorage.clear());

  it('dedupes and keeps newest first', () => {
    markImportedIds(['a', 'b']);
    markImportedIds(['b', 'c']);
    expect(loadImportedIds()).toEqual(['c', 'b', 'a']);
  });

  it('caps stored ids at 200', () => {
    const many = Array.from({ length: 260 }, (_, i) => 'id' + i);
    markImportedIds(many);
    const stored = loadImportedIds();
    expect(stored).toHaveLength(200);
    expect(stored[0]).toBe('id259');
  });

  it('clearImportedIds empties the list', () => {
    markImportedIds(['a']);
    clearImportedIds();
    expect(loadImportedIds()).toEqual([]);
  });
});

describe('buildQuickCreateArgs', () => {
  it('passes layout type through and always nulls book info', () => {
    const args = buildQuickCreateArgs('data:q', 'data:a', ['t1'], ['peiyou'], 1);
    expect(args).toEqual({
      questionImageUrl: 'data:q', answerImageUrl: 'data:a', tagIds: ['t1'],
      layoutType: 1, blankImageUrl: null, versions: ['peiyou'], bookInfo: null,
    });
  });

  it('keeps layout 0 when caller asks for single column only', () => {
    expect(buildQuickCreateArgs('q', null, [], [], 0).layoutType).toBe(0);
  });

  it('copies arrays so callers cannot mutate stored state', () => {
    const tags = ['t1']; const vers = ['peiyou'];
    const args = buildQuickCreateArgs('q', null, tags, vers, 1);
    tags.push('t2'); vers.push('gaosan');
    expect(args.tagIds).toEqual(['t1']);
    expect(args.versions).toEqual(['peiyou']);
  });
});

describe('quick-import layout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 1 (single+double column ok)', () => {
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('round-trips 0 and 1', () => {
    saveQuickLayoutType(0);
    expect(loadQuickLayoutType()).toBe(0);
    saveQuickLayoutType(1);
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('treats any invalid stored value as 1', () => {
    localStorage.setItem('quickImportLayoutType', 'garbage');
    expect(loadQuickLayoutType()).toBe(1);
  });

  it('toggleLayoutType flips between 0 and 1', () => {
    expect(toggleLayoutType(1)).toBe(0);
    expect(toggleLayoutType(0)).toBe(1);
  });

  it('layoutLabel renders readable text', () => {
    expect(layoutLabel(1)).toBe('📏 单双栏均可');
    expect(layoutLabel(0)).toBe('📐 仅适合单栏');
  });
});
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run unit-tests/quick-import.spec.ts`
Expected: FAIL，模块不存在。

**Step 3: 写实现**

```ts
export interface GalleryMediaLite {
  identifier: string;
  data?: string;
  creationDate?: string;
}

export interface QuickPair {
  question: GalleryMediaLite;
  answer: GalleryMediaLite;
}

export function filterFreshMedias(medias: GalleryMediaLite[], importedIds: Set<string>): GalleryMediaLite[] {
  return (medias || []).filter((m) => m && m.identifier && !importedIds.has(m.identifier));
}

export function countFreshMedias(medias: GalleryMediaLite[], importedIds: Set<string>): number {
  return filterFreshMedias(medias, importedIds).length;
}

export function pickQuestionAnswerPair(medias: GalleryMediaLite[], importedIds: Set<string>): QuickPair | null {
  const fresh = filterFreshMedias(medias, importedIds);
  if (fresh.length < 2) return null;
  return { answer: fresh[0], question: fresh[1] };
}

const IMPORTED_KEY = 'quickImportImportedIds';
const IMPORTED_LIMIT = 200;

export function loadImportedIds(): string[] {
  const raw = localStorage.getItem(IMPORTED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function markImportedIds(ids: string[]): void {
  const merged = [...new Set([...ids, ...loadImportedIds()])].slice(0, IMPORTED_LIMIT);
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(merged));
}

export function clearImportedIds(): void {
  localStorage.removeItem(IMPORTED_KEY);
}

export interface QuickCreateArgs {
  questionImageUrl: string;
  answerImageUrl: string | null;
  tagIds: string[];
  layoutType: number;
  blankImageUrl: string | null;
  versions: string[];
  bookInfo: null;
}

export function buildQuickCreateArgs(
  questionImageUrl: string,
  answerImageUrl: string | null,
  tagIds: string[],
  comboVersionIds: string[],
  layoutType: number
): QuickCreateArgs {
  return {
    questionImageUrl,
    answerImageUrl,
    tagIds: [...tagIds],
    layoutType: layoutType === 0 ? 0 : 1,
    blankImageUrl: null,
    versions: [...comboVersionIds],
    bookInfo: null,
  };
}

const LAYOUT_KEY = 'quickImportLayoutType';

export function loadQuickLayoutType(): number {
  return localStorage.getItem(LAYOUT_KEY) === '0' ? 0 : 1;
}

export function saveQuickLayoutType(layoutType: number): void {
  localStorage.setItem(LAYOUT_KEY, layoutType === 0 ? '0' : '1');
}

export function toggleLayoutType(current: number): number {
  return current === 0 ? 1 : 0;
}

export function layoutLabel(layoutType: number): string {
  return layoutType === 0 ? '📐 仅适合单栏' : '📏 单双栏均可';
}
```

**Step 4: 跑测试确认通过**

Run: `npx vitest run unit-tests/quick-import.spec.ts`
Expected: PASS（21 个用例：Task 1 的 6 个 + 本 Task 的 15 个）。

**Step 5: Commit**

```bash
git add src/services/quick-import.ts unit-tests/quick-import.spec.ts
git commit -m "快速导入题目 - 新增照片配对与已导入指纹逻辑"
```

---

## Task 3: 抽出相册原图获取函数（camera.ts 重构）

**Files:**
- Modify: `src/ui/camera.ts:111-203`

**Step 1: 在 `loadGalleryThumbnails` 之前插入两个新导出函数**

```ts
export async function fetchLatestMedias(quantity = 6): Promise<any[] | null> {
  const { isNative, MediaPlugin } = nativeFlags();
  if (!isNative || !MediaPlugin) return null;
  const result = await MediaPlugin.getMedias({
    quantity,
    thumbnailWidth: 240,
    thumbnailHeight: 240,
    thumbnailQuality: 70,
    types: 'photos',
  });
  return result?.medias ?? [];
}

export async function getGalleryImageDataUrl(identifier: string): Promise<string> {
  const MediaPlugin = w.MediaPlugin;
  if (typeof MediaPlugin?.getFullImage === 'function'
    && (identifier.startsWith('content://') || identifier.startsWith('file://')
      || (!identifier.startsWith('/') && !identifier.match(/^[A-Z]:\\/)))) {
    const result = await MediaPlugin.getFullImage({ identifier });
    const mime = result.mimeType || 'image/jpeg';
    return 'data:' + mime + ';base64,' + result.data;
  }
  if (w.Capacitor && w.Capacitor.getPlatform && w.Capacitor.getPlatform() === 'ios' && MediaPlugin.getMediaByIdentifier) {
    const pathResult = await MediaPlugin.getMediaByIdentifier({ identifier });
    const FS = w.Capacitor?.Plugins?.Filesystem;
    if (!FS) throw new Error('文件系统不可用');
    const fileResult = await FS.readFile({ path: pathResult.path });
    return fileResult.data.startsWith('data:') ? fileResult.data : 'data:image/jpeg;base64,' + fileResult.data;
  }
  const FS = w.Capacitor?.Plugins?.Filesystem;
  if (!FS) throw new Error('文件系统不可用');
  const fileResult = await FS.readFile({ path: identifier });
  return fileResult.data.startsWith('data:') ? fileResult.data : 'data:image/jpeg;base64,' + fileResult.data;
}
```

**Step 2: 把 `galleryThumbClick` 第 166-197 行的三条分支替换成调用新函数**

```ts
  try {
    const dataUrl = await getGalleryImageDataUrl(identifier);
    _handleImageReady(target, dataUrl);
    w.showStatus('已导入' + label + '图片', 'success');
  } catch (e: any) {
```

**Step 3: 编译 + 回归**

Run: `npm run typecheck && npx vitest run`

**Step 4: Commit**

```bash
git add src/ui/camera.ts
git commit -m "快速导入题目 - 抽出 fetchLatestMedias 与 getGalleryImageDataUrl 供复用"
```

---

## Task 4: 顶部悬浮条与开关按钮（HTML）

**Files:**
- Modify: `src/index.html:38-44`（toolbar）、`src/index.html:18-19`（body 内、container 前）

**Step 1: toolbar 加开关按钮**（在第 43 行 `floating-toggle-btn` 之后插入）

```html
        <button id="quick-import-toggle" class="btn-grape" onclick="toggleQuickImportMode()">⚡ 快速导入</button>
```

**Step 2: 在 `<div class="container">`（第 19 行）**之前**插入悬浮条**（必须是 body 直接子元素，避免被 header 的 `overflow:hidden` 裁剪）

```html
<div id="quick-import-bar" style="display:none;position:fixed;top:0;left:0;right:0;z-index:1200;background:var(--surface);border-bottom:2px solid var(--primary);box-shadow:0 4px 16px rgba(0,0,0,.18);padding:8px 12px calc(8px + env(safe-area-inset-top)) 12px;padding-top:calc(8px + env(safe-area-inset-top))">
    <div style="display:flex;align-items:center;gap:8px">
        <div style="position:relative;flex-shrink:0">
            <img id="qi-thumb-question" alt="题目" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:2px solid var(--primary);background:var(--surface-2)">
            <span style="position:absolute;top:-6px;left:-6px;background:var(--primary);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:8px">题</span>
        </div>
        <div style="position:relative;flex-shrink:0">
            <img id="qi-thumb-answer" alt="答案" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:2px solid var(--accent);background:var(--surface-2)">
            <span style="position:absolute;top:-6px;left:-6px;background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:8px">答</span>
        </div>
        <button type="button" onclick="swapQuickPair()" style="flex-shrink:0;width:32px;height:32px;border-radius:50%;border:1.5px solid var(--border);background:var(--surface);font-size:15px;cursor:pointer" title="交换题目与答案">⇄</button>
        <div id="qi-tags" style="flex:1;min-width:0;display:flex;align-items:center;gap:4px;overflow-x:auto;padding:2px 0;font-size:11px"></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
        <input id="qi-tag-input" type="text" placeholder="🏷 搜索或新建标签，回车确认" autocomplete="off"
            style="flex:1;min-width:0;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px;background:var(--surface);color:var(--text)">
        <button type="button" id="qi-combo-btn" onclick="openComboPanel()" style="flex-shrink:0;padding:7px 8px;border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--surface);font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer">组合 ▾</button>
        <button type="button" id="qi-layout-btn" onclick="toggleQuickLayout()" style="flex-shrink:0;padding:7px 8px;border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--surface);font-size:12px;cursor:pointer;white-space:nowrap" title="点击在单栏/双栏间切换，会记住上次选择">📏 单双栏</button>
        <button type="button" id="qi-confirm-btn" onclick="confirmQuickImport()" style="flex-shrink:0;padding:7px 14px;border:none;border-radius:var(--radius-md);background:var(--primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer">✅ 确认</button>
    </div>
    <div id="qi-hint" style="margin-top:6px;font-size:11px;color:var(--text-secondary)"></div>
    <div id="qi-tag-results" style="display:none;flex-wrap:wrap;align-content:flex-start;gap:6px;padding:6px;max-height:140px;overflow-y:auto;margin-top:6px;border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--surface)"></div>
</div>
```

**Step 3: 在 body 末尾（`</body>` 前）插入组合面板容器**

```html
<div id="quick-combo-panel" style="display:none;position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45)" onclick="closeComboPanel()">
    <div onclick="event.stopPropagation()" style="position:absolute;left:12px;right:12px;top:calc(84px + env(safe-area-inset-top));max-height:70vh;overflow-y:auto;background:var(--surface);border-radius:var(--radius-lg);padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.28)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span style="font-size:15px;font-weight:700">版本组合</span>
            <button type="button" onclick="closeComboPanel()" style="border:none;background:transparent;font-size:20px;cursor:pointer;color:var(--text-secondary)">×</button>
        </div>
        <div id="qi-combo-list"></div>
        <div style="display:flex;gap:6px;margin-top:12px">
            <input id="qi-combo-name" type="text" placeholder="新组合名称" autocomplete="off" style="flex:1;min-width:0;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px;background:var(--surface);color:var(--text)">
            <button type="button" onclick="createComboFromPanel()" style="padding:8px 12px;border:none;border-radius:var(--radius-md);background:var(--primary);color:#fff;font-size:13px;font-weight:600;cursor:pointer">＋ 新建</button>
        </div>
        <p style="margin-top:10px;font-size:11px;color:var(--text-tertiary);line-height:1.5">顶部条只显示组合摘要，完整的版本列表仍在「添加题目」表单的「版本」区域。</p>
    </div>
</div>
```

**Step 4: Commit**

```bash
git add src/index.html
git commit -m "快速导入题目 - 顶部悬浮确认条与组合面板 HTML 骨架"
```

---

## Task 5: 核心 UI 模块（模式开关 + 拉图 + 渲染）

**Files:**
- Create: `src/ui/quick-import.ts`

**Step 1: 写模块骨架（模式开关 + 渲染 + 拉图）**

```ts
import { fetchLatestMedias, getGalleryImageDataUrl } from './camera';
import { showStatus } from './common';
import {
  pickQuestionAnswerPair, countFreshMedias, loadImportedIds, markImportedIds,
  buildQuickCreateArgs, loadQuickLayoutType, saveQuickLayoutType, toggleLayoutType,
  layoutLabel, type GalleryMediaLite, type QuickPair,
} from '../services/quick-import';
import {
  resolveActiveCombo, comboVersionNames, getComboById, getActiveComboId,
} from '../services/version-combo';

const w = window as unknown as Record<string, any>;
const MODE_KEY = 'quickImportMode';
const FETCH_COUNT = 6;

let quickMode = false;
let pair: QuickPair | null = null;
let questionThumb = '';
let answerThumb = '';
let quickTagIds: string[] = [];
let loading = false;
let lastFetchAt = 0;
let tagPollTimer: number | null = null;
let lastTagInputValue = '';

function bar(): HTMLElement | null { return document.getElementById('quick-import-bar'); }

export function isQuickMode(): boolean { return quickMode; }

export function toggleQuickImportMode(): void {
  quickMode = !quickMode;
  localStorage.setItem(MODE_KEY, quickMode ? '1' : '0');
  const btn = document.getElementById('quick-import-toggle');
  if (btn) btn.style.background = quickMode ? 'var(--primary)' : '';
  renderQuickImportBar();
  if (quickMode) void refreshGalleryPair();
  showStatus(quickMode ? '快速导入已开启' : '快速导入已关闭', 'success');
}

export async function refreshGalleryPair(): Promise<void> {
  if (!quickMode || loading) return;
  const now = Date.now();
  if (now - lastFetchAt < 3000) return;
  lastFetchAt = now;
  loading = true;
  renderHint('正在读取相册...');
  try {
    const medias = await fetchLatestMedias(FETCH_COUNT);
    if (!medias) { renderHint('当前不是原生环境，快速导入需要相册权限'); pair = null; render(); return; }
    pair = pickQuestionAnswerPair(medias as GalleryMediaLite[], new Set(loadImportedIds()));
    if (!pair) {
      const fresh = countFreshMedias(medias as GalleryMediaLite[], new Set(loadImportedIds()));
      renderHint(fresh === 1 ? '只检测到 1 张新照片，请再拍一张后返回' : '相册没有新照片，拍两张后切回本 App');
    } else {
      questionThumb = thumbOf(pair.question);
      answerThumb = thumbOf(pair.answer);
      renderHint('');
    }
  } catch (e: any) {
    renderHint('相册读取失败：' + (e?.message || e));
    pair = null;
  } finally {
    loading = false;
    render();
  }
}

function thumbOf(m: GalleryMediaLite): string {
  if (!m?.data) return '';
  return m.data.startsWith('data:') ? m.data : 'data:image/jpeg;base64,' + m.data;
}

function renderHint(text: string): void {
  const el = document.getElementById('qi-hint');
  if (el) el.textContent = text;
}

export function swapQuickPair(): void {
  if (!pair) return;
  pair = { question: pair.answer, answer: pair.question };
  const t = questionThumb; questionThumb = answerThumb; answerThumb = t;
  render();
}
```

**Step 2: 写渲染 `render()` + 确认建题**

> **顺序约定（踩过坑）**：`markImportedIds(idsOldestFirst)` 要求入参**按时间正序（旧→新）**，
> 函数内部会 reverse 成「最新在前」再存。所以必须传
> `[pair.question.identifier, pair.answer.identifier]`——题目先拍（旧）、答案后拍（新）。
> 传反了不会报错，但淘汰策略会先丢新图。

```ts
function render(): void {
  const el = bar();
  if (!el) return;
  el.style.display = quickMode ? '' : 'none';
  document.body.style.paddingTop = quickMode ? '150px' : '';
  if (!quickMode) return;

  const q = document.getElementById('qi-thumb-question') as HTMLImageElement | null;
  const a = document.getElementById('qi-thumb-answer') as HTMLImageElement | null;
  if (q) q.src = questionThumb;
  if (a) a.src = answerThumb;

  const tagBox = document.getElementById('qi-tags');
  if (tagBox) {
    const names = quickTagIds.map((id) => (w.allTags || []).find((t: any) => t.id === id)?.name).filter(Boolean);
    tagBox.textContent = names.length ? '🏷 ' + names.join('、') : '（未选标签）';
  }

  const comboBtn = document.getElementById('qi-combo-btn');
  if (comboBtn) {
    const combo = getComboById(getActiveComboId());
    const names = comboVersionNames(combo, (id) => w.getAppVersions?.().find((v: any) => v.id === id)?.name ?? null);
    comboBtn.textContent = (combo?.name || '组合') + (names.length ? '：' + names.join('+') : '') + ' ▾';
  }

  const layoutBtn = document.getElementById('qi-layout-btn');
  if (layoutBtn) layoutBtn.textContent = layoutLabel(loadQuickLayoutType());

  const confirmBtn = document.getElementById('qi-confirm-btn') as HTMLButtonElement | null;
  if (confirmBtn) {
    confirmBtn.disabled = !pair;
    confirmBtn.style.opacity = pair ? '1' : '.45';
  }
}

export async function confirmQuickImport(): Promise<void> {
  if (!pair || loading) return;
  const combo = resolveActiveCombo(() => (w.getAppVersions?.() || []).map((v: any) => v.id));
  const ids = [pair.question.identifier, pair.answer.identifier];
  loading = true;
  renderHint('正在导入...');
  try {
    const qUrl = await compress(await getGalleryImageDataUrl(pair.question.identifier));
    const aUrl = await compress(await getGalleryImageDataUrl(pair.answer.identifier));
    const args = buildQuickCreateArgs(qUrl, aUrl, quickTagIds, combo.versionIds, loadQuickLayoutType());
    const created = await w.dbCreateQuestion(
      args.questionImageUrl, args.answerImageUrl, args.tagIds,
      args.layoutType, args.blankImageUrl, args.versions, args.bookInfo
    );
    if (created?.question_image_url) {
      await w.dbAddQuestionNote(created.id, created.question_image_url, '笔记 v1', '');
    }
    markImportedIds(ids);
    quickTagIds = [];
    pair = null; questionThumb = ''; answerThumb = '';
    showStatus('题目已导入', 'success');
    await Promise.resolve(w.loadQuestions?.());
    await Promise.resolve(w.loadBookFilter?.());
  } catch (e: any) {
    showStatus('导入失败：' + (e?.message || e), 'error');
  } finally {
    loading = false;
    lastFetchAt = 0;
    render();
    void refreshGalleryPair();
  }
}

async function compress(dataUrl: string): Promise<string> {
  const fn = w.compressImage as ((i: string, m?: number, q?: number) => Promise<string>) | undefined;
  return fn ? fn(dataUrl, 1200, 0.8) : dataUrl;
}
```

**Step 3: Commit**

```bash
git add src/ui/quick-import.ts
git commit -m "快速导入题目 - 核心 UI：模式开关、相册配对渲染、确认建题"
```

---

## Task 6: 顶部标签输入（对齐 `tag-manage.ts`）

**Files:**
- Modify: `src/ui/quick-import.ts`（追加）

逐项对齐 `src/ui/tag-manage.ts:58-163` 的表单标签选择器，保证顶部条手感和原有标签输入完全一致：

| 行为 | 对齐方式 |
|---|---|
| 搜索过滤 | 子串匹配、排除已选、`slice(0, 50)`（`tag-manage.ts:63-65`） |
| 候选样式 | 圆角 chip + 标签颜色小圆点（`:84-89`） |
| 无匹配时 | 「＋ 创建: "xxx"」chip（`:67-80`） |
| 回车 | 点第一个候选；无候选时命中「创建」（`:118-125`） |
| 已选展示 | chip + ✕ 点击移除（`:151-163`） |
| IME 兼容 | 150ms 轮询补偿（`:18-25`） |
| **不做** | 长按 500ms 进管理模式删标签库——属标签库维护，按「完整信息留在原处」原则留在标签管理 Tab |

**Step 1: 替换 `render()` 里的标签渲染段落**（Task 5 先用了纯文本占位，这里换成 chip 版本）

把

```ts
  const tagBox = document.getElementById('qi-tags');
  if (tagBox) {
    const names = quickTagIds.map((id) => (w.allTags || []).find((t: any) => t.id === id)?.name).filter(Boolean);
    tagBox.textContent = names.length ? '🏷 ' + names.join('、') : '（未选标签）';
  }
```

替换为

```ts
  renderQuickSelectedTags();
```

**Step 2: 追加标签相关函数**

```ts
export function onQuickTagInput(): void {
  const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  const box = document.getElementById('qi-tag-results');
  if (!input || !box) return;
  const query = input.value.trim().toLowerCase();
  const all: any[] = w.allTags || [];
  let matches = all.filter((t: any) => !quickTagIds.includes(t.id));
  if (query) matches = matches.filter((t: any) => t.name.toLowerCase().includes(query));
  matches = matches.slice(0, 50);

  box.innerHTML = '';
  if (matches.length === 0 && !query) { box.style.display = 'none'; return; }
  box.style.display = 'flex';

  if (matches.length === 0) {
    box.appendChild(createTagChip(input.value.trim()));
    return;
  }
  for (const t of matches) box.appendChild(tagCandidateChip(t, input));
}

function tagCandidateChip(tag: any, input: HTMLInputElement): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:var(--surface-dim);border:1px solid var(--border-light);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;flex-shrink:0';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + tag.color + ';flex-shrink:0';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = tag.name;
  btn.append(dot, nameSpan);
  btn.onclick = () => { addQuickTag(tag.id); input.value = ''; onQuickTagInput(); };
  return btn;
}

function createTagChip(name: string): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.style.cssText = 'display:inline-flex;align-items:center;padding:5px 10px;background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;color:var(--accent);flex-shrink:0';
  btn.textContent = '＋ 创建: "' + name + '"';
  btn.onclick = () => void createQuickTag(name);
  return btn;
}

export function addQuickTag(id: string): void {
  if (quickTagIds.includes(id)) return;
  quickTagIds.push(id);
  render();
}

export function removeQuickTag(id: string): void {
  quickTagIds = quickTagIds.filter((x) => x !== id);
  render();
  onQuickTagInput();
}

export async function createQuickTag(name: string): Promise<void> {
  const trimmed = (name || '').trim();
  if (!trimmed) { showStatus('请输入标签名', 'error'); return; }
  let tag = (w.allTags || []).find((t: any) => t.name === trimmed);
  if (!tag) {
    tag = await w.dbCreateTag(trimmed, '#4CC3FF');
    await Promise.resolve(w.loadTags?.());
  }
  if (tag?.id) addQuickTag(tag.id);
  const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  if (input) input.value = '';
  onQuickTagInput();
  showStatus('已添加标签: ' + trimmed, 'success');
}

export function onQuickTagKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const box = document.getElementById('qi-tag-results');
  const first = box ? box.querySelector('span') : null;
  if (first) (first as HTMLElement).click();
}

export function renderQuickSelectedTags(): void {
  const div = document.getElementById('qi-tags');
  if (!div) return;
  div.innerHTML = '';
  if (quickTagIds.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:11px;color:var(--text-tertiary);flex-shrink:0';
    empty.textContent = '（未选标签）';
    div.appendChild(empty);
    return;
  }
  quickTagIds.forEach((tagId) => {
    const tag = (w.allTags || []).find((t: any) => t.id === tagId);
    if (!tag) return;
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:' + tag.color + '15;border:1px solid ' + tag.color + '40;border-radius:var(--radius-xl);font-size:11px;font-weight:500;color:var(--text);white-space:nowrap;flex-shrink:0';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + tag.color + ';flex-shrink:0';
    const name = document.createElement('span');
    name.textContent = tag.name;
    const rm = document.createElement('span');
    rm.textContent = '✕';
    rm.style.cssText = 'cursor:pointer;color:var(--text-tertiary);margin-left:2px';
    rm.onclick = () => removeQuickTag(tag.id);
    el.append(dot, name, rm);
    div.appendChild(el);
  });
}

export function startQuickTagPoll(): void {
  stopQuickTagPoll();
  lastTagInputValue = (document.getElementById('qi-tag-input') as HTMLInputElement | null)?.value || '';
  tagPollTimer = window.setInterval(() => {
    const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
    if (!input) return;
    if (input.value !== lastTagInputValue) { lastTagInputValue = input.value; onQuickTagInput(); }
  }, 150);
}

export function stopQuickTagPoll(): void {
  if (tagPollTimer !== null) { clearInterval(tagPollTimer); tagPollTimer = null; }
}
```

**Step 3: 在 `render()` 末尾追加事件绑定（只绑一次，用 dataset 标记）**

```ts
  const tagInput = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  if (tagInput && !tagInput.dataset.qiBound) {
    tagInput.dataset.qiBound = '1';
    tagInput.addEventListener('input', onQuickTagInput);
    tagInput.addEventListener('focus', startQuickTagPoll);
    tagInput.addEventListener('blur', () => { stopQuickTagPoll(); });
    tagInput.addEventListener('keydown', onQuickTagKeydown);
  }
```

**Step 4: Commit**

```bash
git add src/ui/quick-import.ts
git commit -m "快速导入题目 - 顶部条标签输入，交互对齐原标签模块"
```

---

## Task 7: 版本组合面板

**Files:**
- Modify: `src/ui/quick-import.ts`（追加）

**Step 1: 追加面板逻辑**

```ts
export function openComboPanel(): void {
  const panel = document.getElementById('quick-combo-panel');
  if (!panel) return;
  panel.style.display = '';
  renderComboList();
}

export function closeComboPanel(): void {
  const panel = document.getElementById('quick-combo-panel');
  if (panel) panel.style.display = 'none';
}

export function renderComboList(): void {
  const list = document.getElementById('qi-combo-list');
  if (!list) return;
  const combos = w.loadVersionCombos?.() || [];
  const activeId = getActiveComboId();
  list.innerHTML = '';
  if (combos.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size:12px;color:var(--text-tertiary);margin:0 0 8px';
    empty.textContent = '还没有组合，下面输入名称新建一个。';
    list.appendChild(empty);
  }
  for (const c of combos) {
    list.appendChild(comboRow(c, c.id === activeId));
  }
}

function comboRow(combo: any, active: boolean): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = 'padding:10px;border:1.5px solid ' + (active ? 'var(--primary)' : 'var(--border)')
    + ';border-radius:var(--radius-md);margin-bottom:8px;background:' + (active ? 'var(--primary-light)' : 'var(--surface)');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px';

  const title = document.createElement('span');
  title.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:700;cursor:pointer';
  title.textContent = (active ? '✅ ' : '') + combo.name;
  title.onclick = () => { w.setActiveComboId(combo.id); renderComboList(); render(); };

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.textContent = '✏️';
  rename.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px';
  rename.onclick = () => {
    const next = prompt('组合名称', combo.name);
    if (next && next.trim()) { w.updateVersionCombo(combo.id, { name: next.trim() }); renderComboList(); render(); }
  };

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = '🗑';
  del.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px';
  del.onclick = () => { if (confirm('删除组合「' + combo.name + '」？')) { w.deleteVersionCombo(combo.id); renderComboList(); render(); } };

  head.append(title, rename, del);

  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
  for (const v of w.getAppVersions?.() || []) {
    chips.appendChild(versionChip(combo, v));
  }

  row.append(head, chips);
  return row;
}

function versionChip(combo: any, version: any): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 9px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:12px;cursor:pointer;background:var(--surface)';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = combo.versionIds.includes(version.id);
  cb.style.cssText = 'accent-color:' + version.theme?.primary + ';width:15px;height:15px;cursor:pointer';
  const span = document.createElement('span');
  span.textContent = version.emoji + ' ' + version.name;
  const updateStyle = () => {
    wrap.style.background = cb.checked ? version.theme.primary + '15' : 'var(--surface)';
    wrap.style.borderColor = cb.checked ? version.theme.primary : 'var(--border)';
  };
  const toggle = () => {
    const nextIds = cb.checked
      ? [...new Set([...combo.versionIds, version.id])]
      : combo.versionIds.filter((id: string) => id !== version.id);
    w.updateVersionCombo(combo.id, { versionIds: nextIds });
    combo.versionIds = nextIds;
    updateStyle();
    render();
  };
  cb.onchange = toggle;
  wrap.onclick = (e) => { if (e.target === cb) return; cb.checked = !cb.checked; toggle(); };
  updateStyle();
  wrap.append(cb, span);
  return wrap;
}

export function createComboFromPanel(): void {
  const input = document.getElementById('qi-combo-name') as HTMLInputElement | null;
  const name = input?.value.trim();
  if (!name) { showStatus('请输入组合名称', 'error'); return; }
  const combo = w.createVersionCombo(name, [w.getCurrentVersionId?.()].filter(Boolean));
  w.setActiveComboId(combo.id);
  if (input) input.value = '';
  renderComboList();
  render();
  showStatus('已创建' + combo.name, 'success');
}
```

**Step 2: 追加栏数切换（顶部条 ⇄ 表单 radio 同步）**

```ts
export function toggleQuickLayout(): void {
  const next = toggleLayoutType(loadQuickLayoutType());
  saveQuickLayoutType(next);
  syncFormLayoutRadio(next);
  render();
  showStatus('已设为' + (next === 1 ? '单双栏均可' : '仅适合单栏'), 'success');
}

function syncFormLayoutRadio(layoutType: number): void {
  const radio = document.querySelector('input[name="layout_type"][value="' + layoutType + '"]') as HTMLInputElement | null;
  if (!radio) return;
  radio.checked = true;
  const option = radio.closest('.layout-option') as HTMLElement | null;
  if (option && typeof w.selectLayout === 'function') w.selectLayout(option, String(layoutType));
}
```

`selectLayout` 定义在 `src/ui/platform.ts:21-28`，第二个参数虽未使用但类型是 `string`，所以传 `String(layoutType)`。

**Step 3: Commit**

```bash
git add src/ui/quick-import.ts
git commit -m "快速导入题目 - 版本组合面板：增删改与版本勾选"
```

---

## Task 8: 切回前台自动刷新

**Files:**
- Modify: `src/ui/quick-import.ts`（追加）

**Step 1: 追加初始化与生命周期监听**

```ts
export function initQuickImportMode(): void {
  quickMode = localStorage.getItem(MODE_KEY) === '1';
  const btn = document.getElementById('quick-import-toggle');
  if (btn) btn.style.background = quickMode ? 'var(--primary)' : '';
  syncFormLayoutRadio(loadQuickLayoutType());
  renderQuickImportBar();

  const onForeground = () => {
    if (!quickMode) return;
    lastFetchAt = 0;
    void refreshGalleryPair();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onForeground(); });
  window.addEventListener('focus', onForeground);
  window.addEventListener('pageshow', onForeground);
  if (quickMode) void refreshGalleryPair();
}

export function renderQuickImportBar(): void { render(); }
```

**Step 2: 在 `render()` 里同步开关按钮样式（已包含在 init 与 toggle 中，无需额外改动）**

**Step 3: Commit**

```bash
git add src/ui/quick-import.ts
git commit -m "快速导入题目 - 切回前台自动刷新相册"
```

---

## Task 9: 三处接线

**Files:**
- Modify: `src/ui/index.ts:29`（camera 之后）
- Modify: `src/main.ts:636`（`assignToWindow` 结束前）
- Modify: `src/init-app.ts:81`（`initApp()` 末尾）

**Step 1: `src/ui/index.ts` 追加**

```ts
export * from './quick-import';
```

**Step 2: `src/main.ts` 的 `assignToWindow({...})` 内追加（第 635 行 `retryPendingFeedback` 之后）**

```ts
  toggleQuickImportMode: ui.toggleQuickImportMode,
  confirmQuickImport: ui.confirmQuickImport,
  refreshGalleryPair: ui.refreshGalleryPair,
  swapQuickPair: ui.swapQuickPair,
  openComboPanel: ui.openComboPanel,
  closeComboPanel: ui.closeComboPanel,
  renderComboList: ui.renderComboList,
  createComboFromPanel: ui.createComboFromPanel,
  toggleQuickLayout: ui.toggleQuickLayout,
  loadVersionCombos: services.loadVersionCombos,
  saveVersionCombos: services.saveVersionCombos,
  createVersionCombo: services.createVersionCombo,
  updateVersionCombo: services.updateVersionCombo,
  deleteVersionCombo: services.deleteVersionCombo,
  getActiveComboId: services.getActiveComboId,
  setActiveComboId: services.setActiveComboId,
  getCurrentVersionId: services.getCurrentVersionId,
  getAppVersions: services.getAppVersions,
```

**Step 3: 在 `src/main.ts` 末尾（第 658 行 `initIssueFeedbackListener()` 之后）追加服务层别名**

```ts
assignToWindow({
  initQuickImportMode: ui.initQuickImportMode,
});
```

**Step 4: `src/init-app.ts` 的 `initApp()` 末尾追加**

```ts
  ui.initQuickImportMode();
```

**Step 5: 编译**

Run: `npm run typecheck`
Expected: 0 errors。

**Step 6: Commit**

```bash
git add src/ui/index.ts src/main.ts src/init-app.ts
git commit -m "快速导入题目 - 模块接线与启动初始化"
```

---

## Task 10: E2E 测试

**Files:**
- Modify: `tests/ui-health.spec.js`

> **账号隔离硬约束（见 `docs/e2e-test-account.md`）**：本项目 E2E 一律使用 `.env` 里的
> `E2E_TEST_PHONE`（默认 19000000001），**禁止使用主账号**。历史上测试标签曾同步到用户手机，
> 2026-08-28 才清理掉 12 个。
>
> 本 Task 的三个用例**完全不碰服务端**：不登录、不调接口、不触发同步，只操作 localStorage
> 与本地 IndexedDB。Playwright 每次运行生成独立 `userDataDir`（`playwright.config.js`），
> IndexedDB 为空 → `initApp` 里的 `if (w.currentUser && w.autoSyncEnabled) queueAutoSync(true)`
> 不会被触发。
>
> 实现时若发现需要登录态，**只能**用 `E2E_TEST_PHONE`，且跑之前先执行
> `cd server && node scripts/e2e-account-reset.mjs` 重置测试账号快照。

**Step 1: 追加用例**

```js
test('快速导入模式开关与顶部条', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('quickImportMode', '0'));
  await page.reload();
  await expect(page.locator('#quick-import-toggle')).toBeVisible();
  await expect(page.locator('#quick-import-bar')).toBeHidden();

  await page.click('#quick-import-toggle');
  await expect(page.locator('#quick-import-bar')).toBeVisible();
  await expect(page.locator('#qi-confirm-btn')).toBeDisabled();
  await expect(page.locator('#qi-hint')).toContainText('不是原生环境');
});

test('版本组合可创建并显示在顶部条', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  await page.click('#qi-combo-btn');
  await expect(page.locator('#quick-combo-panel')).toBeVisible();
  await page.fill('#qi-combo-name', '组合一');
  await page.click('text=＋ 新建');
  await expect(page.locator('#qi-combo-btn')).toContainText('组合一');
  await page.click('#quick-combo-panel', { position: { x: 5, y: 5 } });
  await expect(page.locator('#quick-combo-panel')).toBeHidden();
});

test('顶部标签输入与已选 chip', async ({ page }) => {
  await page.evaluate(async () => {
    localStorage.setItem('quickImportMode', '1');
    await window.dbCreateTag('函数', '#4CC3FF');
  });
  await page.reload();
  await expect(page.locator('#quick-import-bar')).toBeVisible();

  await page.fill('#qi-tag-input', '函');
  await expect(page.locator('#qi-tag-results')).toBeVisible();
  await page.locator('#qi-tag-results span').first().click();
  await expect(page.locator('#qi-tags')).toContainText('函数');

  await page.fill('#qi-tag-input', '全新标签XYZ');
  await page.press('#qi-tag-input', 'Enter');
  await expect(page.locator('#qi-tags')).toContainText('全新标签XYZ');

  await page.locator('#qi-tags > span').first().locator('text=✕').click();
  await expect(page.locator('#qi-tags')).not.toContainText('函数');
});

test('顶部栏数可切换、同步表单并持久化', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  await expect(page.locator('#qi-layout-btn')).toContainText('单双栏均可');

  await page.click('#qi-layout-btn');
  await expect(page.locator('#qi-layout-btn')).toContainText('仅适合单栏');
  await expect(page.locator('input[name="layout_type"][value="0"]')).toBeChecked();

  await page.reload();
  await expect(page.locator('#qi-layout-btn')).toContainText('仅适合单栏');
});

test('组合与栏数设置不被清空', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('quickImportMode', '1');
    localStorage.setItem('quickImportLayoutType', '0');
  });
  await page.reload();
  await page.click('#qi-combo-btn');
  await page.fill('#qi-combo-name', '组合一');
  await page.click('text=＋ 新建');
  await page.click('#quick-combo-panel', { position: { x: 5, y: 5 } });

  await page.reload();
  await expect(page.locator('#qi-combo-btn')).toContainText('组合一');
  await expect(page.locator('#qi-layout-btn')).toContainText('仅适合单栏');
  await expect(page.locator('#qi-tags')).toContainText('未选标签');
});
```

**Step 2: 跑 E2E**

Run: `npx playwright test tests/ui-health.spec.js`
Expected: PASS（含原有用例全绿）。

**Step 3: 跑完整 CI 循环**

Run: `npm run typecheck && npm run test && npm run build && npx playwright test tests/ui-health.spec.js`
Expected: 全部通过。

**Step 4: Commit**

```bash
git add tests/ui-health.spec.js
git commit -m "快速导入题目 - E2E 覆盖开关、组合面板与降级提示"
```

---

## Task 11: 开发文档与索引

**Files:**
- Create: `docs/quick-import-mode.md`
- Modify: `AGENTS.md`（功能设计文档表格追加一行）

**Step 1: 写文档**（含：需求背景、交互流程、数据流图、文件清单、默认值表、已知限制、测试方式）

默认值表必须写清三者的区别：

| 设置 | 存储键 | 默认 | 确认提交后 |
|---|---|---|---|
| 版本组合 | `activeVersionComboId` | 首次自动建「组合一」（含全部版本） | **保留** |
| 单双栏 | `quickImportLayoutType` | `1`（单双栏均可） | **保留** |
| 标签 | 无（内存） | 空 | **清空** |

并写明：栏数在顶部条切换时会同步表单原位置的 radio；E2E 严禁触碰主账号（见 Task 10 的隔离约束）。

**Step 2: AGENTS.md「功能设计文档」表格追加**

```markdown
| 快速导入题目模式 | 顶部悬浮确认条 + 相册最新两张自动配对（第1张=答案/第2张=题目）+ 版本组合 + 切回前台自动刷新 | docs/quick-import-mode.md | 2026-08-28 | 快速导入, 相册, 版本组合, UI |
```

**Step 3: Commit**

```bash
git add docs/quick-import-mode.md AGENTS.md
git commit -m "快速导入题目 - 开发文档与索引"
```

---

## 开放问题（实现前请确认，未确认则按下方默认执行）

1. **只检测到 1 张新照片时**：默认**不配对**，提示「请再拍一张后返回」，确认按钮禁用。若你更希望把它当题目图、答案留空，改 `pickQuestionAnswerPair` 返回单元素对即可。
2. **组合是否参与同步**：组合存 localStorage（与 `appVersions` 一致，**不随账号同步**）。若需要跨设备同步，需扩展 sync payload。
3. **顶部条高度**：约 150px，开启时给 `body` 加 `padding-top`。若在你的设备上遮挡过多，调 `render()` 里的数值。

**已确认、不再需要讨论**：确认后清空标签（用户选择）；顶部标签输入存在且对齐原标签模块。

## 验证清单（交给用户手动测试）

- [ ] 点「⚡ 快速导入」→ 顶部条出现，页面内容不被遮挡
- [ ] 切到相机拍两张（先题目、后答案）→ 切回 App → 自动出现两张缩略图，题/答标识正确
- [ ] 顺序反了 → 点「⇄」交换
- [ ] 在顶部输标签 → 候选 chip 带颜色点出现 → 点芯片选中，显示在第一行
- [ ] 输不存在的标签名 → 出现「＋ 创建: "xxx"」→ 回车直接创建并选中
- [ ] 输已有标签的前几个字 → 回车选中最匹配的那个（不会建重复标签）
- [ ] 点已选标签的 ✕ → 该标签移除，候选列表重新出现它
- [ ] 点「组合 ▾」→ 新建「组合一」→ 勾选版本 → 顶部条摘要更新
- [ ] 点「📏 单双栏」→ 在「单双栏均可 / 仅适合单栏」之间切换，下方表单的 radio 跟着变
- [ ] 完全关掉 App 再打开 → 组合、栏数还是上次选的，不用重选
- [ ] 点「✅ 确认」→ 题目列表 +1，图片/标签/版本/栏数正确
- [ ] 确认后 → **组合和栏数保持不变，只有标签被清空**，自动载入下一对照片
- [ ] 不拍新照片直接切回 → 提示「相册没有新照片」，不重复导入
- [ ] 关闭模式 → 顶部条消失，body padding 复原，表单原位置的版本勾选与单双栏仍可正常使用
- [ ] `npm run ship -- "快速导入题目模式"` 打包验证
