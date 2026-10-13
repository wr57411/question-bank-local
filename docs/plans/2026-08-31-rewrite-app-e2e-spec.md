# app.spec.js 重写计划（v2 · 已实测验证）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `tests/app.spec.js` 从「确定性失败」变为「稳定通过」，保留 XSS 防护、备份导出、PDF 下载三项覆盖，并补回「删题 → 试卷数量归零」；把两个 AI 用例从收集范围摘除，使 CI e2e 恢复绿灯。

**Architecture:** 不改任何产品代码。只动测试侧。**造题方式从「纯文字模式 UI 表单」改为「数据层 API 直接造带图题目」**——因为产品方向是「结构上不允许无图题目」，纯文字模式是短命通道，且 Web E2E 没有 Capacitor 相机无法走图片上传。数据层造题与本项目既有范式一致（`ui-health.spec.js:398` 直接调 `window.dbCreateTag()`），纯离线、不依赖服务端。

**Tech Stack:** Playwright，vite dev server（baseURL `http://127.0.0.1:3000`），jsPDF（Web 端 `doc.save()` 触发 download）。

**版本说明:** v1 计划基于纸面推断，已作废。v2 的每一条关键假设都在真实浏览器里跑过探针验证，结论见第一节。

---

## 一、实测验证结论（v2 的事实基础）

我写了一个临时探针 spec 在真实 Chromium 里跑通全流程（已删除），实测输出：

```
[globals] dbCreateQuestion / dbCreateTag / loadQuestions / loadPapers /
          dbCreatePaper / generatePaperPDF / exportAllData /
          showQuestionDetail / deleteQuestion  → 全部 "function"

[created] url head = data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/...   imgLen=2967
[card img] 是占位SVG? = false                    ← 造出的是真图，不是占位框
[paper]    question_count = 1
[after soft delete] {"cardCount":0,"paperCount":0}
[pdf]      DOWNLOAD_OK: 探针期末卷.pdf
[export]   DOWNLOAD_OK: question-bank-backup-2026-09-01.json

[A] __tagXss   = false    标签名原样渲染为文本，未执行注入
[C] __paperXss = false    试卷名同理，且「题目数量: 1」成立
[D] #question-modal .danger 匹配数 = 1，文案 = ["移至垃圾篓"]
[D] 删后题目卡片 = 0，试卷文案「题目数量: 0」
```

### 由此确立的 5 条事实

1. **数据层造带图题目可行**：`window.dbCreateQuestion(dataUrl, ...)` 中的 dataUrl 会经 `compressImage()`（该函数 `typeof input === 'string'` 分支直接吃 data URL，`public/db.js:53`）转成 `data:image/jpeg`，落库为真实图片。**题目带图，符合未来「必须有图」的结构约束。**
2. **图片必须由页面内 canvas 生成**：我最初用硬编码 PNG base64，`compressImage` 的 `img.onerror` 直接 reject 抛 `Event` 错误。改为 `canvas.toDataURL()` 后通过。**这是一个真实的坑，不要再用静态 base64。**
3. **软删题目后试卷 `question_count` 真的归零**：我此前纸面推断「question_count 只数 paper_questions 关联记录、不会随软删减少」是**错的**，实测为 0。因此第 4 条用例成立。
4. **`#question-modal .danger` 唯一匹配**，文案「移至垃圾篓」，可安全用作删除入口（不必担心相似题卡片的「移除关联」按钮抢匹配）。
5. **PDF 与导出在 Web 端都触发 Playwright download 事件**，且无 `alert` 弹出（说明没误走 native 分支）。

### 与 v1 的差异（v1 错在哪）

| 项 | v1 | v2 |
|---|---|---|
| 造题方式 | 纯文字模式 `#mode-text-btn` | 数据层 API 造**带图**题目 |
| 题目有无图 | 无图（未来会被结构禁止） | **有图**（符合未来约束） |
| 依据 | 纸面推断 | 探针实测 |
| 第 4 条用例 | 默认不补 | **补上**（用户要求 + 实测成立） |
| commit 步骤 | 每个 Task 有 | **全部删除**（提交由王先生决定） |

---

## 二、为什么旧测试挂（契约差异）

