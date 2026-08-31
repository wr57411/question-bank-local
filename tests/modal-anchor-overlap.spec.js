const { test, expect } = require('@playwright/test');
const { captureForReview } = require('./helpers/visibility');

async function enableQuickImport(page, noteExpanded = true) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  // 等待 bar 可见
  await expect(page.locator('#quick-import-bar')).toBeVisible();
  if (!noteExpanded) {
    await page.click('#qi-note-btn'); // 收起笔记区 -> 高度回落到 196
    await expect(page.locator('#qi-note-area')).toBeHidden();
  }
}

function noOverlap(page, modalContentSelector) {
  return page.evaluate((sel) => {
    const bar = document.getElementById('quick-import-bar');
    const content = document.querySelector(sel);
    if (!bar || !content) return { overlap: false, reason: 'missing' };
    if (getComputedStyle(bar).display === 'none') return { overlap: false, reason: 'bar hidden' };
    const b = bar.getBoundingClientRect();
    const r = content.getBoundingClientRect();
    // 判定：content 的上边缘是否侵入 bar 的下边缘（允许 8px 间隙）
    const overlap = r.top < b.bottom - 1;
    return { overlap, barBottom: b.bottom, contentTop: r.top, barH: b.height, contentH: r.height };
  }, modalContentSelector);
}

// 覆盖全部 .modal 的选择器清单（与 File Structure 表一致，含 quick-combo-panel 特例）
const MODALS = [
  { id: 'question-modal', sel: '#question-modal .modal-content', open: async (p) => { await p.evaluate(() => window.showQuestionDetail && window.allQuestions && window.allQuestions[0] && window.showQuestionDetail(window.allQuestions[0].id)); } },
  { id: 'provider-modal', sel: '#provider-modal .modal-content', open: async (p) => p.click('#quick-import-toggle').then(() => p.evaluate(() => window.showAddProviderModal && window.showAddProviderModal())) },
];

test.describe('基线：锚点展开时弹窗与 quick-import-bar 重叠（重构前应 FAIL）', () => {
  test('手机视口 390×844：笔记展开态（312px）下 question-modal 与 bar 重叠', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
    // 打开一个典型弹窗（若无数据则退化为直接 active）
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await expect(page.locator('#question-modal')).toBeVisible();
    const { overlap, barBottom, contentTop } = await noOverlap(page, '#question-modal .modal-content');
    await captureForReview(page, 'baseline-overlap-question-modal');
    expect(overlap, `barBottom=${barBottom} contentTop=${contentTop} 应不重叠`).toBe(false);
  });
});

test.describe('锚点定位迁移 - 核心弹窗', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('question-modal 锚点下方渲染，无重叠', async ({ page }) => {
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#question-modal .modal-content');
    expect(overlap).toBe(false);
    await expect(page.locator('#question-modal .modal-content')).toBeVisible();
  });
  test('basket-modal', async ({ page }) => {
    await page.evaluate(() => document.getElementById('basket-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#basket-modal .modal-content');
    expect(overlap).toBe(false);
  });
  test('export-modal', async ({ page }) => {
    await page.evaluate(() => document.getElementById('export-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#export-modal .modal-content');
    expect(overlap).toBe(false);
  });
});

test.describe('锚点定位迁移 - PDF/版本', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('pdf-preview-modal 锚点下方且内部可滚动', async ({ page }) => {
    await page.evaluate(() => document.getElementById('pdf-preview-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#pdf-preview-modal .modal-content');
    expect(overlap).toBe(false);
    const scrollable = await page.evaluate(() => {
      const c = document.querySelector('#pdf-preview-modal .modal-content');
      return c ? getComputedStyle(c).overflowY : '';
    });
    expect(scrollable).toBe('auto');
  });
});

test.describe('锚点定位迁移 - 反馈/同步/备份/组合', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('issue-feedback-modal 在锚点展开态无重叠且可提交', async ({ page }) => {
    await page.evaluate(() => document.getElementById('issue-feedback-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#issue-feedback-modal .modal-content');
    expect(overlap).toBe(false);
    await page.click('#feedback-title');
    await expect(page.locator('#feedback-title')).toBeFocused();
  });
  test('quick-combo-panel 动态 top = barBottom + 12', async ({ page }) => {
    await page.click('#qi-combo-btn');
    await expect(page.locator('#quick-combo-panel')).toBeVisible();
    const topOk = await page.evaluate(() => {
      const bar = document.getElementById('quick-import-bar')?.getBoundingClientRect();
      const card = document.getElementById('quick-combo-panel-card') || document.querySelector('#quick-combo-panel > div');
      if (!bar || !card) return false;
      const t = card.getBoundingClientRect().top;
      return Math.abs(t - (bar.bottom + 12)) < 2;
    });
    expect(topOk).toBe(true);
  });
  test('login-modal / backup-modal 无重叠', async ({ page }) => {
    await page.evaluate(() => document.getElementById('login-modal')?.classList.add('active'));
    let r = await noOverlap(page, '#login-modal .modal-content');
    expect(r.overlap).toBe(false);
    await page.evaluate(() => {
      document.getElementById('login-modal')?.classList.remove('active');
      document.getElementById('backup-modal')?.classList.add('active');
    });
    r = await noOverlap(page, '#backup-modal .modal-content');
    expect(r.overlap).toBe(false);
  });
});

test.describe('锚点定位迁移 - 剩余长尾与白名单', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  const REMAINING = ['teaching-verify-modal','node-question-picker-modal','pending-blank-modal','pending-photos-modal','process-photo-modal','version-modal','system-password-modal','sync-warning-modal'];
  for (const id of REMAINING) {
    test(`${id} 无重叠`, async ({ page }) => {
      await page.evaluate((mid) => document.getElementById(mid)?.classList.add('active'), id);
      const { overlap } = await noOverlap(page, `#${id} .modal-content`);
      expect(overlap).toBe(false);
    });
  }
  test('crop-modal 白名单：保持全屏，不被锚点偏移', async ({ page }) => {
    await page.evaluate(() => document.getElementById('crop-modal')?.classList.add('active'));
    const top = await page.evaluate(() => document.getElementById('crop-modal')?.style.top);
    expect(top).toBe('');
  });
  test('projection-overlay 白名单：保持全屏，不被锚点偏移', async ({ page }) => {
    await page.evaluate(() => document.getElementById('projection-overlay')?.classList.add('active'));
    const top = await page.evaluate(() => document.getElementById('projection-overlay')?.style.top);
    expect(top).toBe('');
  });
});
