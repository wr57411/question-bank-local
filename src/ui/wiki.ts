import { escapeHtml, showTab, showStatus } from './common';
import {
  wikiGetAllPages, wikiGetPagesByReviewStatus, wikiGetPendingReviews,
  wikiGetPendingJobs, wikiLint, wikiUpdateReviewStatus, wikiGetIndex, wikiGetLog,
  wikiPutLink, wikiCreatePendingJob, wikiMarkJobCompleted, wikiMarkJobFailed,
  wikiSmartUpsertPage, wikiGetLinks, wikiLogAppend,
  LintResult, WikiIndex, WikiLogEntry,
  GraphNode, GraphEdge,
} from '../data/wiki';
import { generateId, nowIso } from '../data/stores';
import { getBudgetStatusText, checkBudget, addTokenUsage } from '../services/wiki-budget';
import { recognizePhysicsImage } from '../services/vision';
import {
  compileWikiKnowledge, visionResultToCompileInput, createWikiPageFromDraft,
} from '../services/wiki-compiler';
import type { WikiPage, WikiLink, Question } from '../types';
import type { CompileInput, CompileOutput } from '../services/wiki-compiler';

const TYPE_COLORS: Record<string, string> = {
  concept: '#4CC3FF',
  method: '#3ED598',
  model: '#F79009',
  fallacy: '#FF5A6E',
};

const TYPE_LABELS: Record<string, string> = {
  concept: '概念', method: '方法', model: '模型', fallacy: '误区',
};

export function showWikiTab(btn?: HTMLElement): void {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll('div[id$="-tab"]').forEach(t => t.classList.add("hidden"));
  if (btn) btn.classList.add("active");
  const wikiTab = document.getElementById('wiki-tab');
  if (wikiTab) wikiTab.classList.remove("hidden");
  renderWikiPanel();
}

export async function renderWikiPanel(): Promise<void> {
  const container = document.getElementById('wiki-tab');
  if (!container) return;

  const w = window as unknown as Record<string, any>;
  const pages: any[] = await (w.dbWikiGetAllPages ? w.dbWikiGetAllPages() : []).catch(() => []);
  const budgetText = getBudgetStatusText();

  const typeTabs = (['concept', 'method', 'model', 'fallacy'] as const).map(t => {
    const count = pages.filter(p => p.type === t).length;
    return `<button class="wiki-type-tab" data-type="${t}" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;font-size:13px">${TYPE_LABELS[t]} (${count})</button>`;
  }).join('');

  container.innerHTML = `
    <div class="wiki-panel">
      <div class="wiki-header">
        <h2>📖 物理知识库</h2>
        <span class="wiki-budget">${escapeHtml(budgetText)}</span>
      </div>
      <div class="wiki-stats">
        <span class="stat">📄 Wiki 页面: ${pages.length}</span>
      </div>
      <div class="wiki-type-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${typeTabs}
      </div>
      <div class="wiki-actions">
        <button id="wiki-btn-compile" class="btn-sm" style="background:var(--accent);color:#fff">⚡ 编译题目</button>
        <button id="wiki-btn-index" class="btn-sm">📑 索引</button>
        <button id="wiki-btn-log" class="btn-sm">📜 日志</button>
        <button id="wiki-btn-lint" class="btn-sm">🔍 检查问题</button>
        <button id="wiki-btn-pending" class="btn-sm">📋 待审页面</button>
        <button id="wiki-btn-diag" class="btn-sm">🧪 诊断</button>
        <button id="wiki-btn-graph" class="btn-sm">🕸️ 图谱视图</button>
        <button id="wiki-btn-refresh" class="btn-sm">🔄 刷新</button>
      </div>
      <div id="wiki-content" class="wiki-content"></div>
    </div>
  `;

  wireWikiEvents();
  document.querySelectorAll('.wiki-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = (btn as HTMLElement).dataset.type as WikiPage['type'];
      const filtered = pages.filter(p => p.type === type);
      renderWikiTable(filtered, TYPE_LABELS[type]);
    });
  });
  renderWikiTable(pages);
}

