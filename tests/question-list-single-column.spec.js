const { test, expect } = require("@playwright/test");
const { captureForReview } = require("./helpers/visibility");

// 防回归：题目列表单栏/双栏布局切换
// 需求（2026-09-06）：
//   1. 支持手动切换单栏/双栏，默认单栏（手机双栏下题目照片被压到约 85×110px，看不清）
//   2. 切换后界面即时更新，无需刷新
//   3. 选择持久化到 localStorage，下次打开自动应用

const GRID_TOGGLE = "#grid-layout-toggle";

async function mockApp(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    window.Capacitor = { getPlatform: () => "android", Plugins: {} };
  });
  await page.goto("/");
}

// 300×400 竖版 SVG（模拟手机拍摄的题目照片比例）
const PORTRAIT_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect fill="#E8F5EE" width="300" height="400"/><text x="150" y="200" text-anchor="middle" font-size="40" fill="#1B7A4E">题目照片</text></svg>'
  );

async function seedQuestions(page, imageDataUrl, count) {
  await page.evaluate(
    async ({ src, n }) => {
      for (let i = 0; i < n; i++) {
        await dbCreateQuestion(src, null, [], 0, null, []);
      }
      await loadQuestions();
    },
    { src: imageDataUrl, n: count }
  );
  await expect(page.locator("#questions-list .question-card")).toHaveCount(count);
}

async function gridTrackCount(page) {
  const value = await page
    .locator("#questions-list")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return { value, count: value.trim().split(/\s+/).length };
}

test.describe("题目列表布局切换（手机视口 390×844）", () => {
  test("默认单栏：无缓存时列表解析为单轨道，卡片独占一行", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedQuestions(page, PORTRAIT_SVG, 2);

    const { value, count } = await gridTrackCount(page);
    expect(count, `默认应为单栏单轨道，实际 grid-template-columns="${value}"`).toBe(1);

    const stored = await page.evaluate(() => localStorage.getItem("question-grid-layout"));
    expect(stored === null || stored === "single", `默认无缓存或为 single，实际 "${stored}"`).toBe(true);

    const containerWidth = await page
      .locator("#questions-list")
      .evaluate((el) => el.getBoundingClientRect().width);
    const cards = page.locator("#questions-list .question-card");
    for (let i = 0; i < 2; i++) {
      const box = await cards.nth(i).boundingBox();
      expect(Math.abs(box.width - containerWidth), `第 ${i + 1} 张卡片应独占一行`).toBeLessThanOrEqual(1);
    }
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(second.y, "第二张卡片应位于第一张下方（垂直滚动浏览）").toBeGreaterThanOrEqual(
      first.y + first.height - 1
    );

    await page.locator("#questions-list").scrollIntoViewIfNeeded();
    await captureForReview(page, "默认单栏-手机视口");
  });

  test("切换按钮存在，点击即时切到双栏并写入缓存", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedQuestions(page, PORTRAIT_SVG, 4);

    const toggle = page.locator(GRID_TOGGLE);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("▤ 双栏");

    await toggle.click();
    await expect(toggle).toHaveText("▦ 单栏");
    const { value, count } = await gridTrackCount(page);
    expect(count, `点击后应即时切换为双栏两轨道，实际 "${value}"`).toBe(2);
    expect(
      await page.evaluate(() => localStorage.getItem("question-grid-layout")),
      "双栏选择应写入 localStorage"
    ).toBe("double");

    await page.locator("#questions-list").scrollIntoViewIfNeeded();
    await captureForReview(page, "切换后双栏-手机视口");
  });

  test("持久化：双栏刷新后保持，切回单栏刷新后仍是单栏", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedQuestions(page, PORTRAIT_SVG, 4);

    await page.locator(GRID_TOGGLE).click();
    await page.reload();
    await expect(page.locator("#questions-list .question-card").first()).toBeAttached();
    let { value, count } = await gridTrackCount(page);
    expect(count, `刷新后应保持双栏，实际 "${value}"`).toBe(2);

    await page.locator(GRID_TOGGLE).click();
    await page.reload();
    await expect(page.locator("#questions-list .question-card").first()).toBeAttached();
    ({ value, count } = await gridTrackCount(page));
    expect(count, `切回单栏刷新后应保持单栏，实际 "${value}"`).toBe(1);
    expect(
      await page.evaluate(() => localStorage.getItem("question-grid-layout")),
      "缓存应记录 single"
    ).toBe("single");
  });

  test("单栏下题目图片大尺寸完整展示（可读性）", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedQuestions(page, PORTRAIT_SVG, 1);

    const img = page.locator("#questions-list .question-card img").first();
    await expect
      .poll(
        async () => {
          const box = await img.boundingBox();
          return box ? box.height : 0;
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(200, "单栏下竖版题目图片渲染高度应远超旧双栏的 110px");
    await page.locator("#questions-list").scrollIntoViewIfNeeded();
    await captureForReview(page, "单栏图片可读性");
  });

  test("双栏模式下保持紧凑图片高度（旧行为）", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedQuestions(page, PORTRAIT_SVG, 2);

    await page.locator(GRID_TOGGLE).click();
    const img = page.locator("#questions-list .question-card img").first();
    await expect
      .poll(async () => {
        const box = await img.boundingBox();
        return box ? box.height : 999;
      })
      .toBeLessThan(200, "双栏模式图片应保持紧凑高度，不应继承单栏的大图样式");
  });
});
