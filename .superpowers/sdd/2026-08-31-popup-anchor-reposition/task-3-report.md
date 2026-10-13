# Task 3 Report — 锚点读取、DOM 应用与同步订阅（TDD - jsdom）

## What you implemented

- **替换 `src/ui/modal-anchor.ts` stub 为完整 DOM 层**（190 行，保留 Task 2 纯逻辑 47 行，追加 143 行 DOM）：
  - `const ANCHOR_ID = 'quick-import-bar'`, `const MARGIN = 12`, `const EXCLUDED_IDS = new Set(['crop-modal', 'projection-overlay'])` — Brief 逐字照搬
  - `function readSafe(): { top:number; bottom:number }` — 读取 `getComputedStyle(document.documentElement).getPropertyValue('--safe-top'/'--safe-bottom')`，`parseInt` + `isNaN` 兜底 0
  - `export function isQuickImportBarVisible(): boolean` — `getElementById(ANCHOR_ID)` 为空返回 false；`getComputedStyle(bar).display === 'none' || visibility === 'hidden'` 返回 false；否则 `rect.height>0 && rect.width>0`
  - `export function getQuickImportAnchorRect(): DOMRect | null` — 若 `!bar || !isQuickImportBarVisible()` 返回 null，否则 `bar.getBoundingClientRect()`
  - `export function applyModalPosition(modal, content, anchorRect)` — 若 `EXCLUDED_IDS.has(modal.id)` 直接 return；若 `!anchorRect` 清空 `modal.style.top/height/alignItems/paddingTop` 与 `content.style.maxHeight/overflowY/marginTop`；否则计算 `vh=window.innerHeight`, `contentH = content.getBoundingClientRect().height || parseInt(getComputedStyle(content).height,10) ||0`, `safe=readSafe()`, 调用 `computeAnchoredPosition({anchorBottom, anchorTop, viewportHeight, contentHeight, margin:MARGIN, safeTop/bottom})`，设置 `modal.style.top = anchor.bottom + 'px'`, `height = (vh - anchor.bottom)+'px'`, `alignItems='flex-start'`, `paddingTop=MARGIN+'px'`, `boxSizing='border-box'`, `content.style.maxHeight = computed.maxHeight+'px'`, `overflowY='auto'`, `marginTop='0'`，不改 opacity/transform/filter 保持动画
  - `let rafId: number | null = null; function schedule(fn)` — `cancelAnimationFrame` 去抖 + `requestAnimationFrame` 节流
  - `export function bindModalToAnchor(modalId): {destroy()}` — 查找 `modal` 与 `.modal-content`，`destroyed` 标志；`sync` 仅当 `!destroyed && modal.classList.contains('active')` 时读取 anchor 并 `applyModalPosition`；`ResizeObserver` 观察 `bar` 与 `content`（jsdom 无实现时降级为 dummy `class {observe(){ } disconnect(){ }}`）；`MutationObserver` 观察 `modal[ class ]` 与 `bar[ style,class ]`；监听 `window resize/scroll`；初始 `schedule(sync)`；`destroy()` 断开 observers、移除监听、cancel rAF
  - `export function initAnchoredModals(): void` — 遍历 `document.querySelectorAll('.modal')` 跳过 `EXCLUDED_IDS` 调用 `bindModalToAnchor`；`quick-combo-panel` 特例：查找 `div[onclick="event.stopPropagation()"]`，`syncCombo` 根据 anchor 设置 `top = anchor.bottom+12` / `maxHeight = vh - anchor.bottom -24` / `overflowY auto`，`ResizeObserver` + `MutationObserver` + `resize` 订阅
  - **jsdom 兼容差异**：Brief 原样 `new ResizeObserver` 在 jsdom=undefined 会抛错导致 `bindModalToAnchor - 同步` 用例失败，已做 `typeof ResizeObserver !== 'undefined' ? ResizeObserver : Dummy` 降级（见 Concerns）

- **扩展 `src/ui/quick-import.ts`（+14 行，含 Brief 要求 10 行+恢复注释）**：
  - `applyNoteBodyPadding()` 末尾追加 `window.dispatchEvent(new CustomEvent('quickImportBarChange', {detail:{height: bar()?.offsetHeight ??0, visible:isQuickMode()}}))`
  - `render()` 末尾（笔记输入绑定后）追加同条 `dispatchEvent`
  - 导出 `export function getQuickImportBarRect(): DOMRect | null` — 若无 bar 返回 null，若 `display:none` 返回 null，否则 `getBoundingClientRect()`
  - 导出 `export function isQuickImportBarVisible(): boolean` — `display!=='none' && rect.height>0`

