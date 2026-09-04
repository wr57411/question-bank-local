const { test, expect } = require('@playwright/test');
const { assertVisiblyRendered, captureForReview, measure } = require('./helpers/visibility');

// 设计：docs/plans/2026-09-03-quick-import-favorite-tags.md（Task 8）
// 硬规则：手机视口 390x844；关键控件必须过 assertVisiblyRendered（对比度>=3、无遮挡、无截断）

const TAG_NAMES = ['物理', '化学', '英语错题', '高三一轮', '几何', '函数'];

async function openQuickImport(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
  await page.reload();
  await expect(page.locator('#quick-import-bar')).toBeVisible();
  await expect(page.locator('#qi-fav-tags')).toBeVisible();
}

async function ensureTags(page, names) {
  return page.evaluate(async (list) => {
    const ids = [];
    for (const name of list) {
      let tag = window.allTags.find((t) => t.name === name);
      if (!tag) {
        tag = await window.dbCreateTag(name, '#4CC3FF');
      }
      ids.push(tag.id);
    }
    await window.loadTags();
    return ids;
  }, names);
}

async function setFavTags(page, ids) {
  await page.evaluate((list) => {
    localStorage.removeItem('quickFavoriteTags');
    for (const id of list) window.setQuickFavOn(id, true);
    window.renderQuickFavTags();
  }, ids);
}

test.describe('快速导入 - 常见标签行可见性', () => {
  test('常见标签行、chip 与 ＋ 按钮实际可见，点击 chip 可选中标签（手机视口 390px）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImport(page);
    const ids = await ensureTags(page, TAG_NAMES.slice(0, 2));
    await setFavTags(page, ids);

    await assertVisiblyRendered(page, '#qi-fav-tags', '常见标签滚动行', { skipContrast: true });
    await assertVisiblyRendered(page, '#qi-fav-manage-btn', '＋ 管理按钮');
    const chip = page.locator('#qi-fav-tags > span').first();
    await expect(chip).toContainText(TAG_NAMES[0]);
    await assertVisiblyRendered(page, '#qi-fav-tags > span:first-child', '常见标签 chip');

    // chip 点击 = toggle 使用：未选中 → 加入已选标签区
    await chip.click();
    await expect(page.locator('#qi-tags')).toContainText(TAG_NAMES[0]);
    await chip.click();
    await expect(page.locator('#qi-tags')).not.toContainText(TAG_NAMES[0]);

    await captureForReview(page, 'quick-import-fav-tags-row');
  });

  test('加入 6 个标签后横向溢出，可滑动浏览（手机视口 390px）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImport(page);
    const ids = await ensureTags(page, TAG_NAMES);
    await setFavTags(page, ids);

    const m = await measure(page, '#qi-fav-tags');
    expect(m.scrollWidth, '6 个 chip 应超出可视宽度形成横向滚动').toBeGreaterThan(m.clientWidth);
    for (let i = 0; i < TAG_NAMES.length; i++) {
      const chip = page.locator(`#qi-fav-tags > span:nth-child(${i + 1})`);
      await chip.scrollIntoViewIfNeeded();
      await assertVisiblyRendered(page, `#qi-fav-tags > span:nth-child(${i + 1})`, `chip ${TAG_NAMES[i]}`);
    }
    await captureForReview(page, 'quick-import-fav-tags-overflow');
  });
});

test.describe('快速导入 - 常见标签管理面板（离线路径）', () => {
  test('面板添加/移除/拖拽排序可用；离线推送失败后状态条提示且控件不被禁用', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImport(page);
    const ids = await ensureTags(page, TAG_NAMES.slice(0, 3));

    await page.click('#qi-fav-manage-btn');
    await expect(page.locator('#qi-fav-panel')).toBeVisible();

    // 面板展开后栏高动态补偿应覆盖面板高度（312px 硬编码已被 rAF 实测取代）
    const barHeight = await page.evaluate(() => document.getElementById('quick-import-bar').offsetHeight);
    await expect
      .poll(() => page.evaluate(() => parseInt(document.body.style.paddingTop, 10)), {
      message: '面板展开后 padding 应覆盖含面板的整条栏高（rAF 异步写入，需轮询）',
      })
      .toBeGreaterThanOrEqual(barHeight);

    // 候选区添加两个标签
    await page.fill('#qi-fav-search', TAG_NAMES[0]);
    await page.locator('#qi-fav-candidates > span', { hasText: TAG_NAMES[0] }).first().click();
    await page.fill('#qi-fav-search', TAG_NAMES[1]);
    await page.locator('#qi-fav-candidates > span', { hasText: TAG_NAMES[1] }).first().click();
    await expect(page.locator('#qi-fav-sort-list > div')).toHaveCount(2);

    // 拖拽第 2 行手柄（☰）到第 1 行：顺序交换
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#qi-fav-sort-list > div')).map((r) => r.dataset.favId)
    );
    const rows = page.locator('#qi-fav-sort-list > div');
    const first = await rows.nth(0).boundingBox();
    const handle = await rows.nth(1).locator('span:has-text("☰")').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#qi-fav-sort-list > div')).map((r) => r.dataset.favId)
    );
    expect(after[0], '拖拽后第 2 行应排到第 1 位').toBe(before[1]);
    expect(after[1], '拖拽后原第 1 行应退到第 2 位').toBe(before[0]);

    // 移除一个标签
    await page.locator('#qi-fav-sort-list > div').first().locator('span', { hasText: '移除' }).click();
    await expect(page.locator('#qi-fav-sort-list > div')).toHaveCount(1);

    // 离线推送失败（无服务器）→ 状态条出现；但控件依旧可用
    await expect(page.locator('#qi-fav-sync-state')).toBeVisible();
    await expect(page.locator('#qi-fav-sync-state')).toContainText('待同步');
    await page.fill('#qi-fav-search', TAG_NAMES[2]);
    await page.locator('#qi-fav-candidates > span', { hasText: TAG_NAMES[2] }).first().click();
    await expect(page.locator('#qi-fav-sort-list > div')).toHaveCount(2);

    await captureForReview(page, 'quick-import-fav-panel-offline');
  });
});

