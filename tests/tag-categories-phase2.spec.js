const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

async function openTagsTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '标签管理' }).click();
  await expect(page.locator('#categories-list')).toBeVisible();
}

// 1.4 批量分类界面（列表分页 + 默认全勾 + 一键同意）。25 个种子名全部命中预置映射。
const SEED_NAMES = [
  '临界情况', '动滑轮模型', '动量定理', '机械能守恒', '摩擦角', '追及问题', '微元法', '求导',
  '图像', '多过程分析', '情境题', '典型题', '机械波多解',
  '易错题', '困难', '来回不对称', '方向任意', '易错',
  '较难', '难度较大', '较新',
  'f=kv', '光学', '活动杆', '流体模型',
];

test.describe('1.4 批量分类未分类标签', () => {
  test('列表分页：一页多个标签、默认全勾、取消勾的标签仍留未分类', async ({ page }) => {
    await openTagsTab(page);
    await page.evaluate(async (names) => {
      for (const name of names) await window.dbCreateTag(name, '#4CC3FF');
      await window.loadTags();
    }, SEED_NAMES);
    await expect(page.locator('#batch-categorize-btn')).toContainText('批量分类（25）');

    await page.click('#batch-categorize-btn');
    await expect(page.locator('#batch-categorize-modal')).toBeVisible();

    // ① 一次一页：首页 20 行，远多于 1 个（证明不是「一次一个」）
    const rows = page.locator('#batch-list .batch-row');
    await expect(rows).toHaveCount(20);
    await expect(page.locator('#batch-page-info')).toHaveText('第 1/2 页');

    // ⑤ 关键控件可见性
    await assertVisiblyRendered(page, '#batch-list', '批量分类标签列表');
    await assertVisiblyRendered(page, '#batch-page-info', '批量分类页码');
    await assertVisiblyRendered(page, '#batch-agree-all-btn', '一键全部同意按钮');
    await assertVisiblyRendered(page, '#batch-list .batch-cat-select >> nth=0', '批量分类行内类别下拉');

    // 每行下拉都有默认选中（默认 = Agent 预分类结果）
    const rowsWithDefault = await page.evaluate(() => Array.from(document.querySelectorAll('#batch-list .batch-row')).every((r) => {
      const s = r.querySelector('select');
      return s.selectedIndex >= 0 && !!s.options[s.selectedIndex].textContent;
    }));
    expect(rowsWithDefault).toBe(true);

    // 预置映射 + 未命中启发式：逐条比对类别名
    const guess = await page.evaluate(() => ({
      mappedK: window.guessCategoryForTag('临界情况'),
      mappedE: window.guessCategoryForTag('易错题'),
      mappedD: window.guessCategoryForTag('难度较大'),
      mappedQ: window.guessCategoryForTag('图像'),   // 王先生 JSON：图像 → 其他特征
      heurErr: window.guessCategoryForTag('某易错坑'),
      heurDiff: window.guessCategoryForTag('有点难'),
      heurQ: window.guessCategoryForTag('综合应用题'),
      fallback: window.guessCategoryForTag('法拉第电磁'),
    }));
    expect(guess.mappedK).toBe('知识点/模型');
    expect(guess.mappedE).toBe('易错题');
    expect(guess.mappedD).toBe('难度');
    expect(guess.mappedQ).toBe('其他特征');
    expect(guess.heurErr).toBe('易错题');
    expect(guess.heurDiff).toBe('难度');
    expect(guess.heurQ).toBe('情境');
    expect(guess.fallback).toBe('知识点/模型');

    // ② 勾选框默认全勾
    await expect(page.locator('#batch-list .batch-row-check:checked')).toHaveCount(20);

    // 本页全不选 / 本页全选
    await page.click('#batch-categorize-modal button:has-text("本页全不选")');
    await expect(page.locator('#batch-list .batch-row-check:checked')).toHaveCount(0);
    await page.click('#batch-categorize-modal button:has-text("本页全选")');
    await expect(page.locator('#batch-list .batch-row-check:checked')).toHaveCount(20);

    // ③ 取消第一个勾 = 不同意 → 确认后该标签仍为未分类
    const firstRow = rows.first();
    const uncheckedName = await firstRow.evaluate((el) => el.dataset.tagName);
    await firstRow.locator('input[type="checkbox"]').uncheck();
    await expect(firstRow.locator('input[type="checkbox"]')).not.toBeChecked();

    await captureForReview(page, 'batch-categorize-page1');
    await page.click('#batch-categorize-modal button:has-text("确认本页并下一页")');
    await expect(page.locator('#batch-page-info')).toHaveText('第 2/2 页');
    await expect(page.locator('#batch-list .batch-row')).toHaveCount(5);

    const state = await page.evaluate(async (name) => {
      const tags = await window.dbGetAllTags();
      const t = tags.find((x) => x.name === name);
      return { unclassified: tags.filter((x) => !x.category_id).length, thisCat: t ? t.category_id : 'MISSING' };
    }, uncheckedName);
    expect(state.thisCat, '取消勾选的标签不应写入类别').toBeNull();
    expect(state.unclassified, '本页其余已勾选 19 个已写入，剩未勾 1 + 第二页 5').toBe(6);

    await captureForReview(page, 'batch-categorize-page2');
    await page.evaluate(() => window.closeBatchCategorize());
  });

  test('一键全部同意：所有页默认勾选一次写入，未分类数归零', async ({ page }) => {
    await openTagsTab(page);
    await page.evaluate(async (names) => {
      for (const name of names) await window.dbCreateTag(name, '#4CC3FF');
      await window.loadTags();
    }, SEED_NAMES);
    const before = await page.evaluate(() => window.dbGetAllTags().then((l) => l.filter((t) => !t.category_id).length));
    expect(before).toBe(25);

    await page.click('#batch-categorize-btn');
    await expect(page.locator('#batch-categorize-modal')).toBeVisible();
    await expect(page.locator('#batch-progress')).toContainText('已勾选 25');
    await captureForReview(page, 'batch-categorize-agree-all');

    // ④ 一键同意后未分类数下降（归零）
    await page.click('#batch-agree-all-btn');
    await expect(page.locator('#batch-categorize-modal')).toBeHidden();
    await expect(page.locator('#batch-categorize-btn')).toContainText('批量分类（0）');
    const after = await page.evaluate(() => window.dbGetAllTags().then((l) => l.filter((t) => !t.category_id).length));
    expect(after).toBe(0);
  });
});

