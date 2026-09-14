const { test, expect } = require("@playwright/test");
const { captureForReview } = require("./helpers/visibility");

// 防回归：双栏卡片图片按卡片宽度等比放大；手机与桌面保持固定高。
//
// 生效条件（2026-09-12 修订）：`@supports(container-type:inline-size) { @media(pointer:coarse) { @container(min-width:225px) } }`
//   —— 判定依据是「触屏设备」+「卡片实际宽度 >225px」，不再依赖视口宽度断点。
//   历史教训：曾用 `@media(max-width:1023.98px)` 限定，真机平板（CSS 视口约 1238px）被整体排除 → 完全无效。
//
// 设计要点：默认是单栏（question-core.ts:11），bug 只出现在双栏宽卡片场景，故统一切到双栏后再断言。

// 300×400 竖版 SVG（模拟拍摄的题目照片，natural 宽高比 = 0.75）
const PORTRAIT_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect fill="#E8F5EE" width="300" height="400"/><text x="150" y="200" text-anchor="middle" font-size="40" fill="#1B7A4E">题目照片</text></svg>'
  );

const BASE_URL = "http://127.0.0.1:3000";

// 触屏上下文（hasTouch:true → Chromium 下 pointer:coarse / hover:none 为真），用于模拟平板与手机
async function withTouchViewport(browser, width, height, fn) {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width, height },
    baseURL: BASE_URL,
  });
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function mockApp(page) {
  await page.addInitScript(() => {
    window.confirm = () => true;
    window.alert = () => {};
    window.Capacitor = { getPlatform: () => "android", Plugins: {} };
  });
  await page.goto("/");
}

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

async function ensureDoubleColumn(page) {
  const cls = await page.locator("#questions-list").getAttribute("class");
  if (!cls || !cls.includes("grid-double")) {
    await page.locator("#grid-layout-toggle").click();
  }
  await expect(page.locator("#questions-list")).toHaveClass(/grid-double/);
}

async function waitImgLoaded(page) {
  await expect
    .poll(
      async () =>
        page.locator("#questions-list .question-card img").first().evaluate((el) => el.naturalWidth),
      { timeout: 10_000 }
    )
    .toBeGreaterThan(0);
}

async function gridTrackCount(page) {
  const value = await page
    .locator("#questions-list")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return { value, count: value.trim().split(/\s+/).length };
}

async function imgMetrics(page) {
  return page.locator("#questions-list .question-card img").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { boxW: r.width, boxH: r.height, nw: el.naturalWidth, nh: el.naturalHeight, fit: cs.objectFit };
  });
}

// 平板放大的公共断言：contain 语义 + 等比/钳制分支 + 实质放大
async function assertImageEnlarged(page) {
  const m = await imgMetrics(page);
  const viewportH = page.viewportSize().height;
  const naturalRatio = m.nw / m.nh;

  await expect
    .poll(async () => (await imgMetrics(page)).boxH, { timeout: 10_000 })
    .toBeGreaterThan(200);

  expect(m.fit, "object-fit 必须为 contain（cover/fill 会造成裁切或拉伸）").toBe("contain");
  const clamped = Math.abs(m.boxH - 0.7 * viewportH) < 1;
  if (!clamped) {
    expect(Math.abs(m.boxW / m.boxH - naturalRatio) / naturalRatio, "未钳制时盒子比例应等于原图比例").toBeLessThanOrEqual(0.01);
  } else {
    expect(Math.abs(m.boxH - 0.7 * viewportH), "钳制时盒高应等于 70dvh").toBeLessThanOrEqual(1);
  }
  const scale = Math.min(m.boxW / m.nw, m.boxH / m.nh);
  expect(m.nh * scale, "内容显示高度应 >300px（旧值为 110–160px）").toBeGreaterThan(300);
  return m;
}

// ───────────────── 手机竖屏：触屏但卡片过窄 → 不放大（守卫） ─────────────────
test.describe("手机竖屏 390×844（触屏：卡片过窄，图片保持紧凑固定高）", () => {
  test("双栏下 .question-card img 渲染高度 = 110px（±1，未被等比放大）", async ({ browser }) => {
    await withTouchViewport(browser, 390, 844, async (page) => {
      await mockApp(page);
      await seedQuestions(page, PORTRAIT_SVG, 2);
      await ensureDoubleColumn(page);
      await waitImgLoaded(page);
      await page.locator("#questions-list").scrollIntoViewIfNeeded();
      await captureForReview(page, "手机双栏-守卫");

      const box = await page.locator("#questions-list .question-card img").first().boundingBox();
      expect(
        Math.abs(box.height - 110),
        `手机双栏图片应固定紧凑高 110px（±1），实际 ${box.height}px（若放大则回归手机体验）`
      ).toBeLessThanOrEqual(1);
    });
  });
});

