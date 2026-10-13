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

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function injectNativeGallery(page) {
  await page.addInitScript(({ png }) => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Camera: { getPhoto: async () => {
          const c = document.createElement('canvas');
          c.width = 8;
          c.height = 8;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, 0, 8, 8);
          return { dataUrl: c.toDataURL('image/png') };
        } },
        MediaGallery: {
          getMedias: async () => ({ medias: [
            { identifier: 'content://a.jpg', data: png },
            { identifier: 'content://b.jpg', data: png },
          ] }),
          getFullImage: async () => ({ data: png, mimeType: 'image/png' }),
        },
      },
    };
  }, { png: PNG });
}

async function injectNativeGalleryBig(page, w = 3000, h = 2000) {
  await page.addInitScript(({ w, h }) => {
    const bigData = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#3366cc';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = '160px sans-serif';
      ctx.fillText('BIG IMAGE', 120, 400);
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = i % 2 ? '#111111' : '#eeeeee';
        ctx.fillRect(0, 600 + i * 16, w, 6);
      }
      return c.toDataURL('image/png').split(',')[1];
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Camera: { getPhoto: async () => ({ dataUrl: 'data:image/png;base64,' + bigData() }) },
        MediaGallery: {
          getMedias: async () => ({ medias: [
            { identifier: 'content://big1.jpg', data: bigData() },
            { identifier: 'content://big2.jpg', data: bigData() },
          ] }),
          getFullImage: async () => ({ data: bigData(), mimeType: 'image/png' }),
        },
      },
    };
  }, { w, h });
}

async function waitPairReady(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('qi-confirm-btn');
    const t = document.getElementById('qi-thumb-question');
    return !!b && !b.disabled && !!t && (t.getAttribute('src') || '').startsWith('data:');
  }, null, { timeout: 20000 });
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

test.describe('快速导入 - 文字笔记入口可见性（设计：docs/plans/2026-08-30-quick-import-text-note.md）', () => {
  test('笔记按钮与输入区默认展开可见（手机视口 390px，对比度达标、无遮挡）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImportWithCombo(page);

    await assertVisiblyRendered(page, '#qi-note-btn', '笔记按钮');
    // 默认展开：输入区直接可见可写
    await assertVisiblyRendered(page, '#qi-note-area', '笔记输入区');
    await assertVisiblyRendered(page, '#qi-note-input', '笔记文本框');
    await captureForReview(page, 'quick-import-note-default-open');
  });

  test('点击可收起再展开（字数统计 + 圆点标记随输入更新）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImportWithCombo(page);

    await page.fill('#qi-note-input', '本题用换元法简化');
    await expect(page.locator('#qi-note-count')).toHaveText('8/500');
    await expect(page.locator('#qi-note-dot')).toBeVisible();

    await captureForReview(page, 'quick-import-note-expanded');

    // 点击收起 → 再点展开
    await page.click('#qi-note-btn');
    await expect(page.locator('#qi-note-area')).toBeHidden();
    await page.click('#qi-note-btn');
    await expect(page.locator('#qi-note-area')).toBeVisible();
  });

  test('默认展开态正文 padding-top 已补偿，收起后回落', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImportWithCombo(page);
    const barHeight = await page.evaluate(
      () => document.getElementById('quick-import-bar').offsetHeight
    );
    // 2026-09-04 起栏高改为 rAF 内动态测量，padding 下一帧才写入，需轮询
    await expect
      .poll(() => page.evaluate(() => parseInt(document.body.style.paddingTop, 10)))
      .toBeGreaterThanOrEqual(barHeight);
    await page.click('#qi-note-btn');
    await expect
      .poll(() => page.evaluate(() => parseInt(document.body.style.paddingTop, 10)))
      .toBeLessThan(barHeight);
  });
});

test.describe('快速导入 - 手写笔记照片入口可见性（Task 5 / 手写块）', () => {
  const viewports = [
    { w: 390, h: 844, name: '390x844' },
    { w: 360, h: 800, name: '360x800' },
    { w: 320, h: 640, name: '320x640' },
  ];
  for (const vp of viewports) {
    test(`手写笔记块与按钮在 ${vp.name} 下可见、未被截断、未被遮挡`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await openQuickImportWithCombo(page);

      await assertVisiblyRendered(page, '#qi-note-btn', '附加按钮');
      await assertVisiblyRendered(page, '#qi-hw-block', '手写笔记块', { skipContrast: true });
      await assertVisiblyRendered(page, '#qi-hw-block button:nth-of-type(1)', '拍一张按钮', { skipContrast: true });
      await assertVisiblyRendered(page, '#qi-hw-block button:nth-of-type(2)', '相册按钮');
      await assertVisiblyRendered(page, '#qi-combo-btn', '组合按钮');
      await captureForReview(page, 'quick-import-handnote');

      const combo = await measure(page, '#qi-combo-btn');
      expect(combo.scrollWidth, '组合按钮文字不应被 CSS 截断').toBeLessThanOrEqual(combo.clientWidth + 1);

      await expect(page.locator('#qi-hw-list')).toBeAttached();
    });
  }
});

