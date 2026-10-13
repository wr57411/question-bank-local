# 快速导入栏「常见标签列表」实施计划

> **状态：待确认。** 本文是设计稿，确认后才动代码。
> 需求来源：2026-09-03 王先生提出。
> **v3（2026-09-03 修订）**：v1 的 LWW 会静默丢弃，已推翻。v2 的联网门禁会阻断离线编辑，已降级。v3 改为**逐项状态合并 + 按标签粒度的冲突弹窗**：离线自由编辑，联网后无冲突自动生效，只有真正矛盾的那几项才弹窗。

**Goal:** 在快速导入栏中增加一条用户自管理的「常见标签」横向列表，默认可见约 4 个，超出部分横向滑动浏览；点击即选中/取消选中该标签；行尾「＋」展开栏内管理区，可添加、移除、拖拽排序。多设备场景下**离线可改、永不静默丢弃**：无冲突自动合并，真冲突按标签粒度弹窗让用户裁决。

**Architecture:** 常驻一行插在标签搜索框与按钮行之间；数据落在 localStorage（本地权威副本）+ 服务端 `user_settings.quickFavoriteTags`（跨设备同步层）；栏高补偿从硬编码改为动态测量。

**Tech Stack:** TypeScript（src/services、src/ui、src/data）、src/index.html（内联 CSS）、Playwright E2E、vitest 单测、Express + better-sqlite3（服务端）。

---

## 一、已确认的设计决策

| 决策点 | 结论 | 确认轮次 |
|-------|------|---------|
| 列表位置 | 常驻单行，位于 `#qi-tag-input` 下方、按钮行上方 | 第 1 轮（A） |
| 管理入口 | 行尾「＋」→ 在栏内展开管理区，**不新增浮层** | 第 2 轮（A） |
| 数量控制 | 定宽滚动容器 + chip 限宽，末尾自然露半截 | 第 3 轮（A） |
| 排序规则 | 按加入顺序，管理区内可拖拽排序 | 第 4 轮（A + 追加拖拽） |
| 持久化 | 随服务端同步 | 第 5 轮（B） |
| 并发策略 | 禁止静默覆盖 | 第 6 轮（推翻 v1 的 LWW） |
| **离线编辑** | **必须支持离线修改**；冲突时**弹窗当场选择**（不用事后提示） | 第 7 轮（B） |

---

## 二、三个版本的演进，与各自被推翻的原因

| 版本 | 做法 | 被推翻的原因 |
|-----|------|------------|
| v1 | LWW 整包覆盖（按 `updated_at`，后推的赢） | **静默丢弃**另一台设备的整批修改。写进文档的失效边界不等于解决问题 |
| v2 | 联网门禁（离线不给改）+ rev 乐观锁（拒绝写入） | 门禁**阻断离线编辑**。用户明确要求：不在家连不上服务器时也要能改 |
| **v3** | **逐项状态合并 + rev 判「是否知情」+ 按标签弹窗** | — |

### v3 的核心：把数据结构拆开

v1/v2 的问题根源在于「列表是一个数组」。数组只有两种合并法——二选一或取并集，都是整包操作。

拆成两样东西后性质就变了：

| | 存什么 | 怎么合并 | 冲突后果 |
|---|---|---|---|
| **成员资格** | 每个标签一条 `{在不在, 时间戳}` | **逐项**比时间戳 | 只影响**那一个标签** |
| **顺序** | 一个 id 数组 + 时间戳 | 整体 LWW | 最坏只是**排列不同** |

A 加物理、B 加化学，改的是**不同条目**，逐项合并各归各，**根本不冲突**，不需要任何弹窗。

**关键收益：把「会不会丢数据」和「排列是否一致」彻底分开了。** 顺序错了顶多不好看，成员绝不会丢。

### 为什么「删除」在逐项模型下能传播

整包并集里，删除 = 移除条目 → 另一台设备的旧副本里还有它，一合并就复活。

逐项模型里，删除 = 把状态改成「不在」并打上时间戳 → 它是一条**带时间的信息**，能参与比较，所以能传播。代价是删除后要**留墓碑**（不能真删条目），需定期清理 90 天前就已删除的墓碑。

### rev 的新职责：判断「是否知情」

逐项时间戳模型有个盲区：

