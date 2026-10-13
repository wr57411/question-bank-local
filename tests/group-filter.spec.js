const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview, measure } = require('./helpers/visibility');

// 种子：知识点/模型标签 圆周运动、平抛运动；难度 较难。
// q1: 圆周运动+较难  q2: 圆周运动  q3: 平抛运动
// 章节「第一章」= 圆周运动 或 平抛运动（3 题）；专题「期末冲刺」= 纯手工（空表达式，成员仅来自手动归入）
async function seed(page) {
  return page.evaluate(async () => {
    // 确保默认类别已种入（refreshAll 内含 ensureDefaultTagCategories），避免与启动竞态
    await window.refreshAll?.();
    const cats = await window.dbGetAllTagCategories();
    const kp = cats.find((c) => c.name === '知识点/模型');
    const diff = cats.find((c) => c.name === '难度');
    const mk = async (name, color, catId) => {
      const t = await window.dbCreateTag(name, color);
      if (catId) await window.dbUpdateTag(t.id, { category_id: catId });
      return t.id;
    };
    const t1 = await mk('圆周运动', '#4CC3FF', kp.id);
    const t2 = await mk('平抛运动', '#4CC3FF', kp.id);
    const t3 = await mk('较难', '#F79009', diff.id);
    const mkQ = async (tagIds) => (await window.dbCreateQuestion('data:image/png;base64,', 'data:image/png;base64,', tagIds, 0, null, [], null)).id;
    const q1 = await mkQ([t1, t3]);
    const q2 = await mkQ([t1]);
    const q3 = await mkQ([t2]);
    const chapter = await window.dbCreateGroup({ kind: 'chapter', name: '第一章', expr: { op: 'or', children: [{ tag: t1 }, { tag: t2 }] } });
    // 纯手工专题（空表达式）：成员仅来自手动归入，便于验证「加入/移出」写入系统成员标签
    const topic = await window.dbCreateGroup({ kind: 'topic', name: '期末冲刺' });
    await window.loadTags();
    await window.loadQuestions();
    return { t1, t2, t3, q1, q2, q3, chapterId: chapter.id, topicId: topic.id, memberTagId: topic.member_tag_id };
  });
}

function filteredCount(page) {
  return page.evaluate(() => window.getFilteredQuestions().length);
}

test.describe('2.9 题目列表筛选区（章节行 / 专题行 / 标签 chips，层间 AND）', () => {
  test('展开筛选区显示章节/专题行，选定后回显表达式摘要并与标签层 AND', async ({ page }) => {
    await page.goto('/');
    await page.click('#filter-toggle'); // 展开并持久化 filterTagsExpanded=1
    const ids = await seed(page);

    const chapterChip = page.locator(`#filter-tags .ffilter-row[data-kind="chapter"] .filter-tag[data-group-id="${ids.chapterId}"]`);
    const topicChip = page.locator(`#filter-tags .ffilter-row[data-kind="topic"] .filter-tag[data-group-id="${ids.topicId}"]`);
    await expect(page.locator('#filter-tags')).not.toHaveClass(/collapsed/);
    await expect(chapterChip).toHaveText('第一章（3）');
    await expect(topicChip).toHaveText('期末冲刺（0）');

    await chapterChip.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, `#filter-tags .ffilter-row[data-kind="chapter"] .filter-tag[data-group-id="${ids.chapterId}"]`, '章节筛选 chip');
    await assertVisiblyRendered(page, `#filter-tags .ffilter-row[data-kind="topic"] .filter-tag[data-group-id="${ids.topicId}"]`, '专题筛选 chip');

    // 选定章节 → 回显表达式摘要，题数 3
    await chapterChip.click();
    const echo = page.locator('#filter-tags .ffilter-row[data-kind="chapter"] .ffilter-echo');
    await expect(echo).toHaveText('回显：圆周运动 或 平抛运动');
    await echo.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#filter-tags .ffilter-row[data-kind="chapter"] .ffilter-echo', '章节表达式回显');
    await expect.poll(() => filteredCount(page)).toBe(3);

    // 再选标签「平抛运动」→ 层间 AND：章节(3) ∩ 平抛运动(1) = 1
    const tagChip = page.locator('#filter-tags .filter-tag', { hasText: '平抛运动' }).last();
    await tagChip.scrollIntoViewIfNeeded();
    await tagChip.click();
    await expect.poll(() => filteredCount(page)).toBe(1);

    // 再叠加专题（纯手工，成员 0，与章节/标签并列 AND）：1 ∩ 0 = 0
    await topicChip.click();
    await expect.poll(() => filteredCount(page)).toBe(0);

    await captureForReview(page, 'r4c-filter-layers');

    // 取消章节 → 专题(0) ∩ 标签(1) = 0
    await chapterChip.click();
    await expect.poll(() => filteredCount(page)).toBe(0);
    // 取消专题 → 只剩标签 平抛运动 = 1
    await topicChip.click();
    await expect.poll(() => filteredCount(page)).toBe(1);
    // 取消标签 → 全部 = 3
    await tagChip.click();
    await expect.poll(() => filteredCount(page)).toBe(3);
  });
});

