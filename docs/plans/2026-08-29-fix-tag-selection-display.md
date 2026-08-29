# 修复：标签搜索添加后已选标签不显示的 BUG

## 问题描述

**现象**：过段时间再次进入 APP 并添加新题目时，在标签搜索框中选中标签后，下方 `form-tag-selected` 区域不显示已选中的标签。需要退出 APP 重启才会恢复正常。

**复现路径**：
1. 使用 APP（标签功能正常）
2. 将 APP 切换到后台，放置一段时间
3. 返回 APP，打开添加题目表单
4. 在标签搜索框中搜索并点击标签
5. **BUG**：标签不会出现在「已选标签显示在下方」区域

## 根因分析

### 代码追踪

**关键文件**：
- `src/ui/tag-manage.ts` — 标签选择核心逻辑
- `src/ui/question-core.ts` — 添加题目表单逻辑
- `src/index.html:295-304` — 标签选择区域 DOM 结构

**数据流**：

```
用户点击搜索结果标签
  → addFormTag(tagId)           // tag-manage.ts:127
    → formSelectedTagIds.push(tagId)
    → renderFormSelectedTags()   // tag-manage.ts:151
      → 获取 #form-tag-selected 元素
      → 遍历 formSelectedTagIds
      → 对每个 id 在 w.allTags 中查找 tag 对象
      → 创建 chip 元素追加到 #form-tag-selected
```

### 定位的根因

**`loadTags()` 与用户操作的竞态条件**是最大嫌疑：

1. APP 从后台恢复后，同步轮询 (`sync-ui.ts`) 或其他触发源调用 `refreshAll()` → `loadTags()`
2. `loadTags()` 是 **async 函数**（tag-manage.ts:27）：
   ```js
   w.allTags = await w.dbGetAllTags();  // ← await 等待 IndexedDB
   // ... 后续操作 ...
   if (document.getElementById('form-tag-results')) onFormTagSearch();
   ```
3. **关键缺陷**：`loadTags()` 完成后重新赋值 `w.allTags`，但 **从不调用 `renderFormSelectedTags()`** 来刷新已选标签显示
4. 更危险的是：如果在 `await dbGetAllTags()` 期间用户选择了标签：
   - `addFormTag()` 调用 `renderFormSelectedTags()`
   - 此时 `w.allTags` 还是**旧引用**（await 还没 return）
   - 标签能正常显示 ✅
5. 但当 `await` 完成后，`w.allTags` 被**替换为新数组**
   - 新数组的 tag 对象与 `formSelectedTagIds` 中的 id 仍然匹配（id 是稳定的）
   - 所以后续 `renderFormSelectedTags()` 理论上仍应工作...

### 更可能的直接原因：`renderFormSelectedTags()` 静默失败

```js
// tag-manage.ts:151-163
export function renderFormSelectedTags(): void {
  const div = document.getElementById('form-tag-selected');
  if (!div) return;  // ← 静默返回，无任何提示
  div.innerHTML = '';
  formSelectedTagIds.forEach(tagId => {
    const tag = w.allTags.find((t: any) => t.id === tagId);
    if (!tag) return;  // ← 静默跳过，无任何提示
    // ... 创建元素 ...
  });
}
```

两个静默失败点：
1. **`#form-tag-selected` 元素不存在** — 如果父容器被某个操作重建了 DOM
2. **`w.allTags.find()` 找不到 tag** — 如果 `w.allTags` 为空或 tag 数据不一致

**最可能场景**：APP 从长时间后台恢复后，Capacitor/Android 系统 可能触发了部分 WebView 重建或 DOM 异步渲染延迟，导致短时间内 `document.getElementById('form-tag-selected')` 返回 null。

### 辅助因素：轮询定时器状态异常

```js
// tag-manage.ts:18-24
export function _startFormTagPoll(): void {
  _formTagLastVal = '';
  _formTagPollTimer = setInterval(() => {
    // ...
  }, 150);
}
```

- 用户聚焦搜索框时启动 150ms 轮询
- APP 进入后台后，输入框可能不会触发 blur 事件
- 系统可能暂停/堆积定时器回调
- 恢复后可能出现定时器爆发式触发，导致快速连续执行 `onFormTagSearch()`
- 虽然这不直接影响 `form-tag-selected`，但增加了不稳定性

## 修复方案

### 修复点 1：`loadTags()` 完成后同步刷新已选标签显示

**文件**：`src/ui/tag-manage.ts` — `loadTags()` 函数

**变更**：在 `loadTags()` 末尾增加 `renderFormSelectedTags()` 调用

```js
export async function loadTags(): Promise<void> {
  w.allTags = await w.dbGetAllTags();
  w.activeFilterTags = w.activeFilterTags.filter((id: string) => w.allTags.some((t: any) => t.id === id));
  renderTags(); updateTagSelects(); renderFilterTags();
  if (document.getElementById('form-tag-results')) onFormTagSearch();
  renderFormSelectedTags(); // ← 新增：保持已选标签显示与 allTags 同步
}
```

**理由**：`loadTags()` 替换了 `w.allTags` 引用，必须刷新依赖它的 `renderFormSelectedTags()`。

### 修复点 2：`renderFormSelectedTags()` 增加防御性日志和重试

**文件**：`src/ui/tag-manage.ts` — `renderFormSelectedTags()` 函数

**变更**：
- 当 `#form-tag-selected` 不存在时，打印 console.warn
- 当 tag 在 `w.allTags` 中找不到时，打印 console.warn（包含缺失的 id 列表）
- 这些日志不影响生产环境性能，但对调试至关重要

### 修复点 3：`addFormTag()` 增加操作后验证

**文件**：`src/ui/tag-manage.ts` — `addFormTag()` 函数

**变更**：在 `renderFormSelectedTags()` 调用后，做一次轻量验证——检查 `#form-tag-selected` 是否确实包含了新添加的子元素。如果不包含，延迟 50ms 重试一次（覆盖 DOM 渲染延迟场景）。

## 影响范围

| 模块 | 影响 |
|------|------|
| `src/ui/tag-manage.ts` | 修改 `loadTags()`、`renderFormSelectedTags()`、`addFormTag()` |
| 添加题目表单 | 间接影响（标签选择行为更稳定） |
| 标签管理页面 | `loadTags()` 是共享函数，`renderFormSelectedTags()` 只影响表单内标签 |

## 不涉及的边界

- 不修改 DOM 结构（`index.html` 不变）
- 不改变标签数据模型
- 不涉及服务端/同步逻辑
- 不影响题目列表中的行内标签添加功能（独立代码路径）

## 验证方法

1. **手动测试**：
   - 打开 APP → 添加题目 → 搜索并选标签 → 确认标签显示在下方 ✅
   - 将 APP 切到后台 ≥ 5 分钟 → 回到前台 → 重复上述步骤 ✅
   - 添加题目提交后，确认已选标签被清空 ✅

2. **E2E 测试**：
   - 复用现有 `tests/quick-import-visibility.spec.js` 模式
   - 新增标签选择的可见性断言