// ───────────────── 平板竖屏：触屏 + 卡片够宽 → 等比放大 ─────────────────
test.describe("平板竖屏 617×939（触屏：双栏等比放大）", () => {
  test("双栏 2 轨 + 图片等比放大 + contain 语义 + 勾选框定位完好", async ({ browser }) => {
    await withTouchViewport(browser, 617, 939, async (page) => {
      await mockApp(page);
      await seedQuestions(page, PORTRAIT_SVG, 2);
      await ensureDoubleColumn(page);

      const { value, count } = await gridTrackCount(page);
      expect(count, `平板双栏应为 2 轨，实际 grid-template-columns="${value}"`).toBe(2);

      await waitImgLoaded(page);
      await page.locator("#questions-list").scrollIntoViewIfNeeded();
      await captureForReview(page, "平板竖屏双栏");
      await assertImageEnlarged(page);

      // 勾选框定位（验证 container-type 引入的 stacking context/包含块未破坏定位）
      const cb = page.locator("#questions-list .q-checkbox").first();
      const cbBox = await cb.boundingBox();
      expect(cbBox.width, "平板视口下勾选框应可见").toBeGreaterThan(0);
      await cb.click();
      await expect(cb).toHaveClass(/checked/);
      await expect(page.locator("#question-modal")).not.toHaveClass(/active/);
    });
  });
});

// ───────────────── 平板横屏：触屏 + 放开 max-width ─────────────────
test.describe("平板横屏 939×617（触屏：等比放大 + 容器铺满屏宽）", () => {
  test("双栏 2 轨 + 图片等比放大 + 容器宽度≈视口宽", async ({ browser }) => {
    await withTouchViewport(browser, 939, 617, async (page) => {
      await mockApp(page);
      await seedQuestions(page, PORTRAIT_SVG, 2);
      await ensureDoubleColumn(page);

      const { value, count } = await gridTrackCount(page);
      expect(count, `平板双栏应为 2 轨，实际 grid-template-columns="${value}"`).toBe(2);

      await waitImgLoaded(page);
      await page.locator("#questions-list").scrollIntoViewIfNeeded();
      await captureForReview(page, "平板横屏双栏");
      await assertImageEnlarged(page);

      const containerW = await page.locator(".container").evaluate((el) => el.getBoundingClientRect().width);
      const clientW = await page.evaluate(() => document.documentElement.clientWidth);
      expect(Math.abs(containerW - clientW)).toBeLessThanOrEqual(2);
    });
  });
});

// ───────────────── 平板大视口（真机场景回归） ─────────────────
// 2026-09-12 真机事故：vivo Pad CSS 视口约 1238px，旧实现用 @media(max-width:1023.98px) 限定
// → 被整体排除、完全无效。改为 pointer:coarse 后，大视口触屏设备必须同样生效。
test.describe("平板大视口 1238×900（触屏：真机场景，宽度超 1024 也必须生效）", () => {
  test("视口宽 1238 时图片仍等比放大（>200px）", async ({ browser }) => {
    await withTouchViewport(browser, 1238, 900, async (page) => {
      await mockApp(page);
      await seedQuestions(page, PORTRAIT_SVG, 2);
      await ensureDoubleColumn(page);
      await waitImgLoaded(page);
      await page.locator("#questions-list").scrollIntoViewIfNeeded();
      await captureForReview(page, "平板大视口1238双栏");
      await assertImageEnlarged(page);
    });
  });
});

// ───────────────── 桌面：鼠标设备 → 不放大（守卫） ─────────────────
test.describe("桌面 1280×800（鼠标：pointer:fine，容器查询不生效，图片仍 160px）", () => {
  test("双栏下 .question-card img 渲染高度 = 160px（±1）", async ({ page }) => {
    await mockApp(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedQuestions(page, PORTRAIT_SVG, 2);
    await ensureDoubleColumn(page);
    await waitImgLoaded(page);
    await page.locator("#questions-list").scrollIntoViewIfNeeded();
    await captureForReview(page, "桌面双栏-守卫");

    const box = await page.locator("#questions-list .question-card img").first().boundingBox();
    expect(
      Math.abs(box.height - 160),
      `桌面（鼠标）图片应保持 160px 固定高，实际 ${box.height}px（若被放大说明触屏判定泄漏到桌面）`
    ).toBeLessThanOrEqual(1);
  });
});
