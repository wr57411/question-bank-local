/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// Module-level state
let similarCandidates: any[] = [];
let similarAiReasons: Map<string, string> = new Map();

// Expose _detailLoadToken on window (note-version.ts reads/writes it)
w._detailLoadToken = 0;

export function showQuestionDetail(qId: string): void {
  w.currentQuestionId = qId;
  w.filteredList = w.getFilteredQuestions();
  w.detailIndex = w.filteredList.findIndex((q: any) => q.id === qId);
  if (w.detailIndex < 0) w.detailIndex = 0;
  renderDetailContent(w.filteredList[w.detailIndex]);
  document.getElementById('question-modal')!.classList.add('active');
  w.updatePendingLinkBtnStyle(qId);
}

export function renderDetailContent(q: any): void {
  w._detailLoadToken++;
  document.getElementById('modal-question-image')!.innerHTML = '<div style="text-align:center;padding:20px"><p style="color:var(--text-tertiary)">加载中...</p></div>';
  w.loadNoteVersionsForDetail(q.id);

  document.getElementById('modal-answer-image')!.innerHTML = q.answer_image_url ? '<h3 style="margin-top:12px">答案</h3><img src="' + q.answer_image_url + '" style="max-width:100%;border-radius:var(--radius-sm)">' : '<p style="color:var(--text-tertiary);margin-top:12px">无答案图片</p>';
  const tags = q.question_tags.map((qt: any) => qt.tags);
  document.getElementById('modal-tags')!.innerHTML = tags.length ? '<h3 style="margin-top:12px">标签（点击移除）</h3><div class="tag-container">' + tags.map((t: any) => '<span class="tag" style="background:' + t.color + '20;border:1px solid ' + t.color + ';cursor:pointer" onclick="removeTagFromQuestion(\'' + t.id + '\')">' + t.name + ' ✕</span>').join('') + '</div>' : '';

  // 版本归属编辑
  const versions = q.versions || [];
  const allVersions = w.getAppVersions();
  let versionHtml = '<h3 style="margin-top:12px">适用版本</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
  allVersions.forEach((v: any) => {
    const checked = versions.includes(v.id);
    versionHtml += `<div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border:1.5px solid ${checked ? v.theme.primary : 'var(--border)'};border-radius:var(--radius-md);cursor:pointer;font-size:12px;transition:border-color .2s,background-color .2s;background:${checked ? v.theme.primaryLight : 'var(--surface)'}" onclick="if(event.target.tagName!=='INPUT'){var cb=this.querySelector('input');cb.checked=!cb.checked;var p=cb.parentElement;p.style.borderColor=cb.checked?'${v.theme.primary}':'var(--border)';p.style.background=cb.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',cb.checked)}"><input type="checkbox" onchange="var p=this.parentElement;p.style.borderColor=this.checked?'${v.theme.primary}':'var(--border)';p.style.background=this.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',this.checked)" ${checked ? 'checked' : ''} style="accent-color:${v.theme.primary};width:18px;height:18px;cursor:pointer;flex-shrink:0"><span>${v.emoji} ${v.name}</span></div>`;
  });
  versionHtml += '</div><small style="color:var(--text-secondary);font-size:11px">不勾选则所有版本均可见</small>';
  document.getElementById('modal-tags')!.innerHTML += versionHtml;

  // 书本信息编辑
  const bookHtml = `<h3 style="margin-top:12px">📖 书本信息</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <input id="detail-book-name" placeholder="书名" value="${q.book_name || ''}" style="flex:2;min-width:100px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
      <input id="detail-page-number" placeholder="页码" value="${q.page_number || ''}" style="flex:1;min-width:60px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
      <input id="detail-question-number" placeholder="题号" value="${q.question_number || ''}" style="flex:1;min-width:60px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" />
    </div>
    <button onclick="saveBookInfo('${q.id}')" style="margin-top:8px;padding:6px 14px;font-size:12px">保存书本信息</button>`;
  document.getElementById('modal-tags')!.innerHTML += bookHtml;

  // 复习提醒开关
  const reviewEnabled = q.review_enabled || false;
  const reviewNextDate = q.review_next_date || '未设置';
  const reviewCount = q.review_count || 0;
  const reviewHtml = `<h3 style="margin-top:12px">🧠 复习提醒</h3>
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
        <input type="checkbox" ${reviewEnabled ? 'checked' : ''} onchange="toggleReviewForQuestion('${q.id}')" style="accent-color:var(--accent);width:18px;height:18px;cursor:pointer" />
        开启艾宾浩斯复习提醒
      </label>
    </div>
    ${reviewEnabled ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">已复习 ${reviewCount} 次 · 下次复习: ${reviewNextDate}</div>` : ''}`;
  document.getElementById('modal-tags')!.innerHTML += reviewHtml;

  renderSimilarQuestions(q.id);
  // AI 摘要
  const aiDiv = document.getElementById('modal-ai-summary')!;
  const aiText = document.getElementById('modal-ai-text')!;
  if (q.semantic_summary && q.semantic_summary !== '' && q.semantic_summary !== 'AI 正在分析中...') {
    aiDiv.style.display = 'block';
    aiText.textContent = q.semantic_summary;
  } else {
    aiDiv.style.display = 'none';
  }
  // 用户评价
  const userComment = q.user_comment || '';
  const commentInput = document.getElementById('user-comment') as HTMLInputElement | null;
  if (commentInput && document.activeElement !== commentInput) {
    commentInput.value = userComment;
  }
  document.getElementById('detail-nav-info')!.textContent = (w.detailIndex + 1) + ' / ' + w.filteredList.length;
  (document.getElementById('btn-prev') as HTMLButtonElement).disabled = w.detailIndex <= 0;
  document.getElementById('btn-prev')!.style.opacity = w.detailIndex <= 0 ? '0.4' : '1';
  (document.getElementById('btn-next') as HTMLButtonElement).disabled = w.detailIndex >= w.filteredList.length - 1;
  document.getElementById('btn-next')!.style.opacity = w.detailIndex >= w.filteredList.length - 1 ? '0.4' : '1';
  updateDetailBasketBtn(q.id);
}

export async function toggleQuestionVersion(questionId: string, versionId: string, checked: boolean): Promise<void> {
  const q = await w.dbQuestions.getItem(questionId);
  if (!q) return;
  let versions = q.versions || [];
  if (checked) { if (!versions.includes(versionId)) versions.push(versionId); }
  else { versions = versions.filter((v: string) => v !== versionId); }
  await w.dbUpdateQuestionVersions(questionId, versions);
  await w.loadQuestions();
  w.showStatus('版本归属已更新', 'success');
}

export async function saveBookInfo(questionId: string): Promise<void> {
  const bookName = (document.getElementById('detail-book-name') as HTMLInputElement).value.trim();
  const pageNumber = (document.getElementById('detail-page-number') as HTMLInputElement).value.trim();
  const questionNumber = (document.getElementById('detail-question-number') as HTMLInputElement).value.trim();
  await w.dbUpdateQuestionBookInfo(questionId, { book_name: bookName, page_number: pageNumber, question_number: questionNumber });
  await w.loadQuestions();
  await w.loadBookFilter();
  w.showStatus('书本信息已保存', 'success');
}

export function updateDetailBasketBtn(qId: string): void {
  const btn = document.getElementById('detail-basket-btn')!;
  if (w.questionBasket.has(qId)) { btn.textContent = '✓'; btn.style.background = 'var(--sky)'; btn.style.color = '#fff'; }
  else { btn.textContent = '🧺'; btn.style.background = 'rgba(255,255,255,.9)'; btn.style.color = 'var(--text)'; }
}

export function toggleBasketInDetail(): void {
  if (!w.currentQuestionId) return;
  w.toggleBasket(w.currentQuestionId);
  updateDetailBasketBtn(w.currentQuestionId);
  w.renderQuestions();
}

export function navigateDetail(dir: number): void {
  const ni = w.detailIndex + dir;
  if (ni < 0 || ni >= w.filteredList.length) return;
  w.detailIndex = ni;
  w.currentQuestionId = w.filteredList[ni].id;
  renderDetailContent(w.filteredList[ni]);
}

export function closeQuestionModal(): void {
  document.getElementById('question-modal')!.classList.remove('active');
  w.currentQuestionId = null;
}

export async function renderSimilarQuestions(qId: string): Promise<void> {
  const wrap = document.getElementById('modal-similar-questions');
  if (!wrap) return;
  const ids = await w.dbGetSimilarQuestionIds(qId);
  const questions = w.allQuestions.filter((q: any) => ids.includes(q.id));
  wrap.replaceChildren();
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
  const title = document.createElement('h3');
  title.style.cssText = 'margin:0;font-size:16px';
  title.textContent = '相似题' + (questions.length ? '（' + questions.length + '）' : '');
  const add = document.createElement('button');
  add.textContent = '添加相似题';
  add.style.cssText = 'padding:6px 12px;font-size:12px';
  add.onclick = openSimilarModal;
  head.append(title, add);
  wrap.appendChild(head);
  if (!questions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--text-secondary);padding:8px;background:var(--surface-dim);border-radius:var(--radius-sm)';
    empty.textContent = '暂无相似题关联';
    wrap.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'similar-list';
  questions.forEach((q: any) => {
    const card = document.createElement('div');
    card.className = 'similar-card';
    card.onclick = () => showQuestionDetail(q.id);
    const img = document.createElement('img');
    img.src = q.question_image_url;
    img.style.cursor = 'pointer';
    img.onclick = (e) => {
      e.preventDefault();
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
      overlay.onclick = () => overlay.remove();
      const big = document.createElement('img');
      big.src = q.question_image_url;
      big.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--radius-sm)';
      overlay.appendChild(big);
      document.body.appendChild(overlay);
    };
    const titleEl = document.createElement('div');
    titleEl.className = 'similar-title';
    titleEl.textContent = q.user_comment || q.semantic_summary || q.question_tags.map((qt: any) => qt.tags.name).join('、') || '相似题';
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.style.cssText = 'width:100%;padding:5px 8px;font-size:11px;margin-top:6px';
    remove.textContent = '移除关联';
    remove.onclick = async (event) => {
      event.stopPropagation();
      await w.dbRemoveSimilarQuestionLink(qId, q.id);
      await w.loadQuestions();
      await renderSimilarQuestions(qId);
      w.showStatus('已移除相似题关联', 'success');
    };
    card.append(img, titleEl, remove);
    list.appendChild(card);
  });
  wrap.appendChild(list);
}

export function getQuestionFeatureText(q: any): string {
  return [q.user_comment || '', q.semantic_summary || '', q.question_tags?.map((qt: any) => qt.tags.name).join(' ') || ''].join(' ');
}

export function getTextSignalSet(text: string): Set<string> {
  return new Set(String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('').filter(ch => ch.trim()));
}

export function scoreTextSimilarity(a: string, b: string): number {
  const left = getTextSignalSet(a), right = getTextSignalSet(b);
  if (!left.size || !right.size) return 0;
  let score = 0;
  left.forEach(ch => { if (right.has(ch)) score++; });
  return score;
}

export async function buildSimilarCandidates(): Promise<any[]> {
  if (!w.currentQuestionId) return [];
  const current = w.allQuestions.find((q: any) => q.id === w.currentQuestionId);
  if (!current) return [];
  const selectedTagIds = Array.from((document.getElementById('similar-tag-select') as HTMLSelectElement).selectedOptions).map(o => o.value);
  const linkedIds = await w.dbGetSimilarQuestionIds(w.currentQuestionId);
  const currentText = getQuestionFeatureText(current);
  return w.allQuestions
    .filter((q: any) => q.id !== w.currentQuestionId && !linkedIds.includes(q.id))
    .map((q: any) => {
      const tagIds = q.question_tags.map((qt: any) => qt.tags.id);
      const tagHit = selectedTagIds.filter(id => tagIds.includes(id)).length;
      const textHit = scoreTextSimilarity(currentText, getQuestionFeatureText(q));
      return { q, tagHit, textHit, score: tagHit * 20 + Math.min(textHit, 20) };
    })
    .filter((item: any) => !selectedTagIds.length || item.tagHit > 0)
    .sort((a: any, b: any) => b.score - a.score || new Date(b.q.created_at).getTime() - new Date(a.q.created_at).getTime());
}

export async function openSimilarModal(): Promise<void> {
  if (!w.currentQuestionId) return;
  const current = w.allQuestions.find((q: any) => q.id === w.currentQuestionId);
  const sel = document.getElementById('similar-tag-select') as HTMLSelectElement;
  sel.replaceChildren();
  const currentTagIds = new Set((current?.question_tags || []).map((qt: any) => qt.tags.id));
  w.allTags.forEach((tag: any) => {
    const option = document.createElement('option');
    option.value = tag.id;
    option.textContent = tag.name;
    option.selected = currentTagIds.has(tag.id);
    sel.appendChild(option);
  });
  similarAiReasons = new Map();
  document.getElementById('similar-ai-reason')!.style.display = 'none';
  document.getElementById('similar-modal')!.classList.add('active');
  document.getElementById('btn-pending-similar-count')!.textContent = String(w.getPendingLinkList().length);
  await renderSimilarCandidates();
}

export function closeSimilarModal(): void {
  document.getElementById('similar-modal')!.classList.remove('active');
  similarCandidates = [];
  similarAiReasons = new Map();
}

export async function renderSimilarCandidates(aiPickedIds: string[] | null = null): Promise<void> {
  similarCandidates = await buildSimilarCandidates();
  const list = document.getElementById('similar-candidate-list')!;
  list.replaceChildren();
  if (!similarCandidates.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 12px';
    empty.textContent = '没有找到可关联的候选题';
    list.appendChild(empty);
    return;
  }
  const picked = new Set(aiPickedIds || []);
  similarCandidates.forEach((item: any) => {
    const q = item.q;
    const row = document.createElement('label');
    row.className = 'similar-result' + (picked.has(q.id) ? ' ai-picked' : '');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = q.id;
    checkbox.checked = picked.has(q.id);
    const img = document.createElement('img');
    img.src = q.question_image_url;
    const body = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);line-height:1.4';
    titleEl.textContent = q.user_comment || q.semantic_summary || '候选相似题';
    const meta = document.createElement('div');
    meta.className = 'similar-meta';
    const tagNames = q.question_tags.map((qt: any) => qt.tags.name).join('、') || '无标签';
    meta.textContent = '标签命中 ' + item.tagHit + '｜' + tagNames;
    body.append(titleEl, meta);
    const reason = similarAiReasons.get(q.id);
    if (reason) {
      const reasonEl = document.createElement('div');
      reasonEl.className = 'similar-meta';
      reasonEl.style.color = 'var(--accent-dark)';
      reasonEl.textContent = 'AI：' + reason;
      body.appendChild(reasonEl);
    } else if (q.semantic_summary && q.semantic_summary !== 'AI 正在分析中...') {
      const summary = document.createElement('div');
      summary.className = 'similar-meta';
      summary.textContent = q.semantic_summary;
      body.appendChild(summary);
    }
    row.append(checkbox, img, body);
    list.appendChild(row);
  });
}

export async function loadPendingLinkCandidates(): Promise<void> {
  if (!w.currentQuestionId) return;
  const pendingIds = w.getPendingLinkList();
  if (!pendingIds.length) { w.showStatus('待关联列表为空', 'error'); return; }
  const linkedIds = await w.dbGetSimilarQuestionIds(w.currentQuestionId);
  const available = pendingIds.filter((id: string) => !linkedIds.includes(id));
  document.getElementById('btn-pending-similar-count')!.textContent = String(available.length);
  const list = document.getElementById('similar-candidate-list')!;
  list.replaceChildren();
  if (!available.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '24px 12px';
    empty.textContent = '待关联列表中的题目都已关联';
    list.appendChild(empty);
    return;
  }
  available.forEach((id: string) => {
    const q = w.allQuestions.find((qq: any) => qq.id === id);
    if (!q) return;
    const row = document.createElement('label');
    row.className = 'similar-result';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = q.id;
    checkbox.checked = true;
    const img = document.createElement('img');
    img.src = q.question_image_url;
    const body = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);line-height:1.4';
    titleEl.textContent = q.user_comment || q.semantic_summary || '题目 ' + q.id.substring(0, 8);
    const meta = document.createElement('div');
    meta.className = 'similar-meta';
    const tagNames = (q.question_tags || []).map((qt: any) => qt.tags.name).join('、') || '无标签';
    meta.textContent = '待关联｜' + tagNames;
    body.append(titleEl, meta);
    row.append(checkbox, img, body);
    list.appendChild(row);
  });
  document.getElementById('similar-modal')!.classList.add('active');
}

export function parseSimilarAIResult(text: string): { ids: string[]; reasons: Record<string, string>; summary: string } {
  try {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        ids: Array.isArray(parsed.recommended_ids) ? parsed.recommended_ids : [],
        reasons: parsed.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {},
        summary: parsed.summary || parsed.reason || ''
      };
    }
    const arr = String(text || '').match(/\[[\s\S]*\]/);
    if (arr) return { ids: JSON.parse(arr[0]), reasons: {}, summary: '' };
  } catch (_e) { /* ignore */ }
  return { ids: [], reasons: {}, summary: String(text || '').slice(0, 120) };
}

export async function recommendSimilarWithAI(): Promise<void> {
  if (!w.currentQuestionId) return;
  const current = w.allQuestions.find((q: any) => q.id === w.currentQuestionId);
  const candidates = (await buildSimilarCandidates()).slice(0, 30);
  if (!current || !candidates.length) { w.showStatus('没有可推荐的候选题', 'error'); return; }
  const btn = (window.event as any)?.target as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = '推荐中...'; }
  try {
    const prompt = `你是题库相似题推荐助手。请根据当前题目的参考标签、用户评价原话、AI摘要，从候选题中推荐最相似的题目。