test.describe('2.10 加入 / 移出专题（写入系统成员标签）', () => {
  test('列表批量勾选 → 加入专题；详情页单题 → 移出专题', async ({ page }) => {
    await page.goto('/');
    const ids = await seed(page);

    // 批量：勾选 q1 后加入「期末冲刺」
    await page.locator(`.question-card[data-id="${ids.q1}"] .q-checkbox`).click();
    await page.click('#batch-group-btn');
    await expect(page.locator('#group-assign-modal')).toBeVisible();
    await assertVisiblyRendered(page, `#group-assign-list .gassign-row[data-topic-id="${ids.topicId}"]`, '专题归入行');
    await captureForReview(page, 'r4c-group-assign-modal');

    await page.locator(`#group-assign-list .gassign-row[data-topic-id="${ids.topicId}"] button[data-action="add"]`).click();
    await expect
      .poll(() => page.evaluate(([tid, qid]) => window.getGroupMemberQuestionIds(tid).then((x) => x.includes(qid)), [ids.topicId, ids.q1]))
      .toBe(true);

    // 详情页：单题移出
    await page.evaluate(() => window.closeGroupAssignModal());
    await page.evaluate((qid) => window.showQuestionDetail(qid), ids.q1);
    await expect(page.locator('#question-modal')).toBeVisible();
    const detailBtn = page.locator('#modal-group-assign button', { hasText: '加入 / 移出专题' });
    await detailBtn.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#modal-group-assign button:has-text("加入 / 移出专题")', '详情页专题按钮');
    await detailBtn.click();
    await expect(page.locator('#group-assign-modal')).toBeVisible();
    await page.locator(`#group-assign-list .gassign-row[data-topic-id="${ids.topicId}"] button[data-action="remove"]`).click();
    await expect
      .poll(() => page.evaluate(([tid, qid]) => window.getGroupMemberQuestionIds(tid).then((x) => !x.includes(qid)), [ids.topicId, ids.q1]))
      .toBe(true);
  });
});

test.describe('2.11 快速导入栏专题匹配框', () => {
  test('圆钮「专」22–26px，点开内联面板可选中专题（常态 0 高度）', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
    await page.reload();
    await seed(page);
    await expect(page.locator('#quick-import-bar')).toBeVisible();

    // 常态 0 高度（display:none）
    await expect(page.locator('#qi-topic-panel')).toBeHidden();

    await assertVisiblyRendered(page, '#qi-topic-btn', '专题圆钮');
    const m = await measure(page, '#qi-topic-btn');
    expect(m.offsetWidth, '专题圆钮宽度应在 22–26px').toBeGreaterThanOrEqual(22);
    expect(m.offsetWidth, '专题圆钮宽度应在 22–26px').toBeLessThanOrEqual(26);

    await page.click('#qi-topic-btn');
    await expect(page.locator('#qi-topic-panel')).toBeVisible();
    await assertVisiblyRendered(page, '#qi-topic-panel', '专题匹配面板', { skipContrast: true });
    await assertVisiblyRendered(page, '#qi-topic-list', '专题匹配列表');
    await captureForReview(page, 'r4c-quick-topic-panel');

    await expect(page.locator('#qi-topic-list [data-topic-id]').first()).toBeVisible();
    await page.locator('#qi-topic-list [data-topic-id]').first().click();
    const selected = await page.evaluate(() => document.getElementById('qi-topic-btn').style.background);
    expect(selected).toContain('var(--primary)');
    await page.click('#qi-topic-btn');
    await expect(page.locator('#qi-topic-panel')).toBeHidden();
  });
});

test.describe('2.12 系统成员标签在题目卡片显示 chip', () => {
  test('手动归入的题在卡片上显示「专题·X」chip（带区分标记）', async ({ page }) => {
    await page.goto('/');
    const ids = await seed(page);
    await page.evaluate(async ([qid, tagId]) => {
      await window.dbAddTagToQuestion(qid, tagId);
      await window.loadQuestions();
    }, [ids.q1, ids.memberTagId]);

    const card = page.locator(`.question-card[data-id="${ids.q1}"]`);
    const sysChip = card.locator('.tags .tag.tag-system');
    await expect(sysChip).toHaveText(/专题·期末冲刺/);
    await sysChip.scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, `.question-card[data-id="${ids.q1}"] .tags .tag.tag-system`, '系统成员标签 chip', { skipContrast: true });
    await captureForReview(page, 'r4c-system-tag-chip');
  });
});