> 本机「物理：不在@T5」，云端「物理：在@T3」。按时间戳本机赢——但本机可能 T2 就删了（压根没见过云端 T3 的添加），也可能 T5 是看过云端之后故意删的。两种情况结论完全相反，光看时间戳分不出来。

所以保留 `rev`，但**不再用于拒绝写入**，而是判断本地改动是否基于最新版本：

| 条件 | 判定 | 处理 |
|---|---|---|
| `本地.rev == 云端.rev` | 本机看过云端最新状态后才改的 | **知情决定**，按时间戳直接生效，**不弹窗** |
| `本地.rev < 云端.rev` 且两端结论相反 | 本机可能没见过云端的改动 | **真冲突**，弹窗让用户选 |
| 两端结论相同 | 无论 rev | 取时间戳较新者，不弹窗 |

在设备 A 上**在线**改，永远不会被弹窗打扰；只有**离线**改、且恰好跟别人改了同一个标签，才会弹窗。

---

## 三、现状事实（已实测，非推测）

| 事实 | 证据 | 对设计的影响 |
|-----|------|------------|
| 栏高补偿是硬编码 | `src/ui/quick-import.ts:67` → `312px` / `196px` | 新增行必须改，否则遮挡正文 |
| 第一行 `#qi-tags` 净宽仅约 198px | 390 − 24 − 56 − 56 − 32 | 排除了「并入第一行」方案 |
| 标签同步是 **insert-only** | `src/data/sync.ts:113-118` → 仅 `if (!existing)` 才写入 | **绝不能把「常见」标记挂在 tag 记录上**，字段更新永远传不过去 |
| `canSync()` 不发网络请求 | `src/ui/sync-ui.ts:114-116` | 不能用作「在线」判据 |
| `apiCall` 在 `!resp.ok` 时 throw | `src/ui/sync-ui.ts:143` | 冲突**必须**用 200 + `conflict` 字段返回，不能用 HTTP 409 |
| settings 是整行 `INSERT OR REPLACE` | `routes/sync.ts:81`、`server-sync.ts:270` | 写入必须用 `{ ...prev, quickFavoriteTags: next }` 保留其它字段 |
| 路由挂载在 `/api/sync` | `server/src/app.ts:92` | 新增轻量接口挂在同一 router 下 |
| 已有 debounce 自动同步 | `queueAutoSync()`，`SYNC_DEBOUNCE_MS = 800` | 改动后的推送可复用节流机制 |
| `user_settings` 存有真实 API key | 实测 DB：openrouter / 商汤 / 小米密钥 | 写入必须用 `{...prev}`，误抹后果严重 |

### 全量 push **不携带** settings

v1 曾计划让 `dbBuildSyncPayload()` 带上 settings，那会引入「整行替换抹掉 `cloud_providers`」的风险。**v3 同样不走这条路**，风险从方案里根除，服务端那两处 `undefined` 保护也不用写。

- **写入**：只有 `POST /api/sync/favorite-tags`（轻量）
- **读取**：`GET /api/sync/settings`（轻量，用于进入面板时拉取）；全量 pull 也带回 settings，用于「云端重建」场景恢复配置

### 题目离线录入：本来就不受影响

门禁/合并策略**只作用于「常见标签列表」这一个共享配置**。快速导入的拍照、配对、选标签、写笔记、确认导入全部走 IndexedDB，一直是纯离线的，本次不做任何限制。

---

## 四、变更清单

| 操作 | 路径 | 内容 |
|-----|------|------|
| Add | `src/services/quick-fav-tags.ts` | 逐项状态模型、增删改排序、序列化容错、合并与冲突检测（**纯逻辑，DOM 无关**） |
| Modify | `src/index.html` | 常见标签行 + 管理面板 DOM（内联 CSS） |
| Modify | `src/ui/quick-import.ts` | 渲染、点击 toggle、管理面板、拖拽排序、同步状态提示、冲突弹窗、栏高动态补偿 |
| Modify | `src/data/sync.ts` | `dbApplyRemoteSnapshot` 采用远端 settings（只读方向，不产生写入） |
| Modify | `server/src/routes/sync.ts` | 新增 `GET /settings`、`POST /favorite-tags` 两个轻量路由 |
| Add | `unit-tests/services/quick-fav-tags.spec.ts` | 数据层单测（含合并规则矩阵） |
| Add | `tests/quick-import-fav-tags.spec.js` | 手机视口 E2E + 可见性断言 + 截图 |

