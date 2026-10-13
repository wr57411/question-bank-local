const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

async function openTagsTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '标签管理' }).click();
  await expect(page.locator('#categories-list')).toBeVisible();
}

test.describe('标签管理 - 类别分区 + 选择器可见性', () => {
  test('分区与关键控件实际可见（对比度达标、无遮挡、无截断）', async ({ page }) => {
    await openTagsTab(page);

    const firstRow = page.locator('#categories-list > div:first-child');
    await firstRow.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#categories-list > div:first-child', '类别首行');
    await expect(page.locator('#categories-list')).toContainText('系统');

    const addBtn = page.locator('button:has-text("新增类别")');
    await addBtn.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, 'button:has-text("新增类别")', '新增类别按钮');

    const chapterItem = page.locator('#chapter-visibility label').first();
    await chapterItem.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#chapter-visibility label:first-child', '章节首类别勾选项');

    const topicItem = page.locator('#topic-visibility label').first();
    await topicItem.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#topic-visibility label:first-child', '专题首类别勾选项');

    await captureForReview(page, 'tag-categories-partition');
  });

  test('勾选可见性配置后持久化（reload 保留）', async ({ page }) => {
    await openTagsTab(page);

    // 先强制设为「全勾选 + 显示未分类」的已知状态，避免跨测试/默认漂移
    await page.evaluate(async () => {
      const cats = await window.dbGetAllTagCategories();
      await window.setVisibilityConfig('chapter', { ids: cats.map((c) => c.id), unclassified: true });
      await window.renderVisibilityConfig();
    });

    const first = page.locator('#chapter-visibility input[type="checkbox"]').first();
    await expect(first).toBeChecked();
    const unclassified = page.locator('#chapter-visibility label:has-text("未分类") input[type="checkbox"]');
    await expect(unclassified).toBeChecked();

    await first.uncheck();
    await unclassified.uncheck();

    await page.reload();
    await page.getByRole('button', { name: '标签管理' }).click();
    await expect(page.locator('#categories-list')).toBeVisible();

    const firstAfter = page.locator('#chapter-visibility input[type="checkbox"]').first();
    const unAfter = page.locator('#chapter-visibility label:has-text("未分类") input[type="checkbox"]');
    await expect(firstAfter).not.toBeChecked();
    await expect(unAfter).not.toBeChecked();

    await captureForReview(page, 'tag-categories-visibility-persist');
  });

  test('新增类别（prompt 接受）即时出现在列表中', async ({ page }) => {
    page.on('dialog', (d) => d.accept('新类别ZZ'));
    await openTagsTab(page);

    await page.click('button:has-text("新增类别")');
    await expect(page.locator('#categories-list')).toContainText('新类别ZZ');

    await captureForReview(page, 'tag-categories-add');
  });
});