逐项比对 `tests/app.spec.js` 的每个选择器与 `src/` 当前实现。**标签管理、试卷管理、题目列表三大块契约完好**，失效的只有 4 处。

### 完好（沿用）

| 选择器 | 位置 |
|---|---|
| `#tag-name` / `#tag-color` / `#tag-form` / `#tags-list` + `.tag` + `.remove` | `index.html:368-374`，`tag-manage.ts:44` |
| `#paper-name` / `#paper-tag-select` / `#paper-form` / `#papers-list` + `.paper-card` | `index.html:393-402`，`paper-manage.ts:26-35` |
| `#questions-list` + `.question-card`、`#filter-tags` + `.filter-tag` | `index.html:349-360`，`question-core.ts:225` |
| Tab `题目管理/标签管理/试卷管理`（`<button class="tab">`） | `index.html:80-82` |
| `#question-modal` + `.danger`「移至垃圾篓」 | `index.html:677`、`733` |
| `exportAllData()` / `generatePaperPDF()` | `public/db.js:1807 / 1799`，由 `index.html:1341` 载入 |

### 失效（必须改）

| # | 旧依赖 | 当前事实 | 证据 |
|---|---|---|---|
| 1 | `#question-image` / `#answer-image` file input | **已移除**，改拍照/相册/跨页/悬浮窗四个按钮走 Capacitor 原生，Web 端无法注入文件 | `index.html:241-245`、`264-269` |
| 2 | `#tag-select`（题目表单 select multiple） | 改搜索式 `#form-tag-search` → `#form-tag-results > span` → `#form-tag-selected` | `tag-manage.ts:85` |
| 3 | `#status-message .status`「题目添加成功」 | success 路由改走 `#toast-msg` | `common.ts:33-36` |
| 4 | 按钮名「导出备份」 | 现在是 `📤 导出` | `index.html:72` |

**直接死因**：第 1 条 `page.locator("#question-image").setInputFiles(...)` 找不到元素 → 60s 超时。

---

## 三、重写后的用例结构

拆成 **4 条独立用例**（v1 是 3 条 + 90 行一条龙；拆分后任一条失败不阻塞其它）。

### 公共辅助函数

```js
const fs = require("fs");
const { test, expect } = require("@playwright/test");

// 在页面内用 canvas 生成图片 data URL，再经数据层造一道「带图」题目。
// 不用硬编码 base64 —— compressImage 的解图 onerror 会 reject（探针已验证这个坑）。
async function createQuestionWithImage(page, { tagName, bookName, pageNumber }) {
  await page.evaluate(async (args) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200; canvas.height = 150;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = "#1B7A4E"; ctx.font = "24px sans-serif";
    ctx.fillText("题目图片", 20, 80);

    const tags = await window.dbGetAllTags();
    const tag = tags.find((t) => t.name === args.tagName);
    if (!tag) throw new Error("标签不存在: " + args.tagName);

    await window.dbCreateQuestion(
      canvas.toDataURL("image/png"),
      null,
      [tag.id],
      0,
      null,
      [],
      { book_name: args.bookName, page_number: args.pageNumber, question_number: "1" }
    );
    await window.loadQuestions();
  }, { tagName, bookName, pageNumber });
}

// 试卷表单仍是真实的 <select multiple>，沿用旧写法
async function selectOptionsByLabel(locator, labels) {
  await locator.evaluate((select, expectedLabels) => {
    Array.from(select.options).forEach((option) => {
      option.selected = expectedLabels.includes(option.textContent);
    });
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, labels);
}
```

### 用例 1 — XSS 防护