function wireWikiEvents(): void {
  document.getElementById('wiki-btn-compile')?.addEventListener('click', async () => {
    await renderCompileSelector();
  });
  document.getElementById('wiki-btn-index')?.addEventListener('click', async () => {
    await renderWikiIndex();
  });
  document.getElementById('wiki-btn-log')?.addEventListener('click', async () => {
    await renderWikiLog();
  });
  document.getElementById('wiki-btn-lint')?.addEventListener('click', async () => {
    const w = window as unknown as Record<string, any>;
    const result = w.dbWikiLint ? await w.dbWikiLint() : { orphan_pages: [], conflict_pages: [], broken_links: [], low_confidence: [], missing_refs: [], duplicate_candidates: [] };
    renderLintResult(result);
  });
  document.getElementById('wiki-btn-pending')?.addEventListener('click', async () => {
    renderWikiTable([], '待审页面（暂无）');
  });
  document.getElementById('wiki-btn-diag')?.addEventListener('click', async () => {
    const { runDiagnostic } = await import('../services/wiki-diagnostic');
    const result = await runDiagnostic();
    renderDiagnosticResult(result);
  });
  document.getElementById('wiki-btn-graph')?.addEventListener('click', async () => {
    await renderGraphView();
  });
  document.getElementById('wiki-btn-refresh')?.addEventListener('click', () => {
    renderWikiPanel();
  });
}

