const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

async function openExportModal(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.exportSelectedOrAll === 'function');
  await page.evaluate(() => window.exportSelectedOrAll());
  await expect(page.locator('#export-modal.active')).toBeVisible();
  await expect(page.locator('#print-size-options .print-size-option')).toHaveCount(5);
}

async function expandPageSetup(page) {
  const details = page.locator('#page-setup-details');
  if (!(await details.evaluate(el => el.open))) {
    await page.locator('#page-setup-details > summary').click();
  }
  await expect(details).toHaveJSProperty('open', true);
}

async function assertControl(page, selector, label, opts) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await assertVisiblyRendered(page, selector, label, opts);
}

test.describe('导出弹窗 - 页面设置（边距 / 标题）', () => {
  test('用例1 折叠区可见性（桌面视口，默认收起 + 展开后控件齐全）', async ({ page }) => {
    await openExportModal(page);

    const details = page.locator('#page-setup-details');
    await expect(details).toHaveJSProperty('open', false);
    await assertVisiblyRendered(page, '#page-setup-details > summary', '页面设置折叠摘要');

    await expandPageSetup(page);

    await assertControl(page, '#ps-margin-top', '上边距输入');
    await assertControl(page, '#ps-margin-bottom', '下边距输入');
    await assertControl(page, '#ps-margin-side', '左右边距输入');
    await assertControl(page, '#ps-show-title', '显示标题勾选', { skipContrast: true });
    await assertControl(page, '#ps-show-count', '显示共N题勾选', { skipContrast: true });

    await expect(page.locator('#ps-margin-top')).toHaveValue('10');
    await expect(page.locator('#ps-margin-bottom')).toHaveValue('10');
    await expect(page.locator('#ps-margin-side')).toHaveValue('10');
    await expect(page.locator('#ps-show-title')).toBeChecked();
    await expect(page.locator('#ps-show-count')).toBeChecked();

    await captureForReview(page, 'page-setup-expanded');
  });

  test('用例2 持久化到 localStorage + 空串守卫 + 标题勾选联动 + 重开恢复', async ({ page }) => {
    await openExportModal(page);
    await expandPageSetup(page);

    const top = page.locator('#ps-margin-top');
    await top.fill('20');
    await top.blur();
    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pdfPageSetup') || 'null'));
    expect(stored && stored.marginTopMM, '改上边距为 20 后 localStorage.marginTopMM 应为 20').toBe(20);

    await top.fill('');
    await top.blur();
    await expect(top, '清空边距输入后 blur 应恢复已存值 20，而非 0 或空').toHaveValue('20');
    stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pdfPageSetup') || 'null'));
    expect(stored && stored.marginTopMM, '恢复后 localStorage 仍应为 20').toBe(20);

    await page.locator('#ps-show-title').uncheck();
    await expect(page.locator('#ps-show-count')).toBeDisabled();
    await page.locator('#ps-show-title').check();
    await expect(page.locator('#ps-show-count')).toBeEnabled();
    await page.locator('#ps-show-title').uncheck();

    await page.click('#export-modal button:has-text("取消")');
    await expect(page.locator('#export-modal.active')).toBeHidden();

    await page.evaluate(() => window.exportSelectedOrAll());
    await expect(page.locator('#export-modal.active')).toBeVisible();
    await expandPageSetup(page);
    await expect(page.locator('#ps-margin-top'), '关闭重开后应从 localStorage 恢复上边距 20').toHaveValue('20');
    await expect(page.locator('#ps-show-title'), '关闭重开后应恢复显示标题未勾').not.toBeChecked();

    await top.fill('10');
    await top.blur();
    await page.locator('#ps-show-title').check();
    await expect(page.locator('#ps-show-count')).toBeEnabled();
  });

  test('用例3 手机视口 390x844 下页面设置展开且后续控件可达', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExportModal(page);
    await expandPageSetup(page);

    await assertControl(page, '#ps-margin-top', '上边距输入(手机)');
    await assertControl(page, '#ps-margin-bottom', '下边距输入(手机)');
    await assertControl(page, '#ps-margin-side', '左右边距输入(手机)');
    await assertControl(page, '#ps-show-title', '显示标题勾选(手机)', { skipContrast: true });
    await assertControl(page, '#ps-show-count', '显示共N题勾选(手机)', { skipContrast: true });

    await assertControl(page, '#export-folder-select', '保存文件夹(手机)');
    await assertControl(page, '#export-filename', '文件名输入框(手机)');
    await assertControl(page, '#print-size-options', '打印字号挡位组(手机)', { skipContrast: true });

    await captureForReview(page, 'page-setup-mobile');
  });
});
