const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview } = require('./helpers/visibility');

async function openTagsTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '标签管理' }).click();
  await expect(page.locator('#groups-list')).toBeVisible();
}

// 种子：知识点/模型标签 圆周运动、平抛运动；难度标签 较难；一个未分类标签。
// q1: 圆周运动 + 较难   q2: 圆周运动   q3: 平抛运动
async function seed(page) {
  return page.evaluate(async () => {
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
    const t4 = await mk('未分类标签X', '#8A87A0', null);
    const mkQ = async (tagIds) => (await window.dbCreateQuestion('data:image/png;base64,', 'data:image/png;base64,', tagIds, 0, null, [], null)).id;
    const q1 = await mkQ([t1, t3]);
    const q2 = await mkQ([t1]);
    const q3 = await mkQ([t2]);
    await window.loadTags();
    return { t1, t2, t3, t4, q1, q2, q3 };
  });
}

async function seedData(page) {
  return seed(page);
}

const rootAddMember = '#group-editor-tree .gexpr-group[data-path=""] > .gexpr-node-actions .gexpr-add-member';
const subAddMember = (i) => `#group-editor-tree .gexpr-group[data-path="${i}"] > .gexpr-node-actions .gexpr-add-member`;

async function pickTag(page, name) {
  await expect(page.locator('#group-editor-tag-search')).toBeVisible();
  await page.fill('#group-editor-tag-search', name);
  const item = page.locator(`#group-editor-tag-results .gexpr-tag-item:has-text("${name}")`).first();
  await expect(item).toBeVisible();
  await item.click();
}

test.describe('2.4 章节编辑器（只给「或」、节点题数、回显）', () => {
  test('打开编辑器、加标签显示每节点题数、无「且」/无子分组、保存', async ({ page }) => {
    await openTagsTab(page);
    await seedData(page);

    await page.click('button:has-text("＋ 新建章节")');
    await expect(page.locator('#group-editor-modal')).toBeVisible();
    await assertVisiblyRendered(page, '#group-editor-name', '章节名称输入框');
    await assertVisiblyRendered(page, '#group-editor-tree .gexpr-group[data-path=""]', '章节根分组');

    // 章节只给「或」：不得出现「且」切换，也不得出现子分组入口（裁决1）
    await expect(page.locator('#group-editor-tree .gexpr-op[data-op="and"]')).toHaveCount(0);
    await expect(page.locator('#group-editor-tree .gexpr-add-subgroup')).toHaveCount(0);

    await page.click(rootAddMember);
    await pickTag(page, '圆周运动');
    await page.click(rootAddMember);
    await pickTag(page, '平抛运动');

    // 每节点题数：圆周运动 2 题、平抛运动 1 题、根 3 题
    const leafCounts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#group-editor-tree .gexpr-leaf')).map((n) => ({
        name: n.querySelector('.gexpr-leaf-name').textContent,
        count: n.querySelector('.gexpr-count').textContent,
      })));
    expect(leafCounts).toEqual([
      { name: '圆周运动', count: '2 题' },
      { name: '平抛运动', count: '1 题' },
    ]);
    await assertVisiblyRendered(page, '#group-editor-tree .gexpr-leaf[data-path="0"]', '章节叶子节点(含题数)');

    await expect(page.locator('#group-editor-summary')).toHaveText('最终题数：3 题');
    await page.locator('#group-editor-echo').scrollIntoViewIfNeeded();
    await assertVisiblyRendered(page, '#group-editor-echo', '章节可读回显');
    await expect(page.locator('#group-editor-echo')).toHaveText('回显：圆周运动 或 平抛运动');

    await page.fill('#group-editor-name', '第一章 曲线运动');
    await page.click('#group-editor-modal button:has-text("保存")');
    await expect(page.locator('#group-editor-modal')).toBeHidden();

    const row = page.locator('#groups-list .group-row', { hasText: '第一章 曲线运动' });
    await expect(row).toBeVisible();
    await expect(row.locator('.group-row-echo')).toHaveText('圆周运动 或 平抛运动');
    await expect(row.locator('.group-row-meta')).toHaveText('3 题');

    await captureForReview(page, 'r4b-group-editor-chapter');
  });

  test('章节选择器按 D-b 隐藏未分类标签并给出「去分类」提示', async ({ page }) => {
    await openTagsTab(page);
    await seedData(page);
    await page.click('button:has-text("＋ 新建章节")');
    await expect(page.locator('#group-editor-modal')).toBeVisible();
    await page.click(rootAddMember);
    await assertVisiblyRendered(page, '#group-editor-tag-search', '标签选择器搜索框');
    await assertVisiblyRendered(page, '#group-editor-tag-results', '标签选择器结果区');

    // 未分类标签不出现在章节选择器
    await expect(page.locator('#group-editor-tag-results .gexpr-tag-item:has-text("未分类标签X")')).toHaveCount(0);
    await expect(page.locator('#group-editor-unclassified-hint')).toContainText('未分类标签');
    await expect(page.locator('#group-editor-unclassified-hint .gexpr-goto-category')).toHaveText('去分类');
    // 难度标签（默认章节不可见）也不出现
    await expect(page.locator('#group-editor-tag-results .gexpr-tag-item:has-text("较难")')).toHaveCount(0);
    // 知识点/模型 标签出现，且带题数
    await expect(page.locator('#group-editor-tag-results .gexpr-tag-item:has-text("圆周运动") .gexpr-tag-count')).toHaveText('2 题');

    await captureForReview(page, 'r4b-chapter-picker-visibility');
  });
});

