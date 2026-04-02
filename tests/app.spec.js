const fs = require("fs");
const { test, expect } = require("@playwright/test");

const QUESTION_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAMElEQVR4nO3NAQ0AAAgDINc/9K3hHFQgCimTmZmZmZmZmZmZmZmZmZmZmZmZ2Qe0EwEs1rR0XQAAAABJRU5ErkJggg==";
const ANSWER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAL0lEQVR4nO3NAQ0AAAgDILV/5y1hCIEgCg2ZmZmZmZmZmZmZmZmZmZmZmZmZmRm5A3vEAREY0k7BAAAAAElFTkSuQmCC";

async function selectOptionsByLabel(locator, labels) {
  await locator.evaluate((select, expectedLabels) => {
    Array.from(select.options).forEach((option) => {
      option.selected = expectedLabels.includes(option.textContent);
    });
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, labels);
}

async function createTag(page, name, color, expectedCount) {
  const nameInput = page.locator("#tag-name");
  const colorInput = page.locator("#tag-color");

  await nameInput.fill(name);
  await expect(nameInput).toHaveValue(name);
  await colorInput.fill(color);
  await page.locator("#tag-form button").click();
  await expect(page.locator("#tags-list .tag")).toHaveCount(expectedCount);
}

test.describe("本地题库主流程", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.__alerts = [];
      window.alert = (message) => {
        window.__alerts.push(String(message));
      };
    });

    await page.goto("/");
  });

  test("可以完成离线主流程并支持调试", async ({ page }, testInfo) => {
    const maliciousTagName = `<img src=x onerror="window.__tagXss=1">危险标签`;
    const normalTagName = "数学";
    const maliciousPaperName = `<img src=x onerror="window.__paperXss=1">期末卷`;

    await page.getByRole("button", { name: "标签管理" }).click();

    await createTag(page, maliciousTagName, "#ef4444", 1);
    await createTag(page, normalTagName, "#3b82f6", 2);

    const tagList = page.locator("#tags-list .tag");
    await expect(tagList).toHaveCount(2);
    await expect(tagList.first()).toContainText(maliciousTagName);
    await expect(tagList.nth(1)).toContainText(normalTagName);
    await expect(page.evaluate(() => Boolean(window.__tagXss))).resolves.toBe(false);

    await page.getByRole("button", { name: "题目管理" }).click();

    await page.locator("#question-image").setInputFiles({
      name: "question.png",
      mimeType: "image/png",
      buffer: Buffer.from(QUESTION_PNG_BASE64, "base64"),
    });
    await page.locator("#answer-image").setInputFiles({
      name: "answer.png",
      mimeType: "image/png",
      buffer: Buffer.from(ANSWER_PNG_BASE64, "base64"),
    });
    await selectOptionsByLabel(page.locator("#tag-select"), [maliciousTagName, normalTagName]);
    await page.locator("#question-form button").click();

    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
    await expect(page.locator("#status-message .status")).toHaveText("题目添加成功");

    await page.locator("#filter-tags .filter-tag").filter({ hasText: maliciousTagName }).click();
    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);

    await page.getByRole("button", { name: "标签管理" }).click();
    await page.locator("#tags-list .tag").filter({ hasText: maliciousTagName }).locator(".remove").click();

    await page.getByRole("button", { name: "题目管理" }).click();
    await expect(page.locator("#filter-tags .filter-tag").filter({ hasText: maliciousTagName })).toHaveCount(0);
    await expect(page.locator("#questions-list .question-card")).toHaveCount(1);

    await page.getByRole("button", { name: "试卷管理" }).click();
    await page.locator("#paper-name").fill(maliciousPaperName);
    await selectOptionsByLabel(page.locator("#paper-tag-select"), [normalTagName]);
    await page.locator("#paper-form button").click();

    const paperCard = page.locator("#papers-list .paper-card").first();
    await expect(paperCard).toContainText(maliciousPaperName);
    await expect(paperCard).toContainText("题目数量: 1");
    await expect(page.evaluate(() => Boolean(window.__paperXss))).resolves.toBe(false);

    const backupDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出备份" }).click();
    const backupDownload = await backupDownloadPromise;
    const backupPath = testInfo.outputPath(backupDownload.suggestedFilename());
    await backupDownload.saveAs(backupPath);

    const backupData = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    expect(backupData.questions).toHaveLength(1);
    expect(backupData.tags).toHaveLength(1);
    expect(backupData.question_tags).toHaveLength(1);
    expect(backupData.papers).toHaveLength(1);
    expect(backupData.paper_questions).toHaveLength(1);

    const pdfDownloadPromise = page.waitForEvent("download");
    await paperCard.getByRole("button", { name: "下载 PDF" }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = testInfo.outputPath(pdfDownload.suggestedFilename());
    await pdfDownload.saveAs(pdfPath);

    const pdfBuffer = fs.readFileSync(pdfPath);
    expect(pdfBuffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(pdfBuffer.byteLength).toBeGreaterThan(0);

    await page.getByRole("button", { name: "题目管理" }).click();
    await page.locator("#questions-list .question-card img").first().click();
    await page.locator("#question-modal .danger").click();

    await expect(page.locator("#questions-list .question-card")).toHaveCount(0);

    await page.getByRole("button", { name: "试卷管理" }).click();
    await expect(paperCard).toContainText("题目数量: 0");
  });
});
