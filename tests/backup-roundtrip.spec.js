const fs = require('fs');
const { test, expect } = require('@playwright/test');

async function createTag(page, name) {
  await page.getByRole('button', { name: '标签管理' }).click();
  await page.locator('#tag-name').fill(name);
  await page.locator('#tag-form button[type="submit"]').click();
  await expect(page.locator('#tags-list .tag', { hasText: name })).toBeVisible();
}

async function createQuestionWithImage(page, { tagIds, label }) {
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
    await window.dbCreateQuestion(
      canvas.toDataURL('image/png'),
      null,
      args.tagIds,
      0,
      null,
      [],
      { book_name: '人教版九上', page_number: '42', question_number: '1' }
    );
    await window.loadQuestions();
  }, { tagIds, label });
}

// 通过 IndexedDB 直接清空 questionBank 库的全部 object store（等价于「清空本地」）。
// 不用 window.dbClearAllData：它仅清 5 个 store（见 src/data/sync.ts，D7 缺陷），会残留
// question_tags / topics 等，无法保证干净的恢复前基线。
async function clearAllStores(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('questionBank');
    open.onsuccess = () => {
      const db = open.result;
      const names = Array.from(db.objectStoreNames);
      if (names.length === 0) { db.close(); return resolve(); }
      const tx = db.transaction(names, 'readwrite');
      let pending = names.length;
      names.forEach((n) => {
        const r = tx.objectStore(n).clear();
        r.onsuccess = r.onerror = () => { if (--pending === 0) { db.close(); resolve(); } };
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    };
    open.onerror = () => reject(open.error);
  }));
  await page.evaluate(() => localStorage.removeItem('pendingLinkList'));
}

async function countStore(page, storeName) {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('questionBank');
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(name)) { db.close(); return resolve(0); }
      const tx = db.transaction(name, 'readonly');
      const req = tx.objectStore(name).count();
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
    open.onerror = () => reject(open.error);
  }), storeName);
}

async function seedDataset(page) {
  await page.goto('/');
  await createTag(page, '数学');
  await createTag(page, '物理');
  const ids = await page.evaluate(async () => {
    const tags = await window.dbGetAllTags();
    return {
      math: tags.find((t) => t.name === '数学').id,
      phy: tags.find((t) => t.name === '物理').id,
    };
  });
  // 3 道题：Q1→[数学]，Q2→[数学,物理]，Q3→[物理]  => question_tags = 1+2+1 = 4
  await createQuestionWithImage(page, { tagIds: [ids.math], label: 'Q1' });
  await createQuestionWithImage(page, { tagIds: [ids.math, ids.phy], label: 'Q2' });
  await createQuestionWithImage(page, { tagIds: [ids.phy], label: 'Q3' });
  // 1 张试卷包含 3 道题
  await page.evaluate(async () => {
    const qs = await window.dbGetAllQuestions();
    const qids = qs.filter((q) => !q.deleted_at).map((q) => q.id);
    await window.dbCreatePaperFromExport('期末卷', qids, null, null);
    await window.loadPapers();
  });
}

