const { test, expect } = require('@playwright/test');
const {
  assertVisiblyRendered,
  captureForReview,
  measure,
  parseRgb,
  contrastRatio,
} = require('./helpers/visibility');

// 造数惯例复用 tests/app.spec.js：用数据层 dbCreateQuestion + UI 建标签
async function createTag(page, name) {
  await page.getByRole('button', { name: '标签管理' }).click();
  await page.locator('#tag-name').fill(name);
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator('#tags-list .tag', { hasText: name })).toBeVisible();
}

async function createQuestionWithImage(page, { tagName, label }) {
  await page.evaluate(async (args) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 150);
    ctx.fillStyle = '#1B7A4E';
    ctx.font = '24px sans-serif';
    ctx.fillText(args.label, 20, 80);

    const tags = await window.dbGetAllTags();
    const tag = tags.find((t) => t.name === args.tagName);
    if (!tag) throw new Error('标签不存在: ' + args.tagName);

    await window.dbCreateQuestion(
      canvas.toDataURL('image/png'),
      null,
      [tag.id],
      0,
      null,
      [],
      { book_name: '人教版九上', page_number: '42', question_number: '1' }
    );
    await window.loadQuestions();
  }, { tagName, label });
}

// 本轮 UI 改动只有一处：备份弹窗状态行从「待同步变更: N 条」(永远 0，误导)
// 改为「上次备份: <时间> | 当前数据: N 题 / N 标签 / N 关联」。
test.describe('备份弹窗状态行可见性（D8 文案改动验收）', () => {
  test('状态行渲染可见：文案正确、对比度达标、无遮挡无截断', async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
    });
    await page.setViewportSize({ width: 1280, height: 1024 });

    await page.goto('/');

    // 造一些数据，让「当前数据: N 题 / N 标签 / N 关联」显示真实非零数字
    await createTag(page, '数学');
    await createQuestionWithImage(page, { tagName: '数学', label: '题图A' });

    // 写入 lastBackupTime，使 updateBackupStatusUI 走「上次备份 | 当前数据」新文案分支
    await page.evaluate(() => localStorage.setItem('lastBackupTime', new Date().toISOString()));

    // 打开备份弹窗（showBackupModal 内部会调用 updateBackupStatusUI）
    await page.evaluate(() => window.showBackupModal());
    await expect(page.locator('#backup-modal')).toBeVisible();

    const m = await assertVisiblyRendered(page, '#backup-status', '备份状态行');

    // 计算并输出对比度数值（assertVisiblyRendered 已断言 >= 3，这里记录实际值）
    const fg = parseRgb(m.color);
    const bg = parseRgb(m.background);
    const ratio = fg && bg ? contrastRatio(fg, bg) : NaN;
    console.log('[backup-status] 文案 =', JSON.stringify(m.text));
    console.log('[backup-status] color =', m.color, '| background =', m.background, '| 对比度 =', ratio.toFixed(2));

    // 校验新文案格式确实包含「当前数据」与题/标签/关联三计数
    expect(m.text).toMatch(/上次备份:/);
    expect(m.text).toMatch(/当前数据:/);
    expect(m.text).toMatch(/\d+ 题 \/ \d+ 标签 \/ \d+ 关联/);

    // 截图落到 test-results/screenshots/（项目约定位置）
    const shot = await captureForReview(page, 'backup-status-new-text');
    console.log('[backup-status] 截图路径 =', shot);
  });
});
