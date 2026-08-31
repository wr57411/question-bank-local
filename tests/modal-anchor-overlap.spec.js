const { test, expect } = require('@playwright/test');
const { captureForReview } = require('./helpers/visibility');

async function enableQuickImport(page, noteExpanded = true) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  // 等待 bar 可见
  await expect(page.locator('#quick-import-bar')).toBeVisible();
  if (!noteExpanded) {
    await page.click('#qi-note-btn'); // 收起笔记区 -> 高度回落到 196
    await expect(page.locator('#qi-note-area')).toBeHidden();
  }
}

function noOverlap(page, modalContentSelector) {
  return page.evaluate((sel) => {
    const bar = document.getElementById('quick-import-bar');
    const content = document.querySelector(sel);
    if (!bar || !content) return { overlap: false, reason: 'missing' };
    if (getComputedStyle(bar).display === 'none') return { overlap: false, reason: 'bar hidden' };
    const b = bar.getBoundingClientRect();
    const r = content.getBoundingClientRect();
    // 判定：content 的上边缘是否侵入 bar 的下边缘（允许 8px 间隙）
    const overlap = r.top < b.bottom - 1;
    return { overlap, barBottom: b.bottom, contentTop: r.top, barH: b.height, contentH: r.height };
  }, modalContentSelector);
}

// 同步收敛判定：modal.style.top 与 bar 实时 bottom 对齐（top 是容器顶，内容再经
// paddingTop:12 下移）；bar 隐藏时回落为空。rAF 调度 + RO/MO 均有延迟，
// 用 waitForFunction 轮询避免固定 timeout 的竞态。
function waitModalSynced(page) {
  return page.waitForFunction(() => {
    const m = document.getElementById('question-modal');
    const bar = document.getElementById('quick-import-bar');
    if (!m || !bar || !m.classList.contains('active')) return false;
    const cs = getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && rect.height > 0;
    if (!visible) return m.style.top === '';
    const top = parseFloat(m.style.top);
    return !isNaN(top) && Math.abs(top - rect.bottom) < 1 && m.style.paddingTop === '12px';
  });
}

// modal 遮罩（z-index 1000）盖住工具栏的 quick-import-toggle，真实点击会被
// hit-target 拦截；modal 打开期间用 JS 派发 click 走真实 onclick 处理器。
function clickQuickImportToggle(page) {
  return page.evaluate(() => document.getElementById('quick-import-toggle')?.click());
}

// 覆盖全部 .modal 的选择器清单（与 File Structure 表一致，含 quick-combo-panel 特例）
const MODALS = [
  { id: 'question-modal', sel: '#question-modal .modal-content', open: async (p) => { await p.evaluate(() => window.showQuestionDetail && window.allQuestions && window.allQuestions[0] && window.showQuestionDetail(window.allQuestions[0].id)); } },
  { id: 'provider-modal', sel: '#provider-modal .modal-content', open: async (p) => p.click('#quick-import-toggle').then(() => p.evaluate(() => window.showAddProviderModal && window.showAddProviderModal())) },
];

test.describe('基线：锚点展开时弹窗与 quick-import-bar 重叠（重构前应 FAIL）', () => {
  test('手机视口 390×844：笔记展开态（312px）下 question-modal 与 bar 重叠', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
    // 打开一个典型弹窗（若无数据则退化为直接 active）
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await expect(page.locator('#question-modal')).toBeVisible();
    const { overlap, barBottom, contentTop } = await noOverlap(page, '#question-modal .modal-content');
    await captureForReview(page, 'baseline-overlap-question-modal');
    expect(overlap, `barBottom=${barBottom} contentTop=${contentTop} 应不重叠`).toBe(false);
  });
});