只输出JSON，不要解释正文。格式：
{"recommended_ids":["候选题ID"],"reasons":{"候选题ID":"推荐原因"},"summary":"整体推荐思路"}

当前题：
${JSON.stringify({
  id: current.id,
  tags: current.question_tags.map((qt: any) => qt.tags.name),
  user_comment: current.user_comment || '',
  summary: current.semantic_summary || ''
})}

候选题：
${JSON.stringify(candidates.map((item: any) => ({
  id: item.q.id,
  tags: item.q.question_tags.map((qt: any) => qt.tags.name),
  user_comment: item.q.user_comment || '',
  summary: item.q.semantic_summary || '',
  tag_hit: item.tagHit
})))}`;
    const resultText = await w.callCloudAI(prompt);
    const parsed = parseSimilarAIResult(resultText);
    const validIds = new Set(candidates.map((item: any) => item.q.id));
    const picked = parsed.ids.filter((id: string) => validIds.has(id)).slice(0, 10);
    similarAiReasons = new Map(Object.entries(parsed.reasons || {}));
    const reasonEl = document.getElementById('similar-ai-reason')!;
    reasonEl.textContent = parsed.summary || 'AI 已按评价原话、标签和摘要重新排序候选题。';
    reasonEl.style.display = 'flex';
    await renderSimilarCandidates(picked);
    w.showStatus('AI 推荐完成', 'success');
  } catch (e: any) {
    w.showStatus('AI 推荐失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'AI 推荐'; }
  }
}

export async function confirmSimilarLinks(): Promise<void> {
  if (!w.currentQuestionId) return;
  const ids = Array.from(document.querySelectorAll("#similar-candidate-list input[type='checkbox']:checked")).map((input: any) => input.value);
  if (!ids.length) { w.showStatus('请先勾选要关联的相似题', 'error'); return; }
  await w.dbAddSimilarQuestionLinks(w.currentQuestionId, ids);
  ids.forEach((id: string) => { if (w.isPendingLink(id)) w.removeFromPendingLink(id); });
  await w.loadQuestions();
  await renderSimilarQuestions(w.currentQuestionId);
  closeSimilarModal();
  w.showStatus('已关联 ' + ids.length + ' 道相似题', 'success');
}

// 触摸滑动初始化
export function initDetailSwipe(): void {
  let sx = 0, sy = 0, st = 0;
  const m = document.getElementById('question-modal');
  if (!m) return;
  m.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  m.addEventListener('touchend', (e: TouchEvent) => {
    if (!m.classList.contains('active')) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, dt = Date.now() - st;
    if (Math.abs(dx) > 60 && dt < 500 && Math.abs(dy) < 100) { dx < 0 ? navigateDetail(1) : navigateDetail(-1); }
  }, { passive: true });
}