```js
test("标签名与试卷名中的 HTML 被转义，不会执行注入脚本", async ({ page }) => {
  const maliciousTagName = `<img src=x onerror="window.__tagXss=1">危险标签`;
  const maliciousPaperName = `<img src=x onerror="window.__paperXss=1">XSS期末卷`;

  await page.getByRole("button", { name: "标签管理" }).click();
  await page.locator("#tag-name").fill(maliciousTagName);
  await page.locator("#tag-color").fill("#ef4444");
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(1);
  await expect(page.locator("#tags-list .tag").first()).toContainText(maliciousTagName);
  await expect(page.evaluate(() => Boolean(window.__tagXss))).resolves.toBe(false);

  await createQuestionWithImage(page, {
    tagName: maliciousTagName, bookName: "人教版九上", pageNumber: "42",
  });

  await page.getByRole("button", { name: "试卷管理" }).click();
  await page.locator("#paper-name").fill(maliciousPaperName);
  await selectOptionsByLabel(page.locator("#paper-tag-select"), [maliciousTagName]);
  await page.locator('#paper-form button[type="submit"]').click();

  const paperCard = page.locator("#papers-list .paper-card").first();
  await expect(paperCard).toContainText(maliciousPaperName);
  await expect(paperCard).toContainText("题目数量: 1");
  await expect(page.evaluate(() => Boolean(window.__paperXss))).resolves.toBe(false);
});
```

### 用例 2 — 备份导出

```js
test("带图题目可以导出为完整备份 JSON", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "标签管理" }).click();
  await page.locator("#tag-name").fill("数学");
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(1);

  await createQuestionWithImage(page, {
    tagName: "数学", bookName: "人教版九上", pageNumber: "42",
  });

  await page.getByRole("button", { name: "题目管理" }).click();
  await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
  // 确认卡片渲染的是真图而不是纯文字占位 SVG
  await expect(page.locator("#questions-list .question-card img").first())
    .not.toHaveAttribute("src", /%3Csvg|svg\+xml/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "📤 导出" }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(backupPath);

  const data = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  expect(data.questions).toHaveLength(1);
  expect(data.tags).toHaveLength(1);
  expect(data.question_tags).toHaveLength(1);
  expect(data.questions[0].question_image_url).toMatch(/^data:image\//);
});
```

### 用例 3 — PDF 下载

```js
test("试卷可以下载为合法 PDF", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "标签管理" }).click();
  await page.locator("#tag-name").fill("数学");
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(1);

  await createQuestionWithImage(page, {
    tagName: "数学", bookName: "人教版九上", pageNumber: "42",
  });

  await page.getByRole("button", { name: "试卷管理" }).click();
  await page.locator("#paper-name").fill("期末卷");
  await selectOptionsByLabel(page.locator("#paper-tag-select"), ["数学"]);
  await page.locator('#paper-form button[type="submit"]').click();

  const paperCard = page.locator("#papers-list .paper-card").first();
  await expect(paperCard).toContainText("题目数量: 1");

  const downloadPromise = page.waitForEvent("download");
  await paperCard.getByRole("button", { name: "下载 PDF" }).click();
  const download = await downloadPromise;
  const pdfPath = testInfo.outputPath("paper.pdf");
  await download.saveAs(pdfPath);

  const buf = fs.readFileSync(pdfPath);
  expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  expect(buf.byteLength).toBeGreaterThan(1000);
});
```

> **PDF 用例为什么用正常试卷名**：`generatePDF` 在 `pdf.ts:281` 用 title 拼文件名 `doc.save(fileName)`，恶意名里的 `<` `>` `"` 会进入 download 的 `suggestedFilename()`，落盘可能失败。XSS 覆盖由用例 1 独立承担，不污染这里。

### 用例 4 — 删除题目后试卷数量归零（本次补回）

```js
test("移至垃圾篓后题目从列表移除，试卷题目数量归零", async ({ page }) => {
  await page.getByRole("button", { name: "标签管理" }).click();
  await page.locator("#tag-name").fill("数学");
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(1);

  await createQuestionWithImage(page, {
    tagName: "数学", bookName: "人教版九上", pageNumber: "42",
  });

  await page.getByRole("button", { name: "试卷管理" }).click();
  await page.locator("#paper-name").fill("期末卷");
  await selectOptionsByLabel(page.locator("#paper-tag-select"), ["数学"]);
  await page.locator('#paper-form button[type="submit"]').click();
  const paperCard = page.locator("#papers-list .paper-card").first();
  await expect(paperCard).toContainText("题目数量: 1");

  // UI 删除路径：点卡片图 → 详情弹窗 → 移至垃圾篓
  await page.getByRole("button", { name: "题目管理" }).click();
  await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
  await page.locator("#questions-list .question-card img").first().click();
  await expect(page.locator("#question-modal")).toHaveClass(/active/);
  await page.locator("#question-modal .danger").click();   // 探针实测：唯一匹配「移至垃圾篓」

  await expect(page.locator("#questions-list .question-card")).toHaveCount(0);
  await page.getByRole("button", { name: "试卷管理" }).click();
  await expect(paperCard).toContainText("题目数量: 0");
});
```

