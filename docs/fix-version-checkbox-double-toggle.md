# 修复版本勾选框点击不灵敏（label 双触发）

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-07-13
- **关联模块：** 版本勾选, 添加题目表单, 题目详情
- **影响文件：** www/index.html

## 问题现象

在添加题目栏目的"适用版本"区域，用户点击版本勾选框时：
1. 有时点击有反应（正常勾选/取消）
2. 有时点击后复选框"闪一下"但实际并未改变状态
3. 取消勾选时同样时灵时不灵

行为不可预期，严重影响使用体验。

## 根因分析

### 触发条件

在 Android WebView（Capacitor 环境）中，点击由 `<label>` 包裹的 `<input type="checkbox">` 时触发。

### 根因

`<label>` 元素包裹 checkbox 时，浏览器原生行为是：点击 label 区域会向内部 checkbox 转发一次 click 事件。但在 Android WebView 中，这个转发行为不稳定：

- **点击 label 文字区域**：浏览器向 checkbox 转发一次 click → checkbox 切换一次 → 正常
- **直接点击 checkbox**：浏览器原生 toggle 一次 + label 转发一次 → **双触发**，checkbox 切换两次又回到原状态 → "闪一下但没变"
- **WebView 触摸事件时序不一致**：有时转发生效有时不生效 → 间歇性失灵

## 修复方案

将所有"label 包裹 checkbox"的结构改为 `<div>` + 手动 click 处理，彻底消除浏览器原生 label 转发行为：

- div 的 `onclick`：判断 `event.target` 是否为 checkbox 本身
  - 是 → 让浏览器原生处理 toggle，div 不干预
  - 否 → 手动切换 `cb.checked`，调用 `updateStyle()` 更新样式
- checkbox 的 `onchange`：仅负责更新父 div 的样式

### 变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|-----|
| www/index.html (L2067-2095) | 修改 | `renderVersionCheckboxes()`: label→div，手动 click 处理 |
| www/index.html (L3496) | 修改 | `renderDetailContent()`: 详情页版本勾选 label→div |

### 核心逻辑

```javascript
// div 的 click 处理
wrap.onclick = (e) => {
    if (e.target === cb) return;  // 点击 checkbox 本身，让浏览器处理
    cb.checked = !cb.checked;      // 点击 div 其他区域，手动切换
    updateStyle();
};
// checkbox 的 onchange 只负责样式更新
cb.onchange = updateStyle;
```

## 验证结果

- [x] 原问题已修复 — label 双触发问题消除
- [x] 未引入新问题 — UI 健康检测 19/19 全部通过
- [x] 边界场景已测试 — 快速连续点击、点击文字区域、点击 checkbox 本身均正常
- [x] APK 已生成 — question-bank-local_20260713_160841.apk

## 经验总结

1. **移动端避免 label 包裹 input**：Android WebView 的 label click 转发不稳定，应使用 div + 手动 click 处理替代
2. **transition:all 慎用**：`transition:all .2s` 会对所有 CSS 属性产生过渡动画，应改为只过渡需要的属性（`border-color, background-color`）
3. **移动端点击区域**：checkbox 默认尺寸太小（约 16px），应显式设置 `width:18px;height:18px` 提升触控体验
