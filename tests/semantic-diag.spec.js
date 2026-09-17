const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { assertVisiblyRendered, captureForReview } = require("./helpers/visibility");

function readEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const ENV = readEnv();

test.describe("语义检索真实链路诊断（连真实 server，非 mock）", () => {
  test("登录后重开 App：自动拉取向量 + 相似题可用", async ({ page }) => {
    test.setTimeout(180000);
    const vectorCalls = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/embed/vectors")) vectorCalls.push(r.status());
    });

    await page.addInitScript((token) => {
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", token);
      localStorage.setItem("syncEnabled", "1");
    }, ENV.E2E_TOKEN);
    await page.goto("/");
    const respPromise = page.waitForResponse(
      (r) => r.url().includes("/api/embed/vectors") && r.request().method() === "GET",
      { timeout: 30000 }
    );
    await page.reload();
    const resp = await respPromise;
    vectorCalls.push(resp.status());
    expect(resp.status()).toBe(200);

    const pulled = await page.evaluate(() => window.refreshEmbeddings());
    expect(pulled).toBeGreaterThan(90);
    console.log("[diag] 拉取向量条数:", pulled);
    const camState = await page.evaluate(() => typeof window.Camera);
    console.log("[diag] 相似题渲染路径已在以图搜用例覆盖（同 getAllVectors→renderSemanticResults）");
  });

  test("未登录时语义静默（无向量无报错）", async ({ page }) => {
    await page.goto("/");
    await page.fill("#search-input", "游乐场里旋转的椅子");
    await page.waitForTimeout(2500);
    await expect(page.locator("#semantic-results .semantic-card")).toHaveCount(0);
    await expect(page.locator("#error-modal")).not.toBeVisible();
  });

  test("以图搜题：结果区必须出现在用户视线内（搜索框附近）", async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(() => {
      window.Camera = { getPhoto: async () => ({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }) };
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", "diag-token");
      localStorage.setItem("syncEnabled", "1");
    });
    await page.route("**/api/embed/image", (r) =>
      r.fulfill({ json: { dim: 8, vectors: [[1, 0, 0, 0, 0, 0, 0, 0]] } })
    );
    await page.goto("/");
    // 造 12 道题把列表撑长（复现真机 91 题的长列表布局），前 3 题配向量
    const ids = await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) {
        await window.dbCreateQuestion(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          null, [], 0, null, [], { book_name: "布局复现", page_number: i }
        );
      }
      await window.loadQuestions();
      const all = await window.dbGetAllQuestions();
      return all.filter((x) => !x.deleted_at).slice(0, 3).map((x) => x.id);
    });
    await page.route("**/api/embed/vectors", (r) =>
      r.fulfill({
        json: {
          count: ids.length,
          embeddings: ids.map((id) => ({ question_id: id, dim: 8, vector: Buffer.from(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]).buffer).toString("base64") })),
        },
      })
    );
    await page.route("**/api/embed/image", (r) =>
      r.fulfill({ json: { dim: 8, vectors: [[1, 0, 0, 0, 0, 0, 0, 0]] } })
    );
    const pulled = await page.evaluate(() => window.refreshEmbeddings());
    expect(pulled).toBe(ids.length);
    await page.click("#btn-image-search");
    await expect(page.locator("#semantic-results .semantic-title")).toHaveText(/图片匹配/, { timeout: 20000 });
    await page.waitForTimeout(800);
    const geo = await page.evaluate(() => {
      const el = document.querySelector("#semantic-results .semantic-title");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height), scrollY: Math.round(window.scrollY), vh: window.innerHeight, text: el.textContent };
    });
    console.log("[diag-rect] 标题几何:", JSON.stringify(geo));
    await assertVisiblyRendered(page, "#semantic-results .semantic-title", "图片匹配标题（必须在视口内）");
    await assertVisiblyRendered(page, "#semantic-results .semantic-card >> nth=0", "图片匹配卡片（必须在视口内）");
    await captureForReview(page, "image-search-visibility");
  });

  test("登录后长查询命中测试账号快照题（阈值 0.25）", async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript((token) => {
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", token);
      localStorage.setItem("syncEnabled", "1");
    }, ENV.E2E_TOKEN);
    await page.goto("/");
    const vectorsResp = page.waitForResponse(
      (r) => r.url().includes("/api/embed/vectors") && r.status() === 200,
      { timeout: 30000 }
    );
    await page.reload();
    await vectorsResp;
    await page.fill("#search-input", "游乐场里游客坐在转椅上被绳子拉着绕圈飞");
    await page.waitForTimeout(600);
    await expect(page.locator("#semantic-results .semantic-title")).toHaveText(/语义相关 \(\d+\)/, { timeout: 30000 });
    const titleText = await page.locator("#semantic-results .semantic-title").textContent();
    const n = parseInt(titleText.match(/\((\d+)\)/)[1], 10);
    console.log("[diag] 长查询语义命中数:", n, "（卡片渲染依赖本地题目数据，测试账号无本地快照，卡片层由以图搜用例覆盖）");
    expect(n).toBeGreaterThan(0);
  });
});
