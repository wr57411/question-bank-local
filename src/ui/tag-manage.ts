/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// Module-level state (mirrors app.js locals, TS functions use these)
let formSelectedTagIds: string[] = [];
let _formTagManageMode = false;
let _formTagLongPressTimer: ReturnType<typeof setTimeout> | null = null;
let _formTagPollTimer: ReturnType<typeof setInterval> | null = null;
let _formTagLastVal = '';

// Expose formSelectedTagIds on window for cross-module access
Object.defineProperty(w, 'formSelectedTagIds', {
  get: () => formSelectedTagIds,
  set: (v: string[]) => { formSelectedTagIds = v; },
  configurable: true
});

export function _startFormTagPoll(): void {
  _formTagLastVal = '';
  _formTagPollTimer = setInterval(() => {
    const inp = document.getElementById('form-tag-search') as HTMLInputElement | null;
    if (inp && inp.value !== _formTagLastVal) { _formTagLastVal = inp.value; onFormTagSearch(); }
  }, 150);
}
export function _stopFormTagPoll(): void { clearInterval(_formTagPollTimer!); _formTagPollTimer = null; }

export async function loadTags(): Promise<void> {
  w.allTags = await w.dbGetAllTags();
  w.activeFilterTags = w.activeFilterTags.filter((id: string) => w.allTags.some((t: any) => t.id === id));
  renderTags(); updateTagSelects(); renderFilterTags();
  if (document.getElementById('form-tag-results')) onFormTagSearch();
  renderFormSelectedTags();
}

export function renderTags(): void {
  const c = document.getElementById('tags-list')!;
  c.replaceChildren();
  if (!w.allTags.length) { c.innerHTML = '<div class="empty-state">暂无标签，请添加</div>'; return; }
  w.allTags.forEach((tag: any) => {
    const el = document.createElement('span'); el.className = 'tag';
    el.style.background = tag.color + '20'; el.style.border = '1px solid ' + tag.color;
    el.appendChild(document.createTextNode(tag.name));
    const rm = document.createElement('span'); rm.className = 'remove'; rm.textContent = '×';
    rm.onclick = () => deleteTag(tag.id); el.appendChild(rm); c.appendChild(el);
  });
}

export function updateTagSelects(): void {
  ['paper-tag-select'].forEach(id => {
    const sel = document.getElementById(id) as HTMLSelectElement | null;
    if (!sel) return;
    const prev = Array.from(sel.selectedOptions).map(o => o.value);
    sel.replaceChildren();
    w.allTags.forEach((t: any) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; if (prev.includes(t.id)) o.selected = true; sel.appendChild(o); });
  });
  onFormTagSearch();
}

