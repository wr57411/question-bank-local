const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

test.describe('全站状态提示统一化（错误弹窗 + toast）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#form-tag-search')).toBeVisible();
  });

  test('导出无题目时弹出全局错误弹窗并可关闭', async ({ page }) => {
    await page.evaluate(() => window.doExportPDF());

    await expect(page.locator('#error-modal')).toHaveClass(/active/);
    await expect(page.locator('#error-modal-msg')).toContainText('没有可导出的题目');
    await assertVisiblyRendered(page, '#error-modal .modal-content', '错误弹窗主体');
    await assertVisiblyRendered(page, '#error-modal-close-btn', '错误弹窗关闭按钮');
    await captureForReview(page, 'error-modal-export');

    await page.locator('#error-modal-close-btn').click();
    await expect(page.locator('#error-modal')).not.toHaveClass(/active/);
  });

  test('回归：error 类型不再写内嵌状态条，改走全局错误弹窗', async ({ page }) => {
    await page.evaluate(() => window.showStatus('统一错误弹窗测试', 'error'));

    await expect(page.locator('#error-modal')).toHaveClass(/active/);
    await expect(page.locator('#error-modal-msg')).toContainText('统一错误弹窗测试');
    await expect(page.locator('#status-message .status')).toHaveCount(0);
  });

  test('success toast 滚动到页面底部后仍可见，且 3 秒自动消失', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.showStatus('操作成功提示测试', 'success'));

    await assertVisiblyRendered(page, '#toast', '成功 toast');
    await expect(page.locator('#toast')).toContainText('操作成功提示测试');
    await captureForReview(page, 'toast-scrolled-bottom');

    await expect(page.locator('#toast')).toBeHidden({ timeout: 4000 });
  });

  test('info toast 同样走悬浮提示并自动消失', async ({ page }) => {
    await page.evaluate(() => window.showStatus('正在处理提示测试', 'info'));

    await assertVisiblyRendered(page, '#toast', '信息 toast');
    await expect(page.locator('#toast')).toBeHidden({ timeout: 4000 });
  });

  test('toast 不阻挡页面点击（pointer-events: none）', async ({ page }) => {
    await page.evaluate(() => window.showStatus('操作成功提示测试', 'success'));
    await expect(page.locator('#toast')).toContainText('操作成功提示测试');

    const pointerEvents = await page.evaluate(
      () => getComputedStyle(document.getElementById('toast')).pointerEvents
    );
    expect(pointerEvents).toBe('none');
  });
});
