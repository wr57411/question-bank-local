# 题目列表勾选框：缩小可见尺寸 + 扩展触控热区 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把题目卡片左上角的勾选框可见尺寸从 40×40 缩到 24×24（不再遮挡题目图片内容），同时用透明伪元素把触控热区补到 44×44px，保持「热区内切换选中、热区外弹详情」的原有交互不变。

**Architecture:** 纯 CSS 改动（一处规则 + 一条伪元素规则）。可见框 24×24 加 `padding:0` 抵消全局 button 内边距；`.q-checkbox::after{inset:-10px}` 生成 44×44 透明热区——伪元素点击归属于宿主 button，因此天然沿用既有 `stopPropagation`，不会误触详情弹窗。不触碰 TS/HTML。

**Tech Stack:** CSS Grid 布局 + 伪元素热区；Playwright E2E 验证（含坐标点击与 boundingBox 断言）。

**项目硬规则（覆盖 skill 默认行为，执行者必须遵守）：**
- **禁止 git commit / push**——改完等用户检查统一提交。
- 所有 node 命令加 `NODE_OPTIONS= ` 前缀；测试产物只许落 `tmp/`；长命令走 background + TaskOutput。
- **UI 改动必须截图 + 实际 Read 人工确认**（AGENTS.md 强制），且 `captureForReview` 前先 `scrollIntoViewIfNeeded`（否则视口截图拍不到列表）。
- 客户端源码不加注释；只动被点名的位置。

---

## 背景与根因（2026-09-07 用户真机反馈）

单栏布局上线后题目图片全宽清晰可读，但左上角 40×40 白色勾选框明显压在题目图片上（遮挡题干起始内容）。

**关键陷阱（本轮实测发现，务必注意）**：全局 `main.css:86`

```css
button{background:linear-gradient(...);padding:12px 24px;border:none;border-radius:...;...}
```

会把 `.q-checkbox` 的 `width:24px` 撑成 **实测 48×48**。机理：全局 `*{box-sizing:border-box}`（main.css:44）下，全局 `button` 规则的 `padding:12px 24px` 令**水平 padding 合计 48px 超过指定的 `width:24px`**，盒子被撑到 48px 宽（不是 content-box 相加）。**只改 width/height 无效，必须显式 `padding:0` 抵消**。这正是当前 spec 用例 1 仍失败（报「实际 48」）的原因——不要误判为测试写错。

**不要修改全局 `button` 规则**，只在 `.q-checkbox` 上覆盖（最小改动原则）。

## 取值方案

| 项目 | 取值 | 说明 |
|------|------|------|
| 可见尺寸 | **24×24 px** | 配合 `padding:0` 与 `font-size:14px`（✓ 字形变小）；`box-shadow` 降为 `--shadow-sm` |
| 触控热区 | **44×44 px** | `.q-checkbox::after{content:"";position:absolute;inset:-10px}` → 24 + 10×2 = 44，透明、不占布局、不影响可见面积 |
| 位置 | `top:6px; left:6px` 不变 | 热区左上溢出卡片 4px，卡片 `overflow:visible` 且卡片间距 16px，无相邻元素冲突 |
| 交互 | 不变 | `question-core.ts:120-123` 的 `cb.onclick` 已有 `ev.stopPropagation()`；伪元素点击归属 button，走勾选逻辑，不冒泡到 `img.onclick`（`showQuestionDetail`） |

---

### Task 1: 补 `padding:0` 并跑通 spec

**Files:**
- Modify: `src/styles/main.css:164-165`（`.q-checkbox` 规则 + 新增伪元素热区）
- Test: `tests/question-checkbox-hit-area.spec.js`（已存在，勿改断言语义）

**Step 1: 当前规则（已改过一轮但被 padding 撑大）**

```css
.q-checkbox{position:absolute;top:6px;left:6px;width:24px;height:24px;...;font-size:14px;...;box-shadow:var(--shadow-sm)}
.q-checkbox::after{content:"";position:absolute;inset:-10px}
```

**Step 2: 在 `.q-checkbox` 规则内添加 `padding:0`**（抵消全局 button 的 `padding:12px 24px`，这是让可见尺寸真正变成 24×24 的关键）

```css
.q-checkbox{position:absolute;top:6px;left:6px;width:24px;height:24px;padding:0;border-radius:...;...}
```

**Step 3: 运行 spec**

```bash
cd /Users/john/WorkBuddy/Worktrees/question-bank-local/f640-main2-de235076
NODE_OPTIONS= E2E_SCREENSHOT_DIR="$PWD/tmp/screenshots-single-column" \
  npx playwright test tests/question-checkbox-hit-area.spec.js \
  --reporter=list --output="$PWD/tmp/test-results-checkbox-post" 2>/dev/null
```

Expected: **6 passed**（stderr 的 RLZ/code_sign_clone 沙箱噪音忽略，以 stdout 为准；含夹逼用例「+9px 命中 / +14px 出热区」，把 44×44 硬指标钉进测试）。

**Step 4: 若仍失败**，用 `page.evaluate` 读 `getComputedStyle(el).width/height/padding` 定位，别靠猜。

**Step 5: 报告完成，不 commit。**

---

### Task 2: 截图人工确认

**Step 1: 截图已由 spec 生成**（`tmp/screenshots-single-column/勾选框缩小后-单栏.png`）。

**Step 2: 必须实际 Read 该图**，确认三点：勾选框明显变小、不压住题干起始文字、✓ 字形清晰可辨。

---

### Task 3: CI 循环

```bash
NODE_OPTIONS= npm run typecheck        # Expected: 通过
NODE_OPTIONS= npm run test             # Expected: 279 passed
NODE_OPTIONS= npm run build            # Expected: 成功
NODE_OPTIONS= npx playwright test --reporter=list --output="$PWD/tmp/test-results-checkbox-full" 2>/dev/null   # 全量 E2E，约 11 分钟
```

全量 E2E 预期与上一轮基线一致（77 passed）。若下降，先判定是否本次改动引起（勾选框被别处点击/断言依赖旧尺寸）。

---

### Task 4: 文档收尾

**Files:**
- Modify: `docs/question-list-layout-toggle.md`（追加「勾选框可见尺寸与热区」一节：根因含全局 button padding 陷阱、取值、验证记录）
- Modify: `AGENTS.md` 开发文档索引（该行摘要追加勾选框调整）

**不 commit**，汇总「改动清单 + 取值说明」交用户检查。

---

## 验收清单

- [x] spec 6 passed（可见 23~28px、热区外 6px 命中、夹逼 +9/+14 钉住 44×44、防误触守卫、中心点击）
- [x] 截图经人工 Read 确认（勾选框变小、不遮题干）
- [x] typecheck / test（279）/ build / 全量 E2E（83 passed）全绿
- [x] 热区 ≥44×44 且可见面积未增大（两项由同一伪元素同时满足）
- [ ] 未 commit，等待用户检查