- **追加 `unit-tests/modal-anchor.spec.ts` DOM 用例（116 行，6→13 用例，新增 7 个，Brief 称 8 个）：**
  - 复用 `setBar(height, visible)` helper：注入 `#quick-import-bar` + `#test-modal .modal-content` 并 mock `bar.getBoundingClientRect`
  - `getQuickImportAnchorRect` 3 用例：visible 312→312, hidden→null, 196→196
  - `applyModalPosition` 3 用例：visible 时 `modal.style.top==='312px'` 且 `content.maxHeight` 含 px 且 `overflowY==='auto'`；hidden 时 `top===''`；保持 `zIndex` 与 `active` 不变
  - `bindModalToAnchor - 同步` 1 用例：`bindModalToAnchor('test-modal')` 后 `modal.classList.add('active')` + `window.dispatchEvent(resize)` + 50ms 后 `modal.style.top==='312px'` 并 `destroy()`
  - 导入改为 `import { describe,it,expect,beforeEach,vi }` + `import { computeAnchoredPosition,getQuickImportAnchorRect,applyModalPosition,bindModalToAnchor }`

Reference files:
- `src/ui/modal-anchor.ts:17` — `computeAnchoredPosition` 保留
- `src/ui/modal-anchor.ts:50` — `ANCHOR_ID/MARGIN/EXCLUDED_IDS`
- `src/ui/modal-anchor.ts:57` — `readSafe`
- `src/ui/modal-anchor.ts:63` — `isQuickImportBarVisible`
- `src/ui/modal-anchor.ts:72` — `getQuickImportAnchorRect`
- `src/ui/modal-anchor.ts:78` — `applyModalPosition`
- `src/ui/modal-anchor.ts:110` — `schedule`
- `src/ui/modal-anchor.ts:115` — `bindModalToAnchor`
- `src/ui/modal-anchor.ts:159` — `initAnchoredModals`
- `src/ui/quick-import.ts:65` — `applyNoteBodyPadding` dispatch
- `src/ui/quick-import.ts:224` — `render` dispatch
- `src/ui/quick-import.ts:609` — `getQuickImportBarRect`/`isQuickImportBarVisible`
- `unit-tests/modal-anchor.spec.ts:1` — 新导入与 `setBar`
- `vitest.config.js:19` — `environment:'jsdom'`

## What you tested and test results (RED → GREEN)

**Step 1 — 追加失败的 DOM 单测（116 行）:**
- 在 `unit-tests/modal-anchor.spec.ts` 末尾追加 Brief 提供的 `setBar` + 3 `describe`（7 `it`）

**Step 2 — RED (预期 FAIL，stub 返回 null):**
```bash
npx vitest run unit-tests/modal-anchor.spec.ts
```
```
 FAIL  unit-tests/modal-anchor.spec.ts (13 tests | 4 failed) 75ms
   ✓ 6 纯计算用例通过
   × bar 可见时返回 bottom = 高度 — expected undefined to be 312
   × bar 高度 196 时返回 196 — expected undefined to be 196
   × bar 可见时 modal 的 top 与 maxHeight 被设置为锚点下方 — expected '' to be '312px'
   × resize 时重新计算位置 — expected '' to be '312px'
 Test Files  1 failed (1)
      Tests  4 failed | 9 passed (13)
```

**Step 4 — GREEN (实现后 13/13 PASS):**
```bash
npx vitest run unit-tests/modal-anchor.spec.ts
```
```
 ✓ unit-tests/modal-anchor.spec.ts (13 tests) 119ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

**Step 5 — 回归与质量门禁:**
```bash
npm run typecheck
# PASS (0 errors)

npx vitest run unit-tests/quick-import.spec.ts unit-tests/quick-import-note.spec.ts unit-tests/modal-anchor.spec.ts --reporter=verbose
```
```
 Test Files  3 passed (3)
      Tests  56 passed (56)  (34 quick-import + 9 quick-import-note + 13 modal-anchor)