function renderWikiTable(pages: Awaited<ReturnType<typeof wikiGetAllPages>>, title = '所有页面'): void {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  if (pages.length === 0) {
    content.innerHTML = '<div class="wiki-empty">暂无 Wiki 页面，请先编译一些题目</div>';
    return;
  }

  const rows = pages.map(p => `
    <tr data-id="${p.id}">
      <td><span class="type-badge" style="background:${TYPE_COLORS[p.type]}">${TYPE_LABELS[p.type]}</span></td>
      <td class="wiki-title">${escapeHtml(p.title)}</td>
      <td>${p.source_ids.length}</td>
      <td>${statusBadge(p.review_status)}</td>
      <td>
        <button class="btn-xs btn-view" data-id="${p.id}">查看</button>
        ${p.review_status === 'auto' ? `<button class="btn-xs btn-approve" data-id="${p.id}">确认</button>` : ''}
        ${p.review_status === 'needs_merge' ? `<button class="btn-xs btn-merge" data-id="${p.id}">处理合并</button>` : ''}
      </td>
    </tr>
  `).join('');

  content.innerHTML = `
    <h3>${escapeHtml(title)} (${pages.length})</h3>
    <table class="wiki-table">
      <thead><tr><th>类型</th><th>标题</th><th>关联题</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  content.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id!;
      await renderPageDetail(id);
    });
  });
  content.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).dataset.id!;
      await wikiUpdateReviewStatus(id, 'human_verified');
      showStatus('已审核确认', 'success');
      renderWikiPanel();
    });
  });
}

async function renderPageDetail(id: string): Promise<void> {
  const w = window as unknown as Record<string, any>;
  const page = w.dbWikiGetPage ? await w.dbWikiGetPage(id) : null;
  if (!page) return;

  const content = document.getElementById('wiki-content');
  if (!content) return;

  const sourceButtons = page.source_ids.map((sid: string) =>
    `<button class="btn-xs btn-source" data-source-id="${sid}">📋 ${sid.slice(0, 8)}...</button>`
  ).join(' ');

  content.innerHTML = `
    <div class="wiki-detail">
      <button class="btn-sm btn-back">← 返回列表</button>
      <h3>${escapeHtml(page.title)}</h3>
      <div class="wiki-meta">
        <span class="type-badge" style="background:${TYPE_COLORS[page.type]}">${TYPE_LABELS[page.type]}</span>
        <span>v${page.version}</span>
        <span>置信度: ${(page.confidence * 100).toFixed(0)}%</span>
        <span>${statusBadge(page.review_status)}</span>
      </div>
      <div class="wiki-summary">${escapeHtml(page.summary)}</div>
      <div class="wiki-body">${escapeHtml(page.content)}</div>
      ${page.latex_formulas.length ? `<div class="wiki-formulas"><h4>公式</h4><ul>${page.latex_formulas.map((f: string) => `<li>$$${f}$$</li>`).join('')}</ul></div>` : ''}
      ${page.source_snippets && page.source_snippets.length ? `<div class="wiki-sources"><h4>来源片段</h4>${page.source_snippets.map((s: string) => `<p class="snippet">${escapeHtml(s)}</p>`).join('')}</div>` : ''}
      ${page.source_ids && page.source_ids.length ? `<div class="wiki-source-links"><h4>来源题目</h4>${sourceButtons}</div>` : ''}
    </div>
  `;

  content.querySelector('.btn-back')?.addEventListener('click', () => {
    renderWikiPanel();
  });
  content.querySelectorAll('.btn-source').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sourceId = (e.target as HTMLElement).dataset.sourceId!;
      showStatus(`来源题 ID: ${sourceId}（需在题目管理中查看）`, 'success');
    });
  });
}

async function renderCompileSelector(): Promise<void> {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const w = window as unknown as Record<string, any>;

  // Fetch questions and tags from IndexedDB
  const questions = (await (typeof w.dbGetAllQuestions === 'function' ? w.dbGetAllQuestions() : Promise.resolve([])).catch(() => [])) as Question[];
  const tags: any[] = await new Promise((resolve) => {
    if (typeof w.dbGetAllTags === 'function') {
      w.dbGetAllTags().then((t: any[]) => resolve(t)).catch(() => resolve([]));
    } else { resolve([]); }
  });

  if (questions.length === 0) {
    content.innerHTML = '<h3>⚡ 编译题目</h3><div class="wiki-empty">暂无题目可编译</div>';
    return;
  }

  const questionCheckboxes = questions.slice(0, 50).map((q: any) => `
    <tr data-qid="${q.id}">
      <td><input type="checkbox" class="wiki-compile-check" data-qid="${q.id}" /></td>
      <td style="font-size:12px">${escapeHtml(q.id.slice(0, 12))}</td>
      <td style="font-size:11px;color:var(--text-secondary)">${q.question_image_url ? '📷' : ''} ${escapeHtml(q.semantic_summary || q.book_name || '').slice(0, 30)}</td>
    </tr>
  `).join('');

  const tagRows = tags.slice(0, 50).map((t: any) => `
    <tr>
      <td><input type="checkbox" class="wiki-tag-check" data-tag="${escapeHtml(t.name || '')}" data-color="${escapeHtml(t.color || '#4CC3FF')}" /></td>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(t.color || '#4CC3FF')}"></span></td>
      <td style="font-size:12px">${escapeHtml(t.name || '')}</td>
    </tr>
  `).join('');

  content.innerHTML = `
    <h3>⚡ 编译 Wiki</h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:250px">
        <h4>方式一：AI 分析标签生成</h4>
        <p style="font-size:11px;color:var(--text-secondary)">为每个选中的标签调用 AI 生成结构化 Wiki 页面。</p>
        <button id="wiki-compile-from-tags-ai" class="btn-sm" style="background:#8b5cf6;color:#fff;margin-bottom:8px">🤖 AI 分析标签生成 Wiki</button>
        <table class="wiki-table" style="max-height:200px;overflow-y:auto;display:block">
          <thead><tr><th>✓</th><th>颜色</th><th>标签名</th></tr></thead>
          <tbody>${tagRows}</tbody>
        </table>
      </div>
      <div style="flex:1;min-width:250px">
        <h4>方式二：选择题目 AI 编译</h4>
        <p style="font-size:11px;color:var(--text-secondary)">选择题目，AI 从图片/语义提取知识点。</p>
        <div style="margin:8px 0;display:flex;gap:8px">
          <button id="wiki-compile-select-all" class="btn-xs">全选</button>
          <button id="wiki-compile-start" class="btn-xs" style="background:var(--accent);color:#fff">开始编译</button>
          <span id="wiki-compile-status" style="font-size:12px"></span>
        </div>
        <table class="wiki-table" style="max-height:200px;overflow-y:auto;display:block">
          <thead><tr><th>✓</th><th>ID</th><th>信息</th></tr></thead>
          <tbody>${questionCheckboxes}</tbody>
        </table>
      </div>
    </div>
  `;

  content.querySelector('#wiki-compile-from-tags-ai')?.addEventListener('click', async () => {
    const checked = content.querySelectorAll('.wiki-tag-check:checked');
    if (checked.length === 0) { showStatus('请先选择标签', 'error'); return; }
    const selected = Array.from(checked).map((cb: any) => ({ name: cb.dataset.tag, color: cb.dataset.color }));
    await runCompileFromTagsAI(selected, questions);
  });

  content.querySelector('#wiki-compile-select-all')?.addEventListener('click', () => {
    content.querySelectorAll('.wiki-compile-check').forEach((cb: any) => cb.checked = true);
  });

  content.querySelector('#wiki-compile-start')?.addEventListener('click', async () => {
    const checked = content.querySelectorAll('.wiki-compile-check:checked');
    if (checked.length === 0) { showStatus('请先选择题目', 'error'); return; }
    const selectedIds = Array.from(checked).map((cb: any) => cb.dataset.qid as string);
    const selected = questions.filter(q => selectedIds.includes(q.id));
    await runCompileFromQuestions(selected);
  });
}


async function runCompileFromTagsAI(tags: Array<{ name: string; color: string }>, questions: any[]): Promise<void> {
  const content = document.getElementById('wiki-content');
  if (!content) return;
  const w = window as unknown as Record<string, any>;

  if (typeof w.callCloudAI !== 'function') {
    content.innerHTML = '<h3>❌ AI 未配置</h3><p>请先在设置中配置 AI 服务商</p>';
    return;
  }

  // Check provider
  const provider = w.getCurrentProvider ? w.getCurrentProvider() : null;
  if (!provider) {
    content.innerHTML = '<h3>❌ 无可用 AI</h3><p>请先在 AI 引擎管理中添加服务商</p>';
    return;
  }

  // Show provider warning if using free model
  const isFreeModel = provider.model?.includes(':free') || provider.name?.includes('openrouter');
  if (isFreeModel) {
    const allProviders = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
    const paidProviders = allProviders.filter((p: any) => !p.model?.includes(':free'));
    if (paidProviders.length > 0) {
      content.innerHTML = `
        <h3>⚠️ 当前使用免费模型</h3>
        <p>OpenRouter 免费模型可能较慢或限流。建议切换到：</p>
        <ul>${paidProviders.map((p: any) => `<li><button class="btn-xs wiki-switch-provider" data-id="${p.id}">切换到 ${p.name} (${p.model})</button></li>`).join('')}</ul>
        <p style="margin-top:12px"><button id="wiki-compile-anyway" class="btn-sm" style="background:var(--warning)">仍要继续</button></p>
      `;
      content.querySelector('#wiki-compile-anyway')?.addEventListener('click', async () => {
        await runCompileFromTagsAIDoRun(tags, questions, provider);
      });
      content.querySelectorAll('.wiki-switch-provider').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = (e.target as HTMLElement).dataset.id || '';
          localStorage.setItem('current_provider_id', id);
          location.reload();
        });
      });
      return;
    }
  }

  await runCompileFromTagsAIDoRun(tags, questions, provider);
}

async function runCompileFromTagsAIDoRun(tags: Array<{ name: string; color: string }>, questions: any[], provider: any): Promise<void> {
  const content = document.getElementById('wiki-content');
  if (!content) return;
  const w = window as unknown as Record<string, any>;

  let created = 0;
  let merged = 0;
  let failed = 0;

  for (const tag of tags) {
    content.innerHTML = `<h3>⚡ AI 编译中...</h3><p>分析标签: <b>${escapeHtml(tag.name)}</b></p><p>使用 ${escapeHtml(provider.name || 'AI')} (${escapeHtml(provider.model || '')}) 提取知识点...</p>`;

    const tagQuestions = questions.filter((q: any) => {
      const qTags = q.tags || [];
      return qTags.some((t: any) => (typeof t === 'string' ? t === tag.name : t.name === tag.name || t === tag.name));
    });

    const prompt = `你是一位高中物理教研员。请分析以下物理标签/知识点，生成结构化的 Wiki 内容。