### 明确**不改**的地方

- 不改 `routes/sync.ts:70-81` 与 `server-sync.ts:259-271` 的现有 settings 合并逻辑
- 不动 `cloud_providers` / `appVersions` 的保护规则
- 不改标签的创建 / 删除 / 颜色逻辑
- 不改 `#qi-tag-results` 搜索结果行为
- **不限制题目离线录入**（本来就离线，本次不碰）
- 不引入拖拽库

---

## 五、Task 1：数据层 `src/services/quick-fav-tags.ts`

对齐 `src/services/version-combo.ts` 的模块风格（localStorage 服务、纯函数、无 DOM 依赖）。

```ts
export interface QuickFavItem {
  on: boolean;    // 是否在常见列表中
  at: string;     // 该状态最后被修改的时间
}

export interface QuickFavTags {
  items: Record<string, QuickFavItem>;   // 逐项收藏状态（含墓碑）
  order: { ids: string[]; at: string };  // 顺序，整体 LWW
  rev: number;                           // 本地数据基于的服务端版本号
  synced: string;                        // 上次与服务端一致的快照（JSON 串），用于算待同步项
}

export interface QuickFavConflict {
  id: string;
  local: QuickFavItem;
  remote: QuickFavItem;
}
```

### 对外函数

```ts
export function loadQuickFavTags(): QuickFavTags
export function visibleQuickFavIds(): string[]        // items 中 on=true 的，按 order 排
export function setQuickFavOn(id: string, on: boolean): void   // 改 items[id]，at = now
export function reorderQuickFavIds(ids: string[]): void        // 改 order，at = now
export function pendingQuickFavCount(): number        // 与 synced 快照比较，算待同步项数
export function hasPendingQuickFavChanges(): boolean
export function adoptRemoteQuickFavTags(remote): void // 整体采用远端（仅当无待同步改动时调用）
export function resolveQuickFavConflicts(picks: Record<string, boolean>, rev: number): void
export function pruneQuickFavTombstones(days?: number): void   // 清理过期墓碑
```

### 合并逻辑**只在服务端**存在（重要修正）

原方案写的是「客户端与服务端共用同一份纯函数」。**实施前核查发现此路不通**，且并不需要：

