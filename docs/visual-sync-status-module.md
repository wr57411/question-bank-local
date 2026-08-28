# 可视化同步状态与操作模块方案（修订版）

## 背景

当前应用有两条独立的数据持久化路径：
1. **本地备份**（备份弹窗）：备份到本地设备（iOS iCloud / Android 本地存储）
2. **云端同步**（同步弹窗）：同步到 Mac mini 服务器（通过 `serverUrl` + `apiToken` 连接）

**问题**：云端同步状态完全隐藏在同步弹窗内部（需登录 → 点击头像 → 打开同步弹窗才能看到）。主界面上没有任何同步状态的可视化，用户无法一眼确认数据是否已同步到 Mac mini。

## 功能目标

在主界面 header 下方添加一个**云端同步状态条**：
1. 显示 Mac mini 服务器连接状态（通过 `/api/recovery/status` 检测，复用已有接口）
2. 显示同步状态（最新 / 同步中 / 失败 / 从未同步 / 未登录）
3. 显示上次成功同步时间
4. 提供"同步"按钮，点击调用现有 `runSync` 函数
5. 同步完成/失败时通过现有 `showStatus` 提示（不新建 Toast）
6. 自动同步（已有 4 秒轮询）成功后自动更新状态条

## 与原方案的关键差异

| 原方案问题 | 修订方案 |
|-----------|---------|
| 用不存在的 `/api/ping` 检测连通性 | 复用已有的 `/api/recovery/status` |
| 新建 Toast 系统，与 `showStatus` 重复 | 直接复用 `showStatus` |
| CSS 类定义了但 JS 从未使用 | 删除无用 CSS 类，用内联样式 |
| `slideDown`/`slideUp` 动画未定义 | 不需要，复用 `showStatus` |
| 没有"同步失败"持久状态 | 新增 `lastSyncError` 变量追踪 |
| "有待同步"状态无检测手段 | 去掉，简化为 5 种状态 |
| 修改 `setSyncStatus` 导致闪烁 | 不改 `setSyncStatus`，在 `runSync` 的 finally 中更新 |
| 30秒+10秒轮询浪费资源 | 复用已有 4 秒自动同步轮询，状态条被动更新 |
| `window.showSyncStatus` 缺失（db.js 调用但未定义） | 顺便修复此 bug |

## 技术方案

### 1. HTML 结构

**位置**：`header`（第389行）之后、`toolbar`（第390行）之前。

```html
<div id="sync-bar" style="display:flex;align-items:center;justify-content:space-between;padding:6px 16px;margin:0 -12px var(--space-sm);background:var(--surface);border-bottom:1px solid var(--border-light);font-size:12px;color:var(--text-secondary)">
    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <span id="sync-bar-server">⚪ 未登录</span>
        <span style="color:var(--border)">|</span>
        <span id="sync-bar-state">同步: --</span>
        <span id="sync-bar-time" style="color:var(--text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
    </div>
    <button id="sync-bar-btn" onclick="handleSyncBarClick()" style="padding:4px 10px;font-size:11px;flex-shrink:0" disabled>🔄 同步</button>
</div>
```

设计要点：
- 单行紧凑布局，高度约 32px，不占太多空间
- 左侧：服务器状态 | 同步状态 | 上次时间
- 右侧：同步按钮（未登录时 disabled）
- 按钮文案用"🔄 同步"而非"同步到Mac mini"（节省空间）

### 2. 状态定义（5 种）

| 状态 | 图标 | 文字 | 触发条件 |
|------|------|------|---------|
| 未登录 | ⚪ | `未登录` | `!currentUser` |
| 已连接·最新 | 🟢 | `同步: 最新` | 上次同步 < 5 分钟且无错误 |
| 已连接·过期 | 🟡 | `同步: X分钟前` | 上次同步 ≥ 5 分钟且无错误 |
| 同步中 | 🔄 | `同步中...` | `syncInFlight === true` |
| 失败 | 🔴 | `同步失败` | `lastSyncError` 非空 |

服务器连接状态独立显示：
- `⚪ 未登录` — 未登录
- `🟢 Mac mini` — 已连接
- `🔴 Mac mini` — 连接失败
- `🟡 Mac mini` — 检测中

### 3. JavaScript 逻辑

#### 3.1 新增变量

```javascript
let lastSyncError = null;
let serverConnected = null; // null=未检测, true=已连接, false=未连接
```

#### 3.2 服务器连接检测

复用已有的 `/api/recovery/status` 接口（`checkRecoveryStatus` 已验证可用）：

```javascript
async function checkServerConnection() {
    const el = document.getElementById('sync-bar-server');
    if (!el) return;

    if (!currentUser || !serverUrl) {
        el.textContent = '⚪ 未登录';
        serverConnected = null;
        return;
    }

    try {
        await apiCall('/api/recovery/status');
        el.textContent = '🟢 Mac mini';
        serverConnected = true;
    } catch (e) {
        el.textContent = '🔴 Mac mini';
        serverConnected = false;
    }
}
```

#### 3.3 同步状态更新

