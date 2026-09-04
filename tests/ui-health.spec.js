const { test, expect } = require("@playwright/test");

test.describe("UI 健康检测 - 存在性", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.goto("/");
  });

  test("所有 Tab 按钮存在且可见", async ({ page }) => {
    const tabs = ["题目管理", "标签管理", "试卷管理", "垃圾篓"];
    for (const tabName of tabs) {
      const tab = page.locator(`.tab:has-text("${tabName}")`);
      await expect(tab).toBeAttached({ timeout: 5000 });
    }
    // 已移除功能（专题/待关联/待补拍/待处理/AI教学/书库/Wiki）的 Tab 不应再存在
    await expect(page.locator('.tab:has-text("专题")')).toHaveCount(0);
    await expect(page.locator('button#pending-photos-tab')).toHaveCount(0);
    // 验证 Tab 数量为 4 个
    const tabCount = await page.locator('.tabs .tab').count();
    expect(tabCount).toBe(4);
  });

  test("题目管理页按钮存在", async ({ page }) => {
    // 拍照按钮
    await expect(page.locator('button:has-text("拍照")').first()).toBeVisible();
    // 相册按钮
    await expect(page.locator('button:has-text("相册")').first()).toBeVisible();
    // 跨页按钮
    await expect(page.locator('button:has-text("跨页")').first()).toBeVisible();
    // 工具栏按钮
    await expect(page.locator('button:has-text("导出")').first()).toBeVisible();
    await expect(page.locator('button:has-text("备份")').first()).toBeVisible();
    await expect(page.locator('button:has-text("导入")').first()).toBeVisible();
  });

  test("initApp 已恢复：添加题目表单初始化", async ({ page }) => {
    // 题目管理 Tab 默认激活，beforeEach 已 mock Capacitor=android 且 goto("/")
    // 断言恢复 initApp 后关键表单元素已初始化并可见
    await expect(page.locator('#book-name')).toBeVisible();
    await expect(page.locator('#mode-photo-btn')).toBeVisible();
    await expect(page.locator('#question-form button[type="submit"]')).toContainText('添加题目');
  });

  test("标签管理页表单存在", async ({ page }) => {
    await page.locator('.tab:has-text("标签管理")').click();
    await expect(page.locator('#tag-name')).toBeVisible();
    await expect(page.locator('#tag-color')).toBeVisible();
    await expect(page.locator('#tag-form button')).toBeVisible();
  });

  test("试卷管理页表单存在", async ({ page }) => {
    await page.locator('.tab:has-text("试卷管理")').click();
    await expect(page.locator('#paper-name')).toBeVisible();
    await expect(page.locator('#paper-form button')).toBeVisible();
    await expect(page.locator('button:has-text("AI 智能推荐")')).toBeVisible();
  });

  test("备份弹窗版本切换器存在", async ({ page }) => {
    await page.locator('button:has-text("备份")').first().click();
    await expect(page.locator('#version-switcher')).toBeVisible();
    await expect(page.locator('#version-switcher').locator('div').first()).toBeVisible();
  });

  test("移除 app.js 后关键全局仍可用（回归）", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const has = await page.evaluate(() => ({
      doAutoBackup: typeof window.doAutoBackup,
      buildBackupData: typeof window.buildBackupData,
      stopAllPolling: typeof window.stopAllPolling,
      restartAllPolling: typeof window.restartAllPolling,
    }));
    expect(has.doAutoBackup).toBe("function");
    expect(has.buildBackupData).toBe("function");
    expect(has.stopAllPolling).toBe("function");
    expect(has.restartAllPolling).toBe("function");
  });
});