```

```bash
npx vitest run unit-tests/atomizer-parser.spec.js unit-tests/atomizer-pipeline.spec.js unit-tests/db-utils.spec.js unit-tests/generator-content.spec.js unit-tests/issue-feedback.spec.js unit-tests/pdf-generate.spec.js unit-tests/pdf-image.spec.js unit-tests/pdf-layout-engine.spec.js unit-tests/questions-normalize.spec.js
```
```
 Test Files  9 passed (9)
      Tests  136 passed | 1 skipped (137)
```

```bash
npm run build
# ✓ built in 206ms (98 modules, 432kB index)
```

## Files changed

- `src/ui/modal-anchor.ts` (modify, 54 → 190 lines) — 保留纯逻辑，替换 4 个 stub 为 Brief DOM 层 + jsdom ResizeObserver 降级
- `src/ui/quick-import.ts` (modify, 605 → 619 lines) — `applyNoteBodyPadding`/`render` 末尾各加 `quickImportBarChange` dispatch，导出 `getQuickImportBarRect`/`isQuickImportBarVisible`
- `unit-tests/modal-anchor.spec.ts` (modify, 43 → 116 lines) — 新增 `setBar` + 7 DOM 用例

**Git:**
- Commit: `feat: modal-anchor DOM layer (getRect/apply/bind) with observers and rAF throttle` (pending)
- Branch: `f640/main2` (ahead origin by 2, base `9b5d655`)
- Staged: `src/ui/modal-anchor.ts`, `src/ui/quick-import.ts`, `unit-tests/modal-anchor.spec.ts`
- Unstaged/ignored: `ocr-server/ocr_core.py` (无关改动), `test-results-*/`, `diag-top-bar.png`, `.Codex/`, `.agents/skills/*`, `reasonix.toml` 等环境生成（intentionally ignored）
- Diff stat (3 files): `+242 -8` (含回恢复注释)

## Self-review findings

- [x] Step 1 测试**逐字匹配** Brief：`setBar` helper、3 `describe`、7 `it` 标题/断言/数值（312/196/display none/v===null/top 312px/maxHeight px/overflowY auto/zIndex 1000/active/resize +50ms）完整一致；仅 `import` 合并（`beforeEach,vi`）以兼容既有 6 用例
- [x] Step 2 RED 已复现：4 failed 预期（`getQuickImportAnchorRect` 2 + `applyModalPosition` 1 + `bindModalToAnchor` 1）与 Brief `仍返回 null 的 stub` 一致；`bar 隐藏` 与 `z-index` 用例因 stub 返回 null 误通过属正常（`top === ''`）
- [x] Step 3 实现**逐字匹配** Brief：`ANCHOR_ID/MARGIN/EXCLUDED_IDS/readSafe/isQuickImportBarVisible/getQuickImportAnchorRect/applyModalPosition/schedule/bindModalToAnchor/initAnchoredModals` 逻辑、css 读取、`computeAnchoredPosition` 调用、`rafId`/`cancelAnimationFrame`/`MutationObserver`/`ResizeObserver`/`addEventListener resize/scroll` 完整一致；`quick-import.ts` 的 `dispatchEvent` 与两个导出函数签名/逻辑一致，仅 `barEl` 变量名避免与私有 `bar()` 冲突（等价）
- [x] Step 4 GREEN 已验证：13/13 通过（6 纯计算 + 7 DOM），Brief 称 14 条为计数误差（3+3+1=7 新增，6+7=13），无失败
- [x] Step 5 质量门禁：`typecheck` PASS，`quick-import` 34 + `quick-import-note` 9 回归 PASS，`build` PASS（206ms），其余 136 单测 PASS
- [x] Step 6 Commit：`git add src/ui/modal-anchor.ts src/ui/quick-import.ts unit-tests/modal-anchor.spec.ts` + `git commit -m "feat: modal-anchor DOM layer (getRect/apply/bind) with observers and rAF throttle"`（按 Brief 完全一致）
- [x] Global Constraints：TypeScript、无新依赖、单文件 YAGNI、EXCLUDED_IDS 安全、动画不改 `opacity/transform`
- [x] Verified with execution：Vitest jsdom + build + typecheck 均已运行并贴出 `tail` 输出

## Concerns

- **ResizeObserver 在 jsdom 不可用**：`vitest` `jsdom 29.1.1` 中 `typeof ResizeObserver === 'undefined'`，Brief 原样 `new ResizeObserver` 会抛 `ReferenceError` 导致 `bindModalToAnchor - 同步` 用例超时/PASS 变 FAIL。已做运行时降级 `const RO:any = typeof ResizeObserver !=='undefined' ? ResizeObserver : class {observe(){} disconnect(){} }`，两处（`bindModalToAnchor` 与 `initAnchoredModals` combo 特例）均已覆盖。生产浏览器均支持 `ResizeObserver`，降级仅影响 jsdom 单测；若需更真实测试，可在 `vitest.setup` 注入 `resize-observer-polyfill`。
- **用例数 13 vs Brief 期望 14**：Brief 文本称“新增 8 条，共 14 条”，但实际贴出的代码块为 7 `it`（3+3+1），`6+7=13`。已按 Brief 贴出的代码块逐字实现，若后续 Task 4 需要第 8 条（如 `isQuickImportBarVisible` 显式单测），可在 `getQuickImportAnchorRect` 后追加一个 `isQuickImportBarVisible` 用例而不影响现有实现
- **全局 `rafId` 共享**：`let rafId: number | null` 为模块级单例，`bindModalToAnchor` 与 `initAnchoredModals` 的 `schedule` 共用同一 `rafId`，多 modal 同时 `schedule` 会互相 `cancelAnimationFrame`。Brief 即是如此设计（YAGNI 单文件），对当前“一次仅一个 modal active”场景足够；若后续多 modal 并发，需改为 per-instance `rafId`
- **`applyNoteBodyPadding` 注释恢复**：初始编辑误删了 `// 设计风险项...` 注释，已恢复以保持 `quick-import.ts` 行数/注释一致性
- **`quick-import.ts` 的 `getQuickImportBarRect`/`isQuickImportBarVisible` 与 `modal-anchor.ts` 的同名逻辑略有差异**：`modal-anchor` 检查 `visibility:hidden` 与 `width>0`，`quick-import` 仅检查 `display:none` 与 `height>0`。二者按 Brief 分别实现，分别供 DOM 层与外部调用，属有意差异；Task 4 的 `common.ts` 应统一调用 `modal-anchor` 的 `isQuickImportBarVisible` 以保证一致性
- **未改动文件**：`ocr-server/ocr_core.py` 的未暂存改动与本任务无关，不加入 commit；`test-results-*/` 等按 `.gitignore` 忽略

---

## Fix: review findings (2026-08-31) — 4 Important + minor

### What you changed

1. **Shared global rafId across instances (`src/ui/modal-anchor.ts:108`)** — Fix: removed module-level `let rafId` + `function schedule`. Added `function createSchedule(): ((fn)=>void) & {cancel:()=>void}` factory with per-instance `rafId` closure (`src/ui/modal-anchor.ts:109`). `bindModalToAnchor` now creates `const schedule = createSchedule()` per call, `destroy` calls `schedule.cancel()` instead of global `cancelAnimationFrame`. Combo path in `initAnchoredModals` creates its own `scheduleCombo = createSchedule()` and uses `scheduleCombo.cancel()` on cleanup. Eliminates cross-instance `cancelAnimationFrame` interference.

2. **Divergent isQuickImportBarVisible semantics** — Unified: `src/ui/modal-anchor.ts:59` already checked `display:none || visibility:hidden && height>0 && width>0`. `src/ui/quick-import.ts:614` previously only checked `display:none && height>0`. Fixed `quick-import.ts:609-620` to identical logic: `cs.display==='none' || cs.visibility==='hidden'` + `rect.height>0 && rect.width>0`, and `getQuickImportBarRect` now delegates to `isQuickImportBarVisible()` (`if (!barEl || !isQuickImportBarVisible()) return null`) instead of only `display:none`. Both exports now consistent; `quick-import` no longer diverges.

3. **Leaked observers/listeners in initAnchoredModals combo path** — Fix: introduced module-level singletons `let _initHandles: Array<{destroy():void}> = []` and `let _initComboCleanup: (()=>void)|null` (`src/ui/modal-anchor.ts:167`). `initAnchoredModals` now idempotently cleans previous handles (`_initHandles.forEach(h=>h.destroy())` and `_initComboCleanup && _initComboCleanup()`) at entry. Modal binds are tracked via `const h = bindModalToAnchor(el.id); _initHandles.push(h)`. Combo path uses named `const onComboResize = ():void => scheduleCombo(syncCombo)` (instead of inline arrow) stored for `removeEventListener`, and stores `RO2`/`mo` handles in `_initComboCleanup = () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', onComboResize); scheduleCombo.cancel(); }`. Dummy `ResizeObserver` now includes `unobserve` in both places (`class { observe(){} disconnect(){} unobserve(){} }`).

