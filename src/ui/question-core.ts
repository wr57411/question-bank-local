/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbQuestions } from '../data/stores';

const w = window as any;

let currentAddMode = 'photo';
let batchRowCount = 0;
let openInlineTagAddId: string | null = null;
let openInlineTagSearchValue = '';
let currentBookFilter = '';
let allBookNames: string[] = [];
let _inlinePollTimers: Record<string, ReturnType<typeof setInterval>> = {};

export function switchAddMode(mode: string): void {
  currentAddMode = mode;
  const photoSection = document.getElementById('photo-section')!;
  const batchSection = document.getElementById('batch-section')!;
  const bookSection = document.getElementById('book-info-section')!;
  const photoBtn = document.getElementById('mode-photo-btn')!;
  const textBtn = document.getElementById('mode-text-btn')!;
  const batchBtn = document.getElementById('mode-batch-btn')!;
  const questionLabel = document.getElementById('question-image-label')!;
  [photoBtn, textBtn, batchBtn].forEach(btn => { btn.style.background = 'var(--surface-dim)'; btn.style.color = 'var(--text-secondary)'; (btn as HTMLElement).style.boxShadow = '0 3px 0 var(--border)'; });
  if (mode === 'photo') {
    photoSection.style.display = ''; batchSection.style.display = 'none'; bookSection.style.display = '';
    photoBtn.style.background = 'var(--primary)'; photoBtn.style.color = '#fff'; photoBtn.style.boxShadow = '0 6px 16px rgba(255,120,71,.3)';
    questionLabel.textContent = '题目图片（笔记）*';
    const cap = (window as any).Capacitor;
    const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    const MediaPlugin = isNative ? (cap?.Plugins?.MediaGallery ?? cap?.Plugins?.Media ?? null) : null;
    if (isNative && MediaPlugin) { w.loadGalleryThumbnails('question'); w.loadGalleryThumbnails('answer'); }
  } else if (mode === 'text') {
    photoSection.style.display = 'none'; batchSection.style.display = 'none'; bookSection.style.display = '';
    textBtn.style.background = 'var(--primary)'; textBtn.style.color = '#fff'; textBtn.style.boxShadow = '0 6px 16px rgba(255,120,71,.3)';
  } else if (mode === 'batch') {
    photoSection.style.display = 'none'; batchSection.style.display = ''; bookSection.style.display = 'none';
    batchBtn.style.background = 'var(--primary)'; batchBtn.style.color = '#fff'; batchBtn.style.boxShadow = '0 6px 16px rgba(255,120,71,.3)';
    if ((document.getElementById('batch-rows') as HTMLElement).children.length === 0) addBatchRow();
    const lastBookName = localStorage.getItem('lastBookName');
    if (lastBookName) (document.getElementById('batch-book-name') as HTMLInputElement).value = lastBookName;
  }
}

export function addBatchRow(): void {
  batchRowCount++;
  const rowId = 'batch-row-' + batchRowCount;
  const container = document.getElementById('batch-rows')!;
  const row = document.createElement('div');
  row.id = rowId;
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML = `<input type="number" placeholder="页码" class="batch-page" style="flex:1;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" /><input type="text" placeholder="题号" class="batch-number" style="flex:1;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:var(--radius-sm)" /><button type="button" onclick="removeBatchRow('${rowId}')" style="padding:6px 10px;background:var(--danger);box-shadow:none;font-size:12px;border:none;border-radius:var(--radius-sm);cursor:pointer;color:#fff">✕</button>`;
  container.appendChild(row);
}

export function removeBatchRow(rowId: string): void {
  const container = document.getElementById('batch-rows')!;
  const row = document.getElementById(rowId);
  if (row && container.children.length > 1) row.remove();
}

export function getBatchEntries(): { page: string; number: string }[] {
  const entries: { page: string; number: string }[] = [];
  document.querySelectorAll('#batch-rows > div').forEach(row => {
    const page = (row.querySelector('.batch-page') as HTMLInputElement).value.trim();
    const number = (row.querySelector('.batch-number') as HTMLInputElement).value.trim();
    if (page || number) entries.push({ page, number });
  });
  return entries;
}

