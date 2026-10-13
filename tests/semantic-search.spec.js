const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

process.env.E2E_SCREENSHOT_DIR = 'tmp/test-results-semantic/screenshots';

const NO_MATCH_QUERY = 'zzz无匹配关键词zzz';

function f32b64(arr) {
  return Buffer.from(new Float32Array(arr).buffer).toString('base64');
}
const VEC_A = f32b64([1, 0, 0, 0, 0, 0, 0, 0]);
const VEC_B = f32b64([0, 1, 0, 0, 0, 0, 0, 0]);
const VEC_C = f32b64([0, 0, 1, 0, 0, 0, 0, 0]);
const VEC_ORDER = [VEC_A, VEC_B, VEC_C];
const TEXT_HIT_VEC = [1, 0, 0, 0, 0, 0, 0, 0];
const TEXT_MISS_VEC = [0, 0, 0, 1, 0, 0, 0, 0];

async function createQuestion(page, tagName) {
  await page.evaluate(async (tag) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = '#1B7A4E';
    ctx.font = '24px sans-serif';
    ctx.fillText('题目图片', 20, 80);
    const tags = await window.dbGetAllTags();
    const t = tags.find((x) => x.name === tag);
    if (!t) throw new Error('标签不存在: ' + tag);
    await window.dbCreateQuestion(
      canvas.toDataURL('image/png'),
      null,
      [t.id],
      0,
      null,
      [],
      { book_name: '人教版九上', page_number: '42', question_number: '1' }
    );
    await window.loadQuestions();
  }, tagName);
}

async function seedTagAndQuestions(page) {
  await page.getByRole('button', { name: '标签管理' }).click();
  await page.locator('#tag-name').fill('数学');
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator('#tags-list .tag')).toHaveCount(1);
  await page.getByRole('button', { name: '题目管理' }).click();
  for (let i = 0; i < 3; i++) await createQuestion(page, '数学');
  await expect(page.locator('#questions-list .question-card')).toHaveCount(3);
}

const ENGINE_ID = 'mac-mps';
const ENGINE_FINGERPRINT = 'fp-e2e';

async function setupEngineRoutes(page) {
  await page.route('**/api/embed/engines', (route) =>
    route.fulfill({
      json: [{ id: ENGINE_ID, fingerprint: ENGINE_FINGERPRINT, reachable: true }],
    })
  );
  await page.route('**/api/embed/health**', (route) =>
    route.fulfill({ json: { fingerprint: ENGINE_FINGERPRINT, dtype: 'fp32' } })
  );
}

async function setupRoutes(page) {
  await page.route('**/api/embed/vectors**', async (route) => {
    const ids = await page.evaluate(async () =>
      (await window.dbGetAllQuestions()).map((q) => q.id)
    );
    const embeddings = ids.map((id, i) => ({
      question_id: id,
      dim: 8,
      vector: VEC_ORDER[i % VEC_ORDER.length],
    }));
    await route.fulfill({
      json: { model: 'wemm-embedding-2b', count: embeddings.length, embeddings },
    });
  });
  await page.route('**/api/embed/text**', async (route) => {
    let text = '';
    try {
      text = (JSON.parse(route.request().postData() || '{}').texts || [])[0] || '';
    } catch (e) {
      text = '';
    }
    await route.fulfill({ json: { vectors: [text.includes('游乐场') ? TEXT_HIT_VEC : TEXT_MISS_VEC] } });
  });
  await page.route('**/api/embed/image**', async (route) => {
    await route.fulfill({ json: { vectors: [TEXT_HIT_VEC] } });
  });
}

async function populateVectors(page) {
  await page.waitForFunction(() => !!window.SemanticService);
  await page.evaluate(() => window.refreshEmbeddings());
}

async function openFirstQuestionDetail(page) {
  await page.locator('#questions-list .question-card').first().locator('img').click();
}