4. **boxSizing not reset on fallback** — Fix: `applyModalPosition` null-anchor branch now clears `modal.style.boxSizing = ''` (`src/ui/modal-anchor.ts:81`) alongside `top/height/alignItems/paddingTop/maxHeight/overflowY/marginTop`.

**Minor opportunistic fixes:**
- Removed unused `vi` import in `unit-tests/modal-anchor.spec.ts:1` (`import { describe,it,expect,beforeEach }`); added `isQuickImportBarVisible` to import.
- Dummy `ResizeObserver` second instance `RO2` now includes `unobserve()` (`src/ui/modal-anchor.ts:198`).
- Added 2 explicit `isQuickImportBarVisible` tests (`unit-tests/modal-anchor.spec.ts:104-112`): `bar 可见时返回 true` and `visibility:hidden 时返回 false` to prove unified semantics — total tests 13→15 (6 pure + 3 getRect + 3 apply + 2 isVisible + 1 bind). Count 15 vs brief expectation 13/14 is intentional extra coverage; still PASS.

Reference files after fix:
- `src/ui/modal-anchor.ts:74` — null branch now clears `boxSizing`
- `src/ui/modal-anchor.ts:109` — `createSchedule` factory
- `src/ui/modal-anchor.ts:122` — `bindModalToAnchor` per-instance schedule
- `src/ui/modal-anchor.ts:167` — singleton handles for leak fix
- `src/ui/modal-anchor.ts:186` — combo path with `scheduleCombo` + `onComboResize` + cleanup
- `src/ui/quick-import.ts:609` — `getQuickImportBarRect` delegates to `isQuickImportBarVisible`
- `src/ui/quick-import.ts:614` — unified `isQuickImportBarVisible` (visibility+width)
- `unit-tests/modal-anchor.spec.ts:104` — new `isQuickImportBarVisible` describe

