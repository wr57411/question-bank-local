/**
 * ai-test-harness/lib/env-manager.js
 * 密钥检测、.env 生成、缺失提示 - 框架无关
 */

const fs = require('fs');
const path = require('path');

function loadDotEnv(projectRoot) {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
  return env;
}

function check(config, projectRoot) {
  const keyEnvVar = config.api?.keyEnvVar;
  if (!keyEnvVar) {
    return { hasKey: false, message: '配置中未声明 api.keyEnvVar', keyEnvVar: null };
  }

  if (process.env[keyEnvVar]) {
    return { hasKey: true, message: `已在环境变量中找到 ${keyEnvVar}`, keyEnvVar };
  }

  if (projectRoot) {
    const dotEnv = loadDotEnv(projectRoot);
    if (dotEnv[keyEnvVar]) {
      return { hasKey: true, message: `已在 .env 中找到 ${keyEnvVar}`, keyEnvVar };
    }
  }

  const message = [
    `⚠️  真实 API 测试需要密钥，但未找到环境变量: ${keyEnvVar}`,
    `请通过以下任一方式提供:`,
    `  1. export ${keyEnvVar}=your_key`,
    `  2. 复制 .env.example 到 .env 并填写`,
    `将跳过真实 API 测试，仅运行 unit + mock 测试。`
  ].join('\n');

  return { hasKey: false, message, keyEnvVar };
}

function generateEnvExample(config, outputPath) {
  const api = config.api || {};
  const lines = [
    `# AI Test Harness - API 配置`,
    `# 获取密钥: ${api.baseUrl || 'https://your-api-provider.com'}`,
    ``,
    `${api.keyEnvVar || 'API_KEY'}=your-key-here`,
    ``,
    `# 测试配置`,
    `API_BASE_URL=${api.baseUrl || ''}`,
    `TEST_MODEL=${api.testModel || ''}`,
    `ENABLE_REAL_API_TESTS=true`,
    ``
  ];
  const content = lines.join('\n');
  if (outputPath) {
    fs.writeFileSync(outputPath, content, 'utf8');
  }
  return content;
}

function ensureGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const entries = ['.env', '.env.local'];
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }
  const additions = entries.filter(e => !content.includes(e));
  if (additions.length > 0) {
    const append = '\n# AI Test Harness\n' + additions.join('\n') + '\n';
    fs.writeFileSync(gitignorePath, content + append, 'utf8');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { check, generateEnvExample, ensureGitignore, loadDotEnv };
}