test.describe('锚点定位迁移 - 核心弹窗', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('question-modal 锚点下方渲染，无重叠', async ({ page }) => {
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#question-modal .modal-content');
    expect(overlap).toBe(false);
    await expect(page.locator('#question-modal .modal-content')).toBeVisible();
  });
  test('basket-modal', async ({ page }) => {
    await page.evaluate(() => document.getElementById('basket-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#basket-modal .modal-content');
    expect(overlap).toBe(false);
  });
  test('export-modal', async ({ page }) => {
    await page.evaluate(() => document.getElementById('export-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#export-modal .modal-content');
    expect(overlap).toBe(false);
  });
});

test.describe('锚点定位迁移 - PDF/版本', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('pdf-preview-modal 锚点下方且内部可滚动', async ({ page }) => {
    await page.evaluate(() => document.getElementById('pdf-preview-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#pdf-preview-modal .modal-content');
    expect(overlap).toBe(false);
    const scrollable = await page.evaluate(() => {
      const c = document.querySelector('#pdf-preview-modal .modal-content');
      return c ? getComputedStyle(c).overflowY : '';
    });
    expect(scrollable).toBe('auto');
  });
});

test.describe('锚点定位迁移 - 反馈/同步/备份/组合', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  test('issue-feedback-modal 在锚点展开态无重叠且可提交', async ({ page }) => {
    await page.evaluate(() => document.getElementById('issue-feedback-modal')?.classList.add('active'));
    const { overlap } = await noOverlap(page, '#issue-feedback-modal .modal-content');
    expect(overlap).toBe(false);
    await page.click('#feedback-title');
    await expect(page.locator('#feedback-title')).toBeFocused();
  });
  test('quick-combo-panel 动态 top = barBottom + 12', async ({ page }) => {
    await page.click('#qi-combo-btn');
    await expect(page.locator('#quick-combo-panel')).toBeVisible();
    const topOk = await page.evaluate(() => {
      const bar = document.getElementById('quick-import-bar')?.getBoundingClientRect();
      const card = document.getElementById('quick-combo-panel-card') || document.querySelector('#quick-combo-panel > div');
      if (!bar || !card) return false;
      const t = card.getBoundingClientRect().top;
      return Math.abs(t - (bar.bottom + 12)) < 2;
    });
    expect(topOk).toBe(true);
  });
  test('login-modal / backup-modal 无重叠', async ({ page }) => {
    await page.evaluate(() => document.getElementById('login-modal')?.classList.add('active'));
    let r = await noOverlap(page, '#login-modal .modal-content');
    expect(r.overlap).toBe(false);
    await page.evaluate(() => {
      document.getElementById('login-modal')?.classList.remove('active');
      document.getElementById('backup-modal')?.classList.add('active');
    });
    r = await noOverlap(page, '#backup-modal .modal-content');
    expect(r.overlap).toBe(false);
  });
});

test.describe('锚点定位迁移 - 剩余长尾与白名单', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
  });
  const REMAINING = ['teaching-verify-modal','node-question-picker-modal','pending-blank-modal','pending-photos-modal','process-photo-modal','version-modal','system-password-modal','sync-warning-modal'];
  for (const id of REMAINING) {
    test(`${id} 无重叠`, async ({ page }) => {
      await page.evaluate((mid) => document.getElementById(mid)?.classList.add('active'), id);
      const { overlap } = await noOverlap(page, `#${id} .modal-content`);
      expect(overlap).toBe(false);
    });
  }
  test('crop-modal 白名单：保持全屏，不被锚点偏移', async ({ page }) => {
    await page.evaluate(() => document.getElementById('crop-modal')?.classList.add('active'));
    const top = await page.evaluate(() => document.getElementById('crop-modal')?.style.top);
    expect(top).toBe('');
  });
  test('projection-overlay 白名单：保持全屏，不被锚点偏移', async ({ page }) => {
    await page.evaluate(() => document.getElementById('projection-overlay')?.classList.add('active'));
    const top = await page.evaluate(() => document.getElementById('projection-overlay')?.style.top);
    expect(top).toBe('');
  });
});