export function onFormTagSearch(): void {
  const input = document.getElementById('form-tag-search') as HTMLInputElement | null;
  const resultsDiv = document.getElementById('form-tag-results');
  if (!input || !resultsDiv) return;
  const query = input.value.trim().toLowerCase();
  let matches = w.allTags.filter((t: any) => !formSelectedTagIds.includes(t.id));
  if (query) matches = matches.filter((t: any) => t.name.toLowerCase().includes(query));
  matches = matches.slice(0, 50);
  resultsDiv.innerHTML = '';
  if (matches.length === 0 && query) {
    const btn = document.createElement('span');
    btn.style.cssText = 'display:inline-flex;align-items:center;padding:4px 10px;background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;color:var(--accent)';
    btn.textContent = '＋ 创建: "' + input.value.trim() + '"';
    btn.onclick = async () => {
      const name = input.value.trim();
      if (!name) return;
      const tag = await w.dbCreateTag(name, '#4CC3FF');
      await loadTags();
      addFormTag(tag.id);
      input.value = '';
      onFormTagSearch();
    };
    resultsDiv.appendChild(btn);
  } else {
    matches.forEach((t: any) => {
      const btn = document.createElement('span');
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--surface-dim);border:1px solid var(--border-light);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;transition:all .15s';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + t.color + ';flex-shrink:0';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = t.name;
      btn.appendChild(dot); btn.appendChild(nameSpan);
      const startLP = () => { _formTagLongPressTimer = setTimeout(() => { _formTagManageMode = !_formTagManageMode; onFormTagSearch(); }, 500); };
      const cancelLP = () => clearTimeout(_formTagLongPressTimer!);
      btn.onmousedown = startLP; btn.onmouseup = cancelLP; btn.onmouseleave = cancelLP;
      btn.ontouchstart = startLP; btn.ontouchend = cancelLP; btn.ontouchcancel = cancelLP;
      if (_formTagManageMode) {
        const rm = document.createElement('span');
        rm.textContent = '×';
        rm.style.cssText = 'font-size:10px;padding:1px 5px;margin-left:2px;border-radius:50%;background:rgba(0,0,0,.08);cursor:pointer;line-height:1';
        rm.onclick = async (ev) => {
          ev.stopPropagation();
          const used = w.allQuestions.some((q: any) => q.question_tags && q.question_tags.some((qt: any) => qt.tags && qt.tags.id === t.id));
          if (used) { w.showStatus('该标签已被题目使用，请到标签管理中删除', 'error'); return; }
          if (!confirm('确定删除标签「' + t.name + '」吗？')) return;
          await w.dbDeleteTag(t.id); w.allTags = w.allTags.filter((x: any) => x.id !== t.id);
          onFormTagSearch(); w.showStatus('已删除: ' + t.name, 'success');
        };
        btn.appendChild(rm);
        btn.onclick = null;
      } else {
        btn.onclick = () => { addFormTag(t.id); input.value = ''; onFormTagSearch(); };
      }
      btn.onmouseenter = () => { if (!_formTagManageMode) { btn.style.background = 'var(--primary-light)'; btn.style.borderColor = 'var(--primary)'; } };
      btn.onmouseleave = () => { btn.style.background = 'var(--surface-dim)'; btn.style.borderColor = 'var(--border-light)'; };
      resultsDiv.appendChild(btn);
    });
  }
}

export function onFormTagKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    const resultsDiv = document.getElementById('form-tag-results');
    const first = resultsDiv ? resultsDiv.querySelector('span') : null;
    if (first) (first as HTMLElement).click();
  }
}

export function addFormTag(tagId: string): void {
  if (formSelectedTagIds.includes(tagId)) return;
  formSelectedTagIds.push(tagId);
  const div = document.getElementById('form-tag-selected');
  const before = div?.childElementCount ?? 0;
  renderFormSelectedTags();
  const after = document.getElementById('form-tag-selected')?.childElementCount ?? 0;
  if (after <= before) {
    setTimeout(() => renderFormSelectedTags(), 50);
  }
}

export function removeFormTag(tagId: string): void {
  formSelectedTagIds = formSelectedTagIds.filter(id => id !== tagId);
  renderFormSelectedTags();
  onFormTagSearch();
}

export async function createTagFromSearch(): Promise<void> {
  const input = document.getElementById('form-tag-search') as HTMLInputElement | null;
  const name = (input?.value || '').trim();
  if (!name) { w.showStatus('请输入标签名', 'error'); return; }
  let tag = w.allTags.find((t: any) => t.name === name);
  if (!tag) { tag = await w.dbCreateTag(name, '#4CC3FF'); w.allTags.push(tag); }
  if (!formSelectedTagIds.includes(tag.id)) { formSelectedTagIds.push(tag.id); renderFormSelectedTags(); }
  if (input) input.value = '';
  onFormTagSearch();
  w.showStatus('已添加标签: ' + name, 'success');
}