test.describe('2.4 / 2.6 专题编辑器（且/或 + 一层子分组 + 回显 + 跨分组角标）', () => {
  test('分组「或」+ 根「且」→ 回显（A 或 B）且 C，题数分层正确', async ({ page }) => {
    await openTagsTab(page);
    const ids = await seedData(page);
    // 先建一个引用「圆周运动/平抛运动」的章节，供跨分组角标显示
    await page.evaluate(async ([a, b]) => {
      await window.dbCreateGroup({ kind: 'chapter', name: '第一章', expr: { op: 'or', children: [{ tag: a }, { tag: b }] } });
    }, [ids.t1, ids.t2]);

    await page.click('button:has-text("＋ 新建专题")');
    await expect(page.locator('#group-editor-modal')).toBeVisible();

    // 先建一个子分组（落在 path=0）
    await page.click('#group-editor-tree .gexpr-add-subgroup');
    await page.click(subAddMember(0));
    await page.fill('#group-editor-tag-search', '圆周运动');
    // 跨分组角标：圆周运动 已被「第一章」使用
    await expect(page.locator('#group-editor-tag-results .gexpr-tag-item:has-text("圆周运动") .gexpr-tag-ref')).toHaveText('已用于 第一章');
    await assertVisiblyRendered(page, '#group-editor-tag-results .gexpr-tag-item:has-text("圆周运动")', '带跨分组角标的标签项');
    await page.locator('#group-editor-tag-results .gexpr-tag-item:has-text("圆周运动")').first().click();
    await pickTag(page, '平抛运动');
    // 根（path=""）加「较难」
    await page.click(rootAddMember);
    await pickTag(page, '较难');
    // 根设为「且」
    await page.click('#group-editor-tree .gexpr-group[data-path=""] .gexpr-op[data-op="and"]');

    await expect(page.locator('#group-editor-tree .gexpr-group[data-path=""] > .gexpr-node-head .gexpr-op.active')).toHaveText('且');
    await expect(page.locator('#group-editor-tree .gexpr-group[data-path="0"] > .gexpr-node-head .gexpr-count')).toHaveText('3 题');

    await page.locator('#group-editor-echo').scrollIntoViewIfNeeded();
    await expect(page.locator('#group-editor-echo')).toHaveText('回显：（圆周运动 或 平抛运动）且 较难');
    await assertVisiblyRendered(page, '#group-editor-echo', '专题可读回显(含且)');
    await expect(page.locator('#group-editor-summary')).toContainText('最终题数：1 题');

    await page.fill('#group-editor-name', '期末冲刺');
    await page.click('#group-editor-modal button:has-text("保存")');
    await expect(page.locator('#group-editor-modal')).toBeHidden();
    await expect(page.locator('#groups-list .group-row', { hasText: '期末冲刺' })).toBeVisible();

    await captureForReview(page, 'r4b-group-editor-topic');
  });
});

