/**
 * ai-test-harness/lib/fixture-generator.js
 * Fixture 录制与管理 - 从真实 API 调用录制响应
 */

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateStandardFixtures(pipeline, fixtureDir) {
  ensureDir(fixtureDir);
  const fixtures = pipeline.testFixtures || ['good', 'empty'];
  const files = [];

  for (const fixtureType of fixtures) {
    const fileName = `${pipeline.name}_${fixtureType}`;
    const content = buildFixtureContent(pipeline, fixtureType);
    const ext = content.type === 'json' ? '.json' : '.txt';
    const filePath = path.join(fixtureDir, fileName + ext);
    fs.writeFileSync(filePath, content.data, 'utf8');
    files.push(filePath);
  }

  return files;
}

function buildFixtureContent(pipeline, fixtureType) {
  const sampleOutput = pipeline._sampleOutput || {};

  switch (fixtureType) {
    case 'good':
      if (pipeline.outputSchema?.type === 'array') {
        const item = pipeline.outputSchema.items?.properties || {};
        const sampleItem = {};
        for (const [key, def] of Object.entries(item)) {
          if (def.enum) sampleItem[key] = def.enum[0];
          else if (def.type === 'string') sampleItem[key] = `样例${key}`;
          else sampleItem[key] = null;
        }
        return { type: 'json', data: JSON.stringify([sampleItem], null, 2) };
      }
      return { type: 'json', data: JSON.stringify(sampleOutput.good || {}, null, 2) };

    case 'markdown_wrapped':
      const goodContent = buildFixtureContent(pipeline, 'good').data;
      return { type: 'txt', data: '以下是拆解结果：\n```json\n' + goodContent + '\n```\n希望对你有帮助！' };

    case 'extra_text':
      const innerContent = buildFixtureContent(pipeline, 'good').data;
      return { type: 'txt', data: '好的，我来帮你拆解这个章节的知识点。\n\n' + innerContent + '\n\n以上就是所有知识点了。' };

    case 'truncated':
      return { type: 'txt', data: '[{"id":"k001","name":"知识点A","difficulty":"基础","key_concept":"核' };

    case 'empty':
      return { type: 'txt', data: '' };

    case 'trailing_comma':
      return { type: 'txt', data: '[{"id":"k001","name":"知识点A","difficulty":"基础",},{"id":"k002","name":"知识点B",}]' };

    case 'short_response':
      return { type: 'txt', data: '这是一个很短的回复。' };

    case 'missing_modules':
      return { type: 'txt', data: '## 模块一：概念\n这是模块一的内容。\n\n## 模块三：练习\n缺少了模块二和四。' };

    case 'good_response':
      return { type: 'txt', data: sampleOutput.goodResponse || '## 模块一\n内容\n## 模块二\n内容\n## 模块三\n内容\n## 模块四\n内容\n## 模块五\n内容' };

    default:
      return { type: 'txt', data: '' };
  }
}

async function recordFromRealAPI(pipeline, apiKey, apiConfig, fixtureDir) {
  ensureDir(fixtureDir);
  const url = (apiConfig.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    [apiConfig.authHeader || 'Authorization']: (apiConfig.authScheme ? apiConfig.authScheme + ' ' : '') + apiKey
  };
  if (apiConfig.extraHeaders) Object.assign(headers, apiConfig.extraHeaders);

  const body = {
    model: apiConfig.testModel,
    messages: [
      { role: 'system', content: pipeline.systemPrompt || '' },
      { role: 'user', content: pipeline.input?.sample || '' }
    ],
    temperature: 0.3,
    stream: false
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  const filePath = path.join(fixtureDir, `${pipeline.name}_real_recorded.json`);
  fs.writeFileSync(filePath, JSON.stringify({ raw: content, model: apiConfig.testModel, timestamp: new Date().toISOString() }, null, 2), 'utf8');

  return { filePath, content, model: apiConfig.testModel };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateStandardFixtures, buildFixtureContent, recordFromRealAPI, ensureDir };
}