test.describe('边界处理', () => {
  test('小视口 390×600：锚点 312 + 内容 500 -> 限高滚动，不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await enableQuickImport(page, true);
    await page.evaluate(() => {
      const m = document.getElementById('question-modal');
      const c = m.querySelector('.modal-content');
      c.style.height = '500px';
      m.classList.add('active');
    });
    // 等待 rAF 调度的 applyModalPosition 落盘（Task5 首帧竞态惯例），再进断言
    await page.waitForFunction(() => {
      const c = document.querySelector('#question-modal .modal-content');
      if (!c) return false;
      if (getComputedStyle(c).overflowY !== 'auto') return false;
      if (!c.style.maxHeight) return false;
      return c.getBoundingClientRect().bottom <= window.innerHeight;
    });
    const { overlap } = await noOverlap(page, '#question-modal .modal-content');
    expect(overlap).toBe(false);
    const overflow = await page.evaluate(() => {
      const c = document.querySelector('#question-modal .modal-content');
      const r = c.getBoundingClientRect();
      return { overflowY: getComputedStyle(c).overflowY, bottom: r.bottom, vh: window.innerHeight, scrollH: c.scrollHeight, clientH: c.clientHeight };
    });
    expect(overflow.overflowY).toBe('auto');
    expect(overflow.bottom).toBeLessThanOrEqual(overflow.vh + 1);
    expect(overflow.scrollH).toBeGreaterThan(overflow.clientH); // 触发内部滚动
    await captureForReview(page, 'anchor-boundary-small-viewport');
  });

  test('锚点隐藏时弹窗回落居中且不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('quickImportMode', '0'));
    await page.reload();
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    // 等待 rAF 同步收敛（锚点 null -> 样式回落清空）
    await page.waitForFunction(() => {
      const m = document.getElementById('question-modal');
      return !!m && m.classList.contains('active') && !m.style.alignItems;
    });
    const { overlap } = await noOverlap(page, '#question-modal .modal-content');
    expect(overlap).toBe(false); // bar 隐藏，无重叠概念
    const centered = await page.evaluate(() => {
      const m = document.getElementById('question-modal');
      return getComputedStyle(m).alignItems;
    });
    // 回落时 alignItems 应为 center 或空（默认居中）
    expect(['center','', 'normal']).toContain(centered);
    await captureForReview(page, 'anchor-boundary-hidden-anchor-center');
  });
});