export function renderFormSelectedTags(): void {
  const div = document.getElementById('form-tag-selected');
  if (!div) { console.warn('[renderFormSelectedTags] #form-tag-selected 元素不存在，跳过渲染'); return; }
  div.innerHTML = '';
  const missingIds: string[] = [];
  formSelectedTagIds.forEach(tagId => {
    const tag = w.allTags.find((t: any) => t.id === tagId);
    if (!tag) { missingIds.push(tagId); return; }
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:' + tag.color + '15;border:1px solid ' + tag.color + '40;border-radius:var(--radius-xl);font-size:12px;font-weight:500;color:var(--text)';
    el.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:' + tag.color + '"></span> ' + tag.name + ' <span style="cursor:pointer;color:var(--text-tertiary);margin-left:2px" onclick="removeFormTag(\'' + tag.id + '\')">✕</span>';
    div.appendChild(el);
  });
  if (missingIds.length) console.warn('[renderFormSelectedTags] 以下 tagId 在 allTags 中未找到:', missingIds);
}

export function toggleFilterTags(): void {
  const toggle = document.getElementById('filter-toggle')!;
  const tags = document.getElementById('filter-tags')!;
  const collapsed = tags.classList.toggle('collapsed');
  toggle.classList.toggle('expanded', !collapsed);
  localStorage.setItem('filterTagsExpanded', collapsed ? '0' : '1');
}

export function renderFilterTags(): void {
  const c = document.getElementById('filter-tags')!;
  c.replaceChildren();
  const badge = document.getElementById('filter-badge');
  if (badge) { badge.textContent = String(w.activeFilterTags.length); badge.style.display = w.activeFilterTags.length ? 'inline' : 'none'; }
  const expanded = localStorage.getItem('filterTagsExpanded') === '1';
  if (expanded) { c.classList.remove('collapsed'); document.getElementById('filter-toggle')!.classList.add('expanded'); }
  else { c.classList.add('collapsed'); document.getElementById('filter-toggle')!.classList.remove('expanded'); }
  const all = document.createElement('span'); all.className = 'filter-tag' + (!w.activeFilterTags.length ? ' active' : '');
  all.textContent = '全部'; all.onclick = () => { w.activeFilterTags = []; renderFilterTags(); w.renderQuestions(); }; c.appendChild(all);
  w.allTags.forEach((tag: any) => {
    const el = document.createElement('span');
    const isActive = w.activeFilterTags.includes(tag.id);
    el.className = 'filter-tag' + (isActive ? ' active' : ''); el.textContent = tag.name;
    if (isActive) { el.style.background = tag.color; el.style.color = '#fff'; el.style.borderColor = tag.color; } else { el.style.borderColor = tag.color; }
    el.onclick = () => {
      if (isActive) w.activeFilterTags = w.activeFilterTags.filter((id: string) => id !== tag.id);
      else w.activeFilterTags.push(tag.id);
      renderFilterTags(); w.renderQuestions();
    };
    c.appendChild(el);
  });
}

export async function deleteTag(id: string): Promise<void> {
  if (!confirm('确定删除这个标签吗？')) return;
  await w.dbDeleteTag(id); await w.refreshAll();
}

export function initTagForm(): void {
  document.getElementById('tag-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('tag-name') as HTMLInputElement).value.trim();
    const color = (document.getElementById('tag-color') as HTMLInputElement).value;
    if (!name) return;
    await w.dbCreateTag(name, color);
    (document.getElementById('tag-name') as HTMLInputElement).value = '';
    await loadTags(); w.showStatus('标签添加成功', 'success');
  });
}

// 新建标签弹窗
export function showNewTagModal(ctx: string): void {
  w.newTagContext = ctx;
  document.getElementById('new-tag-modal')!.classList.add('active');
  (document.getElementById('new-tag-name') as HTMLInputElement).focus();
}

export function closeNewTagModal(): void {
  document.getElementById('new-tag-modal')!.classList.remove('active');
  (document.getElementById('new-tag-name') as HTMLInputElement).value = '';
}

export async function submitNewTag(): Promise<void> {
  const name = (document.getElementById('new-tag-name') as HTMLInputElement).value.trim();
  const color = (document.getElementById('new-tag-color') as HTMLInputElement).value;
  if (!name) return;
  const tag = await w.dbCreateTag(name, color);
  await loadTags(); closeNewTagModal();
  if (w.newTagContext === 'form') {
    addFormTag(tag.id);
  } else if (w.newTagContext === 'paper') {
    const sel = document.getElementById('paper-tag-select') as HTMLSelectElement;
    for (const o of Array.from(sel.options)) { if (o.value === tag.id) o.selected = true; }
  }
  w.showStatus('标签创建成功', 'success');
}

export function clearFormGeneratedTags(): void {
  const el = document.getElementById('form-generated-tags');
  if (el) el.style.display = 'none';
  const list = document.getElementById('form-generated-tags-list');
  if (list) list.innerHTML = '';
}

