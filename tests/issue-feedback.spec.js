const { test, expect } = require("@playwright/test");

async function openFeedbackModal(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    localStorage.setItem("serverUrl", "http://127.0.0.1:3000");
    localStorage.setItem("apiToken", "e2e-token");
  });
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, issue_number: 1, issue_url: "https://example.com/issues/1" }),
    })
  );
  await page.goto("/");
  await page.locator(".toolbar button.btn-warn").click();
  await page.locator("#open-feedback-btn").click();
  await expect(page.locator("#issue-feedback-modal")).toBeVisible();
}

test.describe("问题反馈", () => {
  test("从设置打开反馈弹窗并成功提交", async ({ page }) => {
    await openFeedbackModal(page);
    await page.locator("#feedback-title").fill("测试反馈标题");
    await page.locator("#feedback-description").fill("E2E 自动化提交测试");
    await page.locator("#feedback-submit-btn").click();
    await expect(page.locator("#status-message")).toContainText("反馈已提交");
    await expect(page.locator("#issue-feedback-modal")).not.toBeVisible();
  });

  test("未填标题时提示必填", async ({ page }) => {
    await openFeedbackModal(page);
    await page.locator("#feedback-submit-btn").click();
    await expect(page.locator("#feedback-status")).toContainText("请填写标题");
  });

  test("截图提示条在 Web 端不出现", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#feedback-prompt-bar")).toBeHidden();
  });
});