test.describe('快速导入 - 常见标签推送失败提示', () => {
  test('推送遇 404（服务端版本过旧）时，状态条显示升级提示而非「联网后自动合并」', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuickImport(page);
    const ids = await ensureTags(page, ['离线标签X']);
    await setFavTags(page, ids);

    await page.route('**/api/sync/settings', (route) =>
      route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>not found</body></html>' })
    );
    await page.route('**/api/sync/favorite-tags', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><head><title>Error</title></head><body><pre>Cannot POST /api/sync/favorite-tags</pre></body></html>',
      })
    );

    await page.click('#qi-fav-manage-btn');
    await expect(page.locator('#qi-fav-panel')).toBeVisible();
    await expect(page.locator('#qi-fav-sync-state')).toContainText('待同步');
    await expect(page.locator('#qi-fav-sync-state')).toContainText('服务端版本过旧');
    await expect(page.locator('#qi-fav-sync-state')).not.toContainText('联网后会自动合并');

    await captureForReview(page, 'quick-import-fav-404-state');
  });
});

test.describe('快速导入 - 常见标签冲突弹窗', () => {
  test('冲突时只列冲突标签、不自动覆盖本地；选「用云端」后重新推送成功', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ids = await openQuickImport(page).then(() => ensureTags(page, ['冲突标签A']));
    const idA = ids[0];

    await page.route('**/api/sync/settings', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: {} }) })
    );
    await page.route('**/api/sync/favorite-tags', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.rev === 0) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            conflict: true,
            serverRev: 3,
            conflicts: [
              {
                id: idA,
                local: { on: true, at: '2026-09-04T10:00:00.000Z' },
                remote: { on: false, at: '2026-09-04T09:00:00.000Z' },
              },
            ],
            merged: { items: {}, order: { ids: [], at: '' } },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conflict: false,
          rev: 4,
          items: { [idA]: { on: false, at: new Date().toISOString() } },
          order: { ids: [], at: new Date().toISOString() },
        }),
      });
    });

    // 打开面板触发拉取，添加标签触发推送（rev=0 → 冲突响应）
    await page.click('#qi-fav-manage-btn');
    await expect(page.locator('#qi-fav-panel')).toBeVisible();
    await page.fill('#qi-fav-search', '冲突标签A');
    await page.locator('#qi-fav-candidates > span', { hasText: '冲突标签A' }).first().click();

    const modal = page.locator('#qi-fav-conflict-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('冲突标签A');
    expect(await modal.locator('#qi-fav-conflict-list > div').count(), '弹窗只应列出冲突的那一个标签').toBe(1);
    await expect(modal).toContainText('本机：在列表');
    await expect(modal).toContainText('云端：不在列表');

    // 未自动覆盖：本地仍是 on:true、rev 未变
    const beforeResolve = await page.evaluate(() => JSON.parse(localStorage.getItem('quickFavoriteTags')));
    expect(beforeResolve.items[idA].on, '冲突弹窗出现时本地不应被云端覆盖').toBe(true);

    await captureForReview(page, 'quick-import-fav-conflict-modal');

    // 选「用云端」→ 该行移除 → 弹窗关闭 → 以 serverRev 重新推送成功（rev=4）
    await modal.locator('button', { hasText: '用云端' }).click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#qi-fav-sync-state')).toBeHidden();
    const resolved = await page.evaluate(() => JSON.parse(localStorage.getItem('quickFavoriteTags')));
    expect(resolved.rev, '重新推送成功后 rev 应为服务端返回的 4').toBe(4);
    expect(resolved.items[idA].on, '采用云端后该标签应为不在列表').toBe(false);
  });
});
