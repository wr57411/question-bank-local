import { dbGetAllQuestions } from '../data/questions';
import { wikiMvpListSessions, wikiMvpSaveSession, wikiMvpDeleteSession as wikiMvpDeleteSessionRecord } from '../data/wiki-mvp';
import { extractKnowledgeFromQuestions, WIKI_MVP_DEFAULT_MODELS, WIKI_MVP_OCR_MODELS, getWikiSystemPrompt, setWikiSystemPrompt, getLlmBaseUrl, setLlmBaseUrl } from '../services/wiki-mvp';
import { checkOcrHealth, getOcrServerUrl, setOcrServerUrl } from '../services/local-ocr';
import type { Question, WikiMvpSession } from '../types';

let mvpQuestions: Question[] = [];
let mvpSelected = new Set<string>();
let mvpSession: WikiMvpSession | null = null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function showWikiTabMvp(btn?: HTMLElement): void {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('div[id$="-tab"]').forEach(t => t.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  const wikiTab = document.getElementById('wiki-tab');
  if (wikiTab) wikiTab.classList.remove('hidden');
  void renderWikiMvpPanel();
}

export async function renderWikiMvpPanel(): Promise<void> {
  const container = document.getElementById('wiki-content');
  if (!container) return;
  container.innerHTML = `
<style>
.mvp-wrap{display:flex;flex-direction:column;gap:16px;padding:16px;max-width:900px;margin:0 auto}
.mvp-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.mvp-head h3{margin:0;font-size:17px}
.mvp-sessions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.mvp-sessions select{max-width:260px;padding:6px 8px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px}
.mvp-card{background:var(--bg-card,#fff);border:1.5px solid var(--border);border-radius:var(--radius-md);padding:14px}
.mvp-card h4{margin:0 0 10px;font-size:14px}
.mvp-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.mvp-toolbar input[type=text]{flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px}
.mvp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;max-height:340px;overflow-y:auto}
.mvp-qitem{position:relative;border:1.5px solid var(--border);border-radius:var(--radius-md);overflow:hidden;cursor:pointer;transition:border-color .15s}
.mvp-qitem.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(157,123,255,.2)}
.mvp-qitem img{width:100%;height:90px;object-fit:cover;display:block;background:var(--surface-dim)}
.mvp-qitem .noimg{width:100%;height:90px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-tertiary);background:var(--surface-dim);text-align:center;padding:4px;box-sizing:border-box}
.mvp-qitem .qmeta{padding:6px 8px;font-size:11px;color:var(--text-secondary,#666);line-height:1.5}
.mvp-qitem .qcheck{position:absolute;top:6px;left:6px;width:20px;height:20px;accent-color:var(--accent)}
.mvp-count{font-size:12px;color:var(--text-secondary,#666)}
.mvp-config{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mvp-config select{padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px}
.mvp-config input{flex:1;min-width:180px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px}
.mvp-run{padding:10px 22px;font-size:14px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius-md);cursor:pointer;box-shadow:0 6px 16px rgba(157,123,255,.3)}
.mvp-run:disabled{opacity:.55;cursor:not-allowed}
.mvp-status{padding:10px 12px;border-radius:var(--radius-md);font-size:13px;display:none}
.mvp-status.show{display:block}
.mvp-status.err{background:var(--danger-light);color:var(--danger-dark);border:none}
.mvp-status.ok{background:var(--mint-light);color:var(--mint-dark);border:none}
.mvp-status.info{background:var(--sky-light);color:var(--sky-dark);border:none}
.concept-card{border:1.5px solid var(--border);border-radius:var(--radius-md);background:var(--bg-card,#fff);overflow:hidden}
.concept-card.hl{border-color:var(--accent);box-shadow:0 0 0 2px rgba(157,123,255,.25)}
.concept-head{padding:12px 14px;cursor:pointer;display:flex;flex-direction:column;gap:4px}
.concept-head .ct{font-size:15px;font-weight:600}
.concept-head .cd{font-size:13px;color:var(--text-secondary,#666)}
.concept-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;margin-bottom:4px}
.badge-hard{background:var(--danger-light);color:var(--danger-dark)}
.badge-key{background:var(--warning-light);color:var(--warning-dark)}
.badge-method{background:var(--sky-light);color:var(--sky-dark)}
.badge-base{background:var(--surface-dim);color:var(--text-secondary)}
.concept-pit{display:flex;gap:6px;align-items:flex-start;margin:3px 0;color:var(--danger-dark)}
.concept-pit::before{content:'⚠️';flex-shrink:0}
.concept-links{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 10px}
.link-chip{font-size:12px;padding:4px 9px;border-radius:14px;background:var(--accent-light);color:var(--accent-dark);cursor:pointer;border:none}
.link-chip:hover{filter:brightness(.96)}
.link-chip b{font-weight:600}
.concept-detail{display:none;border-top:1px dashed var(--border);padding:12px 14px;font-size:13px;line-height:1.8;color:var(--text)}
.concept-detail.open{display:block}
.concept-detail .sec-label{font-size:12px;font-weight:600;color:var(--text-secondary,#666);margin:8px 0 3px}
.concept-detail blockquote{margin:4px 0;padding:6px 10px;border-left:3px solid var(--border);background:var(--surface-dim);color:var(--text-secondary);border-radius:0 var(--radius-sm,6px) var(--radius-sm,6px) 0}
.mvp-empty{text-align:center;color:var(--text-tertiary);padding:30px 0;font-size:13px}
</style>
<div class="mvp-wrap">
  <div class="mvp-head">
    <h3>🧠 知识点提取</h3>
    <div class="mvp-sessions">
      <select id="mvp-session-select" onchange="window.wikiMvpLoadSession()"><option value="">— 历史记录 —</option></select>
      <button class="secondary" style="font-size:12px" onclick="window.wikiMvpLoadSession()">查看</button>
      <button class="danger" style="font-size:12px" onclick="window.wikiMvpDeleteSession()">删除</button>
    </div>
  </div>
  <div class="mvp-card">
    <h4>① 选择题目（可多选，含图片的题目会自动交给视觉模型）</h4>
    <div class="mvp-toolbar">
      <input type="text" id="mvp-search" placeholder="搜索书名 / 页码 / 题号 / 摘要…" oninput="window.wikiMvpRenderQuestions()" />
      <button class="secondary" style="font-size:12px" onclick="window.wikiMvpSelectAll()">全选</button>
      <button class="secondary" style="font-size:12px" onclick="window.wikiMvpClearAll()">清空</button>
      <span class="mvp-count" id="mvp-count"></span>
    </div>
    <div class="mvp-grid" id="mvp-qgrid"></div>
  </div>
  <div class="mvp-card">
    <h4>② 选择提取方式与模型</h4>
    <div class="mvp-config">
      <select id="mvp-mode" onchange="window.wikiMvpChangeMode()">
        <option value="vision">视觉模型（图片直传）</option>
        <option value="ocr">本地OCR + 纯文本LLM</option>
      </select>
      <select id="mvp-model" onchange="window.wikiMvpSyncModelInput()"></select>
      <input type="text" id="mvp-model-input" placeholder="自定义模型 ID（留空 = 使用下拉所选）" />
      <button class="mvp-run" id="mvp-run-btn" onclick="window.wikiMvpRunExtract()">提取知识点</button>
    </div>
    <div style="font-size:12px;color:var(--text-secondary,#666);margin-top:6px">模型优先级：手动输入非空时使用手动输入的模型，否则使用下拉框所选。切换下拉框会清空手动输入。</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:13px">
      <span>Base URL</span>
      <input type="text" id="mvp-base-url" placeholder="留空 = 使用 AI 设置中的服务商地址（如 https://openrouter.ai/api/v1）" onchange="window.wikiMvpSyncBaseUrl()" style="flex:1;min-width:220px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px" />
    </div>
    <details style="margin-top:8px;font-size:13px">
      <summary style="cursor:pointer;color:var(--text-secondary,#666)">⚙️ 提示词设置（高级）</summary>
      <textarea id="mvp-prompt" rows="9" style="width:100%;margin-top:8px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:12px;line-height:1.6;font-family:inherit;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap">
        <button class="secondary" style="font-size:12px" onclick="window.wikiMvpSavePrompt()">保存提示词</button>
        <button class="secondary" style="font-size:12px" onclick="window.wikiMvpResetPrompt()">恢复默认</button>
        <span style="font-size:12px;color:#888">提示词需让模型输出 JSON：{"concepts": [{"title": ..., "definition": ...}]}</span>
      </div>
    </details>
    <div id="mvp-ocr-config" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px">
        <span>OCR 服务地址</span>
        <input type="text" id="mvp-ocr-url" placeholder="http://localhost:8765" onchange="window.wikiMvpSyncOcrInput()" style="flex:1;min-width:180px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px" />
        <button class="secondary" style="font-size:12px" onclick="window.wikiMvpTestOcrConnection()">测试连接</button>
      </div>
      <div id="mvp-ocr-hint" style="font-size:12px;color:var(--text-secondary,#666);margin-top:6px;line-height:1.6"></div>
    </div>
  </div>
  <div class="mvp-status" id="mvp-status"></div>
  <div id="mvp-result"></div>
</div>`;
  await Promise.all([loadQuestions(), refreshSessionSelect()]);
  const modeSelect = document.getElementById('mvp-mode') as HTMLSelectElement | null;
  if (modeSelect) modeSelect.value = localStorage.getItem('wiki_mvp_mode') === 'ocr' ? 'ocr' : 'vision';
  const ocrInput = document.getElementById('mvp-ocr-url') as HTMLInputElement | null;
  if (ocrInput) ocrInput.value = getOcrServerUrl();
  const baseUrlInput = document.getElementById('mvp-base-url') as HTMLInputElement | null;
  if (baseUrlInput) baseUrlInput.value = getLlmBaseUrl();
  const promptArea = document.getElementById('mvp-prompt') as HTMLTextAreaElement | null;
  if (promptArea) promptArea.value = getWikiSystemPrompt();
  wikiMvpChangeMode();
  wikiMvpRenderQuestions();
  if (mvpSession) renderConcepts(mvpSession);
}

async function loadQuestions(): Promise<void> {
  mvpQuestions = await dbGetAllQuestions();
  mvpSelected = new Set(mvpSelected);
  mvpSelected.forEach(id => {
    if (!mvpQuestions.some(q => q.id === id)) mvpSelected.delete(id);
  });
}

function currentMode(): 'vision' | 'ocr' {
  const select = document.getElementById('mvp-mode') as HTMLSelectElement | null;
  return select?.value === 'ocr' ? 'ocr' : 'vision';
}

function syncModelSelect(): void {
  const select = document.getElementById('mvp-model') as HTMLSelectElement | null;
  if (!select) return;
  const models = currentMode() === 'ocr' ? WIKI_MVP_OCR_MODELS : WIKI_MVP_DEFAULT_MODELS;
  select.innerHTML = models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
}

export function wikiMvpChangeMode(): void {
  localStorage.setItem('wiki_mvp_mode', currentMode());
  const ocrConfig = document.getElementById('mvp-ocr-config');
  if (ocrConfig) ocrConfig.style.display = currentMode() === 'ocr' ? 'block' : 'none';
  syncModelSelect();
  const input = document.getElementById('mvp-model-input') as HTMLInputElement | null;
  if (input) input.value = '';
}

export function wikiMvpSyncOcrInput(): void {
  const input = document.getElementById('mvp-ocr-url') as HTMLInputElement | null;
  if (input) setOcrServerUrl(input.value);
}

export function wikiMvpSyncBaseUrl(): void {
  const input = document.getElementById('mvp-base-url') as HTMLInputElement | null;
  if (input) setLlmBaseUrl(input.value);
}

export function wikiMvpSavePrompt(): void {
  const area = document.getElementById('mvp-prompt') as HTMLTextAreaElement | null;
  if (!area) return;
  setWikiSystemPrompt(area.value);
  setStatus('提示词已保存，下次提取生效', 'ok');
}

export function wikiMvpResetPrompt(): void {
  const area = document.getElementById('mvp-prompt') as HTMLTextAreaElement | null;
  if (!area) return;
  setWikiSystemPrompt('');
  area.value = getWikiSystemPrompt();
  setStatus('已恢复默认提示词', 'ok');
}

export async function wikiMvpTestOcrConnection(): Promise<void> {
  const hint = document.getElementById('mvp-ocr-hint');
  if (!hint) return;
  const url = getOcrServerUrl();
  hint.textContent = '正在连接…';
  hint.style.color = 'var(--text-secondary,#666)';
  try {
    const health = await checkOcrHealth(url);
    if (health.status === 'ready') {
      hint.textContent = `连接成功：文字OCR ${health.engines?.paddle ? '✓' : '✗'} / 公式识别 ${health.engines?.unimer ? '✓' : '✗'}`;
      hint.style.color = 'var(--mint-dark)';
    } else if (health.status === 'error') {
      hint.textContent = `服务可达但引擎异常：${JSON.stringify(health.errors || {})}`;
      hint.style.color = 'var(--danger-dark)';
    } else {
      hint.textContent = `服务可达，引擎${health.status === 'loading' ? '正在加载模型' : '未加载'}（首次提取自动加载，需 10~30 秒）`;
      hint.style.color = 'var(--warning-dark)';
    }
  } catch {
    hint.textContent = `无法连接 ${url}，请确认已启动：cd ocr-server && ./start.sh`;
    hint.style.color = 'var(--danger-dark)';
  }
}

export function wikiMvpSyncModelInput(): void {
  const input = document.getElementById('mvp-model-input') as HTMLInputElement | null;
  if (input) input.value = '';
}

function currentModel(): string {
  const input = document.getElementById('mvp-model-input') as HTMLInputElement | null;
  const custom = input?.value?.trim();
  if (custom) return custom;
  const select = document.getElementById('mvp-model') as HTMLSelectElement | null;
  return select?.value || WIKI_MVP_DEFAULT_MODELS[0];
}

function setStatus(text: string, kind: 'err' | 'ok' | 'info'): void {
  const el = document.getElementById('mvp-status');
  if (!el) return;
  el.className = `mvp-status show ${kind}`;
  el.textContent = text;
}

export function wikiMvpRenderQuestions(): void {
  const grid = document.getElementById('mvp-qgrid');
  const search = document.getElementById('mvp-search') as HTMLInputElement | null;
  const count = document.getElementById('mvp-count');
  if (!grid) return;
  const kw = (search?.value || '').trim().toLowerCase();
  const filtered = mvpQuestions.filter(q => {
    if (!kw) return true;
    return [q.book_name, q.page_number, q.question_number, q.semantic_summary, q.user_comment]
      .filter(Boolean)
      .some(v => (v as string).toLowerCase().includes(kw));
  });
  if (count) count.textContent = `已选 ${mvpSelected.size} / ${mvpQuestions.length} 题`;
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="mvp-empty" style="grid-column:1/-1">没有匹配的题目</div>';
    return;
  }
  grid.innerHTML = filtered
    .map(q => {
      const meta = [q.book_name, q.page_number && `p.${q.page_number}`, q.question_number && `#${q.question_number}`]
        .filter(Boolean)
        .join(' · ');
      const thumb = q.question_image_url
        ? `<img src="${esc(q.question_image_url)}" loading="lazy" alt="" onerror="window.wikiMvpImgError(this)" />`
        : `<div class="noimg">${esc(q.semantic_summary || '无图片题目')}</div>`;
      return `<div class="mvp-qitem ${mvpSelected.has(q.id) ? 'sel' : ''}" onclick="window.wikiMvpToggleQuestion('${q.id}')">
        ${thumb}
        <div class="qmeta">${esc(meta || '未标注来源')}</div>
        <input type="checkbox" class="qcheck" ${mvpSelected.has(q.id) ? 'checked' : ''} onchange="window.wikiMvpToggleQuestion('${q.id}')" />
      </div>`;
    })
    .join('');
}

