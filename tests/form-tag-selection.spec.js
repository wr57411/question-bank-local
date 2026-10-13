const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

const TAG_NAME = 'E2E表单标签';

async function ensureTag(page) {
  return page.evaluate(async (name) => {
    let tag = window.allTags.find((t) => t.name === name);
    if (!tag) {
      tag = await window.dbCreateTag(name, '#4CC3FF');
      await window.loadTags();
    }
    return tag.id;
  }, TAG_NAME);
}

test.describe('添加题目表单 - 标签选择可见性', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#form-tag-search')).toBeVisible();
    await ensureTag(page);
  });

  test('搜索并点击标签后，已选 chip 实际可见（手机视口 390px）', async ({ page }) => {
    await page.fill('#form-tag-search', TAG_NAME);
    const result = page.locator('#form-tag-results span', { hasText: TAG_NAME }).first();
    await expect(result).toBeVisible();
    await result.click();

    const chip = page.locator('#form-tag-selected > span').first();
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(TAG_NAME);
    await chip.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#form-tag-selected > span', '已选标签 chip');

    await captureForReview(page, 'form-tag-selected');
  });

  test('点击 chip 上的 ✕ 可移除已选标签', async ({ page }) => {
    await page.evaluate((id) => window.addFormTag(id), await ensureTag(page));
    await expect(page.locator('#form-tag-selected > span')).toHaveCount(1);

    await page.locator('#form-tag-selected > span span[onclick]').click();
    await expect(page.locator('#form-tag-selected > span')).toHaveCount(0);
  });

  test('回归：选中标签的显示被清空后，loadTags 会重新渲染（防后台恢复丢失）', async ({ page }) => {
    const tagId = await ensureTag(page);
    await page.evaluate((id) => window.addFormTag(id), tagId);
    await expect(page.locator('#form-tag-selected > span')).toHaveCount(1);

    await page.evaluate(() => {
      document.getElementById('form-tag-selected').innerHTML = '';
      return window.loadTags();
    });

    await expect(page.locator('#form-tag-selected > span')).toHaveCount(1);
    await page.locator('#form-tag-selected > span').first().scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#form-tag-selected > span', 'loadTags 恢复后的已选 chip');
  });
});
