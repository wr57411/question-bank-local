/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbQuestions } from '../data/stores';

const w = window as any;

export function markWrapperDone(wrapper: HTMLElement): void {
  const mainBtn = wrapper.querySelector('button');
  if (mainBtn) { mainBtn.style.background = '#22c55e'; mainBtn.style.color = '#fff'; mainBtn.style.borderColor = '#22c55e'; }
  wrapper.querySelectorAll('button').forEach(b => { b.style.pointerEvents = 'none'; });
}

export function createGeneratedTagButton(tagName: string, opts: {
  onClickNew: (tagName: string) => void;
  onClickExisting: (tag: any) => void;
}): HTMLSpanElement {
  const allTags: any[] = w.allTags;
  const exact = allTags.find((t: any) => t.name === tagName);
  const similarList = !exact ? w.findSimilarTags(tagName) : [];

  const wrapper = document.createElement('span');
  wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:2px;flex-wrap:wrap;';
  wrapper.dataset.tag = tagName;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'padding:4px 10px;font-size:11px;border-radius:12px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;';

  if (exact) {
    btn.style.border = '1px solid var(--mint)';
    btn.style.background = 'var(--mint-light)';
    btn.style.color = 'var(--mint-dark)';
    btn.innerHTML = `<span>${tagName}</span><span style="font-size:9px;background:#22c55e;color:#fff;border-radius:6px;padding:1px 4px">存</span>`;
    btn.onclick = () => opts.onClickExisting(exact);
    wrapper.appendChild(btn);
  } else {
    btn.style.border = '1px solid var(--warning)';
    btn.style.background = 'var(--warning-light)';
    btn.style.color = 'var(--warning-dark)';
    btn.textContent = tagName;
    btn.onclick = () => opts.onClickNew(tagName);
    wrapper.appendChild(btn);

    similarList.forEach((s: any) => {
      const hint = document.createElement('button');
      hint.type = 'button';
      hint.textContent = '≈' + s.tag.name;
      hint.style.cssText = 'padding:3px 8px;font-size:9px;border-radius:10px;cursor:pointer;border:1px dashed var(--warning);background:var(--warning-light);color:var(--warning-dark);opacity:.7;transition:all .15s;';
      hint.onmouseenter = () => { hint.style.opacity = '1'; hint.style.background = 'var(--sun-soft)'; };
      hint.onmouseleave = () => { hint.style.opacity = '0.7'; hint.style.background = 'var(--warning-light)'; };
      hint.onclick = (ev) => { ev.stopPropagation(); opts.onClickExisting(s.tag); };
      wrapper.appendChild(hint);
    });
  }

  btn.onmouseenter = () => { if (btn.style.background !== 'rgb(62, 213, 152)') btn.style.background = 'var(--sun-soft)'; };
  btn.onmouseleave = () => {
    if (btn.style.background === 'rgb(62, 213, 152)') return;
    btn.style.background = exact ? 'var(--mint-light)' : 'var(--warning-light)';
  };

  return wrapper;
}

