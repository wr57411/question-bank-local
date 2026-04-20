const { test, expect } = require('@playwright/test');
const path = require('path');

test('Gemma 4 智能组卷全链路仿真', async ({ page }) => {
  // 1. 加载本地 Web 环境
  await page.goto('file://' + path.resolve(__dirname, '../www/index.html'));

  console.log('✅ 成功加载题库应用');

  // 2. 模拟 Capacitor 插件环境 (Web Mock 会自动生效)
  await page.evaluate(() => {
    console.log('正在检测 AI 状态...');
  });

  // 3. 模拟“点击发现模型”
  await page.click('text=自动发现模型');
  console.log('✅ 模拟操作：点击“自动发现模型”');

  // 等待 UI 更新
  await expect(page.locator('#ai-status-label')).toHaveText('已就绪');
  console.log('✅ UI 验证：AI 引擎状态已变为“已就绪”');

  // 3.5 注入模拟题目数据
  await page.evaluate(async () => {
    // 调用 db.js 中的方法注入模拟数据
    await localforage.createInstance({ name: 'questionBank', storeName: 'questions' }).setItem('test-q-1', {
        id: 'test-q-1',
        semantic_summary: '勾股定理基础练习题',
        question_image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        created_at: new Date().toISOString(),
        question_tags: []
    });
    // 强制刷新内存中的变量
    if (typeof loadQuestions === 'function') await loadQuestions();
  });
  console.log('✅ 模拟数据注入完成');

  // 4. 切换到“试卷管理”
  await page.click('button:has-text("试卷管理")');
  
  // 5. 输入 AI 组卷需求
  const requirement = "我想要 3 道难度较高的几何题，侧重辅助线作法";
  await page.fill('#ai-paper-requirement', requirement);
  console.log(`✅ 模拟输入："${requirement}"`);

  // 6. 点击“开始 AI 推荐”
  await page.click('text=开始 AI 智能推荐');
  console.log('✅ 模拟操作：触发 AI 智能推荐');

  // 7. 验证推荐结果弹窗是否弹出
  await expect(page.locator('#ai-recommend-modal')).toHaveClass(/active/);
  const reason = await page.textContent('#ai-recommend-reason');
  console.log('✅ AI 推荐理由：', reason);

  // 8. 模拟“一键生成试卷”
  await page.click('#ai-create-paper-btn');
  console.log('✅ 模拟操作：点击“一键生成试卷”');

  // 9. 验证试卷列表是否出现了新试卷
  const paperListText = await page.textContent('#papers-list');
  expect(paperListText).toContain('AI 推荐试卷');
  console.log('✅ 最终验证：智能试卷已成功生成在列表中');
});