test.describe('同步更新', () => {
  test('笔记收起/展开时弹窗 top 跟随变化（196 <-> 312）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true); // 展开（设计高 312）
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await waitModalSynced(page);
    const topExpanded = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    await page.click('#qi-note-btn'); // 收起（设计高 196）
    await waitModalSynced(page);
    const topCollapsed = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    expect(parseInt(topCollapsed,10)).toBeLessThan(parseInt(topExpanded,10));
    // top 精确跟随锚点实时底边（设计值 196/312 是 padding 补偿参考，真实渲染高度以 rect 为准）
    const barBottomCollapsed = await page.evaluate(() => document.getElementById('quick-import-bar').getBoundingClientRect().bottom);
    expect(Math.abs(parseInt(topCollapsed,10) - barBottomCollapsed)).toBeLessThanOrEqual(1);
    await page.click('#qi-note-btn'); // 再展开回落
    await waitModalSynced(page);
    const topReExpanded = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    expect(topReExpanded).toBe(topExpanded);
    await captureForReview(page, 'sync-note-collapse-expand');
  });

  test('窗口 resize 时弹窗重新计算', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await waitModalSynced(page);
    const before = await page.evaluate(() => document.querySelector('#question-modal .modal-content')?.style.maxHeight);
    await page.setViewportSize({ width: 390, height: 600 });
    const expectedMax = await page.waitForFunction(() => {
      const c = document.querySelector('#question-modal .modal-content');
      const bar = document.getElementById('quick-import-bar');
      if (!c || !bar) return null;
      const m = window.innerHeight - bar.getBoundingClientRect().bottom - 24;
      const parsed = parseFloat(c.style.maxHeight);
      return !isNaN(parsed) && Math.abs(parsed - m) <= 2 ? c.style.maxHeight : null;
    });
    const after = await expectedMax.jsonValue();
    expect(after).not.toBe(before); // maxHeight 确实按新视口重算
    const fits = await page.evaluate(() => {
      const c = document.querySelector('#question-modal .modal-content');
      return c.getBoundingClientRect().bottom <= window.innerHeight + 1;
    });
    expect(fits).toBe(true);
    await captureForReview(page, 'sync-resize-recalc');
  });

  test('快速导入显隐切换时弹窗同步（隐藏 -> 显示）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('quickImportMode', '0'));
    await page.reload();
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await waitModalSynced(page);
    const topHidden = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    expect(topHidden).toBe(''); // 无锚点时回落
    await clickQuickImportToggle(page); // 开启 quickMode
    await waitModalSynced(page);
    const topShown = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    expect(topShown).not.toBe('');
    const { overlap } = await noOverlap(page, '#question-modal .modal-content');
    expect(overlap).toBe(false);
    await captureForReview(page, 'sync-visibility-show');
  });

  test('快速导入显隐切换时弹窗同步（显示 -> 隐藏，动态 null 分支重置）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await waitModalSynced(page);
    const topShown = await page.evaluate(() => document.getElementById('question-modal')?.style.top);
    expect(topShown).not.toBe('');
    await clickQuickImportToggle(page); // 关闭 quickMode，锚点动态消失
    await page.waitForFunction(() => {
      const m = document.getElementById('question-modal');
      return !!m && m.style.top === '' && m.style.alignItems === '';
    });
    const cleared = await page.evaluate(() => {
      const m = document.getElementById('question-modal');
      const c = m.querySelector('.modal-content');
      return {
        top: m.style.top,
        height: m.style.height,
        alignItems: getComputedStyle(m).alignItems,
        contentMaxHeight: c.style.maxHeight,
        contentOverflowY: c.style.overflowY,
        barDisplay: getComputedStyle(document.getElementById('quick-import-bar')).display,
      };
    });
    expect(cleared.barDisplay).toBe('none');
    expect(cleared.top).toBe('');
    expect(cleared.height).toBe('');
    expect(['center', '', 'normal']).toContain(cleared.alignItems); // 回落居中
    expect(cleared.contentMaxHeight).toBe('');
    expect(cleared.contentOverflowY).toBe('');
    await captureForReview(page, 'sync-visibility-hide');
  });

  test('页面滚动时弹窗保持在视口内（不随滚动偏移出界）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enableQuickImport(page, true);
    // 制造可滚动页面
    await page.evaluate(() => { document.body.style.height = '2000px'; window.scrollTo(0, 300); });
    await page.evaluate(() => document.getElementById('question-modal')?.classList.add('active'));
    await waitModalSynced(page);
    const check = () => page.evaluate(() => {
      const c = document.querySelector('#question-modal .modal-content');
      const bar = document.getElementById('quick-import-bar');
      const r = c.getBoundingClientRect();
      return {
        overlap: r.top < bar.getBoundingClientRect().bottom - 1,
        inView: r.top >= 0 && r.bottom <= window.innerHeight + 1,
      };
    });
    let s = await check();
    expect(s.overlap).toBe(false);
    expect(s.inView).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 900)); // 继续滚动，触发 scroll 同步
    await page.waitForFunction(() => window.scrollY > 500);
    await waitModalSynced(page);
    s = await check();
    expect(s.overlap).toBe(false);
    expect(s.inView).toBe(true);
    await captureForReview(page, 'sync-scroll-inview');
  });
});