export async function generateFormTagsFromComment(): Promise<void> {
  const comment = (document.getElementById('form-comment') as HTMLInputElement).value.trim();
  if (!comment) { w.showStatus('请输入评价', 'error'); return; }

  const btn = (window.event as any)?.target as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  w.stopAllPolling();

  try {
    const prompt = `请基于以下用户评价，为题目生成语义标签（JSON数组格式）。
标签范围不限，自行判断哪些语义可以作为题目特征。
只输出JSON数组，不要其他内容。

用户评价：${comment}`;

    const result = await w.callCloudAI(prompt);
    let tags: string[] = [];
    try {
      const jsonMatch = result.match(/\[[\s\S]*?\]/);
      if (jsonMatch) { tags = JSON.parse(jsonMatch[0]); }
      else { tags = result.split('\n').map((t: string) => t.trim()).filter((t: string) => t && !t.startsWith('[') && !t.startsWith(']')); }
    } catch { tags = result.split('\n').map((t: string) => t.trim()).filter((t: string) => t); }

    const container = document.getElementById('form-generated-tags-list')!;
    container.innerHTML = '';
    const allTags: any[] = w.allTags;
    const formSelectedTagIds: string[] = w.formSelectedTagIds;

    tags.forEach(tag => {
      const wrapper = createGeneratedTagButton(tag, {
        onClickNew: async (name) => {
          let t = allTags.find((x: any) => x.name === name);
          if (!t) { t = await w.dbCreateTag(name, '#F79009'); allTags.push(t); w.onFormTagSearch(); }
          if (!formSelectedTagIds.includes(t.id)) { formSelectedTagIds.push(t.id); w.renderFormSelectedTags(); }
          markWrapperDone(wrapper);
        },
        onClickExisting: (t) => {
          if (!formSelectedTagIds.includes(t.id)) { formSelectedTagIds.push(t.id); w.renderFormSelectedTags(); }
          markWrapperDone(wrapper);
        },
      });
      container.appendChild(wrapper);
    });
    document.getElementById('form-generated-tags')!.style.display = tags.length > 0 ? 'block' : 'none';
    w.showStatus(`生成了 ${tags.length} 个标签`, 'success');
  } catch (e: any) {
    w.showStatus('生成失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 生成'; }
    w.restartAllPolling();
  }
}

export async function addFormTagByName(tagName: string): Promise<void> {
  const allTags: any[] = w.allTags;
  let tag = allTags.find((t: any) => t.name === tagName);
  if (!tag) { tag = await w.dbCreateTag(tagName, '#f59e0b'); await w.loadTags(); }
  w.addFormTag(tag.id);
}

export async function removeTagFromQuestion(tagId: string): Promise<void> {
  const currentQuestionId = w.currentQuestionId;
  if (!currentQuestionId) return;
  try {
    await w.dbRemoveTagFromQuestion(currentQuestionId, tagId);
    await w.loadQuestions();
    w.showQuestionDetail(currentQuestionId);
    w.showStatus('已移除标签', 'success');
  } catch (e: any) {
    w.showStatus('移除标签失败: ' + e.message, 'error');
  }
}

export async function saveUserComment(): Promise<void> {
  const currentQuestionId = w.currentQuestionId;
  if (!currentQuestionId) return;

  const comment = (document.getElementById('user-comment') as HTMLInputElement).value.trim();
  const q = await dbQuestions.getItem<Record<string, any>>(currentQuestionId);
  if (!q) return;

  await dbQuestions.setItem(currentQuestionId, {
    ...q,
    user_comment: comment,
    updated_at: new Date().toISOString()
  });
  w._invalidateQuestionsCache();
  await w.loadQuestions();
  await w.doAutoBackup();
}

