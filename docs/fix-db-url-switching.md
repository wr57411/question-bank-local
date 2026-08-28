# 修复测试库 URL 参数隔离失效

## 问题

`?db=questionBank-test` URL 参数本应让网页测试端读写独立的 IndexedDB 数据库（与原库 `questionBank` 隔离），但实际效果是：测试端和原库共写同一个 `questionBank`。

**根因**: `public/db.js` 头部所有 localforage 实例硬编码 `name: 'questionBank'`：

```js
const dbTags = localforage.createInstance({ name: 'questionBank', storeName: 'tags' });
```

虽然 `src/data/stores.ts` 已加 `getDbName()` 读 URL 参数，但 `src/main.ts` 用 `assignIfMissing` 挂载，**绝不覆盖已存在的全局函数**；而 `src/index.html` 先加载 `public/db.js`（定义了 dbTags 等），所以 TS 模块始终不被使用。真正在跑的 data layer 是 `db.js`。

## 修复

在 `public/db.js` 顶部加 `getDbName()` 并替换所有 `name: 'questionBank'` 为 `name: DB_NAME`（22 个 store）。逻辑与 `src/data/stores.ts` 完全一致：优先读 URL `?db=xxx`，正则校验只允许 `[a-zA-Z0-9_-]+`，fallback 到 `questionBank`。

## 影响模块

- `public/db.js`（22 处替换） + 新增 `getDbName()` + `DB_NAME`

## 不涉及边界

- 服务端代码
- `src/data/sync.ts` 中的 `dbSyncMeta` 改动（保留但当前未充分利用）
- 任何未带 `?db=` URL 参数的原库用户（完全走 fallback，行为不变）

## 事后验证

1. 访问 `localhost:3000/` → 标签页 → 应看到原库标签（51 个）
2. 访问 `localhost:3000/?db=questionBank-test` → 标签页 → 默认空库
3. 在测试库点击同步 → 服务端 pull → 测试库应出现 51 个标签
4. 在原库新增/删除一个标签 → 切换测试库应不受影响（独立数据库）