test.describe("UI 健康检测 - 功能性", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.goto("/");
  });

  test("Tab 切换正常工作", async ({ page }) => {
    // 点击标签管理
    await page.locator('.tab:has-text("标签管理")').click();
    await expect(page.locator('#tags-tab')).toBeVisible();
    await expect(page.locator('#questions-tab')).toHaveClass(/hidden/);

    // 点击试卷管理
    await page.locator('.tab:has-text("试卷管理")').click();
    await expect(page.locator('#papers-tab')).toBeVisible();
    await expect(page.locator('#tags-tab')).toHaveClass(/hidden/);

    // 点击回题目管理
    await page.locator('.tab:has-text("题目管理")').click();
    await expect(page.locator('#questions-tab')).toBeVisible();
    await expect(page.locator('#papers-tab')).toHaveClass(/hidden/);
  });

  test("Tab 切换后所有按钮仍可见（回归测试）", async ({ page }) => {
    // 先切换到其他 Tab
    await page.locator('.tab:has-text("标签管理")').click();
    await page.locator('.tab:has-text("试卷管理")').click();
    await page.locator('.tab:has-text("题目管理")').click();

    // 验证所有 Tab 按钮仍可见
    const tabButtons = page.locator('.tabs .tab');
    const count = await tabButtons.count();
    expect(count).toBe(4);

    for (let i = 0; i < count; i++) {
      await expect(tabButtons.nth(i)).toBeVisible();
    }
  });

  test("创建标签成功", async ({ page }) => {
    await page.locator('.tab:has-text("标签管理")').click();
    await page.locator('#tag-name').fill("测试标签");
    await page.locator('#tag-color').fill("#3b82f6");
    await page.locator('#tag-form button').click();

    // 验证标签出现在列表中
    await expect(page.locator('#tags-list .tag')).toHaveCount(1);
    await expect(page.locator('#tags-list .tag')).toContainText("测试标签");
  });

  test("创建试卷成功", async ({ page }) => {
    await page.locator('.tab:has-text("试卷管理")').click();
    await page.locator('#paper-name').fill("测试试卷");
    await page.locator('#paper-form button').click();

    // 验证试卷出现在列表中
    await expect(page.locator('#papers-list .paper-card')).toHaveCount(1);
    await expect(page.locator('#papers-list .paper-card')).toContainText("测试试卷");
  });

  test("备份弹窗打开和关闭", async ({ page }) => {
    await page.locator('button:has-text("备份")').first().click();
    await expect(page.locator('#backup-modal')).toHaveClass(/active/);

    // 关闭弹窗
    await page.locator('#backup-modal button:has-text("关闭")').click();
    await expect(page.locator('#backup-modal')).not.toHaveClass(/active/);
  });

  test("版本切换生效", async ({ page }) => {
    await page.locator('button:has-text("备份")').first().click();

    // 获取当前主题色
    const initialColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    });

    // 点击第二个版本卡片（如果有）
    const versionCards = page.locator('#version-switcher > div');
    const count = await versionCards.count();
    if (count > 1) {
      await versionCards.nth(1).click();

      // 验证主题色变化
      const newColor = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      });
      expect(newColor).not.toBe(initialColor);
    }
  });

  test("题目详情弹窗打开和关闭", async ({ page }) => {
    // 通过 JS 注入一个测试题目
    await page.evaluate(async () => {
      await dbCreateQuestion(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        null, [], 0, null, []
      );
      await loadQuestions();
    });

    // 点击题目图片
    const questionCard = page.locator('#questions-list .question-card').first();
    await questionCard.locator('img').click();

    // 验证弹窗打开
    await expect(page.locator('#question-modal')).toHaveClass(/active/);

    // 关闭弹窗
    await page.locator('#question-modal').locator('span:has-text("×")').click();
    await expect(page.locator('#question-modal')).not.toHaveClass(/active/);
  });
});

test.describe("UI 健康检测 - 扩展功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.goto("/");
  });

  test("题目创建完整流程", async ({ page }) => {
    // 1. 创建标签
    await page.locator('.tab:has-text("标签管理")').click();
    await page.locator('#tag-name').fill("流程测试标签");
    await page.locator('#tag-color').fill("#10b981");
    await page.locator('#tag-form button').click();
    await expect(page.locator('#tags-list .tag')).toHaveCount(1);

    // 2. 创建题目
    await page.locator('.tab:has-text("题目管理")').click();
    await page.evaluate(async () => {
      await dbCreateQuestion(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        null, [], 0, null, []
      );
      await loadQuestions();
    });

    // 3. 题目出现在列表
    await expect(page.locator('#questions-list .question-card')).toHaveCount(1);

    // 4. 题目可查看详情
    await page.locator('#questions-list .question-card img').first().click();
    await expect(page.locator('#question-modal')).toHaveClass(/active/);

    // 5. 关闭详情
    await page.locator('#question-modal').locator('span:has-text("×")').click();
    await expect(page.locator('#question-modal')).not.toHaveClass(/active/);
  });

  test("版本切换完整流程", async ({ page }) => {
    // 1. 打开备份弹窗
    await page.locator('button:has-text("备份")').first().click();
    await expect(page.locator('#backup-modal')).toHaveClass(/active/);

    // 2. 版本切换器可见
    await expect(page.locator('#version-switcher')).toBeVisible();

    // 3. 获取初始主题色
    const initialColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    });

    // 4. 点击第二个版本卡片
    const versionCards = page.locator('#version-switcher > div');
    const count = await versionCards.count();
    if (count > 1) {
      await versionCards.nth(1).click();

      // 5. 主题色变化
      const newColor = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      });
      expect(newColor).not.toBe(initialColor);

      // 6. Header 标题变化
      const headerText = await page.locator('#header-title').textContent();
      expect(headerText).not.toBe("📚 本地题库");
    }

    // 7. 关闭弹窗
    await page.locator('#backup-modal button:has-text("关闭")').click();
    await expect(page.locator('#backup-modal')).not.toHaveClass(/active/);
  });

  test("工具栏按钮可点击", async ({ page }) => {
    // 1. 导出按钮
    await expect(page.locator('button:has-text("导出")').first()).toBeEnabled();

    // 2. 备份按钮可打开弹窗
    await page.locator('button:has-text("备份")').first().click();
    await expect(page.locator('#backup-modal')).toHaveClass(/active/);
    await page.locator('#backup-modal button:has-text("关闭")').click();

    // 3. 导入按钮存在
    await expect(page.locator('button:has-text("导入")').first()).toBeVisible();
  });
});