test.describe('2.7 删标签级联清理', () => {
  test('有引用时弹窗列出「清理前 N 题 → 清理后 M 题」，确认后物理移除引用', async ({ page }) => {
    await openTagsTab(page);
    const ids = await seedData(page);
    await page.evaluate(async ([t1, t2]) => {
      const g = await window.dbCreateGroup({ kind: 'chapter', name: '第一章', expr: { op: 'or', children: [{ tag: t1 }, { tag: t2 }] } });
      window.__gid = g.id;
    }, [ids.t1, ids.t2]);

    await page.evaluate((id) => window.deleteTag(id), ids.t1);
    await expect(page.locator('#tag-cascade-modal')).toBeVisible();
    await assertVisiblyRendered(page, '#tag-cascade-list .cascade-row', '级联清理变化行');
    await expect(page.locator('#tag-cascade-title')).toHaveText('删除标签「圆周运动」');
    await expect(page.locator('#tag-cascade-list .cascade-row .cascade-name')).toHaveText('第一章');
    await expect(page.locator('#tag-cascade-list .cascade-delta')).toHaveText('清理前 3 题 → 清理后 1 题');

    await captureForReview(page, 'r4b-tag-cascade-modal');

    await page.click('#tag-cascade-modal button:has-text("确认清理并删除")');
    await expect(page.locator('#tag-cascade-modal')).toBeHidden();
    // 清理是异步链，等列表回显收敛为「只剩平抛运动」再断言
    await expect(page.locator('#groups-list .group-row', { hasText: '第一章' }).locator('.group-row-echo'))
      .toHaveText('平抛运动');

    const after = await page.evaluate(async ([idx, tagId]) => {
      const g = await window.dbGetGroup(window.__gid);
      const tags = await window.dbGetAllTags();
      return { stillReferenced: window.exprContainsTag(g.expr, tagId), tagGone: !tags.some((t) => t.id === tagId) };
    }, [0, ids.t1]);
    expect(after.stillReferenced).toBe(false);
    expect(after.tagGone).toBe(true);
  });

  test('无引用时直接删除，不弹级联窗（§3.1.2）', async ({ page }) => {
    await openTagsTab(page);
    const ids = await seedData(page);
    await page.evaluate((id) => window.deleteTag(id), ids.t2);
    await expect(page.locator('#tag-cascade-modal')).toBeHidden();
    const gone = await page.evaluate(async (id) => !(await window.dbGetAllTags()).some((t) => t.id === id), ids.t2);
    expect(gone).toBe(true);
  });
});

test.describe('2.8 删专题级联清理', () => {
  test('弹窗说明手动归入题数，确认后删除系统成员标签', async ({ page }) => {
    await openTagsTab(page);
    const { gid, memberTagId } = await page.evaluate(async () => {
      const g = await window.dbCreateGroup({ kind: 'topic', name: '易错专题' });
      const q = await window.dbCreateQuestion('data:image/png;base64,', 'data:image/png;base64,', [], 0, null, [], null);
      await window.dbAddTagToQuestion(q.id, g.member_tag_id);
      return { gid: g.id, memberTagId: g.member_tag_id };
    });
    await page.evaluate(() => window.renderGroupManage());

    const row = page.locator(`#groups-list .group-row[data-group-id="${gid}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.group-row-meta')).toHaveText('1 题');
    await row.locator('button:has-text("删除")').click();

    await expect(page.locator('#group-delete-modal')).toBeVisible();
    await assertVisiblyRendered(page, '#group-delete-message', '删专题弹窗说明');
    await expect(page.locator('#group-delete-message')).toContainText('1 道手动归入的题');
    await captureForReview(page, 'r4b-group-delete-modal');

    await page.click('#group-delete-modal button:has-text("确认删除")');
    await expect(page.locator('#group-delete-modal')).toBeHidden();
    // 删除是异步链（confirmDeleteGroup → dbDeleteGroup → refreshAll），等列表收敛再断言
    await expect(page.locator('#groups-list .group-row')).toHaveCount(0);

    const after = await page.evaluate(async ([g, t]) => {
      const groups = await window.dbGetAllGroups();
      const tags = await window.dbGetAllTags();
      return { groupGone: !groups.some((x) => x.id === g), memberTagGone: !tags.some((x) => x.id === t) };
    }, [gid, memberTagId]);
    expect(after.groupGone).toBe(true);
    expect(after.memberTagGone).toBe(true);
  });
});
