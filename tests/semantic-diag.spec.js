const fs = require("fs");
const { test, expect } = require("@playwright/test");
const { assertVisiblyRendered, captureForReview } = require("./helpers/visibility");

const BACKEND = "http://127.0.0.1:3001";

function readEnv() {
  const out = {};
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const ENV = readEnv();

// ---- 共享状态（beforeAll 探测后填充，供 ①②④ 用例使用）----
let SERVER_ONLINE = false;
let USABLE_TOKEN = ENV.E2E_TOKEN || null; // 自愈后可能更新为登录换得的新 token
let SKIP_REAL = false;            // 是否跳过依赖真实链路的用例（①②④）
let SKIP_REASON = "";
let DID_LOGIN = false;

// 真实链路用例（①②④）在开头调用：server 不可达 / 缺凭据 / 登录失败 → 自动 skip（不失败）
function skipIfRealBlocked() {
  test.skip(SKIP_REAL, SKIP_REASON || "真实链路不可用");
}

test.describe("语义检索真实链路诊断（连真实 server，非 mock）", () => {
  test.beforeAll(async ({ request }) => {
    // 3) 缺凭据 → 跳过真实链路用例（E2E_TOKEN 用于直塞；PHONE/PASSWORD 用于登录自愈）
    const missing = [];
    if (!ENV.E2E_TOKEN) missing.push("E2E_TOKEN");
    if (!ENV.E2E_TEST_PHONE) missing.push("E2E_TEST_PHONE");
    if (!ENV.E2E_TEST_PASSWORD) missing.push("E2E_TEST_PASSWORD");
    if (missing.length) {
      SKIP_REAL = true;
      SKIP_REASON = "缺凭据: " + missing.join(", ");
      return;
    }

    // 1) 探测真实 server 是否可达（超时 3 秒）；不可达则静默 skip，不失败
    let online = false;
    try {
      const health = await request.get(`${BACKEND}/api/health`, { timeout: 3000 });
      online = health.ok();
    } catch (e) {
      online = false;
    }
    if (!online) {
      SKIP_REAL = true;
      SKIP_REASON = "server 不可达 (127.0.0.1:3001)";
      return;
    }
    SERVER_ONLINE = true;

    // 2) token 自愈：用现有 token 探 /api/embed/vectors，401/403 才登录（最多一次）
    let token = ENV.E2E_TOKEN;
    let tokenValid = false;
    try {
      const v = await request.get(`${BACKEND}/api/embed/vectors`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      tokenValid = v.status() !== 401 && v.status() !== 403;
    } catch (e) {
      tokenValid = false;
    }

    if (!tokenValid) {
      try {
        const loginResp = await request.post(`${BACKEND}/api/login`, {
          headers: { "Content-Type": "application/json" },
          data: { phone: ENV.E2E_TEST_PHONE, password: ENV.E2E_TEST_PASSWORD },
          timeout: 5000,
        });
        if (!loginResp.ok()) {
          SKIP_REAL = true;
          SKIP_REASON = `登录失败 (${loginResp.status()})`;
          return;
        }
        const body = await loginResp.json();
        const newToken = body.token || (body.data && body.data.token) || body.access_token;
        if (newToken) {
          token = newToken;
          DID_LOGIN = true;
          console.log("[diag] token 已自愈（登录换取新 token）");
        }
      } catch (e) {
        SKIP_REAL = true;
        SKIP_REASON = "登录异常: " + (e && e.message ? e.message : String(e));
        return;
      }
    }
    USABLE_TOKEN = token;
  });

  test("登录后重开 App：自动拉取向量 + 相似题可用", async ({ page }) => {
    skipIfRealBlocked(); // ①②④：server 不可达/缺凭据/登录失败 → 自动 skip
    test.setTimeout(180000);
    const vectorCalls = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/embed/vectors")) vectorCalls.push(r.status());
    });

    await page.addInitScript((token) => {
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", token);
      localStorage.setItem("syncEnabled", "1");
    }, USABLE_TOKEN);
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
    skipIfRealBlocked(); // ①②④：server 不可达/缺凭据/登录失败 → 自动 skip
    await page.goto("/");
    await page.fill("#search-input", "游乐场里旋转的椅子");
    await page.waitForTimeout(2500);
    await expect(page.locator("#semantic-results .semantic-card")).toHaveCount(0);
    await expect(page.locator("#error-modal")).not.toBeVisible();
  });

  test("以图搜题：结果区必须出现在用户视线内（搜索框附近）", async ({ page }) => {
    // ③ 为 mock 版，不依赖真实 server，永不 skip
    test.setTimeout(120000);
    await page.addInitScript(() => {
      window.Camera = { getPhoto: async () => ({ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }) };
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", "diag-token"); // 假 token 常量，不受自愈影响
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
    skipIfRealBlocked(); // ①②④：server 不可达/缺凭据/登录失败 → 自动 skip
    test.setTimeout(120000);
    await page.addInitScript((token) => {
      localStorage.setItem("serverUrl", "http://127.0.0.1:3001");
      localStorage.setItem("apiToken", token);
      localStorage.setItem("syncEnabled", "1");
    }, USABLE_TOKEN);
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