export function initQuestionForm(): void {
  document.getElementById('question-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qi = w.croppedImages.question, ai = w.croppedImages.answer, bi = w.croppedImages.blank;
    const tags = [...w.formSelectedTagIds];
    const versions = w.getSelectedVersions();
    const bookName = (document.getElementById('book-name') as HTMLInputElement).value.trim();
    const pageNumber = (document.getElementById('page-number') as HTMLInputElement).value.trim();
    const questionNumber = (document.getElementById('question-number') as HTMLInputElement).value.trim();

    if (currentAddMode === 'batch') {
      const batchBookName = (document.getElementById('batch-book-name') as HTMLInputElement).value.trim();
      const entries = getBatchEntries();
      if (!batchBookName) { w.showStatus('请输入书名', 'error'); return; }
      if (entries.length === 0) { w.showStatus('请添加至少一道题目', 'error'); return; }
      try {
        const btn = (e.target as HTMLElement).querySelector('button[type="submit"]') as HTMLButtonElement;
        btn.disabled = true; btn.textContent = '处理中...';
        let count = 0;
        for (const entry of entries) {
          const bookInfo = { book_name: batchBookName, page_number: entry.page, question_number: entry.number };
          await w.dbCreateQuestion(null, null, tags, 0, null, versions, bookInfo);
          count++;
        }
        localStorage.setItem('lastBookName', batchBookName);
        document.getElementById('batch-rows')!.innerHTML = '';
        addBatchRow();
        w.formSelectedTagIds = []; w.renderFormSelectedTags();
        w.resetVersionCheckboxes();
        await loadQuestions(); await loadBookFilter();
        w.showStatus(`成功添加 ${count} 道题目`, 'success');
        btn.disabled = false; btn.textContent = '添加题目';
      } catch (err: any) { w.showStatus('批量添加失败: ' + err.message, 'error'); const btn = (e.target as HTMLElement).querySelector('button[type="submit"]') as HTMLButtonElement; btn.disabled = false; btn.textContent = '添加题目'; }
      return;
    }

    if (currentAddMode === 'text' && !bookName && !pageNumber && !questionNumber) { w.showStatus('纯文字模式下请至少填写一项书本信息', 'error'); return; }
    if (currentAddMode === 'photo' && !qi) { w.showStatus('请先选择题目图片', 'error'); return; }

    const lr = document.querySelector('input[name="layout_type"]:checked') as HTMLInputElement | null;
    const lt = lr ? parseInt(lr.value) : 0;
    const bookInfo = (pageNumber || questionNumber) ? { book_name: bookName, page_number: pageNumber, question_number: questionNumber } : null;

    try {
      const btn = (e.target as HTMLElement).querySelector('button[type="submit"]') as HTMLButtonElement;
      btn.disabled = true; btn.textContent = '处理中...';
      const newQuestion = await w.dbCreateQuestion(qi, ai, tags, lt, bi, versions, bookInfo);
      const textNote = ((document.getElementById('form-text-note') as HTMLInputElement)?.value || '').trim();
      if (qi) await w.dbAddQuestionNote(newQuestion.id, qi, '笔记 v1', textNote);
      const comment = (document.getElementById('form-comment') as HTMLInputElement).value.trim();
      if (comment) { await dbQuestions.setItem(newQuestion.id, { ...newQuestion, user_comment: comment, updated_at: new Date().toISOString() }); w._invalidateQuestionsCache(); }
      let noteIdx = 2;
      for (const ev of w.extraNoteVersions) {
        if (ev.image) {
          const labelInput = document.getElementById('extra_' + ev.idx + '-label') as HTMLInputElement | null;
          const label = (labelInput ? labelInput.value.trim() : '') || '笔记 v' + noteIdx;
          await w.dbAddQuestionNote(newQuestion.id, ev.image, label, '');
          noteIdx++;
        }
      }
      w.extraNoteVersions = []; w.extraNoteVersionCounter = 0;
      document.getElementById('extra-note-versions')!.innerHTML = '';
      w.removeImage('question'); w.removeImage('answer'); w.removeImage('blank');
      w.formSelectedTagIds = []; w.renderFormSelectedTags();
      document.querySelectorAll('.layout-option').forEach(l => { (l as HTMLElement).style.borderColor = 'var(--border-light)'; (l as HTMLElement).style.background = 'var(--surface)'; });
      w.resetVersionCheckboxes();
      if (bookName) localStorage.setItem('lastBookName', bookName);
      (document.getElementById('page-number') as HTMLInputElement).value = '';
      (document.getElementById('question-number') as HTMLInputElement).value = '';
      (document.getElementById('form-comment') as HTMLInputElement).value = '';
      (document.getElementById('form-text-note') as HTMLInputElement).value = '';
      w.clearFormGeneratedTags();
      await loadQuestions(); await loadBookFilter();
      w.showStatus('题目添加成功', 'success');
      btn.disabled = false; btn.textContent = '添加题目';
    } catch (err: any) { w.showStatus('添加失败: ' + err.message, 'error'); const btn = (e.target as HTMLElement).querySelector('button[type="submit"]') as HTMLButtonElement; btn.disabled = false; btn.textContent = '添加题目'; }
  });
}