test.describe('语义检索', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('apiToken', 'e2e-semantic-token');
      localStorage.setItem('syncEnabled', '1');
      localStorage.setItem('serverUrl', 'http://127.0.0.1:9');
      window.confirm = () => true;
      window.alert = () => {};
      Object.assign(window, {
        Camera: {
          getPhoto: async () => ({
            dataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          }),
        },
      });
    });
    await setupEngineRoutes(page);
    await page.goto('/');
  });

  test('语义搜索：零字面命中时展示语义相关区块', async ({ page }) => {
    await setupRoutes(page);
    await seedTagAndQuestions(page);
    await populateVectors(page);

    await page.fill('#search-input', '游乐场里旋转的椅子');

    await expect(page.locator('#semantic-results .semantic-title')).toHaveText(/语义相关/);
    const card = page.locator('#semantic-results .semantic-card').first();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#semantic-results .semantic-card', '语义推荐卡片', {
      skipContrast: true,
    });
    await captureForReview(page, 'semantic-results');
  });

  test('语义服务宕机时静默降级', async ({ page }) => {
    await setupRoutes(page);
    await page.route('**/api/embed/text**', (route) => route.abort());
    await seedTagAndQuestions(page);
    await populateVectors(page);

    await page.fill('#search-input', '斜面上拉货');

    await expect(page.locator('#semantic-results .semantic-card')).toHaveCount(0);
    await expect(page.locator('#semantic-results .semantic-title')).toHaveCount(0);
    await expect(page.locator('#error-modal.active')).toHaveCount(0);
    await page.locator('#search-input').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#search-input', '搜索输入框');
    await captureForReview(page, 'semantic-degraded');
  });

  test('详情页找相似题按钮与弹层', async ({ page }) => {
    await setupRoutes(page);
    await seedTagAndQuestions(page);
    await populateVectors(page);

    await openFirstQuestionDetail(page);

    const btn = page.locator('#modal-tags button', { hasText: '找相似题' });
    await expect(btn).toBeVisible();
    await btn.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#modal-tags button', '找相似题按钮', {
      skipContrast: true,
    });
    await btn.click();

    await expect(page.locator('#similar-modal')).toBeVisible();
    await expect(page.locator('#similar-list .similar-card').first()).toBeVisible();
    await captureForReview(page, 'similar-modal');
  });

  test('以图搜题结果区块', async ({ page }) => {
    await setupRoutes(page);
    await seedTagAndQuestions(page);
    await populateVectors(page);

    await page.fill('#search-input', NO_MATCH_QUERY);
    await page.locator('#btn-image-search').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#btn-image-search', '以图搜题按钮', {
      skipContrast: true,
    });
    await page.click('#btn-image-search');

    await expect(page.locator('#semantic-results .semantic-title')).toHaveText(/图片匹配/);
    await expect(page.locator('#semantic-results .semantic-card').first()).toBeVisible();
    await page.locator('#semantic-results .semantic-title').scrollIntoViewIfNeeded();
    await captureForReview(page, 'image-search-results');
  });

  test('以图搜题降级', async ({ page }) => {
    await setupRoutes(page);
    await page.route('**/api/embed/image**', (route) => route.abort());
    await seedTagAndQuestions(page);
    await populateVectors(page);

    await page.click('#btn-image-search');

    await expect(page.locator('#semantic-results .semantic-card')).toHaveCount(0);
    await expect(page.locator('#semantic-results .semantic-title')).toHaveCount(0);
    await expect(page.locator('#error-modal .modal-content')).toBeVisible();
    await assertVisiblyRendered(page, '#error-modal .modal-content', '以图搜题失败提示卡片', {
      skipContrast: true,
    });
    await captureForReview(page, 'image-search-degraded');
  });

  test('库中存在维度不符的向量时降级而非挂起', async ({ page }) => {
    await setupRoutes(page);
    await page.route('**/api/embed/vectors**', async (route) => {
      const ids = await page.evaluate(async () =>
        (await window.dbGetAllQuestions()).map((q) => q.id)
      );
      const embeddings = ids.map((id, i) => ({
        question_id: id,
        dim: i === 0 ? 8 : 4,
        vector: i === 0 ? VEC_A : f32b64([1, 0, 0, 0]),
      }));
      await route.fulfill({
        json: { model: 'wemm-embedding-2b', count: embeddings.length, embeddings },
      });
    });
    await seedTagAndQuestions(page);
    await populateVectors(page);

    const res = await page.evaluate(() =>
      window.SemanticService.search({ query: { kind: 'text', text: '游乐场里旋转的椅子' }, minScore: 0.25 })
    );
    expect(res.degraded && res.degraded.reason).toBe('store-corrupt');
    expect(res.hits).toHaveLength(0);

    await page.fill('#search-input', '游乐场里旋转的椅子');
    await page.waitForTimeout(800);

    await expect(page.locator('#semantic-results')).toBeEmpty();
    await expect(page.locator('#error-modal.active')).toHaveCount(0);
    await page.locator('#search-input').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#search-input', '搜索输入框');
    await captureForReview(page, 'dim-mismatch-degraded');
  });
});