// 1.5 新建标签强制选类别（三处入口）
test.describe('1.5 新建标签强制选类别', () => {
  test('新建标签弹窗：未选类别被拦截，选类别后成功', async ({ page }) => {
    await openTagsTab(page);
    await page.evaluate(() => window.showNewTagModal('form'));
    await expect(page.locator('#new-tag-modal')).toBeVisible();
    await assertVisiblyRendered(page, '#new-tag-category', '新建标签类别选择器');

    // 未选类别直接创建 -> 应被拦截并提示
    await page.fill('#new-tag-name', '强制类别测试X');
    await page.click('#new-tag-modal button:has-text("创建")');
    await expect(page.locator('#error-modal')).toBeVisible();
    await expect(page.locator('#error-modal-msg')).toHaveText('请先选择类别');
    await page.click('#error-modal-close-btn');
    await expect(page.locator('#error-modal')).toBeHidden();

    const stillMissing = await page.evaluate(async () => !(await window.dbGetAllTags()).some((t) => t.name === '强制类别测试X'));
    expect(stillMissing).toBe(true);

    // 选类别后创建 -> 成功并写入 category_id
    const catId = await page.evaluate(async () => (await window.dbGetAllTagCategories())[0].id);
    await page.selectOption('#new-tag-category', catId);
    await page.click('#new-tag-modal button:has-text("创建")');
    await expect(page.locator('#new-tag-modal')).toBeHidden();

    const created = await page.evaluate(async () => {
      const t = (await window.dbGetAllTags()).find((x) => x.name === '强制类别测试X');
      return t ? { name: t.name, category_id: t.category_id } : null;
    });
    expect(created).not.toBeNull();
    expect(created.category_id).not.toBeNull();

    await captureForReview(page, 'gap2-force-category');
  });

  test('题内联新建标签：未选类别被拦截', async ({ page }) => {
    await page.goto('/');
    const qid = await page.evaluate(async () => {
      const q = await window.dbCreateQuestion('data:image/png;base64,', 'data:image/png;base64,', [], 0, null, [], null);
      await window.loadQuestions();
      return q.id;
    });
    await page.evaluate((id) => window.toggleInlineTagAdd(id), qid);
    const inlineSel = '#inline-tag-category-' + qid;
    await expect(page.locator(inlineSel)).toBeVisible();
    await assertVisiblyRendered(page, inlineSel, '题内联类别选择器');

    await page.fill('#inline-tag-search-' + qid, '内联强制Y');
    await page.locator('#inline-tag-results-' + qid + ' .inline-tag-result').click();
    await expect(page.locator('#error-modal')).toBeVisible();
    await expect(page.locator('#error-modal-msg')).toHaveText('请先选择类别');
    await page.click('#error-modal-close-btn');

    const notCreated = await page.evaluate(async () => !(await window.dbGetAllTags()).some((t) => t.name === '内联强制Y'));
    expect(notCreated).toBe(true);

    await captureForReview(page, 'gap2-inline-force-category');
  });
});

// N1 未打标签的题入口
test.describe('N1 未打标签的题入口', () => {
  test('显示未打标签计数、列出题目并可批量补标签', async ({ page }) => {
    await openTagsTab(page);
    await page.evaluate(async () => {
      const tag = await window.dbCreateTag('补标Z', '#4CC3FF');
      await window.dbCreateQuestion('data:image/png;base64,', 'data:image/png;base64,', [], 0, null, [], null);
      await window.loadQuestions();
      await window.loadTags();
    });
    await expect(page.locator('#untagged-btn')).toContainText('未打标签的题（1）');

    await page.click('#untagged-btn');
    await expect(page.locator('#untagged-modal')).toBeVisible();
    await assertVisiblyRendered(page, '#untagged-list', '未打标签题目列表');
    await assertVisiblyRendered(page, '#untagged-tag', '未打标签补标选择器');

    const rows = page.locator('#untagged-list input[type="checkbox"]');
    await expect(rows).toHaveCount(1);
    await rows.first().check();

    await page.selectOption('#untagged-tag', { label: '补标Z' });
    await page.click('button:has-text("批量加标签")');
    await expect(page.locator('#untagged-modal-count')).toHaveText('（0）');

    const after = await page.evaluate(() => window.listUntaggedQuestions().then((l) => l.length));
    expect(after).toBe(0);

    await captureForReview(page, 'gap3-untagged-entry');
  });
});
