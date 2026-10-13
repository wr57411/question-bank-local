const { test, expect } = require("@playwright/test");
const { captureForReview } = require("./helpers/visibility");

// 防回归：题目列表勾选框（q-checkbox）可见尺寸与触控热区
// 需求（2026-09-07）：
//   1. 可见尺寸缩小，不再遮挡题目图片内容
//   2. 热区不小于 44×44px（伪元素扩展，可见面积不增大）
//   3. 热区内点击切换选中（不冒泡）；热区外点击图片才弹详情

const PORTRAIT_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect fill="#E8F5EE" width="300" height="400"/><text x="150" y="200" text-anchor="middle" font-size="40" fill="#1B7A4E">题目照片</text></svg>'
  );

async function mockApp(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    window.Capacitor = { getPlatform: () => "android", Plugins: {} };
  });
  await page.goto("/");
}

async function seedOne(page) {
  await page.evaluate(async (src) => {
    await dbCreateQuestion(src, null, [], 0, null, []);
    await loadQuestions();
  }, PORTRAIT_SVG);
  await expect(page.locator("#questions-list .question-card")).toHaveCount(1);
}

async function getCheckboxBox(page) {
  return page.locator("#questions-list .q-checkbox").first().boundingBox();
}

test.describe("勾选框可见尺寸与触控热区（手机视口 390×844）", () => {
  test.beforeEach(async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedOne(page);
    await page.locator("#questions-list .question-card").first().scrollIntoViewIfNeeded();
  });

  test("可见尺寸不超过 28px 且不小于 23px（不再遮挡题目内容，但仍是可用勾选框）", async ({ page }) => {
    const box = await getCheckboxBox(page);
    expect(box.width, `勾选框可见宽度应 ≤28px，实际 ${box.width}`).toBeLessThanOrEqual(28);
    expect(box.height, `勾选框可见高度应 ≤28px，实际 ${box.height}`).toBeLessThanOrEqual(28);
    expect(box.width, `勾选框可见宽度应 ≥23px，实际 ${box.width}`).toBeGreaterThanOrEqual(23);
    expect(box.height, `勾选框可见高度应 ≥23px，实际 ${box.height}`).toBeGreaterThanOrEqual(23);
    await page.locator("#questions-list").scrollIntoViewIfNeeded();
    await captureForReview(page, "勾选框缩小后-单栏");
  });

  test("热区扩展：可见框右侧外 6px 处点击仍切换选中、不弹详情", async ({ page }) => {
    const box = await getCheckboxBox(page);
    const gapToHotZoneEdge = 6;
    await page.mouse.click(box.x + box.width + gapToHotZoneEdge, box.y + box.height / 2);

    await expect(page.locator("#questions-list .q-checkbox").first()).toHaveClass(/checked/);
    await expect(page.locator("#question-modal")).not.toHaveClass(/active/);
  });

  test("热区上侧外 6px 处点击同样命中热区", async ({ page }) => {
    const box = await getCheckboxBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y - 6);
    await expect(page.locator("#questions-list .q-checkbox").first()).toHaveClass(/checked/);
    await expect(page.locator("#question-modal")).not.toHaveClass(/active/);
  });

  test("热区边界夹逼：+9px 命中热区切换，+14px 出热区命中图片弹详情", async ({ page }) => {
    // 几何：可见框 24 宽，热区 ::after{inset:-10px} → 热区右缘在 box.x + box.width + 10
    // 每次点击前重新测量 box：选中会触发列表重渲染，勾选框 Y 坐标会位移，
    // 必须用当前实际落点（贴近真实用户点击），而非放宽热区断言。
    const clickRightOf = async (dx) => {
      const b = await getCheckboxBox(page);
      await page.mouse.click(b.x + b.width + dx, b.y + b.height / 2);
    };

    // +9px：在 44 热区内、可见框外 → 切换为选中，不弹详情
    await clickRightOf(9);
    await expect(page.locator("#questions-list .q-checkbox").first()).toHaveClass(/checked/);
    await expect(page.locator("#question-modal")).not.toHaveClass(/active/);

    // 再点同位置 → 取消选中（证明是热区命中而非误触）
    await clickRightOf(9);
    await expect(page.locator("#questions-list .q-checkbox").first()).not.toHaveClass(/checked/);
    await expect(page.locator("#question-modal")).not.toHaveClass(/active/);

    // +14px：已出 44×44 热区（右缘 +10）→ 命中图片弹详情，且勾选框未被选中
    await clickRightOf(14);
    await expect(page.locator("#question-modal")).toHaveClass(/active/);
    await expect(page.locator("#questions-list .q-checkbox").first()).not.toHaveClass(/checked/);
  });

  test("防误触回归：热区外点击图片弹详情且不选中", async ({ page }) => {
    const img = page.locator("#questions-list .question-card img").first();
    const b = await img.boundingBox();
    await img.click({ position: { x: b.width * 0.7, y: b.height * 0.5 } });

    await expect(page.locator("#question-modal")).toHaveClass(/active/);
    await expect(page.locator("#questions-list .q-checkbox").first()).not.toHaveClass(/checked/);
  });

  test("勾选框中心点击正常切换", async ({ page }) => {
    await page.locator("#questions-list .q-checkbox").first().click();
    await expect(page.locator("#questions-list .q-checkbox").first()).toHaveClass(/checked/);
    await expect(page.locator("#question-modal")).not.toHaveClass(/active/);
  });
});