export async function loadQuestions(): Promise<void> { w.allQuestions = await w.dbGetAllQuestions(); renderQuestions(); }

export async function loadBookFilter(): Promise<void> {
  allBookNames = await w.dbGetAllBookNames();
  const select = document.getElementById('book-filter') as HTMLSelectElement;
  select.innerHTML = '<option value="">📚 全部书本</option>';
  allBookNames.forEach(name => { const opt = document.createElement('option'); opt.value = name; opt.textContent = '📖 ' + name; select.appendChild(opt); });
  const datalist = document.getElementById('book-name-list');
  if (datalist) { datalist.innerHTML = ''; allBookNames.forEach(name => { const opt = document.createElement('option'); opt.value = name; datalist.appendChild(opt); }); }
}

export function filterByBook(bookName: string): void { currentBookFilter = bookName; renderQuestions(); }

export function fuzzyMatchTags(searchText: string): any[] {
  if (!searchText || !w.allTags.length) return [];
  const q = searchText.toLowerCase().trim();
  if (!q) return [];
  const results: any[] = [];
  for (const tag of w.allTags) {
    const name = (tag.name || '').toLowerCase();
    if (!name) continue;
    let score = 0, type = '';
    if (name.includes(q)) { score = 100; type = '精确匹配'; }
    else if (q.includes(name) && name.length >= 2) { score = 90; type = '包含标签'; }
    else { let qi = 0; for (let ci = 0; ci < name.length && qi < q.length; ci++) { if (name[ci] === q[qi]) qi++; } if (qi === q.length && q.length >= 2) { score = 80; type = '顺序匹配'; } }
    if (score === 0) { const qChars = new Set(q); const nChars = new Set(name); let intersection = 0; for (const c of qChars) { if (nChars.has(c)) intersection++; } const union = new Set([...qChars, ...nChars]).size; const jaccard = intersection / union; if (jaccard >= 0.34 && intersection >= 2) { score = Math.round(40 + jaccard * 40); type = '相似'; } }
    if (score > 0) results.push({ tag, score, type });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

export function showTagSuggestions(): void {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  const dropdown = document.getElementById('tag-suggest-dropdown');
  if (!input || !dropdown) return;
  const searchText = input.value.trim();
  if (!searchText) { dropdown.classList.remove('show'); dropdown.replaceChildren(); return; }
  const matches = fuzzyMatchTags(searchText);
  if (!matches.length) { dropdown.classList.remove('show'); dropdown.replaceChildren(); return; }
  dropdown.replaceChildren();
  matches.forEach(m => {
    const item = document.createElement('div'); item.className = 'tag-suggest-item';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = m.tag.color || '#4CC3FF';
    const label = document.createElement('span'); label.textContent = m.tag.name;
    const badge = document.createElement('span'); badge.className = 'match-type'; badge.textContent = m.type;
    item.appendChild(dot); item.appendChild(label); item.appendChild(badge);
    item.onclick = () => { input.value = m.tag.name; dropdown.classList.remove('show'); dropdown.replaceChildren(); filterQuestions(); input.focus(); };
    dropdown.appendChild(item);
  });
  dropdown.classList.add('show');
}

export function filterQuestions(): void { showTagSuggestions(); renderQuestions(); }

export function getFilteredQuestions(): any[] {
  const currentVersionId = w.getCurrentVersionId();
  const searchText = (document.getElementById('search-input') as HTMLInputElement)?.value?.toLowerCase()?.trim() || '';
  let filtered = w.allQuestions.filter((q: any) => { const versions = q.versions || []; return versions.length === 0 || versions.includes(currentVersionId); });
  if (w.activeFilterTags.length) { filtered = filtered.filter((q: any) => { const qt = q.question_tags.map((t: any) => t.tags.id); return w.activeFilterTags.some((f: string) => qt.includes(f)); }); }
  if (currentBookFilter) { filtered = filtered.filter((q: any) => q.book_name === currentBookFilter); }
  if (searchText) { filtered = filtered.filter((q: any) => { const bookMatch = (q.book_name || '').toLowerCase().includes(searchText); const pageMatch = (q.page_number || '').toLowerCase().includes(searchText); const numMatch = (q.question_number || '').toLowerCase().includes(searchText); const tagMatch = q.question_tags.some((t: any) => t.tags.name.toLowerCase().includes(searchText)); const summaryMatch = (q.semantic_summary || '').toLowerCase().includes(searchText); return bookMatch || pageMatch || numMatch || tagMatch || summaryMatch; }); }
  return filtered;
}

export function renderQuestions(): void {
  const container = document.getElementById('questions-list')!;
  const filtered = getFilteredQuestions();
  document.getElementById('question-count')!.textContent = w.activeFilterTags.length ? `(筛选: ${filtered.length}/${w.allQuestions.length})` : `(${filtered.length}/${w.allQuestions.length})`;
  updateSelectedCount();
  if (!filtered.length) { container.innerHTML = '<div class="empty-state"><div class="icon">📝</div>暂无题目</div>'; return; }
  container.replaceChildren();
  filtered.forEach((q: any) => {
    const tags = q.question_tags.map((qt: any) => qt.tags);
    const isChecked = w.selectedQuestions.has(q.id), inBasket = w.questionBasket.has(q.id);
    const card = document.createElement('div'); card.className = 'question-card' + (isChecked ? ' selected' : ''); card.dataset.id = q.id;
    const cb = document.createElement('button'); cb.className = 'q-checkbox' + (isChecked ? ' checked' : '');
    cb.textContent = isChecked ? '✓' : '';
    cb.onclick = (ev) => { ev.stopPropagation(); toggleQuestionSelect(q.id, cb); };
    card.appendChild(cb);
    const img = document.createElement('img');
    if (q.question_image_url) { img.src = q.question_image_url; img.alt = '题目'; img.loading = 'lazy'; }
    else { img.style.background = 'linear-gradient(135deg, var(--primary-light) 0%, var(--surface-dim) 100%)'; img.style.display = 'flex'; img.style.alignItems = 'center'; img.style.justifyContent = 'center'; img.style.fontSize = '32px'; img.alt = '纯文字题目'; img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="130" viewBox="0 0 160 130"><rect fill="%23E8F5EE" width="160" height="130"/><text x="80" y="60" text-anchor="middle" font-size="28" fill="%231B7A4E">📝</text><text x="80" y="85" text-anchor="middle" font-size="11" fill="%235F6368">纯文字题目</text></svg>'); }
    img.onclick = () => w.showQuestionDetail(q.id); card.appendChild(img);
    const info = document.createElement('div'); info.className = 'info'; info.onclick = () => w.showQuestionDetail(q.id);
    if (q.book_name || q.page_number || q.question_number) {
      const bookWrap = document.createElement('div'); bookWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;font-size:10px;color:var(--text-secondary)';
      if (q.book_name) bookWrap.innerHTML += '<span style="background:var(--primary-light);padding:1px 6px;border-radius:8px">📖 ' + q.book_name + '</span>';
      if (q.page_number) bookWrap.innerHTML += '<span style="background:var(--surface-dim);padding:1px 6px;border-radius:8px">p.' + q.page_number + '</span>';
      if (q.question_number) bookWrap.innerHTML += '<span style="background:var(--surface-dim);padding:1px 6px;border-radius:8px">第' + q.question_number + '题</span>';
      info.appendChild(bookWrap);
    }
    if (q.semantic_summary && q.semantic_summary !== 'AI 正在分析中...') {
      const summaryWrap = document.createElement('div'); summaryWrap.className = 'ai-summary-wrap';
      summaryWrap.innerHTML = '<span class="ai-badge">AI</span> <span class="summary-text">' + q.semantic_summary + '</span>';
      info.appendChild(summaryWrap);
    }
    const tagsWrap = document.createElement('div'); tagsWrap.className = 'tags';
    tags.forEach((t: any) => { const te = document.createElement('span'); te.className = 'tag'; te.style.background = t.color + '20'; te.textContent = t.name; tagsWrap.appendChild(te); });
    const addBtn = document.createElement('span'); addBtn.className = 'tag-add-btn'; addBtn.textContent = '+';
    addBtn.onclick = (ev) => { ev.stopPropagation(); toggleInlineTagAdd(q.id); }; tagsWrap.appendChild(addBtn);
    const inlineAdd = document.createElement('div'); inlineAdd.id = 'inline-add-' + q.id; inlineAdd.className = 'inline-tag-add hidden';
    inlineAdd.onclick = (ev) => ev.stopPropagation();
    inlineAdd.innerHTML = `<input type="text" id="inline-tag-search-${q.id}" placeholder="🔍 搜索或输入标签名..." oninput="onInlineTagSearch('${q.id}')" onfocus="startInlinePoll('${q.id}')" onblur="stopInlinePoll('${q.id}')" onkeydown="onInlineTagKeydown(event,'${q.id}')" /><div id="inline-tag-results-${q.id}" class="inline-tag-results"></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button onclick="showNewTagModal('form')" style="padding:4px 10px;font-size:11px;background:var(--accent);box-shadow:none">＋ 新建标签</button><button onclick="toggleInlineTagAdd('${q.id}')" class="secondary" style="padding:4px 10px;font-size:11px">关闭</button></div><div id="inline-tag-added-${q.id}" class="inline-tag-added" style="display:none"></div>`;
    info.appendChild(tagsWrap); info.appendChild(inlineAdd); card.appendChild(info);
    container.appendChild(card);
  });
  restoreInlineTagAdd();
}

function restoreInlineTagAdd(): void {
  try {
    if (!openInlineTagAddId) return;
    const el = document.getElementById('inline-add-' + openInlineTagAddId);
    if (el) { el.classList.remove('hidden'); const input = document.getElementById('inline-tag-search-' + openInlineTagAddId) as HTMLInputElement | null; if (input) { input.value = openInlineTagSearchValue; input.focus(); } onInlineTagSearch(openInlineTagAddId); }
  } catch (e) { console.error('恢复标签弹窗失败:', e); }
}

export function toggleInlineTagAdd(id: string): void {
  const el = document.getElementById('inline-add-' + id)!;
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) { openInlineTagAddId = id; openInlineTagSearchValue = ''; const input = document.getElementById('inline-tag-search-' + id) as HTMLInputElement; if (input) { input.value = ''; input.focus(); } onInlineTagSearch(id); }
  else { openInlineTagAddId = null; openInlineTagSearchValue = ''; }
}

export function startInlinePoll(qId: string): void { _inlinePollTimers[qId] = setInterval(() => { const inp = document.getElementById('inline-tag-search-' + qId) as any; if (inp && inp.value !== (inp._lastVal || '')) { inp._lastVal = inp.value; onInlineTagSearch(qId); } }, 150); }
export function stopInlinePoll(qId: string): void { clearInterval(_inlinePollTimers[qId]); delete _inlinePollTimers[qId]; }

export function onInlineTagSearch(qId: string): void {
  const input = document.getElementById('inline-tag-search-' + qId) as HTMLInputElement | null;
  const resultsDiv = document.getElementById('inline-tag-results-' + qId);
  if (!input || !resultsDiv) return;
  const query = input.value.trim().toLowerCase();
  if (openInlineTagAddId === qId) openInlineTagSearchValue = query;
  const question = w.allQuestions.find((q: any) => q.id === qId);
  const existingTagIds = question ? question.question_tags.map((qt: any) => qt.tags.id) : [];
  let matches = w.allTags.filter((t: any) => !existingTagIds.includes(t.id));
  if (query) matches = matches.filter((t: any) => t.name.toLowerCase().includes(query));
  matches = matches.slice(0, 12);
  resultsDiv.innerHTML = '';
  if (matches.length === 0 && query) {
    const createBtn = document.createElement('span'); createBtn.className = 'inline-tag-result';
    createBtn.style.cssText = 'background:var(--accent-light);border-color:var(--accent);color:var(--accent)';
    createBtn.textContent = '＋ 创建: "' + input.value.trim() + '"';
    createBtn.onclick = async (ev) => { ev.stopPropagation(); const name = input.value.trim(); if (!name) return; const tag = await w.dbCreateTag(name, '#4CC3FF'); await w.dbAddTagToQuestion(qId, tag.id); input.value = ''; w.allTags.push(tag); showAddedTag(qId, tag); onInlineTagSearch(qId); };
    resultsDiv.appendChild(createBtn);
  } else {
    matches.forEach((t: any) => {
      const btn = document.createElement('span'); btn.className = 'inline-tag-result';
      btn.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + t.color + ';flex-shrink:0"></span> ' + t.name;
      btn.onclick = async (ev) => { ev.stopPropagation(); await w.dbAddTagToQuestion(qId, t.id); showAddedTag(qId, t); onInlineTagSearch(qId); };
      resultsDiv.appendChild(btn);
    });
  }
}

export function onInlineTagKeydown(event: KeyboardEvent, qId: string): void {
  if (event.key === 'Enter') { event.preventDefault(); const resultsDiv = document.getElementById('inline-tag-results-' + qId); const firstResult = resultsDiv ? resultsDiv.querySelector('.inline-tag-result') : null; if (firstResult) (firstResult as HTMLElement).click(); }
}

export function showAddedTag(qId: string, tag: any): void {
  const addedDiv = document.getElementById('inline-tag-added-' + qId);
  if (!addedDiv) return;
  addedDiv.style.display = 'flex';
  const span = document.createElement('span'); span.className = 'tag';
  span.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + tag.color + '"></span> ' + tag.name + ' ✓';
  addedDiv.appendChild(span);
  const question = w.allQuestions.find((q: any) => q.id === qId);
  if (question) question.question_tags.push({ tags: tag });
  const card = document.querySelector('[data-id="' + qId + '"]');
  if (card) { const tagsWrap = card.querySelector('.tags'); if (tagsWrap) { const addBtnEl = tagsWrap.querySelector('.tag-add-btn'); const te = document.createElement('span'); te.className = 'tag'; te.style.background = tag.color + '20'; te.textContent = tag.name; if (addBtnEl) tagsWrap.insertBefore(te, addBtnEl); else tagsWrap.appendChild(te); } }
}

// 批量选择
export function toggleQuestionSelect(qId: string, btn: HTMLElement): void {
  if (w.selectedQuestions.has(qId)) { w.selectedQuestions.delete(qId); btn.classList.remove('checked'); btn.textContent = ''; btn.closest('.question-card')!.classList.remove('selected'); }
  else { w.selectedQuestions.add(qId); btn.classList.add('checked'); btn.textContent = '✓'; btn.closest('.question-card')!.classList.add('selected'); }
  updateSelectedCount();
}

export function updateSelectedCount(): void {
  const el = document.getElementById('selected-count')!;
  if (w.selectedQuestions.size > 0) { el.style.display = 'inline'; document.getElementById('selected-num')!.textContent = String(w.selectedQuestions.size); }
  else el.style.display = 'none';
}

// 删除/垃圾篓
export async function deleteQuestion(): Promise<void> {
  if (!w.currentQuestionId || !confirm('确定将这道题目移至垃圾篓吗？')) return;
  await w.dbSoftDeleteQuestion(w.currentQuestionId); w.closeModal(); await Promise.all([loadQuestions(), w.loadPapers()]);
}

export async function loadTrashed(): Promise<void> {
  w.trashedQuestions = await w.dbGetTrashedQuestions();
  document.getElementById('trash-count')!.textContent = '(' + w.trashedQuestions.length + ')';
  const c = document.getElementById('trash-list')!;
  if (!w.trashedQuestions.length) { c.innerHTML = '<div class="empty-state">垃圾篓是空的</div>'; return; }
  c.replaceChildren();
  w.trashedQuestions.forEach((q: any) => {
    const card = document.createElement('div'); card.className = 'paper-card';
    const img = document.createElement('img'); img.src = q.question_image_url; img.style.maxWidth = '100%'; img.style.maxHeight = '120px'; img.style.objectFit = 'contain'; img.style.borderRadius = '8px';
    const bg = document.createElement('div'); bg.className = 'btn-group'; bg.style.marginTop = '10px';
    const rb = document.createElement('button'); rb.className = 'success'; rb.textContent = '恢复';
    rb.onclick = async () => { await w.dbRestoreQuestion(q.id); await Promise.all([loadTrashed(), loadQuestions()]); w.showStatus('已恢复', 'success'); };
    const db = document.createElement('button'); db.className = 'danger'; db.textContent = '彻底删除';
    db.onclick = async () => { if (!confirm('确定彻底删除？不可恢复！')) return; await w.dbPermanentDeleteQuestion(q.id); await loadTrashed(); w.showStatus('已彻底删除', 'success'); };
    bg.append(rb, db); card.append(img, bg); c.appendChild(card);
  });
}
