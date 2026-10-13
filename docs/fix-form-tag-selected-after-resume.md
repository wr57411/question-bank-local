# 修复：后台恢复后已选标签不显示

## 问题

APP 切后台一段时间后返回，添加题目表单中搜索并点击标签，`#form-tag-selected` 区域不显示已选 chip，需重启 APP 才恢复。

## 根因

- `loadTags()`（async）完成后整体替换 `w.allTags` 引用，但从不调用 `renderFormSelectedTags()` 刷新已选区，后台恢复时同步轮询等触发 `loadTags()` 造成数据与显示脱节。
- `renderFormSelectedTags()` 原有两个静默失败点（元素不存在 / tagId 在 allTags 中找不到）无任何日志，问题难以定位。

## 修复（均在 src/ui/tag-manage.ts）

1. `loadTags()` 末尾新增 `renderFormSelectedTags()`，`w.allTags` 替换后已选区同步刷新。
2. `renderFormSelectedTags()` 增加防御性 `console.warn`：元素缺失、tagId 缺失时输出诊断信息。
3. `addFormTag()` 渲染后对比 `childElementCount`，未新增则 50ms 延迟重试一次（复用同一元素引用，覆盖节点瞬时被替换场景）。

## 验证

- `npm run typecheck` 通过
- 新增 `tests/form-tag-selection.spec.js`（手机视口 390px + assertVisiblyRendered + 截图）：
  - 搜索点击标签后 chip 实际可见（对比度/遮挡/截断检查）
  - ✕ 移除正常
  - 回归用例：显示被清空后 `loadTags()` 重新渲染（临时移除修复代码确认该用例失败，防回归有效）
- `tests/ui-health.spec.js` + `tests/quick-import-visibility.spec.js` + 新增 spec 共 34 项全部通过

## 关联

- 计划文档：docs/plans/2026-08-29-fix-tag-selection-display.md
- 创建日期：2026-08-29
- 关联模块：添加题目表单, 标签选择, loadTags