标签名：${tag.name}
关联题目数：${tagQuestions.length} 道

请输出严格的 JSON 格式（不要包含 markdown 代码块标记）：
{
  "type": "concept 或 method 或 model 或 fallacy",
  "summary": "一句话概括（50字以内）",
  "content": "详细的 Markdown 内容，包含：定义、公式（用 $...$）、适用条件、常见误区",
  "formulas": ["公式1", "公式2"],
  "conditions": ["条件1", "条件2"],
  "mistakes": ["误区1", "误区2"]
}

只输出 JSON，不要其他文字。`;

    try {
      const aiResponse = await Promise.race([
        w.callCloudAI(prompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI 超时（30s）')), 30000)),
      ]) as string;
      if (!aiResponse || aiResponse.length < 20) {
        throw new Error('AI 响应无效: ' + (aiResponse || '空').slice(0, 100));
      }
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { throw new Error('AI 未返回 JSON'); }

      const data = JSON.parse(jsonMatch[0]);
      const page = {
        id: 'wiki_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        type: ['concept', 'method', 'model', 'fallacy'].includes(data.type) ? data.type : 'concept',
        title: tag.name,
        canonical_title: tag.name,
        aliases: [tag.name],
        summary: data.summary || tag.name,
        content: data.content || ('## ' + tag.name),
        latex_formulas: data.formulas || [],
        key_conditions: data.conditions || [],
        common_mistakes: data.mistakes || [],
        related_page_ids: [],
        source_ids: tagQuestions.map((q: any) => q.id),
        source_snippets: [],
        confidence: 0.8,
        review_status: 'auto',
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        version: 1,
        deleted_at: null,
      };

      const res = await w.dbWikiSmartUpsertPage(page, tagQuestions[0]?.id || 'tag-source', '');
      if (res.action === 'created') created++;
      else if (res.action === 'updated' || res.action === 'merged') merged++;
    } catch (e: any) {
      failed++;
      console.warn('AI compile error for', tag.name, e.message);
    }
  }

  try { await w.dbWikiLogAppend({ action: 'compile', detail: 'AI 编译: ' + created + ' 新建, ' + merged + ' 合并, ' + failed + ' 失败', page_ids: [] }); } catch (e) {}

  content.innerHTML = `
    <h3>✅ AI 编译完成</h3>
    <p>新建: ${created} | 合并: ${merged} | 失败: ${failed}</p>
    ${failed > 0 ? '<p style="color:var(--danger);font-size:12px">部分编译失败，请检查 AI 服务商配置或切换 provider</p>' : ''}
    <p style="font-size:11px;color:var(--text-secondary)">使用 AI: ${escapeHtml(provider.name || 'unknown')}</p>
    <button class="btn-sm" id="wiki-refresh-after-compile">刷新面板</button>
  `;
  content.querySelector('#wiki-refresh-after-compile')?.addEventListener('click', () => {
    renderWikiPanel();
  });
}

async function runCompileFromQuestions(questions: Array<Question>): Promise<void> {
  const status = document.getElementById('wiki-compile-status');
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const budget = checkBudget();
  if (!budget.allowed) {
    showStatus(budget.reason || '编译预算已超限', 'error');
    content.innerHTML = `<h3>⛔ 编译被阻断</h3><p>${escapeHtml(budget.reason || '预算超限')}</p>`;
    return;
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showStatus('当前离线，已将题目加入编译队列，联网后自动处理', 'info');
    for (const q of questions) {
      await wikiCreatePendingJob('question_image', q.id);
    }
    content.innerHTML = '<h3>📴 已入队</h3><p>联网后将自动编译这些题目。</p>';
    return;
  }

  let done = 0;
  let created = 0;
  let updated = 0;
  let merged = 0;
  let failed = 0;
  let linksCreated = 0;

  const allPages = await wikiGetAllPages();

  for (const q of questions) {
    if (status) status.textContent = `编译中 ${done + 1}/${questions.length}...`;
    const job = await wikiCreatePendingJob('question_image', q.id);
    try {
      const { compileInput, visionUsage } = await buildCompileInputFromQuestion(q);
      if (!compileInput.text && !compileInput.formulas.length && !compileInput.concepts.length) {
        throw new Error('题目无可识别文本/公式/知识点（无图且无语义摘要）');
      }

      const output = await compileWikiKnowledge(compileInput);
      if (output.error) throw new Error('编译解析失败: ' + output.error);

      const titleToPageId = new Map<string, string>();
      for (const draft of output.drafts) {
        const page = createWikiPageFromDraft(draft, q.id);
        const res = await wikiSmartUpsertPage(page, q.id, draft.source_snippet, allPages);
        titleToPageId.set(draft.canonical_title, res.pageId);
        if (res.action === 'created') created++;
        else if (res.action === 'merged') merged++;
        else if (res.action === 'updated') updated++;
      }

      for (const [a, b, rel] of output.link_pairs) {
        const draftA = output.drafts[a];
        const draftB = output.drafts[b];
        const fromId = titleToPageId.get(draftA.canonical_title);
        const toId = titleToPageId.get(draftB.canonical_title);
        if (fromId && toId && fromId !== toId) {
          await wikiPutLink({
            id: generateId(),
            source_page_id: fromId,
            target_page_id: toId,
            relation: rel,
            description: `${draftA.title} ↔ ${draftB.title}`,
            created_at: nowIso(),
            deleted_at: null,
          });
          linksCreated++;
        }
      }

      const tokenUsage = (visionUsage || 0) + (output.usage || 0);
      addTokenUsage(tokenUsage);

      await wikiMarkJobCompleted(job.id, [...titleToPageId.values()]);
      await wikiLogAppend({
        action: 'compile',
        detail: `题目 ${q.id.slice(0, 8)} 编译: ${output.drafts.length} 草稿, ${titleToPageId.size} 入库, ${output.link_pairs.length} 关系`,
        page_ids: [...titleToPageId.values()],
      });
      done++;
    } catch (e: any) {
      failed++;
      done++;
      await wikiMarkJobFailed(job.id, e.message || String(e));
      console.warn('编译失败', q.id, e);
    }
  }

  if (content) {
    content.innerHTML = `
      <h3>✅ 编译完成</h3>
      <p>成功: ${done - failed} / ${questions.length}</p>
      <p>新建: ${created} | 更新: ${updated} | 合并: ${merged} | 失败: ${failed} | 关系: ${linksCreated}</p>
      <button class="btn-sm" onclick="document.getElementById('wiki-btn-refresh').click()">刷新面板</button>
    `;
  }
}

function isLikelyImageUrl(url: string): boolean {
  if (!url) return false;
  return url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:') || url.startsWith('/');
}

async function resolveImageDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function extractTagNames(q: Question): string[] {
  if (!q.question_tags) return [];
  return q.question_tags.map(t => (typeof t === 'string' ? t : t.name));
}

async function buildCompileInputFromQuestion(q: Question): Promise<{ compileInput: CompileInput; visionUsage?: number }> {
  const ctx = {
    tags: extractTagNames(q),
    book_name: q.book_name || undefined,
    chapter: q.page_number || undefined,
  };

  if (q.question_image_url && isLikelyImageUrl(q.question_image_url)) {
    try {
      const imageDataUrl = await resolveImageDataUrl(q.question_image_url);
      const vr = await recognizePhysicsImage(imageDataUrl);
      return {
        compileInput: visionResultToCompileInput(vr, ctx),
        visionUsage: vr.usage,
      };
    } catch (e) {
      console.warn('vision 识别失败，回退文本编译', e);
    }
  }

  return {
    compileInput: {
      text: q.semantic_summary || '',
      formulas: [],
      concepts: [],
      conditions: [],
      target: '',
      ...ctx,
    },
  };
}

export async function wikiFlushPendingJobs(): Promise<number> {
  const jobs = await wikiGetPendingJobs();
  if (jobs.length === 0) return 0;

  const w = window as unknown as Record<string, any>;
  const allQuestions = (typeof w.dbGetAllQuestions === 'function' ? await w.dbGetAllQuestions().catch(() => []) : []) as Question[];
  const qMap = new Map(allQuestions.map(q => [q.id, q]));
  const allPages = await wikiGetAllPages();

  let processed = 0;
  for (const job of jobs) {
    if (job.status !== 'pending') continue;
    const q = qMap.get(job.source_id);
    if (!q) {
      await wikiMarkJobFailed(job.id, '找不到源题目');
      continue;
    }
    try {
      const { compileInput, visionUsage } = await buildCompileInputFromQuestion(q);
      const output = await compileWikiKnowledge(compileInput);
      if (output.error) throw new Error(output.error);

      const titleToPageId = new Map<string, string>();
      for (const draft of output.drafts) {
        const page = createWikiPageFromDraft(draft, q.id);
        const res = await wikiSmartUpsertPage(page, q.id, draft.source_snippet, allPages);
        titleToPageId.set(draft.canonical_title, res.pageId);
      }
      for (const [a, b, rel] of output.link_pairs) {
        const fromId = titleToPageId.get(output.drafts[a].canonical_title);
        const toId = titleToPageId.get(output.drafts[b].canonical_title);
        if (fromId && toId && fromId !== toId) {
          await wikiPutLink({
            id: generateId(), source_page_id: fromId, target_page_id: toId,
            relation: rel, description: '', created_at: nowIso(), deleted_at: null,
          });
        }
      }
      const tokenUsage = (visionUsage || 0) + (output.usage || 0);
      addTokenUsage(tokenUsage);
      await wikiMarkJobCompleted(job.id, [...titleToPageId.values()]);
      processed++;
    } catch (e: any) {
      await wikiMarkJobFailed(job.id, e.message || String(e));
    }
  }
  return processed;
}

function renderLintResult(result: LintResult): void {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const issues: string[] = [];
  if (result.orphan_pages.length) issues.push(`孤立页面: ${result.orphan_pages.length} 个`);
  if (result.conflict_pages.length) issues.push(`待合并页面: ${result.conflict_pages.length} 个`);
  if (result.broken_links.length) issues.push(`断链: ${result.broken_links.length} 条`);
  if (result.missing_refs.length) issues.push(`缺少交叉引用: ${result.missing_refs.length} 个`);
  if (result.low_confidence.length) issues.push(`低置信度: ${result.low_confidence.length} 个`);
  if (result.duplicate_candidates.length) issues.push(`疑似重复: ${result.duplicate_candidates.length} 对`);

  content.innerHTML = `
    <h3>🔍 Lint 检查结果</h3>
    ${issues.length ? `<ul class="lint-issues">${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '<div class="wiki-empty">无明显问题 ✓</div>'}
    ${result.orphan_pages.length ? `<p>孤立页面 ID: ${result.orphan_pages.slice(0, 5).map(id => id.slice(0, 8)).join(', ')}</p>` : ''}
    ${result.duplicate_candidates.length ? `<p>重复候选: ${result.duplicate_candidates.slice(0, 3).map(d => `${d.a.slice(0,8)}≈${d.b.slice(0,8)}(${(d.similarity*100).toFixed(0)}%)`).join(', ')}</p>` : ''}
  `;
}