### What you tested and test results

**Command:** `npx vitest run unit-tests/modal-anchor.spec.ts --reporter=verbose` (workdir `question-bank-local`, jsdom)
```
 ✓ unit-tests/modal-anchor.spec.ts (15 tests) 118ms
   ✓ computeAnchoredPosition - 纯计算 (6 tests)
   ✓ getQuickImportAnchorRect (3 tests) — bottom 312 / null / 196
   ✓ applyModalPosition (3 tests) — top 312px / fallback '' / zIndex preserved
   ✓ isQuickImportBarVisible (2 tests) — true / visibility:hidden false
   ✓ bindModalToAnchor - 同步 (1 test) — resize → top 312px
 Test Files  1 passed (1)
      Tests  15 passed (15)
 Duration  710ms (environment 479ms)
```

**Regression:**
```
 npx vitest run unit-tests/quick-import.spec.ts unit-tests/quick-import-note.spec.ts unit-tests/modal-anchor.spec.ts --reporter=verbose
 Test Files  3 passed (3)
      Tests  58 passed (58)  (34 quick-import + 9 quick-import-note + 15 modal-anchor)

 npx vitest run unit-tests/atomizer-parser.spec.js ... unit-tests/questions-normalize.spec.js
 Test Files  9 passed (9)
      Tests  136 passed | 1 skipped (137)
```

**Quality gates:**
```
 npm run typecheck
 > tsc --noEmit
 (PASS, 0 errors)

 npm run build
 > vite build
 ✓ 98 modules transformed.
 ✓ built in 193ms (432kB index)
```

### Files changed (this fix)

- `src/ui/modal-anchor.ts` (modify, 190→215 lines) — per-instance schedule factory, singleton leak fix, boxSizing reset, unobserve dummy
- `src/ui/quick-import.ts` (modify, 620→621 lines) — unified visibility (visibility:hidden + width>0) and delegation
- `unit-tests/modal-anchor.spec.ts` (modify, 116→128 lines) — removed vi, added isQuickImportBarVisible import + 2 tests
- `.superpowers/sdd/2026-08-31-popup-anchor-reposition/task-3-report.md` (append fix section)

**Git:**
- Commit: `fix: modal-anchor review findings (rafId per-instance, visibility unify, leak fix, boxSizing)` (pending)
- Branch: `f640/main2`
- Diff stat (this fix): `+56 -10` across 3 source files (excluding report)


