const { test, expect } = require("@playwright/test");
const { assertVisiblyRendered, captureForReview } = require("./helpers/visibility");

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

test.describe("PDF 预览改为应用内渲染", () => {
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
    });
    await page.reload();
  });

  test("预览在应用内弹窗渲染出 PDF，且不在公共目录写文件", async ({ page }) => {
    await createTag(page, "数学");
    await seedTaggedQuestion(page, "数学");

    await page.getByRole("button", { name: "题目管理" }).click();
    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);

    // 注入原生平台 mock，使预览走 native 路径（应用内渲染），并记录文件系统写入
    await page.evaluate(() => {
      window.__fsWriteCount = 0;
      window.__openCount = 0;
      const origOpen = window.open ? window.open.bind(window) : () => null;
      window.open = (...a) => { window.__openCount++; return origOpen(...a); };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {
          Filesystem: {
            writeFile: () => { window.__fsWriteCount++; return Promise.resolve(); },
            readdir: () => Promise.resolve({ files: [] }),
            getUri: () => Promise.resolve({ uri: "file://x" }),
            deleteFile: () => Promise.resolve(),
          },
          FileOpener: { open: () => Promise.resolve() },
          Browser: { open: () => Promise.resolve() },
        },
      };
    });

    await page.evaluate(() => window.exportSelectedOrAll());
    await expect(page.locator("#export-modal.active")).toBeVisible();

    await page.locator('#export-modal button:has-text("预览")').click();

    await expect(page.locator("#pdf-preview-modal.active")).toBeVisible();
    await expect(page.locator("#pdf-preview-canvas-wrap canvas")).toBeVisible();
    // 渲染完成：状态行隐藏
    await expect(page.locator("#pdf-preview-status")).toBeHidden({ timeout: 15000 });

    const canvasCount = await page.locator("#pdf-preview-canvas-wrap canvas").count();
    expect(canvasCount).toBeGreaterThan(0);

    await assertVisiblyRendered(page, "#pdf-preview-modal .modal-content", "预览弹窗卡片", { skipContrast: true });
    const canvas = page.locator("#pdf-preview-canvas-wrap canvas").first();
    await expect(canvas).toBeVisible();
    const drawn = await canvas.evaluate((el) => {
      if (!el.width || !el.height) return false;
      const ctx = el.getContext("2d");
      if (!ctx) return false;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let nonWhite = 0;
      for (let i = 0; i < data.length; i += 4 * 97) {
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) nonWhite++;
      }
      return nonWhite > 5;
    });
    expect(drawn, "预览画布应已渲染出 PDF 内容（非空白）").toBe(true);
    await captureForReview(page, "pdf-preview-inapp");

    // 关键证据：预览路径不应再调用文件系统写文件（避免公共目录残留）
    const fsWrites = await page.evaluate(() => window.__fsWriteCount || 0);
    const openCalls = await page.evaluate(() => window.__openCount || 0);
    expect(fsWrites, "预览不应写任何文件到文件系统").toBe(0);
    expect(openCalls, "预览不应再调用 window.open 跳出应用").toBe(0);

    // 关闭后弹窗消失
    await page.locator("#pdf-preview-modal .modal-content span:has-text(\"×\")").click();
    await expect(page.locator("#pdf-preview-modal.active")).toBeHidden();
  });
});
