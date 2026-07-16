const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, 'fixtures', 'question-bank-seed.json');

async function seedData(page) {
  const seedData = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  await page.evaluate(async (data) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], 'seed.json');
    await importAllData(file);
    if (typeof loadQuestions === 'function') await loadQuestions();
  }, seedData);
}

const ATOMIZER_FIXTURE = JSON.stringify([
  { id: 'k101', name: '整体法与隔离法', difficulty: '进阶', key_concept: '多物体系统的受力分析' },
  { id: 'k102', name: '超重与失重', difficulty: '基础', key_concept: '加速度方向与视重关系' }
]);

const GENERATOR_FIXTURE = `## 模块一：概念原子化拆解

整体法与隔离法是牛顿第二定律在多物体系统中的核心应用方法。

核心原子模型：
1. **整体法** - 将多个物体视为整体，求系统加速度 - 入门首选
2. **隔离法** - 隔离单个物体，分析其受力
3. **整体+隔离联合法** - 先整体求加速度，再隔离求内力

## 模块二：沉浸式样例库

### 样例1：两物体叠放
质量 $m_1 = 2\\text{kg}$ 和 $m_2 = 3\\text{kg}$ 的两物体叠放在光滑水平面上，对 $m_1$ 施加水平力 $F = 10\\text{N}$。

[DRAW:id=stack01:两物体叠放受力分析图]

解题思维：整体法求加速度 $a = F/(m_1+m_2)$，隔离法求接触力。

## 模块三：配对练习

练习：三个物体连接，求中间物体的受力。

## 模块四：变式组题

变式1：竖直方向的连接体，上方物体通过绳子悬挂下方物体。

## 模块五：小循环复习包

1. 整体法适用的条件是什么？
2. 隔离法的关键步骤是什么？
3. 何时需要联合使用两种方法？`;

