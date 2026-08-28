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
    const tabs = ["题目管理", "标签管理", "试卷管理"];
    for (const tabName of tabs) {
      const tab = page.locator(`.tab:has-text("${tabName}")`);
      await expect(tab).toBeAttached({ timeout: 5000 });
    }
    // 专题 Tab（带 emoji）
    await expect(page.locator('.tab:has-text("专题")')).toBeAttached({ timeout: 5000 });
    // 待关联 Tab
    await expect(page.locator('.tab:has-text("待关联")')).toBeAttached({ timeout: 5000 });
    // 待补拍 Tab
    await expect(page.locator('button#pending-blank-tab')).toBeAttached({ timeout: 5000 });
    // 待处理 Tab
    await expect(page.locator('button#pending-photos-tab')).toBeAttached({ timeout: 5000 });
    // 验证 Tab 数量至少 6 个
    const tabCount = await page.locator('.tabs .tab').count();
    expect(tabCount).toBeGreaterThanOrEqual(6);
  });

  test("题目管理页按钮存在", async ({ page }) => {
    // 拍照按钮
    await expect(page.locator('button:has-text("拍照")').first()).toBeVisible();
    // 相册按钮
    await expect(page.locator('button:has-text("相册")').first()).toBeVisible();
    // 跨页按钮
    await expect(page.locator('button:has-text("跨页")').first()).toBeVisible();
    // 悬浮窗按钮
    await expect(page.locator('#floating-toggle-btn')).toBeVisible();
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

  test("专题页表单存在", async ({ page }) => {
    await page.locator('.tab:has-text("专题")').click();
    await expect(page.locator('#topic-name')).toBeVisible();
    await expect(page.locator('#topic-form button')).toBeVisible();
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
    await page.locator('.tab:has-text("专题")').click();
    await page.locator('.tab:has-text("题目管理")').click();

    // 验证所有 Tab 按钮仍可见
    const tabButtons = page.locator('.tabs .tab');
    const count = await tabButtons.count();
    expect(count).toBeGreaterThanOrEqual(6);

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

  test("创建专题成功", async ({ page }) => {
    await page.locator('.tab:has-text("专题")').click();
    await page.locator('#topic-name').fill("测试专题");
    await page.locator('#topic-form button').click();

    // 验证专题出现在列表中
    await expect(page.locator('#topics-list .paper-card')).toHaveCount(1);
    await expect(page.locator('#topics-list .paper-card')).toContainText("测试专题");
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

  test("专题创建和管理", async ({ page }) => {
    // 1. 创建专题
    await page.locator('.tab:has-text("专题")').click();
    await page.locator('#topic-name').fill("测试专题管理");
    await page.locator('#topic-desc').fill("这是测试描述");
    await page.locator('#topic-form button').click();

    // 2. 专题出现在列表
    await expect(page.locator('#topics-list .paper-card')).toHaveCount(1);
    await expect(page.locator('#topics-list .paper-card')).toContainText("测试专题管理");

    // 3. 查看专题详情（通过 JS 注入题目并关联）
    await page.evaluate(async () => {
      await dbCreateQuestion(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        null, [], 0, null, []
      );
    });

    // 4. 删除专题
    await page.locator('#topics-list .paper-card .danger').click();
    await expect(page.locator('#topics-list .paper-card')).toHaveCount(0);
  });

  test("待处理 Tab 功能", async ({ page }) => {
    // 1. 点击待处理 Tab
    await page.locator('button#pending-photos-tab').click();

    // 2. 验证 Tab 数量至少 6 个
    const tabCount = await page.locator('.tabs .tab').count();
    expect(tabCount).toBeGreaterThanOrEqual(6);

    // 3. 其他 Tab 按钮仍可见
    await expect(page.locator('.tab:has-text("题目管理")')).toBeAttached();
    await expect(page.locator('.tab:has-text("标签管理")')).toBeAttached();
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
