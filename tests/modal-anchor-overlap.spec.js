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
