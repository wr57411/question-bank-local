const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

const PRESET_LABELS = ['小五', '五号', '小四', '四号', '三号'];

async function openExportModal(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.exportSelectedOrAll === 'function');
  await page.evaluate(() => window.exportSelectedOrAll());
  await expect(page.locator('#export-modal.active')).toBeVisible();
  await expect(page.locator('#print-size-options .print-size-option')).toHaveCount(5);
}

test.describe('导出弹窗 - 打印字号控件', () => {
  test('用例1 挡位可见性（桌面视口）', async ({ page }) => {
    await openExportModal(page);

    const opts = page.locator('#print-size-options .print-size-option');
    await expect(opts).toHaveCount(5);

    for (let i = 0; i < PRESET_LABELS.length; i++) {
      await assertVisiblyRendered(
        page,
        `#print-size-options .print-size-option >> nth=${i}`,
        `打印字号-${PRESET_LABELS[i]}挡位`
      );
    }

    const selText = await page.locator('.print-size-option.selected').first().textContent();
    expect(selText, '默认选中应为五号 10.5pt').toContain('10.5');

    await assertVisiblyRendered(page, '#export-modal .modal-content', '导出弹窗卡片', { skipContrast: true });
    await captureForReview(page, 'export-modal-print-size');
  });

  test('用例2 选中值持久化到 localStorage 并恢复', async ({ page }) => {
    await openExportModal(page);

    await page.locator('#print-size-options .print-size-option').nth(0).click();
    const stored = await page.evaluate(() => localStorage.getItem('printStemPt'));
    expect(stored, '点击小五后 localStorage 应为 9').toBe('9');

    await page.click('#export-modal button:has-text("取消")');
    await expect(page.locator('#export-modal.active')).toBeHidden();

    await page.evaluate(() => window.exportSelectedOrAll());
    await expect(page.locator('#export-modal.active')).toBeVisible();
    await expect(page.locator('#print-size-options .print-size-option')).toHaveCount(5);

    const restoredText = await page.locator('.print-size-option.selected').first().textContent();
    expect(restoredText, '重新打开后应从 localStorage 恢复小五 9pt').toContain('9');

    await page.locator('#print-size-options .print-size-option').nth(1).click();
    const backToDefault = await page.evaluate(() => localStorage.getItem('printStemPt'));
    expect(backToDefault, '恢复默认五号避免污染其他用例').toBe('10.5');
  });

  test('用例3 手机视口 390x844 下新增区块不撑坏弹窗', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExportModal(page);

    await assertVisiblyRendered(page, '#print-size-options', '打印字号挡位组', { skipContrast: true });
    await assertVisiblyRendered(page, '#print-size-hint', '实测回显行');

    await captureForReview(page, 'export-modal-print-size-mobile');

    await page.locator('#export-folder-select').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#export-folder-select', '保存文件夹');
    await captureForReview(page, 'export-modal-print-size-mobile-folder');

    await page.locator('#export-filename').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#export-filename', '文件名输入框');
    await captureForReview(page, 'export-modal-print-size-mobile-filename');
  });

  test('用例4 回显文案非空（无题目时为占位提示）', async ({ page }) => {
    await openExportModal(page);
    const hint = await page.locator('#print-size-hint').textContent();
    expect(hint, '回显行不应为空').not.toBe('');
    expect(hint, '无题目数据应显示占位提示').toContain('没有可测量的题目');
  });
});