// 账号隔离：以下用例全部只操作 localStorage / 本地 IndexedDB，不登录、不同步、不调服务端。
// 见 docs/e2e-test-account.md —— E2E 一律使用 E2E_TEST_PHONE，禁止使用主账号。
test.describe("快速导入题目", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.alert = () => {};
      window.prompt = () => null;
      window.Capacitor = { getPlatform: () => 'android', Plugins: {} };
    });
    await page.goto("/");
  });

  test("模式开关与顶部条降级提示", async ({ page }) => {
    await expect(page.locator('#quick-import-toggle')).toBeVisible();
    await expect(page.locator('#quick-import-bar')).toBeHidden();

    await page.click('#quick-import-toggle');
    await expect(page.locator('#quick-import-bar')).toBeVisible();
    await expect(page.locator('#qi-confirm-btn')).toBeDisabled();
    // Web 环境没有原生相册插件，应给出降级提示而不是崩溃
    await expect(page.locator('#qi-hint')).toContainText('不是原生环境');

    await page.click('#quick-import-toggle');
    await expect(page.locator('#quick-import-bar')).toBeHidden();
  });

  test("版本组合可创建并显示在顶部条", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
    await page.reload();
    await expect(page.locator('#quick-import-bar')).toBeVisible();

    await page.click('#qi-combo-btn');
    await expect(page.locator('#quick-combo-panel')).toBeVisible();

    await page.fill('#qi-combo-name', '组合一');
    await page.locator('#quick-combo-panel button:has-text("新建")').click();
    await expect(page.locator('#qi-combo-btn')).toHaveAttribute('title', /^组合一/);

    await page.locator('#quick-combo-panel button:has-text("×")').click();
    await expect(page.locator('#quick-combo-panel')).toBeHidden();
  });

  test("顶部标签输入与已选 chip", async ({ page }) => {
    await page.evaluate(async () => {
      localStorage.setItem('quickImportMode', '1');
      await window.dbCreateTag('函数', '#4CC3FF');
    });
    await page.reload();
    await expect(page.locator('#quick-import-bar')).toBeVisible();

    await page.fill('#qi-tag-input', '函');
    await expect(page.locator('#qi-tag-results')).toBeVisible();
    await page.locator('#qi-tag-results > span').first().click();
    await expect(page.locator('#qi-tags')).toContainText('函数');

    await page.fill('#qi-tag-input', '全新标签XYZ');
    await page.press('#qi-tag-input', 'Enter');
    await expect(page.locator('#qi-tags')).toContainText('全新标签XYZ');

    await page.locator('#qi-tags > span').first().locator('text=✕').click();
    await expect(page.locator('#qi-tags')).not.toContainText('函数');
  });

  test("顶部栏数可切换、同步表单并持久化", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
    await page.reload();
    await expect(page.locator('#qi-layout-btn')).toContainText('双');

    await page.click('#qi-layout-btn');
    await expect(page.locator('#qi-layout-btn')).toContainText('单');
    await expect(page.locator('input[name="layout_type"][value="0"]')).toBeChecked();

    await page.reload();
    await expect(page.locator('#qi-layout-btn')).toContainText('单');
  });

  test("组合与栏数设置不被清空", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('quickImportMode', '1');
      localStorage.setItem('quickImportLayoutType', '0');
    });
    await page.reload();

    await page.click('#qi-combo-btn');
    await page.fill('#qi-combo-name', '组合一');
    await page.locator('#quick-combo-panel button:has-text("新建")').click();
    await page.locator('#quick-combo-panel button:has-text("×")').click();

    await page.reload();
    await expect(page.locator('#qi-combo-btn')).toHaveAttribute('title', /^组合一/);
    await expect(page.locator('#qi-layout-btn')).toContainText('单');
    await expect(page.locator('#qi-tags')).toContainText('未选标签');
  });

  test("组合按钮可显示自定义名称", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('quickImportMode', '1'));
    await page.reload();
    await page.click('#qi-combo-btn');
    await page.fill('#qi-combo-name', '组合一');
    await page.locator('#quick-combo-panel button:has-text("新建")').click();

    const displayInput = page.locator('#qi-combo-list input[type="text"]').first();
    const initial = await displayInput.inputValue();
    expect(initial.length, '新建组合应预填首字建议，不应为空').toBeGreaterThan(0);
    expect(initial, '预填的应是首字建议，不应等于组合名').not.toBe('组合一');

    await displayInput.fill('高三专用');
    await page.locator('#quick-combo-panel button:has-text("×")').click();
    await expect(page.locator('#qi-combo-btn')).toContainText('高三专用');

    await page.reload();
    await expect(page.locator('#qi-combo-btn')).toContainText('高三专用');
  });
});