test.describe('快速导入 - 手写笔记照片挂载链路（真链路，注入假原生层）', () => {
  test('拍一张后逐张挂成题目额外图片版本，字段名 note_image_url 且旧字段 image_url 未被写回', async ({ page }) => {
    await injectNativeGallery(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('quickImportMode', '1');
      localStorage.removeItem('quickImportImportedIds');
    });
    await page.reload();

    await page.waitForFunction(() => {
      const b = document.getElementById('qi-confirm-btn');
      const t = document.getElementById('qi-thumb-question');
      return !!b && !b.disabled && !!t && (t.getAttribute('src') || '').startsWith('data:');
    }, null, { timeout: 15000 });

    await page.click('#qi-hw-block button:nth-of-type(1)');
    await expect(page.locator('#qi-hw-list img')).toHaveCount(1);
    await expect(page.locator('#qi-hw-count')).toHaveText('1/5');

    await page.click('#qi-confirm-btn');

    await expect(page.locator('#toast')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#toast-msg')).toHaveText('题目已导入');

    const notes = await page.evaluate(async () => {
      const qs = await window.dbGetAllQuestions();
      const q = qs[0];
      const ns = await window.dbGetQuestionNotes(q.id);
      return ns.map((n) => ({
        id: n.id,
        label: n.label,
        created_at: n.created_at,
        note_image_url: n.note_image_url || '',
        hasOldField: Object.prototype.hasOwnProperty.call(n, 'image_url'),
      }));
    });

    console.log('手写笔记挂载链路 ｜ dbGetQuestionNotes 实际:', JSON.stringify(
      notes.map((n) => ({ ...n, note_image_url: n.note_image_url.slice(0, 32) + '...(' + n.note_image_url.length + 'B)' })),
      null,
      2
    ));

    const labels = notes.map((n) => n.label);
    expect(new Set(labels), '数据层应含 笔记 v1 与 手写笔记（原始顺序仍不确定，见下方展示层断言）').toEqual(new Set(['笔记 v1', '手写笔记']));

    const displayOrder = await page.evaluate(async () => {
      const qs = await window.dbGetAllQuestions();
      window.showQuestionDetail(qs[0].id);
      await new Promise((r) => setTimeout(r, 300));
      const sel = document.getElementById('modal-note-version-select');
      const img = document.querySelector('#modal-question-image img');
      const opts = [...sel.options].map((o) => o.textContent);
      const chosenLabel = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent : null;
      return { opts, chosenLabel, imgSrc: (img && img.getAttribute('src')) || '' };
    });
    console.log('详情页下拉顺序与实际选中:', JSON.stringify(
      { ...displayOrder, imgSrc: displayOrder.imgSrc.slice(0, 32) + '...(' + displayOrder.imgSrc.length + 'B)' },
      null,
      2
    ));
    expect(displayOrder.opts, '详情页下拉顺序应与版本顺序一致').toEqual(['笔记 v1', '手写笔记']);
    expect(displayOrder.chosenLabel, '详情页默认应显示「笔记 v1」（题图），不能是手写笔记').toBe('笔记 v1');
    expect(displayOrder.imgSrc, '默认渲染的图应是 dataURL').toMatch(/^data:image\//);

    const v1 = notes.find((n) => n.label === '笔记 v1');
    expect(v1, '应存在 笔记 v1 条目').toBeTruthy();
    expect(v1.note_image_url, '笔记 v1 note_image_url 应为 data:image/ 前缀').toMatch(/^data:image\//);
    expect(v1.hasOldField, '笔记 v1 不应写回旧字段 image_url').toBe(false);

    const hand = notes.find((n) => n.label === '手写笔记');
    expect(hand, '应存在 手写笔记 条目').toBeTruthy();
    expect(hand.note_image_url, '手写笔记 note_image_url 应为 data:image/ 前缀').toMatch(/^data:image\//);
    expect(hand.hasOldField, '手写笔记 不应写回旧字段 image_url').toBe(false);

    expect(hand.note_image_url, '前提：题图与手写图内容必须不同，否则下面的渲染断言没有区分力').not.toBe(v1.note_image_url);
    expect(displayOrder.imgSrc, '详情页默认渲染的必须是题图本身，而不只是任意一张图').toBe(v1.note_image_url);
  });
});

test.describe('快速导入 - 题/答图片压缩真闸门（dbCreateQuestion 1600/0.85）', () => {
  test('3000×2000 的题图/答图落库后被压到恰好 1600（真尺寸断言）', async ({ page }) => {
    await injectNativeGalleryBig(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('quickImportMode', '1');
      localStorage.removeItem('quickImportImportedIds');
    });
    await page.reload();
    await waitPairReady(page);

    await page.click('#qi-confirm-btn');
    await expect(page.locator('#toast-msg')).toHaveText('题目已导入', { timeout: 20000 });

    const info = await page.evaluate(async () => {
      const qs = await window.dbGetAllQuestions();
      const q = qs[0];
      const measure = (src) => new Promise((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight, len: (src || '').length });
        img.onerror = () => res({ w: -1, h: -1, len: (src || '').length });
        img.src = src;
      });
      return { q: await measure(q.question_image_url), a: await measure(q.answer_image_url) };
    });
    console.log('题/答落库后真实尺寸:', JSON.stringify(info));

    expect(info.q.w, '题图应被压到恰好 1600（旧的 800/0.7 闸门会给出 800，必须区分开）').toBe(1600);
    expect(info.a.w, '答图应被压到恰好 1600').toBe(1600);
  });
});