export async function analyzeSingleQuestion(): Promise<void> {
  const currentQuestionId = w.currentQuestionId;
  if (!currentQuestionId) return;

  const mode = (document.getElementById('analyze-mode') as HTMLSelectElement)?.value || 'cloud';
  const q = await dbQuestions.getItem<Record<string, any>>(currentQuestionId);
  if (!q) return;

  const btn = (window.event as any)?.target as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = '分析中...'; }

  try {
    let result: any;
    if (mode === 'cloud') {
      const prompt = '请简要描述这道题目图片的内容，包括学科和大致知识点';
      if (btn) btn.textContent = '分析中 (云端)...';
      console.log('[分析] 调用云端 API, 题目ID:', currentQuestionId, '有无图片:', !!q.question_image_url);
      result = { summary: await w.callCloudAI(prompt, q.question_image_url), difficulty: 3 };
    } else {
      const Gemma4 = w.Capacitor?.Plugins?.Gemma4;
      if (!Gemma4) { w.showStatus('请在原生 App 中使用本地模型', 'error'); return; }
      const status = await Gemma4.checkModelStatus();
      if (!status.ready) { w.showStatus('本地 AI 引擎未就绪，请先加载模型', 'error'); return; }

      const progressListener = Gemma4.addListener('analyzeProgress', (info: any) => {
        const pct = info.total > 0 ? Math.round(info.step / info.total * 100) : 0;
        if (btn) btn.textContent = '分析中 ' + pct + '% (' + info.status + ')';
      });

      try {
        result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('超时')), 600000);
          Gemma4.analyzeQuestion({ prompt: '请简要描述这张题目图片的内容，包括学科和大致知识点' })
            .then((r: any) => { clearTimeout(timer); resolve(r); })
            .catch((e: any) => { clearTimeout(timer); reject(e); });
        });
      } finally {
        progressListener.remove();
      }
    }

    q.semantic_summary = result.summary || '分析完成';
    q.ai_metadata = { difficulty: result.difficulty || 3, tags: result.tags || [], analyzed_at: new Date().toISOString(), mode };
    await dbQuestions.setItem(q.id, q);
    w._invalidateQuestionsCache();

    const aiDiv = document.getElementById('modal-ai-summary');
    const aiText = document.getElementById('modal-ai-text');
    if (aiDiv) aiDiv.style.display = 'block';
    if (aiText) aiText.textContent = q.semantic_summary;
    w.showStatus('分析完成 (' + (mode === 'cloud' ? '云端' : '本地') + ')', 'success');
  } catch (e: any) {
    w.showStatus('分析失败: ' + e.message, 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = '🧠 分析此题'; }
}

export async function handleBatchAnalyze(): Promise<void> {
  const Gemma4 = w.Capacitor?.Plugins?.Gemma4;
  if (!Gemma4) { w.showStatus('请在原生 App 中使用此功能', 'error'); return; }

  const status = await Gemma4.checkModelStatus();
  if (!status.ready) { w.showStatus('AI 引擎未就绪', 'error'); return; }

  const pending: any[] = [];
  await dbQuestions.iterate((q: any) => {
    if (q && !q.deleted_at && (!q.semantic_summary || q.semantic_summary === '' || q.semantic_summary === 'AI 正在分析中...')) {
      pending.push(q);
    }
  });

  if (pending.length === 0) { w.showStatus('所有题目已分析完成', 'success'); return; }

  const btn = document.getElementById('ai-batch-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '分析中 (0/' + pending.length + ')...';
  w.showStatus('开始批量分析 ' + pending.length + ' 道题目...', 'success');

  let done = 0;
  for (const q of pending) {
    try {
      const img = q.question_image_url || '';
      if (!img || !img.startsWith('data:')) { done++; continue; }

      const result: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('超时')), 600000);
        Gemma4.analyzeQuestion({ prompt: '请简要描述这张题目图片的内容，包括学科和大致知识点' })
          .then((r: any) => { clearTimeout(timer); resolve(r); })
          .catch((e: any) => { clearTimeout(timer); reject(e); });
      });

      q.semantic_summary = result.summary || '分析完成';
      q.ai_metadata = {
        difficulty: result.difficulty || 3,
        tags_suggested: result.tags || [],
        analyzed_at: new Date().toISOString()
      };
      await dbQuestions.setItem(q.id, q);
      w._invalidateQuestionsCache();
      done++;
    } catch (e: any) {
      btn.disabled = false;
      btn.textContent = '🧠 批量分析已有题目';
      w.showStatus('第 ' + (done + 1) + ' 道题分析失败: ' + e.message, 'error');
      return;
    }
    btn.textContent = '分析中 (' + done + '/' + pending.length + ')...';
  }

  btn.disabled = false;
  btn.textContent = '🧠 批量分析已有题目';
  w.showStatus('分析完成: ' + done + ' 道题全部成功', 'success');
  await w.loadQuestions();
}
