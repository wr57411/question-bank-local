/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbQuestions } from '../data/stores';

const w = window as any;

export async function runFullAIAutomation(): Promise<void> {
  console.log('🛠️ [自动化] 🚀 开始全链路自检 (Gemma 4 全自动调试流程)...');
  w.showStatus('正在执行全自动 AI 压力测试...', 'success');

  // 1. 注入模拟数据
  console.log('🛠️ [自动化] Step 1: 正在尝试注入模拟题目数据...');
  const testId = 'auto-test-' + Date.now();
  await dbQuestions.setItem(testId, {
    id: testId,
    semantic_summary: '自动化测试专用：勾股定理难题',
    question_image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    created_at: new Date().toISOString(),
    question_tags: [],
    ai_metadata: { difficulty: 5 }
  });
  w._invalidateQuestionsCache();
  await w.loadQuestions();
  console.log('🛠️ [自动化] ✅ Step 1: 模拟题目注入成功');

  // 2. 自动发现并加载模型
  console.log('🛠️ [自动化] Step 2: 正在执行自动模型发现 handleDiscoverModel...');
  if (typeof w.handleDiscoverModel === 'function') {
    await w.handleDiscoverModel();
  } else {
    console.warn('🛠️ [自动化] handleDiscoverModel 未实现，跳过自动模型发现');
  }

  // 3. 等待引擎就绪
  console.log('🛠️ [自动化] Step 3: 开始轮询检查 AI 引擎就绪状态...');
  const checkReady = setInterval(async () => {
    const status = await w.Capacitor.Plugins.Gemma4.checkModelStatus();
    console.log('🛠️ [自动化] 当前引擎状态: ', JSON.stringify(status));
    if (status.ready) {
      clearInterval(checkReady);
    }
  }, 2000);
}

export async function handleImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    w.showStatus('正在导入...', 'success');
    const r = await w.importAllData(file);
    await w.refreshAll();
    w.showStatus('导入成功: ' + r.questions + ' 题, ' + r.tags + ' 标签, ' + r.papers + ' 试卷', 'success');
  } catch (e: any) {
    w.showStatus('导入失败: ' + e.message, 'error');
  }
  input.value = '';
}