test.describe('题目详情 - 删除图片版本（墓碑）', () => {
  test('删除当前版本后下拉消失；删光后自动用题图重建 笔记 v1', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await injectNativeGallery(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('quickImportMode', '1');
      localStorage.removeItem('quickImportImportedIds');
    });
    await page.reload();
    await waitPairReady(page);
    await page.click('#qi-confirm-btn');
    await expect(page.locator('#toast-msg')).toHaveText('题目已导入', { timeout: 20000 });

    const setup = await page.evaluate(async () => {
      const qs = await window.dbGetAllQuestions();
      const q = qs[0];
      const hand = await window.dbAddQuestionNote(q.id, 'data:image/png;base64,iVBORw0KGgo=', '手写笔记', '');
      window.showQuestionDetail(q.id);
      return { qid: q.id, handId: hand.id };
    });

    await page.waitForFunction(() => {
      const s = document.getElementById('modal-note-version-select');
      return !!s && s.options.length === 2;
    }, null, { timeout: 15000 });

    await page.selectOption('#modal-note-version-select', { label: '手写笔记' });
    await page.click('#modal-note-version-delete');

    await page.waitForFunction(() => {
      const s = document.getElementById('modal-note-version-select');
      return !!s && s.options.length === 1 && s.options[0].textContent === '笔记 v1';
    }, null, { timeout: 15000 });

    const afterFirst = await page.evaluate(async (qid) => {
      const live = await window.dbGetQuestionNotes(qid);
      return { labels: live.map((n) => n.label), ids: live.map((n) => n.id) };
    }, setup.qid);
    expect(afterFirst.labels, '手写笔记应已从活列表消失').toEqual(['笔记 v1']);
    expect(afterFirst.ids, '手写笔记不应还在活列表里').not.toContain(setup.handId);

    const v1IdBefore = afterFirst.ids[0];
    await page.selectOption('#modal-note-version-select', { label: '笔记 v1' });
    await page.click('#modal-note-version-delete');

    await page.waitForFunction((prev) => {
      const s = document.getElementById('modal-note-version-select');
      return !!s && s.options.length === 1 && s.options[0].value !== prev;
    }, v1IdBefore, { timeout: 15000 });

    const afterSecond = await page.evaluate(async (qid) => {
      const live = await window.dbGetQuestionNotes(qid);
      return { labels: live.map((n) => n.label), ids: live.map((n) => n.id) };
    }, setup.qid);
    expect(afterSecond.labels, '删光后应自动重建一条 笔记 v1').toEqual(['笔记 v1']);
    expect(afterSecond.ids[0], '重建的应是新记录（旧 v1 已墓碑）').not.toBe(v1IdBefore);
  });
});
