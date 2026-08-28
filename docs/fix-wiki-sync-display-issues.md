# Wiki Tab / 服务商 / 标签同步修复

## 问题摘要

1. 点击 Wiki Tab（🧠 知识）后内容区空白
2. 模型服务商数据没有在客户端同步显示（server 已存储 3 个，UI 拿不到）
3. 标签只有 42 个，但其实服务端有 53 个
4. 每次同步都报"token 已过期"导致静默失败

## 根因

### 1. Wiki Tab 空白
- 旧版 `app.js` 的 `showTab()` 使用 `classList.add/remove("hidden")`
- `src/index.html` 里 `<div id="tab-wiki" style="display:none">` 有内联 `display:none`（没有 `hidden` class）
- 按钮调用 `showTab('wiki', ...)` 构造的是 `wiki-tab`（tabName + "-tab"）xpath，但实际 ID 是 `tab-wiki`，所以永远找不到目标
- 结果：即便 classList/inline-style 一切 OK，showTab 也不能让 tab-wiki 显示出来

### 2. 服务商不显示
- `runSync()` 在 `pull` 后把 `pullResp.settings` 数据丢掉了，没有写入 localStorage

### 3. 标签数不全
- `runSync()` 的 `dbApplyRemoteSnapshot` 虽然能把服务端 53 个标签写入 IndexedDB，但由于 pull 结果经常被 token 过期吞噬，所以 UI 一次只显示本地那 42 个

### 4. 同步循环失败
- 浏览器里的 `apiToken` 变量在页面加载时读一次后不再刷新，但 token 30 天后过期
- 新 token 只有在 `doLogin` 流程中才会更新，老 token 没更新的情况下，所有 `/api/*` 请求都返回 401

## 修复

### 修改 showTab 使其同时兼容新旧命名

**app.js** (`public/app.js`)：

```javascript
function showTab(tabName, btn) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll('div[id$="-tab"]').forEach(el => {
      el.classList.add("hidden");
      el.style.display = '';
    });
    if (btn) btn.classList.add("active");
    let target = document.getElementById(tabName + "-tab");
    if (!target) target = document.getElementById("tab-" + tabName);  // 兼容 #tab-wiki 命名
    if (target) {
      target.classList.remove("hidden");
      target.style.display = '';
    }
}
```

- 保留 `.hidden` class 操作以兼容 E2E 测试 (`toHaveClass(/hidden/)`)
- 同时清理 inline style (`el.style.display = ''`) 覆盖 HTML 中 `style="display:none"` 硬编码
- 新增回退查找路径 `"tab-" + tabName` 以支持 `tab-wiki` 命名

**TypeScript** (`src/ui/common.ts`)：采用与 app.js 相同的实现。

**main.ts**：移除之前的错误 `showTabOverride` 强制赋值（其 `[id^="tab-"]` 选择器只匹配 `tab-wiki`，导致其他 tab 切换失效）。让 `assignIfMissing` 把 common.ts 的 showTab 挂上 window。

### 服务端 - push/pull 返回 PDF + wiki 数据

**`server/src/routes/sync.ts`**：
- pull 端返回 `wiki_pages/wiki_links/compile_jobs/settings`
- push 端解构并处理 `wiki/pages/links` 和 `compile_jobs`

**`server/src/services/sync-upsert.ts`**：
- 新增 `upsertWikiPage`/`upsertWikiLink`/`upsertCompileJob`
- `AppliedResult` 和 `createAppliedResult` 追加 wiki 字段

### 客户端 - 接收 settings 与 pdf/wiki 兜底

**`public/app.js` runSync()**：`pull` 成功后从 `pullResp.settings` 写入 `cloud_providers`/`current_provider_id` 到 localStorage，更新闭包变量。同时保留 local 已有数据时不会被空数组覆盖。

**`public/app.js` apiHeaders()**：每次调用从 localStorage 最新读取 token。

**`public/db.js`**：
- 添加 pdf_books/wiki_pages 等 localForage 兜底 storage 声明
- `dbBuildSyncPayload` 加入 pdf/wiki 系列字段
- `dbApplyRemoteSnapshot` 加入 pdf/wiki 表的 apply 循环

## 验证

- Tab 切换: #questions-tab 切换为 hidden class，#tags-tab 移除 hidden class ✓
- Wiki UI: 显示"📖 物理知识库" + 预算 + 操作按钮 ✓
- 云服务商: 3 个（openrouter, 商汤科技, 小米）✓
- 标签: TAGS_COUNT=53 ✓
- 服务端 push/pull wiki 往返测试 ✓
- npm run typecheck (client): 通过 ✓
- npm run build: 通过 ✓
- npx playwright test tests/ui-health.spec.js: 7 → 14 passed

### E2E 剩余 5 个失败说明（非本修复引入）

1. **题目管理页按钮存在**: `#floating-toggle-btn` 在 web 平台被 `applyPlatformUI()` 隐藏 (app.js:213)
2. **Tab 切换后所有按钮仍可见（回归测试）**: `pending-blank-tab` 在 web 平台被隐藏 (app.js:214)
3. **创建标签成功 / 题目创建完整流程**: 期望 count=1 但收到 50/51，是 IndexedDB 跨用例残留测试数据 (test isolation 问题)
4. **待处理 Tab 功能**: `pending-photos-tab` 在 web 平台被隐藏 (app.js:215)

以上属于 web 平台 UI 降级与测试数据隔离的既有问题，与本次 Wiki/服务商/标签修复无关。