export function wikiMvpImgError(img: HTMLImageElement): void {
  const div = document.createElement('div');
  div.className = 'noimg';
  div.textContent = '图片无法显示';
  img.replaceWith(div);
}

export function wikiMvpToggleQuestion(id: string): void {
  if (mvpSelected.has(id)) mvpSelected.delete(id);
  else mvpSelected.add(id);
  wikiMvpRenderQuestions();
}

export function wikiMvpSelectAll(): void {
  mvpQuestions.forEach(q => mvpSelected.add(q.id));
  wikiMvpRenderQuestions();
}

export function wikiMvpClearAll(): void {
  mvpSelected.clear();
  wikiMvpRenderQuestions();
}

export async function wikiMvpRunExtract(): Promise<void> {
  const selected = mvpQuestions.filter(q => mvpSelected.has(q.id));
  if (selected.length === 0) {
    setStatus('请先选择至少一道题目', 'err');
    return;
  }
  const mode = currentMode();
  const model = currentModel();
  const ocrUrl = getOcrServerUrl();
  if (mode === 'ocr' && !ocrUrl) {
    setStatus('请先配置 OCR 服务地址', 'err');
    return;
  }
  const btn = document.getElementById('mvp-run-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  const modeLabel = mode === 'ocr' ? `（本地OCR → ${model}）` : `（模型：${model}）`;
  const startedAt = Date.now();
  let lastUiUpdate = 0;
  setStatus(
    `正在${mode === 'ocr' ? 'OCR 识别并' : ''}提取 ${selected.length} 道题的知识点${modeLabel}，${mode === 'ocr' ? '首次需加载模型 10~30 秒，' : ''}通常需要 10~60 秒，免费档大模型可能需 1~3 分钟…`,
    'info'
  );
  try {
    const result = await extractKnowledgeFromQuestions(selected, model, {
      mode,
      ocrBaseUrl: mode === 'ocr' ? ocrUrl : undefined,
      onToken: (text: string) => {
        const now = Date.now();
        if (now - lastUiUpdate < 200) return;
        lastUiUpdate = now;
        const seconds = Math.round((now - startedAt) / 1000);
        setStatus(`正在生成知识（已生成 ${text.length} 字，用时 ${seconds}s）…`, 'info');
      },
    });
    const session = await wikiMvpSaveSession({
      id: '',
      created_at: '',
      model: result.model_used,
      question_ids: selected.map(q => q.id),
      question_count: selected.length,
      concepts: result.concepts,
      raw_response: result.raw_response,
    });
    mvpSession = session;
    renderConcepts(session);
    setStatus(`提取完成：${session.concepts.length} 个概念（模型 ${result.model_used}，耗时 ${Math.round(result.elapsed_ms / 1000)}s），已自动保存`, 'ok');
    await refreshSessionSelect();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function badgeClass(category: string): string {
  switch (category) {
    case '核心难点': return 'badge-hard';
    case '重要考点': return 'badge-key';
    case '解题方法': return 'badge-method';
    default: return 'badge-base';
  }
}

function renderConcepts(session: WikiMvpSession): void {
  const result = document.getElementById('mvp-result');
  if (!result) return;
  if (session.concepts.length === 0) {
    result.innerHTML = '<div class="mvp-empty">未提取到概念</div>';
    return;
  }
  result.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px">
  <h4 style="margin:0;font-size:14px">③ 知识结构（${session.concepts.length} 个概念，点击概念查看详情，点击链接跳转）</h4>
  <span style="font-size:12px;color:var(--text-secondary,#666)">${esc(new Date(session.created_at).toLocaleString())} · ${session.question_count} 题 · ${esc(session.model)}</span>
</div>
<div style="display:flex;flex-direction:column;gap:10px">
${session.concepts.map((c, i) => {
  const links = (c.links || [])
    .map(l => `<button class="link-chip" onclick="window.wikiMvpJumpToConcept('${esc(l.target)}')"><b>${esc(l.target)}</b> ← ${esc(l.relation)}</button>`)
    .join('');
  const quotes = (c.quotes || []).map(q => `<blockquote>${esc(q)}</blockquote>`).join('');
  const pitfalls = (c.pitfalls || []).map(p => `<div class="concept-pit">${esc(p)}</div>`).join('');
  return `<div class="concept-card" id="cc-${i}">
    <div class="concept-head" onclick="window.wikiMvpToggleConcept(${i})">
      <span class="concept-badge ${badgeClass(c.category)}">${esc(c.category)}</span>
      <span class="ct">${esc(c.title)}</span>
      <span class="cd">${esc(c.definition)}</span>
    </div>
    <div class="concept-links">${links || '<span style="font-size:12px;color:#bbb">无链接</span>'}</div>
    <div class="concept-detail" id="cd-${i}">
      <div class="sec-label">📖 详解</div>
      <div>${esc(c.explanation)}</div>
      ${c.exam_point ? `<div class="sec-label">🎯 高考命题视角</div><div>${esc(c.exam_point)}</div>` : ''}
      ${pitfalls ? `<div class="sec-label">🚨 易错陷阱</div>${pitfalls}` : ''}
      ${c.analogy ? `<div class="sec-label">💡 类比</div><div>${esc(c.analogy)}</div>` : ''}
      ${quotes ? `<div class="sec-label">📎 题目依据</div>${quotes}` : ''}
    </div>
  </div>`;
}).join('')}
</div>`;
}

export function wikiMvpToggleConcept(index: number): void {
  const detail = document.getElementById(`cd-${index}`);
  if (detail) detail.classList.toggle('open');
}

export function wikiMvpJumpToConcept(title: string): void {
  if (!mvpSession) return;
  const index = mvpSession.concepts.findIndex(c => c.title === title);
  if (index === -1) {
    setStatus(`概念「${title}」不在当前结果中`, 'err');
    return;
  }
  const card = document.getElementById(`cc-${index}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('hl');
  setTimeout(() => card.classList.remove('hl'), 1800);
}

async function refreshSessionSelect(): Promise<void> {
  const select = document.getElementById('mvp-session-select') as HTMLSelectElement | null;
  if (!select) return;
  const sessions = await wikiMvpListSessions();
  const current = select.value || (mvpSession ? mvpSession.id : '');
  select.innerHTML =
    '<option value="">— 历史记录 —</option>' +
    sessions
      .map(s => `<option value="${esc(s.id)}">${esc(new Date(s.created_at).toLocaleString())} · ${s.question_count}题 · ${s.concepts.length}概念</option>`)
      .join('');
  if (current) select.value = current;
}

export async function wikiMvpLoadSession(): Promise<void> {
  const select = document.getElementById('mvp-session-select') as HTMLSelectElement | null;
  if (!select || !select.value) return;
  const session = (await wikiMvpListSessions()).find(s => s.id === select.value) || null;
  mvpSession = session;
  if (session) {
    renderConcepts(session);
    setStatus(`已加载历史记录：${session.concepts.length} 个概念（${session.model}）`, 'ok');
  }
}

export async function wikiMvpDeleteSession(): Promise<void> {
  const select = document.getElementById('mvp-session-select') as HTMLSelectElement | null;
  if (!select || !select.value) return;
  if (!window.confirm('删除这条知识记录？')) return;
  await wikiMvpDeleteSessionRecord(select.value);
  mvpSession = null;
  document.getElementById('mvp-result')!.innerHTML = '';
  await refreshSessionSelect();
}
