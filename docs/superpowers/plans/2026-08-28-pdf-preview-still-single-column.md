# PDF 预览仍为单栏——重新打包 APK 分发新引擎 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根因确认"预览 PDF 仍为单栏"源于手机上的 APK 是 2026-06-02 旧包（不含 v5 引擎与 layout_type 映射），通过统一提交 + ship-feature 重新打包并指导安装验证，使预览 PDF 呈现自动混排。

**Architecture:** 无代码改动（映射与引擎已在工作区完成并验证）。流程为：统一提交两批工作 → 按 AGENTS.md 调用 ship-feature skill 打包（vite build → cap sync android → gradle assembleDebug）→ 校验 APK 产物 → 给出安装后的人工验收清单。

**Tech Stack:** 既有 ship-feature.sh 流程（Capacitor 6 + Gradle）。

---

## 背景与根因证据（执行者必读）

1. **症状**：用户在 APP 内预览导出 PDF，全部题目仍为整图全宽单栏（双栏标注未生效）。
2. **根因证据链**：
   - `PROJECT_MEMORY.md` 最新 ship 记录为 `20260602_111154`（6 月 2 日）——此后再无打包；本会话完成的 PDF 排版引擎 v5（planLayout、长图切割）与 layout_type 自动映射只存在于工作区，从未进入 APK。
   - [capacitor.config.ts](file:///Users/john/.codex/worktrees/f640/question-bank-local/capacitor.config.ts) `webDir: 'dist'`；[scripts/ship-feature.sh](file:///Users/john/.codex/worktrees/f640/question-bank-local/scripts/ship-feature.sh) 流程为 `npx vite build` → `npx cap sync android` → `./gradlew clean assembleDebug`——APK 内容 = 打包时刻的 dist。
   - 工作区 `dist/assets/index-C8W230C_.js` 已含 `layout_type===1` 映射（本会话 Task 3 build 产物），但从未 `cap sync` 进 APK。
   - 6 月 2 日旧包的导出实现为 `db.js` 旧版 `generatePDF`（整图全宽单栏、无切割）→ 与用户所见症状完全一致。
3. **关联说明**：题目列表冷启动卡 3~4 秒是旧代码既有问题（`dbGetAllQuestions` 每题双 `JSON.stringify` + `_migrateQuestionNotes` 每次启动 63 次串行查询），**新 APK 不会自动解决**，用户已指示"先放一边"，单独排期修复（根因已定位，方案已给用户）。
4. **预期新 APK 行为**：预览 PDF 中 `layout_type===1`（全库 54 题）按半宽双栏排版（可两题并排、长图切割），`layout_type===0`（9 题）单栏全宽；同页不混排、组间翻页；弹窗布局方式为「题目跟答案挨着 / 题目/答案分开」二选。
5. **规范**：AGENTS.md 要求打包前必须先调用 `ship-feature` skill 并按其步骤执行；git 提交需用户确认（本计划 Task 1 即为该确认动作的执行）。

## File Structure

无源码改动。涉及产物：git 提交（两批工作）、`question-bank-local_<时间戳>.apk`（原项目根目录）、`PROJECT_MEMORY.md`（ship 脚本自动追加记录）。

---

### Task 1: 统一提交两批已完成工作

**Files:**
- git add + commit（变更清单见下）

- [ ] **Step 1: 向用户展示 `git status` 与提交范围，确认后执行**

提交范围（不含无关的 `ocr-server/ocr_core.py` 与环境目录）：

```bash
git add src/types/pdf.ts src/types/index.ts src/data/pdf-layout-engine.ts src/data/pdf-image.ts src/data/pdf-font.ts src/data/pdf.ts src/index.html src/ui/export-pdf-ui.ts src/main.ts unit-tests/pdf-layout-engine.spec.js unit-tests/pdf-image.spec.js unit-tests/pdf-generate.spec.js docs/pdf-layout-engine-v5.md AGENTS.md
git commit -m "PDF导出接入自动分组排版引擎 - layout_type快速映射自动混排+长图切割+修复试卷导出空白页"
```

- [ ] **Step 2: 确认提交成功**

Run: `git log --oneline -1 && git status --short | grep -E "src/|unit-tests/" | head`
Expected: 新提交出现在顶部；src/unit-tests 相关变更已清空（仅剩 ocr-server 与环境目录）。

---

### Task 2: ship-feature 打包新 APK

- [ ] **Step 1: 调用 ship-feature skill 并按其步骤执行**

使用 Skill 工具调用 `ship-feature`（AGENTS.md 强制要求），随后执行：

```bash
npm run ship -- "PDF导出接入自动分组排版引擎 layout_type快速映射自动混排"
```

ship 内部流程：`npx vite build` → `npx cap sync android` → `cd android && ./gradlew clean assembleDebug` → 复制 APK 到原项目根目录并追加 PROJECT_MEMORY.md 记录。

Expected: 构建成功，输出 `question-bank-local_<YYYYMMDD_HHMM>.apk`。

- [ ] **Step 2: 校验产物**

Run: `ls -la question-bank-local_2026*.apk | tail -3 && ls -lt PROJECT_MEMORY.md`
Expected: 出现新时间戳 APK（大小与旧包同量级，约 10~30MB）；PROJECT_MEMORY.md 修改时间为当前。

- [ ] **Step 3: 校验 APK 内 web 资产含新引擎**

```bash
unzip -l question-bank-local_<新时间戳>.apk | grep "public/index.html" && unzip -p question-bank-local_<新时间戳>.apk "public/assets/index-*.js" | grep -c "layout_type"
```

（若 unzip 不可用或路径不同，改用 `npx cap sync android` 后直接检查 `android/app/src/main/assets/public/assets/index-*.js` 是否含 `layout_type===1`。）
Expected: 计数 > 0，证明新代码已进包。

---

### Task 3: 交付验收清单（人工验证）

- [ ] **Step 1: 安装并验收**

将新 APK 安装到设备（覆盖安装保留数据），按以下清单验收：

1. 打开 APP → 题目列表 → 勾选若干题目（含"单双栏均可"标注的题）→ 导出 PDF → 预览：
   - 双栏标注题按**半宽**排版（一页可左右两题并排），不再整图全宽
   - 单栏标注题全宽；单栏组在前、双栏组在后、组间翻页
   - 超长题图被切割为多段连续排版（黄色切割线）
2. 导出弹窗布局方式只有「📄 题目跟答案挨着」「📑 题目/答案分开」两项
3. 试卷管理 → 任一试卷 → 下载 PDF：不再是只有标题的空白页（merged 空白 bug 修复验证）

- [ ] **Step 2: 向用户报告结果与后续项**

告知：列表冷启动卡顿为旧代码既有问题（根因已定位：dbGetAllQuestions 每题双 JSON.stringify + 启动迁移阻塞），新 APK 仍会存在，待用户确认后单独修复。

---

## Self-Review 结论

1. **Spec 覆盖**：根因（旧 APK）→ 背景证据链；解决（新代码进包）→ Task 1 提交 + Task 2 打包 + Step 3 包内校验；验收 → Task 3 清单。
2. **占位符扫描**：无 TBD；所有命令具体。
3. **类型一致性**：无类型改动；校验命令中的 APK 文件名为执行时产物占位符（`<新时间戳>` 以 `ls` 实际输出为准，属执行时变量非计划缺口）。