async function renderWikiIndex(): Promise<void> {
  const index = await wikiGetIndex();
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const typeOrder: Array<keyof typeof index.by_type> = ['concept', 'method', 'model', 'fallacy'];
  const sections = typeOrder.map(type => {
    const entries = index.by_type[type];
    if (!entries.length) return '';
    const rows = entries.map(e => `
      <tr data-id="${e.id}">
        <td><span class="wiki-title" style="cursor:pointer;color:${TYPE_COLORS[type]}">${escapeHtml(e.title)}</span></td>
        <td>${escapeHtml(e.summary)}</td>
        <td>${e.source_count}</td>
      </tr>
    `).join('');
    return `<h4 style="color:${TYPE_COLORS[type]};margin-top:12px">${TYPE_LABELS[type]} (${entries.length})</h4>
      <table class="wiki-table"><tbody>${rows}</tbody></table>`;
  }).join('');

  content.innerHTML = `
    <h3>📑 Wiki 索引 <span style="font-size:12px;color:var(--text-secondary)">${index.generated_at.slice(0, 19)}</span></h3>
    <p>共 ${index.total} 个页面</p>
    ${sections || '<div class="wiki-empty">暂无页面</div>'}
  `;

  content.querySelectorAll('.wiki-title').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = (e.target as HTMLElement).closest('tr')!.dataset.id!;
      await renderPageDetail(id);
    });
  });
}