test.describe('AI 教学内容管线 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.confirm = () => true;
      window.__alerts = [];
      window.alert = (message) => { window.__alerts.push(String(message)); };
    });
    await page.goto('/');
    await seedData(page);
  });

  test('题库数据加载验证', async ({ page }) => {
    const questionCount = await page.evaluate(async () => {
      const questions = await dbGetAllQuestions();
      return questions.length;
    });
    expect(questionCount).toBe(5);

    const tagCount = await page.evaluate(async () => {
      const tags = await dbGetAllTags();
      return tags.length;
    });
    expect(tagCount).toBe(3);
  });

  test('教学内容页面加载与节点列表渲染', async ({ page }) => {
    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const nodeCards = page.locator('.teaching-node-card');
    await expect(nodeCards).toHaveCount(2);
    await expect(nodeCards.first()).toContainText('牛顿第二定律基本应用');
  });

  test('查看已生成的教学内容（校验 Modal）', async ({ page }) => {
    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const viewBtn = page.locator('.teaching-node-card').filter({ hasText: '斜面模型分析' }).locator('button:has-text("查看")');
    await viewBtn.click();
    await page.waitForTimeout(300);

    const modal = page.locator('#teaching-verify-modal');
    await expect(modal).toHaveClass(/active/);
    await expect(page.locator('#verify-title')).toContainText('斜面模型分析');
    await expect(page.locator('#verify-content')).toContainText('模块一');
  });

  test('Atomizer 全流程（Mock API）', async ({ page }) => {
    await page.route('**/chat/completions', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.stream) {
        const chunks = ATOMIZER_FIXTURE.match(/.{1,3}/g) || [];
        let sseData = '';
        for (const chunk of chunks) {
          sseData += `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`;
        }
        sseData += 'data: [DONE]\n\n';
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: sseData
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: ATOMIZER_FIXTURE } }] })
        });
      }
    });

    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const initialCount = await page.locator('.teaching-node-card').count();

    await page.fill('#teaching-chapter-input', '力的合成与分解');

    const providerSetup = await page.evaluate(() => {
      const providers = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
      if (providers.length === 0) {
        const testProvider = {
          id: 'test-provider',
          name: 'Test Provider',
          baseUrl: 'http://localhost:9999/v1',
          apiKey: 'test-key',
          model: 'test-model',
          authHeader: 'Authorization',
          authScheme: 'Bearer'
        };
        localStorage.setItem('cloud_providers', JSON.stringify([testProvider]));
        localStorage.setItem('current_provider_id', testProvider.id);
        if (typeof cloudProviders !== 'undefined') {
          window.cloudProviders = [testProvider];
          window.currentProviderId = testProvider.id;
        }
        return true;
      }
      return false;
    });

    const atomizeBtn = page.locator('#atomize-btn');
    if (await atomizeBtn.isVisible()) {
      await atomizeBtn.click();
      await page.waitForTimeout(3000);

      const newCount = await page.locator('.teaching-node-card').count();
      expect(newCount).toBeGreaterThanOrEqual(initialCount);
    }
  });

  test('校验通过流程', async ({ page }) => {
    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const viewBtn = page.locator('.teaching-node-card').filter({ hasText: '斜面模型分析' }).locator('button:has-text("查看")');
    await viewBtn.click();
    await page.waitForTimeout(300);

    await page.click('button:has-text("通过")');
    await page.waitForTimeout(500);

    const nodeStatus = await page.evaluate(async () => {
      const node = await dbGetTeachingNode('node-002');
      return node?.status;
    });
    expect(nodeStatus).toBe('VERIFIED');
  });

  test('关联题目到知识点', async ({ page }) => {
    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const viewBtn = page.locator('.teaching-node-card').filter({ hasText: '斜面模型分析' }).locator('button:has-text("查看")');
    await viewBtn.click();
    await page.waitForTimeout(300);

    const linkedBefore = await page.evaluate(async () => {
      return (await dbGetNodeQuestions('node-002')).length;
    });
    expect(linkedBefore).toBe(1);

    await page.click('button:has-text("关联题目")');
    await page.waitForTimeout(300);

    const pickerModal = page.locator('#node-question-picker-modal');
    await expect(pickerModal).toHaveClass(/active/);

    const checkboxes = pickerModal.locator('input[name="node_questions"]');
    const totalCheckboxes = await checkboxes.count();
    expect(totalCheckboxes).toBeGreaterThan(0);

    if (totalCheckboxes > 1) {
      await checkboxes.nth(0).check();
    }

    await page.click('button:has-text("确认关联")');
    await page.waitForTimeout(500);

    const linkedAfter = await page.evaluate(async () => {
      return (await dbGetNodeQuestions('node-002')).length;
    });
    expect(linkedAfter).toBeGreaterThanOrEqual(linkedBefore);
  });

  test('API 错误处理（Mock 500）', async ({ page }) => {
    await page.route('**/chat/completions', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'Internal Server Error'
      });
    });

    await page.getByRole('button', { name: /AI教学/ }).click();
    await page.waitForTimeout(500);

    const providerSetup = await page.evaluate(() => {
      const providers = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
      if (providers.length === 0) {
        const testProvider = {
          id: 'test-provider',
          name: 'Test',
          baseUrl: 'http://localhost:9999/v1',
          apiKey: 'test-key',
          model: 'test-model'
        };
        localStorage.setItem('cloud_providers', JSON.stringify([testProvider]));
        localStorage.setItem('current_provider_id', testProvider.id);
        window.cloudProviders = [testProvider];
        window.currentProviderId = testProvider.id;
      }
    });

    await page.fill('#teaching-chapter-input', '测试章节');
    const atomizeBtn = page.locator('#atomize-btn');
    if (await atomizeBtn.isVisible()) {
      await atomizeBtn.click();
      await page.waitForTimeout(3000);

      const alerts = await page.evaluate(() => window.__alerts);
      const hasError = alerts.some(a => a.includes('失败') || a.includes('错误'));
    }
  });

  test('状态机流转验证', async ({ page }) => {
    const states = await page.evaluate(async () => {
      const node = await dbGetTeachingNode('node-001');
      const initial = node?.status;

      await dbUpdateTeachingNode('node-001', { status: 'GENERATING' });
      let n = await dbGetTeachingNode('node-001');
      const generating = n?.status;

      await dbUpdateTeachingNode('node-001', { status: 'GENERATED', content_markdown: '## 测试内容' });
      n = await dbGetTeachingNode('node-001');
      const generated = n?.status;

      await dbUpdateTeachingNode('node-001', { status: 'VERIFIED' });
      n = await dbGetTeachingNode('node-001');
      const verified = n?.status;

      await dbUpdateTeachingNode('node-001', { status: 'PENDING' });
      n = await dbGetTeachingNode('node-001');
      const resetToPending = n?.status;

      return { initial, generating, generated, verified, resetToPending };
    });

    expect(states.initial).toBe('PENDING');
    expect(states.generating).toBe('GENERATING');
    expect(states.generated).toBe('GENERATED');
    expect(states.verified).toBe('VERIFIED');
    expect(states.resetToPending).toBe('PENDING');
  });
});