```javascript
function updateSyncBar() {
    const stateEl = document.getElementById('sync-bar-state');
    const timeEl = document.getElementById('sync-bar-time');
    const btn = document.getElementById('sync-bar-btn');
    if (!stateEl) return;

    const canDoSync = canSync();
    btn.disabled = !canDoSync || syncInFlight;

    if (!currentUser) {
        stateEl.textContent = '同步: 未登录';
        timeEl.textContent = '';
        return;
    }

    if (syncInFlight) {
        stateEl.textContent = '🔄 同步中...';
        return;
    }

    if (lastSyncError) {
        stateEl.textContent = '🔴 同步失败';
        timeEl.textContent = lastSyncError;
        return;
    }

    const lastSync = localStorage.getItem('lastSyncTime');
    if (!lastSync) {
        stateEl.textContent = '⚪ 从未同步';
        timeEl.textContent = '';
        return;
    }

    const diffMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
    if (diffMin < 5) {
        stateEl.textContent = '🟢 同步: 最新';
    } else if (diffMin < 60) {
        stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin) + '分钟前';
    } else {
        stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin / 60) + '小时前';
    }
    timeEl.textContent = new Date(lastSync).toLocaleString();
}
```

#### 3.4 同步按钮处理

```javascript
async function handleSyncBarClick() {
    if (syncInFlight || !canSync()) return;
    const btn = document.getElementById('sync-bar-btn');
    btn.disabled = true;
    btn.textContent = '🔄 ...';
    lastSyncError = null;
    updateSyncBar();

    const ok = await runSync({ silent: false });

    btn.textContent = '🔄 同步';
    btn.disabled = false;
    updateSyncBar();
}
```

注意：`runSync({ silent: false })` 内部已经调用 `showStatus` 显示成功/失败消息，不需要额外 Toast。

#### 3.5 修改 `runSync` — 仅在 finally 中更新状态条

在 `runSync` 的 `try` 成功分支末尾：
```javascript
lastSyncError = null;
```

在 `runSync` 的 `catch` 分支：
```javascript
lastSyncError = e.message;
```

在 `runSync` 的 `finally` 分支末尾追加：
```javascript
updateSyncBar();
```

**不修改 `setSyncStatus` 函数**，避免闪烁。

#### 3.6 修复 `window.showSyncStatus` 缺失

db.js 第299行调用了 `window.showSyncStatus`，但 index.html 从未定义。新增：

```javascript
window.showSyncStatus = function(text) {
    setSyncStatus(text);
    updateSyncBar();
};
```

#### 3.7 初始化

在现有的 `DOMContentLoaded` 回调末尾追加：

```javascript
checkServerConnection();
updateSyncBar();
setInterval(checkServerConnection, 60000);
```

服务器连接检测 60 秒一次（轻量）。同步状态不需要额外轮询——已有的 4 秒自动同步轮询（`SYNC_POLL_MS = 4000`）会在每次 `runSync` 的 `finally` 中触发 `updateSyncBar()`。

### 4. 与现有代码的集成点

| 修改位置 | 修改内容 | 行数 |
|---------|---------|------|
| 第389行后 | 插入 `sync-bar` HTML | +8行 |
| 第6714行附近 | 新增 `lastSyncError`、`serverConnected` 变量 | +2行 |
| 第6960行 `runSync` | try 中加 `lastSyncError = null`，catch 中加 `lastSyncError = e.message`，finally 中加 `updateSyncBar()` | +3行 |
| 第6725行附近 | 新增 `checkServerConnection`、`updateSyncBar`、`handleSyncBarClick`、`window.showSyncStatus` | +55行 |
| DOMContentLoaded 回调 | 追加初始化调用 | +3行 |

**总计约 +71 行，不删除任何现有代码。**

### 5. 不修改的部分

- `setSyncStatus` 函数 — 不改
- `showStatus` 函数 — 不改，直接复用
- `toggleSync` / `toggleAutoSync` — 不改（它们调用 `restartSyncPolling` → `runSync` → `finally` → `updateSyncBar`，自动联动）
- 备份弹窗 — 不改
- 同步弹窗 — 不改
- db.js — 不改

## 影响范围

- **修改文件**：仅 `www/index.html`（+71行）
- **不修改**：`www/db.js`、`www/ai.js`、测试文件
- **兼容性**：所有现有功能不变，状态条是纯增量 UI

## 验证步骤

1. **未登录状态**：打开应用（未登录），状态条显示"⚪ 未登录 | 同步: 未登录"，按钮 disabled
2. **登录后连接检测**：登录后，状态条显示"🟢 Mac mini | 同步: 从未同步"，按钮可用
3. **手动同步**：点击"🔄 同步"，状态变为"🔄 同步中..."，完成后变为"🟢 同步: 最新"，`showStatus` 显示"同步完成"
4. **同步失败**：断开网络后点击同步，状态变为"🔴 同步失败"，`showStatus` 显示错误信息
5. **自动同步联动**：开启实时同步，添加一道题目，等待 4 秒自动同步，状态条自动更新为"🟢 同步: 最新"
6. **服务器断开**：关闭 Mac mini 服务器，等待 60 秒，状态条变为"🔴 Mac mini"

## 创建日期

2026-07-19

## 更新记录

- 2026-07-19 v1：初版方案（小米模型）
- 2026-07-19 v2：修订版，修复 7 个硬伤（复用已有接口、去掉冗余 Toast、增加失败状态追踪、修复 showSyncStatus 缺失）