### beforeEach

保留 `window.confirm/alert` stub 与 IndexedDB 残留清理（用例 4 的删除依赖 `confirm` 返回 true）：

```js
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.__alerts = [];
    window.alert = (message) => { window.__alerts.push(String(message)); };
  });

  await page.goto("/");
  await page.evaluate(async () => {
    const evilTags = await window.dbGetAllTags();
    for (const t of evilTags) {
      if (t.name && t.name.includes("危险")) await window.dbDeleteTag(t.id);
    }
    const evilPapers = await window.dbGetAllPapers();
    for (const p of evilPapers) {
      if (p.name && p.name.includes("XSS")) await window.dbDeletePaper(p.id);
    }
  });
  await page.reload();
});
```

---

## 四、任务清单

### Task 1: 从收集范围中排除两个 AI 用例

**Files:** Modify `playwright.config.js`（`defineConfig` 内，`testMatch` 之后）

```js
  testMatch: /(?<!unit\/).*\.spec\.js$/,
  // 2026-08-31 王先生裁决：端侧 AI 相关功能暂不维护，这两个用例不再运行。
  // 文件保留在 tests/ 以便日后恢复，仅从收集范围中排除。
  testIgnore: [
    /ai-simulation\.spec\.js$/,
    /ai-pipeline-e2e\.spec\.js$/,
  ],
```

**验证：** `npx playwright test --list --reporter=list`
**期望：** 输出不含这两个文件，其余 6 个 spec 仍在。

---

### Task 2: 重写 tests/app.spec.js

**Files:** Rewrite `tests/app.spec.js`

**Step 1 — 记录改动前的失败形态**
```bash
npx playwright test tests/app.spec.js --reporter=list --output=tmp/test-results-before
```
期望：1 failed，`locator.setInputFiles: Timeout ... waiting for locator("#question-image")`。

**Step 2 — 写入新文件**（内容见第三节）

**Step 3 — 跑新用例**
```bash
npx playwright test tests/app.spec.js --reporter=list --output=tmp/test-results-after
```
期望：4 passed。

**Step 4 — 防「假绿」验证**（每条用例临时改成必然失败，确认会红，再改回）
- 用例 1：`window.__tagXss` → `window.__alwaysUndefined` 应 fail
- 用例 2：`expect(data.questions).toHaveLength(1)` → `2` 应 fail
- 用例 3：`toBe("%PDF")` → `toBe("XXXX")` 应 fail
- 用例 4：删掉 `.danger` 点击那一行 → 应 fail 在「题目数量: 0」

---

### Task 3: 跑完整本地 CI 验证循环

按 `AGENTS.md` 顺序：
```bash
npm run typecheck
npm run test
npm run build
npx playwright test --reporter=list --output=tmp/test-results-final
```
期望：前三项通过；E2E 全绿。

> `npm run test` 中 `unit-tests/real-api.spec.js` 有 1 条挂起（真实 AI API 集成测试，CI 本就 `--exclude`），属已知现象。

**CI 影响：** `.github/workflows/ci.yml:37` 跑 `npx playwright test` 全量无 exclude，故这 3 条确定性失败会让 e2e 长期红灯，并**连带阻塞依赖它的 `build-apk` job**（`ci.yml:46`）。本计划落地后应转绿。

---

### Task 4: 更新文档索引

**Files:**
- Modify `AGENTS.md`「开发文档索引」新增一行：

| 文档名称 | 问题摘要 | 存储路径 | 创建日期 | 关联模块 |
|---|---|---|---|---|
| 重写 app.spec.js | 图片 file input 移除+标签选择改搜索式+状态提示走 toast+导出按钮改名；改用数据层造带图题目并拆分为 4 条独立用例 | docs/fix-app-spec-rewrite.md | 2026-08-31 | E2E, Playwright, 题目表单, 备份导出, PDF |

