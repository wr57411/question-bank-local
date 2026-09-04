const fs = require("fs");
const { test, expect } = require("@playwright/test");

async function createQuestionWithImage(page, { tagName, bookName, pageNumber }) {
  await page.evaluate(async (args) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = "#1B7A4E";
    ctx.font = "24px sans-serif";
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

async function createTag(page, name) {
  await page.getByRole("button", { name: "标签管理" }).click();
  await page.locator("#tag-name").fill(name);
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(1);
}

async function seedTaggedQuestion(page, tagName) {
  await createQuestionWithImage(page, {
    tagName,
    bookName: "人教版九上",
    pageNumber: "42",
  });
}

async function createPaperFromQuestions(page, name) {
  await page.evaluate(async (paperName) => {
    const questions = await window.dbGetAllQuestions();
    const q = questions.find((x) => !x.deleted_at);
    if (!q) throw new Error("没有可关联的题目");
    await window.dbCreatePaperFromExport(paperName, [q.id], null, null);
    await window.loadPapers();
  }, name);
}

test.describe("本地题库主流程", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
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

  test("标签名与试卷名中的 HTML 被转义，不会执行注入脚本", async ({ page }) => {
    const maliciousTagName = `<img src=x onerror="window.__tagXss=1">危险标签`;
    const maliciousPaperName = `<img src=x onerror="window.__paperXss=1">XSS期末卷`;

    await createTag(page, maliciousTagName);
    await expect(page.locator("#tags-list .tag").first()).toContainText(maliciousTagName);
    await expect.poll(() => page.evaluate(() => Boolean(window.__tagXss))).toBe(false);

    await seedTaggedQuestion(page, maliciousTagName);

    await createPaperFromQuestions(page, maliciousPaperName);
    await page.getByRole("button", { name: "试卷管理" }).click();

    const paperCard = page.locator("#papers-list .paper-card").first();
    await expect(paperCard).toContainText(maliciousPaperName);
    await expect(paperCard).toContainText("题目数量: 1");
    await expect.poll(() => page.evaluate(() => Boolean(window.__paperXss))).toBe(false);
  });

  test("带图题目可以导出为完整备份 JSON", async ({ page }, testInfo) => {
    await createTag(page, "数学");
    await seedTaggedQuestion(page, "数学");

    await page.getByRole("button", { name: "题目管理" }).click();
    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
    await expect(page.locator("#questions-list .question-card img").first())
      .toHaveAttribute("src", /^data:image\/(jpeg|png)/);

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

  test("试卷可以下载为合法 PDF", async ({ page }, testInfo) => {
    await createTag(page, "数学");
    await seedTaggedQuestion(page, "数学");

    await createPaperFromQuestions(page, "期末卷");
    await page.getByRole("button", { name: "试卷管理" }).click();

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

  test("移至垃圾篓后题目从列表移除，试卷题目数量归零", async ({ page }) => {
    await createTag(page, "数学");
    await seedTaggedQuestion(page, "数学");

    await createPaperFromQuestions(page, "期末卷");
    await page.getByRole("button", { name: "试卷管理" }).click();
    const paperCard = page.locator("#papers-list .paper-card").first();
    await expect(paperCard).toContainText("题目数量: 1");

    await page.getByRole("button", { name: "题目管理" }).click();
    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
    await page.locator("#questions-list .question-card img").first().click();
    await expect(page.locator("#question-modal")).toHaveClass(/active/);
    await page.locator("#question-modal").getByRole("button", { name: "移至垃圾篓" }).click();

    await expect(page.locator("#questions-list .question-card")).toHaveCount(0);
    await page.getByRole("button", { name: "试卷管理" }).click();
    await expect(paperCard).toContainText("题目数量: 0");
  });
});