test.describe('备份恢复端到端往返（D8 / FF-1 实证）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
    });
    await page.setViewportSize({ width: 1280, height: 1024 });
  });

  test('正向：导出完整 + 清空 + 恢复后数据一一对应', async ({ page }, testInfo) => {
    await seedDataset(page);

    // —— 导出（TS 实现 window.exportAllData，走 exportFullBackup 全量）——
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => window.exportAllData());
    const download = await downloadPromise;
    const outPath = testInfo.outputPath('backup-export.json');
    await download.saveAs(outPath);
    const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));

    // —— FF-1 端到端防线：必须断言确切条数，不能只断言 > 0 ——
    expect(data.questions, '导出 questions 应=3（FF-1 修复前每表仅 1 条）').toHaveLength(3);
    expect(data.tags, '导出 tags 应=2').toHaveLength(2);
    expect(data.question_tags, '导出 question_tags 应=4').toHaveLength(4);
    expect(data.papers, '导出 papers 应=1').toHaveLength(1);
    expect(data.paper_questions, '导出 paper_questions 应=3').toHaveLength(3);

    // —— 清空本地 ——
    await clearAllStores(page);
    expect(await countStore(page, 'questions')).toBe(0);
    expect(await countStore(page, 'tags')).toBe(0);
    expect(await countStore(page, 'question_tags')).toBe(0);
    expect(await countStore(page, 'papers')).toBe(0);

    // —— 恢复：用真实 File 走 window.restoreFromBackup（含 assertBackupHasData + importBackupData）——
    await page.evaluate((s) => {
      const file = new File([s], 'backup.json', { type: 'application/json' });
      return window.restoreFromBackup(file);
    }, JSON.stringify(data));

    // —— 断言恢复后的真实数据量（不是"成功"文案）——
    expect(await countStore(page, 'questions'), '恢复后 questions 应=3').toBe(3);
    expect(await countStore(page, 'tags'), '恢复后 tags 应=2').toBe(2);
    expect(await countStore(page, 'question_tags'), '恢复后 question_tags 应=4').toBe(4);
    expect(await countStore(page, 'papers'), '恢复后 papers 应=1').toBe(1);
    expect(await countStore(page, 'paper_questions'), '恢复后 paper_questions 应=3').toBe(3);

    // —— 刷新后题目列表真的渲染出来 ——
    await page.evaluate(() => window.refreshAll());
    await expect(page.locator('#questions-list .question-card'), '题目列表应渲染 3 张卡').toHaveCount(3);
    await expect(page.locator('#papers-list .paper-card'), '试卷列表应含期末卷').toContainText('期末卷');
  });

  test('负向：空壳增量 manifest 必须被明确拒绝（不出现恢复成功）', async ({ page }) => {
    await page.goto('/');
    await clearAllStores(page);

    const emptyManifest = {
      format: 'incremental_v1',
      snapshot_id: 'x',
      base_snapshot_id: 'y',
      timestamp: '2026-01-01T00:00:00.000Z',
      is_full: false,
      changes: [],
    };

    // 方式一：直接断言 importBackupData 的 promise reject
    const r1 = await page.evaluate(
      (d) => window.importBackupData(d).then(() => ({ ok: true }), (e) => ({ ok: false, err: e.message })),
      emptyManifest
    );
    expect(r1.ok, 'importBackupData(空壳增量) 必须 reject').toBe(false);
    expect(r1.err, '错误信息应提示是空增量').toMatch(/增量|0 条变更/);
    expect(await countStore(page, 'questions'), '被拒绝后不应写入任何数据').toBe(0);

    // 方式二：走 restoreFromBackup 真实入口，应走 error 通道（#error-modal），而非 success
    await page.evaluate((s) => {
      const file = new File([s], 'bad.json', { type: 'application/json' });
      return window.restoreFromBackup(file);
    }, JSON.stringify(emptyManifest));
    await expect(page.locator('#error-modal'), '错误应走全局弹窗 #error-modal').toBeVisible();
    await expect(page.locator('#error-modal-msg')).toContainText(/数据备份|增量/);
    await expect(page.locator('#toast'), '不得出现「恢复成功」之类的成功文案').not.toContainText('恢复成功');
    expect(await countStore(page, 'questions'), '恢复入口被拒绝后仍应为空').toBe(0);
  });

  test('负向：非数据文件 {foo:1} 必须被明确拒绝', async ({ page }) => {
    await page.goto('/');
    await clearAllStores(page);

    const bad = { foo: 1 };

    const r1 = await page.evaluate(
      (d) => window.importBackupData(d).then(() => ({ ok: true }), (e) => ({ ok: false, err: e.message })),
      bad
    );
    expect(r1.ok, 'importBackupData({foo:1}) 必须 reject').toBe(false);
    expect(r1.err, '错误信息应提示缺少 questions/tags').toMatch(/questions\/tags|数据备份/);
    expect(await countStore(page, 'questions'), '被拒绝后不应写入任何数据').toBe(0);

    await page.evaluate((s) => {
      const file = new File([s], 'bad.json', { type: 'application/json' });
      return window.restoreFromBackup(file);
    }, JSON.stringify(bad));
    await expect(page.locator('#error-modal'), '错误应走全局弹窗 #error-modal').toBeVisible();
    await expect(page.locator('#toast'), '不得出现「恢复成功」之类的成功文案').not.toContainText('恢复成功');
    expect(await countStore(page, 'questions'), '恢复入口被拒绝后仍应为空').toBe(0);
  });
});