- Create `docs/fix-app-spec-rewrite.md`（记录契约差异表、探针验证结论、重写理由）

> **本计划不含任何 commit 步骤。** 全部改动留在工作树，是否提交由王先生决定。

---

## 五、对抗性自评（什么情况下这个结论不成立）

| 假设 | 失效条件 | 兜底 |
|---|---|---|
| 数据层造题长期有效 | `dbCreateQuestion` 从 `public/db.js` 迁到 TS 后签名变更（当前 TS 版在 `src/data/questions.ts:93`，参数是 URL string，与 legacy 的 File 参数不同） | 迁移发生时同步改探针；本计划所有调用都集中在 `createQuestionWithImage` 一个函数里，改动面可控 |
| 图片必须用 canvas 生成 | 硬编码 base64 会 reject（已实测） | 已固化进辅助函数，并写注释警示 |
| 软删后 `question_count` 归零 | 若将来 `dbGetAllPapers` 改为不重算（当前 `papers.ts:18-25` 每次重算） | 用例 4 会先红，届时按新语义调整断言 |
| `#question-modal .danger` 唯一匹配 | 若详情弹窗里新增相似题卡片，其「移除关联」也是 `.danger`（`question-detail.ts:185`） | 改用 `getByRole("button", { name: "移至垃圾篓" })`；当前无相似题，实测唯一 |
| 导出/PDF 走 download 而非 alert | 若页面被判定为 native（误设 `window.Capacitor`） | 探针实测 web 端无 alert；测试不注入 Capacitor stub |
| toast 断言不 flaky | `#toast-msg` 3 秒后隐藏，后续 toast 会覆盖 | 本计划**已不依赖 toast 断言**（改用列表计数 + download 内容校验），比 v1 更稳 |
| 两个 AI 用例排除后 CI 转绿 | 还有别的用例在 CI Linux 上失败（本机 macOS，无法完全复现） | 落地后看一次真实 CI 结果 |

## 六、关于「使用测试账号」的建议（需王先生裁决）

您提到可以用 `E2E_TEST_PHONE` 测试账号调主账号的题目。我调研了既有基建，结论是**本次不建议走这条路**，理由如下：

**既有基建：** `docs/e2e-test-account.md` + `server/scripts/e2e-account-reset.mjs`，可把主账号的活跃标签/题目（**含题目图片，data:URL 内嵌**）快照复制到测试账号。

**但现有 E2E 范式是纯离线的。** `tests/ui-health.spec.js:352` 明确写着：

> 账号隔离：以下用例全部只操作 localStorage / 本地 IndexedDB，**不登录、不同步、不调服务端**。

也就是说测试账号机制目前是给 AI 测试 harness 用的，常规 E2E 从未登录过。

**走测试账号的代价：**
1. 要起服务端（`:3001`）+ 跑 reset 脚本（依赖 `.env` 的 `MAIN_ACCOUNT_PHONE` 等凭据），CI 需新增 job 并配 secrets
2. E2E 从离线单元测试性质变成集成测试，flaky 风险上升
3. **断言会失去确定性**：主账号数据会变（今天 59 道题，明天可能不同），`expect(data.questions).toHaveLength(1)` 这类断言将不再成立，得改成动态计算，可诊断性下降

**而实测证明，离线数据层造题已经能造出带真实图片的题目**，完全满足这 4 条用例的需求，且不增加任何 CI 复杂度。

**建议：** 本次走离线数据层方案。测试账号通路保留，日后若需要「真实数据规模的 PDF 导出性能」这类测试再启用。

**若您仍要求走测试账号，请告知**，我会另出一版计划（含服务端启动、登录流程、pull 同步、CI secrets 配置）。

## 七、其它存疑点

1. **`www/` 目录**按您裁决不动。但 `src/index.html:1341-1343` 仍加载 `public/db.js` + `public/ai.js` + `main.ts`。`exportAllData` / `generatePaperPDF` / **`dbCreateQuestion`** 都来自这个 2026-08-15 的 legacy bundle。**清理 `public/` 会立刻断掉这 4 条用例**——本计划新增了对 `dbCreateQuestion` 的依赖，风险比 v1 更高，特此备案。
2. **提交**：Task 1、2、4 的改动全部留在工作树，等您决定。
