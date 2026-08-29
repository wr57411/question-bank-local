const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview, measure } = require('./helpers/visibility');

async function openQuickImportWithCombo(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  await page.click('#qi-combo-btn');
  await page.fill('#qi-combo-name', '组合一');
  await page.locator('#quick-combo-panel button:has-text("新建")').click();
  await page.locator('#quick-combo-panel button:has-text("×")').click();
}

test.describe('快速导入 - 顶部条实际可见性', () => {
  test('关键控件文字可见：对比度达标、未被截断、未被遮挡', async ({ page }) => {
    await openQuickImportWithCombo(page);

    await assertVisiblyRendered(page, '#qi-combo-btn', '组合按钮');
    await assertVisiblyRendered(page, '#qi-layout-btn', '栏数按钮');
    await assertVisiblyRendered(page, '#qi-confirm-btn', '确认按钮');
    await assertVisiblyRendered(
      page,
      '#quick-import-bar button[title="交换题目与答案"]',
      '交换按钮'
    );
    await assertVisiblyRendered(page, '#qi-tag-input', '标签输入框');

    await captureForReview(page, 'quick-import-bar');
  });

  test('标签输入框尺寸足够手指点中', async ({ page }) => {
    await openQuickImportWithCombo(page);
    const input = await measure(page, '#qi-tag-input');
    expect(input.offsetHeight, '输入框高度应 >= 40px').toBeGreaterThanOrEqual(40);
    expect(input.offsetWidth, '输入框宽度应 > 200px').toBeGreaterThan(200);
  });

  test('组合面板打开后文字同样可见', async ({ page }) => {
    await openQuickImportWithCombo(page);
    await page.click('#qi-combo-btn');

    await assertVisiblyRendered(page, '#quick-combo-panel', '组合面板遮罩', { skipContrast: true });
    await assertVisiblyRendered(page, '#quick-combo-panel > div', '组合面板卡片');
    await assertVisiblyRendered(page, '#qi-combo-name', '组合名输入框');
    await assertVisiblyRendered(page, '#qi-combo-list', '组合列表');

    await captureForReview(page, 'quick-import-combo-panel');
  });

  test('组合按钮宽度随名称动态伸缩（手机视口 390px）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImportWithCombo(page);
    const short = await measure(page, '#qi-combo-btn');

    const probe = (text) =>
      page.evaluate((t) => {
        const btn = document.getElementById('qi-combo-btn');
        btn.textContent = t;
        return {
          offsetWidth: btn.offsetWidth,
          clientWidth: btn.clientWidth,
          scrollWidth: btn.scrollWidth,
        };
      }, text);

    const nine = await probe('高三总复习专用组合 ▾');
    const eighteen = await probe('高三总复习专用组合加上同步练习和基础训练 ▾');

    console.log(
      '手机 390px 视口 ｜短名称:', short.offsetWidth,
      '｜9字:', nine.offsetWidth, `(截断:${nine.scrollWidth > nine.clientWidth + 1})`,
      '｜18字:', eighteen.offsetWidth, `(截断:${eighteen.scrollWidth > eighteen.clientWidth + 1})`
    );

    expect(nine.offsetWidth, '长名称时按钮应比短名称更宽').toBeGreaterThan(short.offsetWidth);
    expect(nine.scrollWidth, '9 字名称在手机视口下不应被截断').toBeLessThanOrEqual(nine.clientWidth + 1);
    expect(eighteen.scrollWidth, '18 字超长名称才允许省略号').toBeGreaterThan(eighteen.clientWidth);
  });
});