async function renderWikiLog(): Promise<void> {
  const logs = await wikiGetLog(30);
  const content = document.getElementById('wiki-content');
  if (!content) return;

  if (logs.length === 0) {
    content.innerHTML = '<h3>📜 操作日志</h3><div class="wiki-empty">暂无日志</div>';
    return;
  }

  const rows = logs.map(l => `
    <tr>
      <td style="white-space:nowrap;font-size:11px;color:var(--text-secondary)">${l.timestamp.slice(0, 19)}</td>
      <td><span class="log-action log-action-${l.action}">${l.action}</span></td>
      <td>${escapeHtml(l.detail)}</td>
      <td style="font-size:11px">${l.page_ids.length} 页</td>
    </tr>
  `).join('');

  content.innerHTML = `
    <h3>📜 操作日志（最近 ${logs.length} 条）</h3>
    <table class="wiki-table log-table">
      <thead><tr><th>时间</th><th>操作</th><th>详情</th><th>影响</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderDiagnosticResult(result: { total: number; covered: number; coverage_pct: number; gaps: Array<{ question: string; missing_concepts: string[]; difficulty: string }> }): Promise<void> {
  const content = document.getElementById('wiki-content');
  if (!content) return;

  const gapRows = result.gaps.map(g => `
    <tr>
      <td>${escapeHtml(g.question)}</td>
      <td>${escapeHtml(g.missing_concepts.join(', '))}</td>
      <td>${g.difficulty}</td>
    </tr>
  `).join('');

  content.innerHTML = `
    <h3>🧪 诊断结果</h3>
    <div class="wiki-diag-score" style="font-size:24px;font-weight:700;color:${result.coverage_pct >= 70 ? 'var(--success)' : result.coverage_pct >= 40 ? 'var(--warning)' : 'var(--danger)'}">${result.coverage_pct}%</div>
    <p>覆盖 ${result.covered}/${result.total} 道诊断题</p>
    ${result.gaps.length ? `<h4 style="margin-top:16px">知识盲区 (${result.gaps.length})</h4>
      <table class="wiki-table"><thead><tr><th>诊断题</th><th>缺失概念</th><th>难度</th></tr></thead>
      <tbody>${gapRows}</tbody></table>` : '<div class="wiki-empty" style="margin-top:16px">所有诊断题均有对应 Wiki 页面 ✓</div>'}
  `;
}

async function renderGraphView(): Promise<void> {
  const pages = await wikiGetAllPages();
  const links = await wikiGetLinks();
  const content = document.getElementById('wiki-content');
  if (!content) return;

  content.innerHTML = `
    <h3>🕸️ 知识图谱</h3>
    <div class="wiki-graph-info">页面: ${pages.length} | 关系: ${links.length}</div>
    <canvas id="wiki-graph-canvas" width="700" height="500"></canvas>
    ${pages.length === 0 ? '<div class="wiki-empty">暂无页面，请先编译题目</div>' : ''}
  `;

  const canvas = document.getElementById('wiki-graph-canvas') as HTMLCanvasElement | null;
  if (!canvas || pages.length === 0) return;

  drawGraph(canvas, pages, links);
}

function drawGraph(
  canvas: HTMLCanvasElement,
  pages: WikiPage[],
  links: WikiLink[]
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'var(--ink)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sorted = [...pages].sort((a, b) => b.source_ids.length - a.source_ids.length);
  const shown = sorted.slice(0, 30);
  const shownIds = new Set(shown.map(p => p.id));

  const nodes = new Map<string, { id: string; x: number; y: number; label: string; color: string; r: number }>();
  shown.forEach((item, i) => {
    const angle = (2 * Math.PI * i) / shown.length;
    const radius = Math.min(canvas.width, canvas.height) * 0.38;
    nodes.set(item.id, {
      id: item.id,
      x: canvas.width / 2 + radius * Math.cos(angle),
      y: canvas.height / 2 + radius * Math.sin(angle),
      label: item.title.slice(0, 6),
      color: TYPE_COLORS[item.type] || '#888',
      r: 8 + Math.min(item.source_ids.length * 2, 12),
    });
  });

  const edges = links.filter(l => !l.deleted_at && shownIds.has(l.source_page_id) && shownIds.has(l.target_page_id));

  ctx.strokeStyle = 'var(--ink-2)';
  ctx.lineWidth = 1;
  for (const e of edges) {
    const a = nodes.get(e.source_page_id);
    const b = nodes.get(e.target_page_id);
    if (a && b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const node of nodes.values()) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.label, node.x, node.y + node.r + 12);
  }
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    auto: '<span class="badge badge-auto">自动</span>',
    human_verified: '<span class="badge badge-verified">✓ 已审</span>',
    rejected: '<span class="badge badge-rejected">✗ 拒绝</span>',
    needs_merge: '<span class="badge badge-merge">🔀 待合并</span>',
  };
  return map[status] || status;
}

export async function renderWikiForQuestion(questionId: string): Promise<string> {
  const allPages = await wikiGetAllPages();
  const related = allPages.filter(p => p.source_ids.includes(questionId));

  if (related.length === 0) {
    return `<div class="wiki-related">暂无关联知识页面</div>`;
  }

  const items = related.map(p => `
    <div class="wiki-related-item" data-id="${p.id}">
      <span class="type-badge" style="background:${TYPE_COLORS[p.type]}">${TYPE_LABELS[p.type]}</span>
      ${escapeHtml(p.title)}
    </div>
  `).join('');

  return `<div class="wiki-related"><h4>关联知识</h4>${items}</div>`;
}

export { TYPE_COLORS, TYPE_LABELS };