| 核查项 | 结论 |
|-------|------|
| 根 `tsconfig.json` | `include: ["src/**/*.ts"]`、`rootDir: "./src"` → `npm run typecheck` **根本不检查 server/** |
| `server/tsconfig.json` | `include: ["src"]`、`rootDir: "src"` → 服务端也无法 import `server/src` 之外的文件（TS6059） |
| 服务端有 typecheck 脚本吗 | **没有**。`server/package.json` 只有 `start` / `dev`（均走 tsx，不做类型检查） |

**修正后的分工：**

- **客户端不实现合并**。进入面板拉远端时：本地**无**待同步改动 → `adoptRemoteQuickFavTags()` 整体采用（没有东西可丢）；本地**有**待同步改动 → 什么都不做，留给 push 时由服务端裁决。
- **push 时客户端只上报本地状态**（`items` + `order` + `rev`），合并在服务端完成。

这样合并逻辑**只有服务端一份**，不存在两份实现漂移的问题——比原本设想的「共用一份」更彻底。

### 合并规则矩阵（**服务端实现，单测逐格覆盖**）

规则矩阵见 Task 5，实现落在 `server/src/services/quick-fav-merge.ts`。

| 情形 | 处理 |
|-----|------|
| 只有一端有该 key | 采用存在的那一端 |
| 两端都有，结论相同（`on` 一致） | 取 `at` 较新者 |
| 两端都有，结论相反，`本地.rev == 云端.rev` | 本地知情，取 `at` 较新者，**不算冲突** |
| 两端都有，结论相反，`本地.rev < 云端.rev` | **冲突**，进 `conflicts` 交由用户裁决 |

### 顺序的合并

```
取 order.at 较新的一端作为骨架
→ 骨架里缺少的（新加入的）成员，按各自 items.at 升序追加到末尾
→ 骨架里多余的（已删除的）成员，从骨架中剔除
```

顺序**不弹窗**——见「对抗性评审」第 2 条，这是全方案唯一保留的自动裁决点。

### 容错要求（单测覆盖）

| 输入 | 行为 |
|-----|------|
| 无记录 | 返回空初始态 |
| 非法 JSON | 返回空初始态，不抛异常 |
| `items` 非对象 / 值缺 `on` 或 `at` | 该条丢弃 |
| `at` 解析不出时间 | 按 0 处理（等价于最旧） |
| `rev` 为字符串 / NaN / 负数 | 归一化为 `0` |
| `order.ids` 含不存在的 key | 渲染时过滤，不写回清理 |

### 墓碑清理

`on === false` 且 `at` 早于 90 天前的条目，在每次成功同步后清理，防止无限膨胀。

---

## 六、Task 2：DOM 与样式（`src/index.html`）

在 `#qi-tag-input`（第 33 行）之后、按钮行（第 34 行）之前插入：

```html
<div style="display:flex;align-items:center;gap:6px;margin-top:6px">
    <div id="qi-fav-tags" style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scrollbar-width:none;padding:2px 0"></div>
    <button type="button" id="qi-fav-manage-btn" onclick="toggleQuickFavPanel()" style="flex-shrink:0;width:26px;height:26px;border:1.5px dashed var(--border);border-radius:50%;background:var(--surface);color:var(--text-secondary);font-size:14px;line-height:1;cursor:pointer" title="管理常见标签">＋</button>
</div>
<div id="qi-fav-panel" style="display:none;margin-top:6px;padding:8px;border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--surface-dim)">
    <div id="qi-fav-sync-state" style="display:none;margin-bottom:6px;padding:6px 8px;border-radius:var(--radius-sm);background:var(--warning-light);color:var(--warning-dark);font-size:12px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:500;color:var(--text)">管理常见标签</span>
        <button type="button" onclick="toggleQuickFavPanel()" style="border:none;background:transparent;color:var(--text-tertiary);font-size:13px;cursor:pointer">收起</button>
    </div>
    <div id="qi-fav-sort-list" style="max-height:120px;overflow-y:auto"></div>
    <div style="height:1px;background:var(--border-light);margin:8px 0"></div>
    <input id="qi-fav-search" type="text" placeholder="搜索标签以添加" autocomplete="off" oninput="renderQuickFavCandidates()" style="display:block;width:100%;box-sizing:border-box;padding:7px 9px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:13px;background:var(--surface);color:var(--text)">
    <div id="qi-fav-candidates" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-height:96px;overflow-y:auto"></div>
</div>
```

**样式要点：**

| 元素 | 关键样式 | 理由 |
|-----|---------|------|
| 滚动容器 | `overflow-x:auto` + `overscroll-behavior-x:contain` | 防横滑触发页面下拉刷新/回弹 |
| 管理按钮 | 置于滚动容器**外部**，`flex-shrink:0` | 在容器内会跟着内容滚走 |
| chip | `flex:0 0 auto; max-width:88px` + 文字 `text-overflow:ellipsis` | 约 6 个汉字；长标签不霸占整行 |
| chip 未选中 | `border:1.5px solid var(--border); background:var(--surface); color:var(--text)` | 中性描边，与「已选标签」区区分 |
| chip 已选中 | `border-color:<tag.color>; background:<tag.color>15` | 沿用 `renderQuickSelectedTags` 的色值约定（`quick-import.ts:388`） |

**交互细节：** 聚焦 `#qi-tag-input` 时自动收起 `#qi-fav-panel`（否则搜索结果区与管理面板同时展开，栏高失控）。

---

## 七、Task 3：交互逻辑（`src/ui/quick-import.ts`）

1. `renderQuickFavTags()`：取 `visibleQuickFavIds()`，**过滤掉 `w.allTags` 里找不到的 id**，渲染 chip。
   - **只过滤渲染，不写回清理。** 标签可能只是还没从服务端同步下来，写回清理等于永久删除用户配置。
2. chip 点击 → **toggle**：已选中则从 `quickTagIds` 移除，未选中则 `addQuickTag(id)`。
   - 这是「使用」而非「修改配置」，**完全离线可用**，不受任何同步状态影响。
3. `toggleQuickFavPanel()`：展开面板 → 尝试拉取远端（成功则静默合并无冲突项）→ 刷新 `qi-fav-sync-state` 状态条。
4. `renderQuickFavSortList()`：纵向列表，每行 = 色点 + 名称 + 右侧拖拽手柄 + 移除按钮。
5. `renderQuickFavCandidates()`：按 `#qi-fav-search` 过滤 `w.allTags`，排除已在列表中的，点选即加入。
6. **拖拽排序**（管理区内，纵向）：`pointerdown/move/up` + 手柄 `touch-action:none`。拖过相邻项中心时交换数组顺序并局部重渲染，松手 `reorderQuickFavIds(newIds)` + 触发推送。
   - 不用 HTML5 drag & drop（移动端触屏不支持）。
   - 手柄与行点击区分离，避免手势打架。
7. **每次改动后立即推送**：`setQuickFavOn` / `reorderQuickFavIds` 之后 debounce 800ms 触发 `pushQuickFavTags()`。离线时 push 失败属正常路径，仅更新状态条。

---

## 八、Task 4：同步状态提示（**门禁已降级为告知**）

v2 的门禁会阻断离线编辑，v3 **取消拦截**，只保留一条状态条 `#qi-fav-sync-state`：

| 状态 | 文案 |
|-----|------|
| 有 N 项待同步（离线或 push 失败） | 「⚠️ 有 N 项改动待同步，联网后会自动合并」 |
| 同步中 | 「正在同步…」 |
| 已同步 | 隐藏 |

**关键：任何情况下都不禁用编辑控件。** 离线时添加、移除、拖拽排序全部照常可用，改动暂存本地。

进入面板时若网络可达，静默拉取一次远端并合并**无冲突项**（冲突项留待 push 时弹窗，避免进入面板就弹窗打扰）。

---

## 九、Task 5：服务端轻量接口（逐项合并）

在 `server/src/routes/sync.ts` 新增两条路由（挂在现有 `/api/sync` 下，复用 `authMiddleware`）。

### `GET /api/sync/settings`

```ts
router.get('/settings', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
  let settings: Record<string, unknown> = {};
  try { settings = row?.settings ? JSON.parse(row.settings) : {}; } catch { settings = {}; }
  res.json({ settings });
});
```

### `POST /api/sync/favorite-tags`

```ts
router.post('/favorite-tags', (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { items, order, rev, force = false } = req.body || {};
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    return res.status(400).json({ error: 'items 格式不合法' });
  }

  const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(userId) as { settings: string } | undefined;
  let prev: Record<string, unknown> = {};
  try { prev = row?.settings ? JSON.parse(row.settings) : {}; } catch { prev = {}; }
  const cur = prev.quickFavoriteTags as { items: Record<string, { on: boolean; at: string }>; order: { ids: string[]; at: string }; rev: number } | undefined;

合并函数落在 **`server/src/services/quick-fav-merge.ts`**（纯函数，无 IO），由路由调用：

```ts
const result = mergeQuickFavTags({ items, order, rev }, cur);
```

  if (!force && result.conflicts.length > 0) {
    // 注意：200，不是 4xx
    return res.json({
      conflict: true,
      conflicts: result.conflicts,
      serverRev: cur?.rev ?? 0,
      merged: result.merged,   // 无冲突部分，供客户端预览
    });
  }

  const next = { items: result.merged.items, order: result.merged.order, rev: (Number(cur?.rev) || 0) + 1 };
  const mergedSettings = { ...prev, quickFavoriteTags: next };   // 展开 prev，绝不会抹掉其它字段
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, settings) VALUES (?, ?)')
    .run(userId, JSON.stringify(mergedSettings));
  res.json({ conflict: false, rev: next.rev, items: next.items, order: next.order });
});
```

**三个关键点：**

1. **用 `{ ...prev, quickFavoriteTags: next }`，不是 `{ ...body }`。** 展开 `prev` 保留所有既有字段，`cloud_providers` / `appVersions` 分毫不动。
2. **冲突返回 HTTP 200 + `conflict: true`。** `apiCall` 在 `!resp.ok` 时直接 throw（`sync-ui.ts:143`），用 4xx 会让客户端连服务端的那份副本都拿不回来，就没法做「用云端」的选项了。
3. **合并逻辑与客户端共用同一份纯函数**，放在 `src/services/quick-fav-tags.ts`，服务端通过相对路径 import。两侧行为必须完全一致——单测覆盖整个规则矩阵。

---

## 十、Task 6：冲突弹窗（按标签粒度）

```ts
async function pushQuickFavTags(): Promise<void> {
  const local = loadQuickFavTags();
  if (!w.canSync() || pendingQuickFavCount() === 0) return;
  try {
    const resp = await w.apiCall('/api/sync/favorite-tags', 'POST', {
      items: local.items, order: local.order, rev: local.rev,
    });
    if (resp?.conflict) { showQuickFavConflict(resp.conflicts, resp.serverRev); return; }
    markQuickFavSynced(resp.rev, resp.items, resp.order);
  } catch {
    renderQuickFavSyncState();   // 更新为「有 N 项待同步」
  }
}
```

弹窗只列出**真正冲突的标签**，每个一行，必须显示两端的时间：

> **「物理」在多台设备上被同时修改**
> 本机：不在列表（09-03 22:15）
> 云端：在列表（09-03 21:47）
> [用云端] [用本机]

| 按钮 | 行为 |
|-----|------|
| 用云端 | `resolveQuickFavConflicts({id: remote.on}, serverRev)`，重新 push |
| 用本机 | `resolveQuickFavConflicts({id: local.on}, serverRev)`，重新 push |

**重新 push 时 `rev` 已更新为 `serverRev`，因此不会被再次判为冲突**——此时 `本地.rev == 云端.rev`，按规则属于「知情决定」，直接生效。

未冲突的改动**不等弹窗**，服务端已在返回 `merged` 的同时完成了无冲突部分的合并；用户处理完冲突项后整包落定。

---

## 十一、Task 7：栏高补偿（消除硬编码债）

现状 `quick-import.ts:65-69`：

```ts
document.body.style.paddingTop = quickMode ? (isQuickNoteExpanded() ? '312px' : '196px') : '';
```

改为动态测量：

```ts
function applyQuickBarBodyPadding(): void {
  const barEl = bar();
  if (!quickMode || !barEl) {
    document.body.style.paddingTop = '';
    dispatchBarChange(0);
    return;
  }
  requestAnimationFrame(() => {
    const h = bar()?.offsetHeight ?? 0;
    document.body.style.paddingTop = h ? h + 'px' : '';
    dispatchBarChange(h);
  });
}
```

**为什么包 `requestAnimationFrame`：** 展开/收起后 DOM 尚未重排，同步读 `offsetHeight` 会拿到旧值——与项目已有的 modal-anchor 竞态同一病根（`docs/fix-modal-anchor-flaky.md`）。

改动后 `196px` / `312px` 两个魔法数字一并消失。

---

## 十二、Task 8：测试

### 合并规则矩阵单测 `unit-tests/services/quick-fav-tags.spec.ts`

**这是全方案的核心，必须逐格覆盖：**

| 用例 | 断言 |
|-----|------|
| 仅本地有该 key | 采用本地 |
| 仅云端有该 key | 采用云端 |
| 两端结论相同，本地 `at` 更新 | 采用本地 |
| 两端结论相同，云端 `at` 更新 | 采用云端 |
| 结论相反，`rev` 相同，本地 `at` 更新 | 采用本地，**无冲突** |
| 结论相反，`rev` 相同，云端 `at` 更新 | 采用云端，**无冲突** |
| **结论相反，`本地.rev < 云端.rev`** | **产生冲突项，不自动裁决** |
| `at` 为非法时间字符串 | 按最旧处理，不崩溃 |
| 墓碑清理 | 90 天前的 `on:false` 被清除，近期保留 |

### 数据层单测

| 用例 | 断言 |
|-----|------|
| 加 / 删 / 排序后 `visibleQuickFavIds()` | 顺序与内容正确 |
| `pendingQuickFavCount()` | 改动后 > 0，`markQuickFavSynced` 后 = 0 |
| localStorage 非法 JSON / 类型错乱 | 返回空初始态，不抛异常 |
| `order.ids` 含不存在 key | 渲染过滤，不写回清理 |

### 服务端单测（新增）

| 用例 | 断言 |
|-----|------|
| 首次写入 | rev = 1，`cloud_providers` 等既有字段**原样保留** |
| 无冲突写入 | 合并生效，rev +1 |
| 有冲突 | 返回 `conflict:true` + `conflicts` 列表，且**不写入** |
| `force:true` | 覆盖成功，rev +1 |
| `items` 非对象 | 400 |

**「既有字段原样保留」是防 API key 被抹的最后一道闸，必须有断言。**

### E2E `tests/quick-import-fav-tags.spec.js`

遵循 `AGENTS.md` 的「E2E 截图评估要求」：

1. **手机视口**：`page.setViewportSize({ width: 390, height: 844 })`
2. 常见标签行、每个 chip、「＋」按钮全部过 `assertVisiblyRendered`（对比度 ≥ 3、无遮挡、无截断）
3. 加入 6 个标签后断言 `scrollWidth > clientWidth`
4. **离线可编辑用例**：mock 网络失败 → 断言「有 N 项待同步」状态条出现，且**添加/移除控件仍可点击**
5. **冲突弹窗用例**：mock 返回 `conflict:true` + 一个冲突项 → 断言弹窗只列该标签，且**未自动覆盖**
6. `captureForReview(page, 'quick-import-fav-tags')` 截图，**AI 必须实际 Read 截图**
7. 复现性验证：临时破坏（如把 chip 文字色设成背景色）确认测试失败，再还原

```bash
npx playwright test tests/quick-import-fav-tags.spec.js --reporter=list --output=tmp/test-results-qi-fav-tags
```

---

## 十三、CI 验证与文档

按顺序全部通过，任一失败立即修复后重跑：

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. `npx playwright test`（全量，弹窗锚定竞态只在全量串行时暴露）
5. 截图 + 可见性评估
6. 开发文档存入 `docs/`，更新 `AGENTS.md` 的「开发文档索引」
7. 先加载 `ship-feature` skill，再 `npm run ship -- "快速导入栏常见标签列表"`

---

## 十四、风险登记表

| 风险 | 触发条件 | 缓解措施 |
|-----|---------|---------|
| **其它 settings 字段被抹除**（含 API key） | 写入时未展开 `prev` | 服务端用 `{ ...prev, quickFavoriteTags: next }`；单测断言 `cloud_providers` 原样保留 |
| 栏高增加遮挡正文 | 常驻 +34px；面板展开再 +约 250px | paddingTop 改动态测量 |
| 拖拽与横滑手势冲突 | 手柄未隔离 touch 行为 | 拖拽只在**纵向**管理区内；手柄 `touch-action:none` |
| 同步 id 指向本地不存在的标签 | 标签尚未同步下来 | 渲染时过滤，**不写回清理** |
| 墓碑无限增长 | 长期增删标签 | 每次成功同步后清理 90 天前的 `on:false` 条目 |
| 离线改动长期未同步 | 用户长期不联网 | 状态条常驻提示「有 N 项待同步」；联网后首次同步即处理 |
| chip 对比度不足 | 浅色描边配浅色底 | E2E `assertVisiblyRendered` 强制 ≥ 3 |
| 管理面板与搜索结果同时展开 | 用户边输入边管理 | 聚焦 tag input 自动收起面板 |
| 服务器间同步（`server-sync.ts`）未同步新字段 | 多服务器部署 | **已知残留，本次不处理**：该路径复制整行 settings blob，源端有则目标有 |

---

## 十五、对抗性评审：什么情况下这个设计还是错的

1. **`rev` 相等并不能 100% 证明「知情」。** 两台设备可能都从同一个 rev 拉取后各自离线修改，此时两端 `rev` 相同，按规则会被判为「知情决定」而按时间戳直接裁决——**这就绕过了弹窗**。要堵住需要在 `rev` 之外再记录「上次同步的时间点」，判据变成「本地上次成功同步的时间 > 云端该 key 的最后修改时间」。这是可增量加固的点，若日后发现误判频繁再加。
2. **顺序冲突是全方案唯一保留的自动裁决点。** 两端都改了顺序时按 `at` 取较新，**不弹窗**。理由：顺序是排列而非数据，被覆盖不造成信息丢失；且让人在弹窗里选「用哪个排列」没有可判断的依据。若你认为顺序也必须知情，此处需改为弹窗。
3. **如果常见标签会超过 15 个**，横向滑动找特定标签的效率会急剧下降，届时应改成分组或搜索优先。**隐含前提是列表维持在一屏可见 4 个、总数十几个。**
4. **如果标签名普遍超过 6 个汉字**，`max-width:88px` 会让大部分 chip 显示为省略号，「一眼扫到」这个核心价值就没了。届时应放宽限宽或减少展示数量。
5. **未登录用户走纯本地模式**（无同步、无冲突，`rev` 恒为 0）。若日后登录并开启同步，本机已配好的列表以 `rev: 0` 首次写入——此时若服务端已有该字段且结论相反，会触发弹窗。可接受：用户看得见、能选择。
6. **弹窗只在联网同步的那一刻出现。** 若用户离线改完就再也不联网，那些改动永远停留在本机——这是本地优先架构的固有语义，非缺陷。

---

## 十六、附：查本次方案时发现的**既有**风险（待王先生决定是否一并修复）

> 这一节**不属于**本次功能范围。是在核查同步链路时发现的既有缺陷，按「最小改动」原则未擅自修改，先报告。

### 事实

| 项 | 结论 | 证据 |
|---|------|------|
| 服务端 `user_settings` 的写入点 | **只有 2 处** | `routes/sync.ts:81`（客户端 push）、`services/server-sync.ts:270`（服务器间同步） |
| 两处的写入方式 | 都是**整行** `INSERT OR REPLACE` | 同上 |
| 客户端当前是否推送 settings | **从不推送** | `dbBuildSyncPayload()`（`src/data/sync.ts:55-80`）无 settings 字段；`cloud_providers` 只写 localStorage（`provider-manage.ts:31,102,124,221`），`sync-ui.ts:441` 也只是从本地读 |
| 服务端现有 `cloud_providers` 数据 | **历史遗留**（含 openrouter / 商汤 / 小米真实 API key，明文存储） | 实测 `server/data.db` |
| 现有保护措施 | 只对 `cloud_providers`、`appVersions` 两个字段做硬编码恢复，用 `length === 0` 判断 | `routes/sync.ts:74,78`；`server-sync.ts:263,267` |
| 保护措施是否被真实触发过 | **否**——没有客户端推 settings，这两条分支从未执行 | 由上两条推出 |

### 三重问题

1. **`{ ...settings }` 的语义是「用请求体覆盖一切」。** 任何请求体里没有的字段都会被抹掉。现有保护只是给两个已知字段打了补丁，新增第三个字段就得记得再打一次。
2. **`length === 0` 无法区分「用户清空」与「客户端没这个功能所以没传」。** 结果是：**用户想清空 `cloud_providers`，永远清不掉**（服务端会把旧值恢复回去）。这是一个已经存在的功能性 bug。
3. **现在没出事只是因为碰巧没人推 settings。** 这是运气，不是设计保障。任何客户端一旦开始推 settings（例如恢复旧逻辑、新增功能），`cloud_providers` 里的 API key 就会被整行替换掉。

### 根本修复：一行代码

两处各改一处，把

```ts
const merged = { ...settings };              // 或 { ...data.settings }
```

改成

```ts
const merged = { ...prev, ...settings };
```

**为什么这一行就够：**

| 场景 | `{ ...settings }` | `{ ...prev, ...settings }` |
|-----|------------------|---------------------------|
| 请求体没传某字段 | 该字段**被抹除** | 保留 `prev` 的值 |
| 请求体传了 `[]`（用户清空） | 被保护逻辑**强行恢复**，清空失效 | `[]` 正常覆盖，**清空生效** |

改完之后，那两条硬编码保护（`routes/sync.ts:74-79`、`server-sync.ts:263-268`）就可以**直接删掉**——`{ ...prev }` 天然覆盖了它们要解决的问题，而且做得更正确。净效果是**代码更少、语义更对、顺带修好「清空失效」这个 bug**。

### 与本次功能的关系

本次方案走**独立的轻量接口** `POST /api/sync/favorite-tags`，写入用 `{ ...prev, quickFavoriteTags: next }`，**不经过上面这条危险路径**。所以：

- **新功能本身是安全的**，不依赖这个修复
- 但**既有的 `cloud_providers` / `appVersions` 仍然暴露在原风险里**

是否在本次一并修复，由王先生决定。若修复，需补两条单测：

| 用例 | 断言 |
|-----|------|
| push 的 settings 缺某字段 | 该字段原样保留（不被抹除） |
| push 的 settings 显式传 `[]` | 清空生效（不被恢复） |
