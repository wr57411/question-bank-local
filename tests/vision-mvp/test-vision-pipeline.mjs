/**
 * LLM Wiki Vision Pipeline 集成测试
 *
 * 流程:
 * 1. 从 .env.local 读取配置
 * 2. 登录服务端获取 JWT token
 * 3. 拉取题目列表 (question_image_url 为 base64 data URL)
 * 4. 取图片 → 调用 OpenRouter Qwen3 VL 视觉模型
 * 5. 输出识别结果和质量报告
 *
 * 运行: node tests/vision-mvp/test-vision-pipeline.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// ---- Step 0: 读取环境变量 ----
function loadEnvLocal() {
  const envPath = path.join(projectRoot, '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('错误: 找不到 .env.local 文件');
    console.error('请确保项目根目录有 .env.local 文件');
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = loadEnvLocal();
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const TEST_SERVER_URL = env.TEST_SERVER_URL || 'http://localhost:3001';
const TEST_PHONE = env.TEST_PHONE;
const TEST_PASSWORD = env.TEST_PASSWORD;
const OPENROUTER_MODEL = env.OPENROUTER_MODEL || 'openrouter/free';

// 备选模型（免费路由拥堵时尝试）- 均为支持图片的免费/超低价模型
const FALLBACK_MODELS = [
  'openrouter/free',
  'google/gemini-3.5-flash-lite',  // $0.0003/M tokens, 支持图片
  'qwen/qwen3.7-flash',            // $0.00003/M tokens, 支持图片
];

if (!OPENROUTER_API_KEY) {
  console.error('错误: .env.local 中缺少 OPENROUTER_API_KEY');
  process.exit(1);
}
if (!TEST_PHONE || !TEST_PASSWORD) {
  console.error('错误: .env.local 中缺少 TEST_PHONE 或 TEST_PASSWORD');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('🧪 LLM Wiki Vision Pipeline 集成测试');
console.log('='.repeat(60));
console.log(`服务端地址: ${TEST_SERVER_URL}`);
console.log(`登录账号:   ${TEST_PHONE}`);
console.log(`视觉模型:   ${OPENROUTER_MODEL}`);
console.log('');

// ---- Step 1: 登录服务端 ----
async function loginToServer() {
  console.log('[1/4] 登录服务端...');
  const res = await fetch(`${TEST_SERVER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: TEST_PHONE, password: TEST_PASSWORD }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`登录失败 (${res.status}): ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(`登录失败: ${data.error}`);

  console.log(`  ✓ 登录成功 (userId: ${data.id?.slice(0, 8)}...)`);
  return data.token;
}

// ---- Step 2: 拉取题目列表 ----
async function fetchQuestions(token) {
  console.log('[2/4] 拉取题目数据...');
  const res = await fetch(`${TEST_SERVER_URL}/api/questions?include_deleted=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`获取题目失败 (${res.status}): ${err}`);
  }

  const questions = await res.json();
  const withImages = questions.filter(q => q.question_image_url && q.question_image_url.length > 100);
  console.log(`  ✓ 总题目: ${questions.length}, 含图片: ${withImages.length}`);

  if (withImages.length === 0) {
    throw new Error('没有带图片的题目，无法测试视觉识别');
  }

  return withImages;
}

// ---- Step 3: 调用视觉模型 ----
async function recognizeImage(questionImageUrl, model) {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 秒超时（免费服务器拥堵时快速切备选）

  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'LLM Wiki Vision Test',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: `你是一位高中物理老师。请分析这张物理题图片，完成以下任务：

1. 识别并提取题目中的所有文字内容（包括公式）
2. 将物理公式转换为标准 LaTeX 格式（行内用$...$，块级用$$...$$）
3. 指出本题考查的物理概念和知识点
4. 列出题目中给出的已知条件
5. 指出要求的未知量

请以结构化格式输出，使用 Markdown：

## 题目原文
（OCR 识别的完整题目文本）

## 物理公式
（题目中涉及的所有公式，LaTeX 格式）

## 考查知识点
（列出涉及的概念）

## 已知条件
（逐一列出）

## 求解目标
（题目要求什么）`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请分析这张物理题：' },
              { type: 'image_url', image_url: { url: questionImageUrl } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });

    const elapsed = Date.now() - startTime;

    if (!orRes.ok) {
      const errText = await orRes.text();
      throw new Error(`OpenRouter 请求失败 (${orRes.status}): ${errText}`);
    }

    const data = await orRes.json();
    const content = data.choices?.[0]?.message?.content || '(无返回)';
    const usage = data.usage || {};

    return {
      content,
      elapsed,
      tokens: usage.total_tokens || 0,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时（45秒）');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---- Step 4: 运行测试并生成报告 ----
async function main() {
  try {
    const token = await loginToServer();
    const questions = await fetchQuestions(token);

    // 只取前 2 题做测试（控制调用量，免费额度有限）
    const testCount = Math.min(2, questions.length);
    console.log(`[3/4] 开始视觉识别 (测试 ${testCount} 张图片)...\n`);

    const results = [];
    for (let i = 0; i < testCount; i++) {
      const q = questions[i];
      const shortId = q.id.slice(0, 8);
      const imgLen = q.question_image_url?.length || 0;
      console.log(`  [${i + 1}/${testCount}] 识别题目 ${shortId}... (${(imgLen / 1024).toFixed(0)}KB)`);

      let lastError = null;
      let success = false;

      // 尝试主模型和备选模型
      const modelsToTry = [OPENROUTER_MODEL, ...FALLBACK_MODELS.filter(m => m !== OPENROUTER_MODEL)];
      for (const model of modelsToTry) {
        try {
          console.log(`    尝试模型: ${model}`);
          const result = await recognizeImage(q.question_image_url, model);
          results.push({ id: q.id, success: true, model, ...result });
          console.log(`    ✓ 完成 (${(result.elapsed / 1000).toFixed(1)}s, ${result.tokens} tokens, 模型: ${model})`);
          console.log(`    ── 识别结果预览 ──`);
          const preview = result.content.split('\n').slice(0, 10).map(l => `    ${l}`).join('\n');
          console.log(preview);
          console.log(`    ── 预览结束 ──\n`);
          success = true;
          break;
        } catch (err) {
          lastError = err;
          console.log(`    ! ${model} 失败: ${err.message}`);
          // 继续尝试下一个模型
        }
      }

      if (!success) {
        results.push({ id: q.id, success: false, error: lastError?.message || '所有模型均失败' });
        console.log(`    ✗ 所有模型均失败，最后一个错误: ${lastError?.message}\n`);
      }
    }

    // ---- 报告 ----
    console.log('='.repeat(60));
    console.log('📊 测试报告');
    console.log('='.repeat(60));

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const avgTime = results.filter(r => r.success).reduce((s, r) => s + r.elapsed, 0) / (successCount || 1);
    const totalTokens = results.filter(r => r.success).reduce((s, r) => s + r.tokens, 0);

    console.log(`总测试数:   ${results.length}`);
    console.log(`成功:       ${successCount}`);
    console.log(`失败:       ${failCount}`);
    console.log(`平均耗时:   ${(avgTime / 1000).toFixed(1)}s`);
    console.log(`总 Token:   ${totalTokens}`);
    console.log(`模型:       ${OPENROUTER_MODEL}`);
    console.log('');

    if (successCount > 0) {
      console.log('结论: 视觉识别管道可用');
      console.log('');
      console.log('下一步建议:');
      console.log('1. 检查上面的识别结果是否准确');
      console.log('2. 如果公式识别不理想，可以调整 system prompt');
      console.log('3. 如果速度满意，可以集成到 src/services/ 中');
    } else {
      console.log('结论: 视觉识别管道存在问题，请检查上面的错误信息');
    }

    // 写结果到文件
    const reportPath = path.join(__dirname, 'test-result.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      model: OPENROUTER_MODEL,
      total: results.length,
      success: successCount,
      failed: failCount,
      avgElapsedMs: avgTime,
      totalTokens,
      results: results.map(r => ({
        id: r.id?.slice(0, 8),
        success: r.success,
        elapsedMs: r.elapsed || null,
        tokens: r.tokens || 0,
        contentPreview: r.content?.slice(0, 800) || null,
        error: r.error || null,
      })),
    }, null, 2));
    console.log(`\n详细结果已保存: ${reportPath}`);

  } catch (err) {
    console.error(`\n❌ 测试失败: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
