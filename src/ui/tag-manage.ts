/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
import {
  dbGetAllTagCategories, dbCreateTagCategory, dbRenameTagCategory, dbDeleteTagCategory, dbMoveTagCategory,
  dbUpdateTag, dbCreateTag, getUntaggedQuestionCount, listUntaggedQuestions,
  getVisibilityConfig, setVisibilityConfig,
  dbGetAllGroups, dbGetGroup, dbUpdateGroup, buildGroupQuestionTagMap,
  getGroupMemberQuestionIds,
  evalExpr, removeTagFromExpr, exprContainsTag, formatExpr,
  guessCategoryForTag,
  type VisibilityConfig, type VisibilityKind,
} from '../data';
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
  renderTags(); updateTagSelects(); void renderFilterTags();
  if (document.getElementById('form-tag-results')) onFormTagSearch();
  renderFormSelectedTags();
  await populateCategorySelect(document.getElementById('form-tag-category') as HTMLSelectElement | null, false);
  await refreshTagManageCounts();
}

// 填充类别选择器（默认不含「系统」，那是专题机制自动建的标签归属）。
export async function populateCategorySelect(sel: HTMLSelectElement | null, includeSystem = false): Promise<void> {
  if (!sel) return;
  const cats: any[] = await dbGetAllTagCategories();
  const list = includeSystem ? cats : cats.filter((c) => !c.is_system);
  const prev = sel.value;
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— 请选择类别 —';
  sel.appendChild(none);
  for (const c of list) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
  if (prev && list.some((c) => c.id === prev)) sel.value = prev;
}

// 刷新标签管理里的两个计数徽标（未分类标签数 / 未打标签题数）。
export async function refreshTagManageCounts(): Promise<void> {
  const unclassified = (w.allTags || []).filter((t: any) => !t.category_id).length;
  const batchBtn = document.getElementById('batch-categorize-btn');
  if (batchBtn) batchBtn.textContent = '批量分类（' + unclassified + '）';
  const untaggedCount = await getUntaggedQuestionCount();
  const untaggedBtn = document.getElementById('untagged-btn');
  if (untaggedBtn) untaggedBtn.textContent = '未打标签的题（' + untaggedCount + '）';
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
      const catId = (document.getElementById('form-tag-category') as HTMLSelectElement)?.value || null;
      if (!catId) { w.showStatus('请先选择类别', 'error'); return; }
      const tag = await dbCreateTag(name, '#4CC3FF');
      await dbUpdateTag(tag.id, { category_id: catId });
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
          const used = w.allQuestions.some((q: any) => q.question_tags && q.question_tags.some((qt: any) => qt && qt.id === t.id));
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
  const catId = (document.getElementById('form-tag-category') as HTMLSelectElement)?.value || null;
  if (!catId) { w.showStatus('请先选择类别', 'error'); return; }
  let tag = w.allTags.find((t: any) => t.name === name);
  if (!tag) { tag = await dbCreateTag(name, '#4CC3FF'); await dbUpdateTag(tag.id, { category_id: catId }); w.allTags.push(tag); }
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

// 2.9 筛选区：章节行 / 专题行 / 标签 chips；层间 AND（与 question-core.getFilteredQuestions 对应）。
// 选定章节/专题时回显其表达式摘要（formatExpr）；列表只消费成员集合，不解析表达式（§0 E6）。
export async function renderFilterTags(): Promise<void> {
  const c = document.getElementById('filter-tags');
  if (!c) return;
  c.replaceChildren();
  const expTagCount = w.activeFilterTags.length;
  const activeCount = expTagCount + (w.activeFilterChapterId ? 1 : 0) + (w.activeFilterTopicId ? 1 : 0);
  const badge = document.getElementById('filter-badge');
  if (badge) { badge.textContent = String(activeCount); badge.style.display = activeCount ? 'inline' : 'none'; }
  const expanded = localStorage.getItem('filterTagsExpanded') === '1';
  if (expanded) { c.classList.remove('collapsed'); document.getElementById('filter-toggle')!.classList.add('expanded'); }
  else { c.classList.add('collapsed'); document.getElementById('filter-toggle')!.classList.remove('expanded'); }

  const groups = await dbGetAllGroups();
  const nameOf = new Map((w.allTags as any[]).map((t: any) => [t.id, t.name]));
  const questionTags = await buildGroupQuestionTagMap();
  const memberCount = (g: any): number => {
    const { hits } = evalExpr(g.expr, questionTags);
    if (g.member_tag_id) for (const [qid, tags] of questionTags) if (tags.has(g.member_tag_id)) hits.add(qid);
    return hits.size;
  };

  c.appendChild(renderGroupFilterRow('章节', 'chapter', groups.filter((g) => g.kind === 'chapter'), nameOf, memberCount));
  c.appendChild(renderGroupFilterRow('专题', 'topic', groups.filter((g) => g.kind === 'topic'), nameOf, memberCount));
  const divider = document.createElement('div'); divider.className = 'ffilter-divider'; c.appendChild(divider);

  const all = document.createElement('span'); all.className = 'filter-tag' + (!expTagCount ? ' active' : '');
  all.textContent = '全部标签'; all.onclick = () => { w.activeFilterTags = []; void renderFilterTags(); w.renderQuestions(); }; c.appendChild(all);
  // §3.3：「系统」类别（专题的系统成员标签）不得出现在标签筛选里
  const sysCatId = (await dbGetAllTagCategories()).find((x: any) => x.is_system)?.id ?? null;
  w.allTags.filter((t: any) => !(sysCatId && t.category_id === sysCatId)).forEach((tag: any) => {
    const el = document.createElement('span');
    const isActive = w.activeFilterTags.includes(tag.id);
    el.className = 'filter-tag' + (isActive ? ' active' : ''); el.textContent = tag.name;
    if (isActive) { el.style.background = tag.color; el.style.color = '#fff'; el.style.borderColor = tag.color; } else { el.style.borderColor = tag.color; }
    el.onclick = () => {
      if (isActive) w.activeFilterTags = w.activeFilterTags.filter((id: string) => id !== tag.id);
      else w.activeFilterTags.push(tag.id);
      void renderFilterTags(); w.renderQuestions();
    };
    c.appendChild(el);
  });
}

function renderGroupFilterRow(
  label: string,
  kind: 'chapter' | 'topic',
  list: any[],
  nameOf: Map<string, string>,
  memberCount: (g: any) => number,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ffilter-row';
  row.dataset.kind = kind;
  const labelEl = document.createElement('span');
  labelEl.className = 'ffilter-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);
  const activeKey = kind === 'chapter' ? 'activeFilterChapterId' : 'activeFilterTopicId';
  if (list.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'gexpr-picker-empty';
    empty.textContent = kind === 'chapter' ? '（暂无章节）' : '（暂无专题）';
    row.appendChild(empty);
    return row;
  }
  for (const g of list) {
    const el = document.createElement('span');
    const isActive = w[activeKey] === g.id;
    el.className = 'filter-tag' + (isActive ? ' active' : '');
    el.dataset.groupId = g.id;
    el.textContent = `${g.name}（${memberCount(g)}）`;
    if (isActive) { el.style.background = 'var(--primary)'; el.style.color = '#fff'; }
    el.onclick = () => { void toggleFilterGroup(kind, g.id); };
    row.appendChild(el);
  }
  if (w[activeKey]) {
    const g = list.find((x) => x.id === w[activeKey]);
    if (g) {
      const echo = document.createElement('div');
      echo.className = 'ffilter-echo';
      echo.dataset.role = 'echo';
      echo.textContent = `回显：${formatExpr(g.expr, (id: string) => nameOf.get(id) ?? '已删除标签')}`;
      row.appendChild(echo);
    }
  }
  return row;
}

async function toggleFilterGroup(kind: 'chapter' | 'topic', id: string): Promise<void> {
  const activeKey = kind === 'chapter' ? 'activeFilterChapterId' : 'activeFilterTopicId';
  const idsKey = kind === 'chapter' ? 'activeFilterChapterIds' : 'activeFilterTopicIds';
  if (w[activeKey] === id) { w[activeKey] = null; w[idsKey] = null; }
  else {
    w[activeKey] = id;
    const ids = await getGroupMemberQuestionIds(id);
    w[idsKey] = new Set(ids);
  }
  await renderFilterTags();
  w.renderQuestions();
}

// ========== 2.7 删标签级联清理（§3.1.2） ==========
// 有引用：弹窗逐个列出「清理前 N 题 → 清理后 M 题」，确认后从表达式树物理移除；
// 无引用：直接删除，不打扰。
let _pendingTagDeleteId: string | null = null;
let _pendingTagDeleteRows: { groupId: string; name: string; before: number; after: number }[] = [];

export async function deleteTag(id: string): Promise<void> {
  const tag = (w.allTags as any[]).find((t: any) => t.id === id);
  const groups = await dbGetAllGroups();
  const affected = groups.filter((g) => exprContainsTag(g.expr, id));
  if (!affected.length) {
    await w.dbDeleteTag(id);
    await w.refreshAll();
    return;
  }
  const questionTags = await buildGroupQuestionTagMap();
  const rows = affected.map((g) => ({
    groupId: g.id,
    name: g.name,
    before: evalExpr(g.expr, questionTags).hits.size,
    after: evalExpr(removeTagFromExpr(g.expr, id), questionTags).hits.size,
  }));
  _pendingTagDeleteId = id;
  _pendingTagDeleteRows = rows;
  const title = document.getElementById('tag-cascade-title');
  if (title) title.textContent = `删除标签「${tag ? tag.name : ''}」`;
  renderTagCascadeRows(rows);
  openModal('tag-cascade-modal');
}

function renderTagCascadeRows(rows: { groupId: string; name: string; before: number; after: number }[]): void {
  const list = document.getElementById('tag-cascade-list');
  if (!list) return;
  list.replaceChildren();
  const intro = document.createElement('div');
  intro.className = 'gexpr-picker-empty';
  intro.textContent = '以下条目引用了该标签，确认后将从句式中物理移除：';
  list.appendChild(intro);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'cascade-row';
    row.dataset.groupId = r.groupId;
    const nm = document.createElement('span');
    nm.className = 'cascade-name';
    nm.textContent = r.name;
    const delta = document.createElement('span');
    delta.className = 'cascade-delta';
    delta.textContent = `清理前 ${r.before} 题 → 清理后 ${r.after} 题`;
    row.append(nm, delta);
    list.appendChild(row);
  }
  const emptyAfter = rows.filter((r) => r.after === 0);
  if (emptyAfter.length) {
    const note = document.createElement('div');
    note.className = 'gexpr-unclassified-hint';
    note.textContent = `提示：${emptyAfter.map((r) => r.name).join('、')} 清理后将不含表达式命中题`;
    list.appendChild(note);
  }
}

export async function confirmTagCascade(): Promise<void> {
  const id = _pendingTagDeleteId;
  const rows = _pendingTagDeleteRows;
  _pendingTagDeleteId = null;
  _pendingTagDeleteRows = [];
  closeModal('tag-cascade-modal');
  if (!id) return;
  for (const r of rows) {
    const g = await dbGetGroup(r.groupId);
    if (g) await dbUpdateGroup(g.id, { expr: removeTagFromExpr(g.expr, id) });
  }
  await w.dbDeleteTag(id);
  await w.refreshAll();
  await w.renderGroupManage?.();
  w.showStatus('已删除标签并清理引用', 'success');
}

export function closeTagCascadeModal(): void {
  _pendingTagDeleteId = null;
  _pendingTagDeleteRows = [];
  closeModal('tag-cascade-modal');
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
  openModal('new-tag-modal');
  const sel = document.getElementById('new-tag-category') as HTMLSelectElement | null;
  sel?.querySelectorAll('option').forEach((o) => (o.selected = false));
  if (sel) sel.value = '';
  populateCategorySelect(sel, false);
  (document.getElementById('new-tag-name') as HTMLInputElement).focus();
}

export function closeNewTagModal(): void {
  closeModal('new-tag-modal');
  (document.getElementById('new-tag-name') as HTMLInputElement).value = '';
}

export async function submitNewTag(): Promise<void> {
  const name = (document.getElementById('new-tag-name') as HTMLInputElement).value.trim();
  const color = (document.getElementById('new-tag-color') as HTMLInputElement).value;
  if (!name) return;
  const catId = (document.getElementById('new-tag-category') as HTMLSelectElement)?.value || null;
  if (!catId) { w.showStatus('请先选择类别', 'error'); return; }
  const tag = await dbCreateTag(name, color);
  await dbUpdateTag(tag.id, { category_id: catId });
  await loadTags(); closeNewTagModal();
  if (w.newTagContext === 'form') {
    addFormTag(tag.id);
  }
  w.showStatus('标签创建成功', 'success');
}

export function clearFormGeneratedTags(): void {
  const el = document.getElementById('form-generated-tags');
  if (el) el.style.display = 'none';
  const list = document.getElementById('form-generated-tags-list');
  if (list) list.innerHTML = '';
}

function mkMiniBtn(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'min-width:34px;padding:6px 10px;font-size:12px;border-radius:var(--radius-sm);background:var(--surface-dim);color:var(--text-secondary);border:1px solid var(--border-light);cursor:pointer';
  if (disabled) {
    b.disabled = true;
    b.style.opacity = '0.4';
    b.style.cursor = 'not-allowed';
  } else {
    b.onclick = onClick;
  }
  return b;
}

export async function renderCategories(): Promise<void> {
  const c = document.getElementById('categories-list');
  if (!c) return;
  c.replaceChildren();
  const cats: any[] = await dbGetAllTagCategories();
  if (!cats.length) {
    c.innerHTML = '<div class="empty-state">暂无类别，请新增</div>';
    return;
  }
  cats.forEach((cat: any, i: number) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-light)';
    const name = document.createElement('span');
    name.style.cssText = 'flex:1;font-size:14px;font-weight:600;color:var(--text)';
    name.textContent = cat.name;
    row.appendChild(name);
    if (cat.is_system) {
      const badge = document.createElement('span');
      badge.textContent = '系统';
      badge.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:999px;background:var(--accent-light);color:var(--accent-dark);font-weight:700';
      row.appendChild(badge);
    }
    const up = mkMiniBtn('↑', i === 0, () => moveCategory(cat.id, -1));
    const down = mkMiniBtn('↓', i === cats.length - 1, () => moveCategory(cat.id, 1));
    const rename = mkMiniBtn('改名', !!cat.is_system, () => renameCategory(cat.id));
    const del = mkMiniBtn('删除', !!cat.is_system, () => deleteCategory(cat.id));
    if (cat.is_system) {
      del.title = '系统类别不可删除';
      rename.title = '系统类别不可改名';
    }
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(rename);
    row.appendChild(del);
    c.appendChild(row);
  });
}

export async function addCategory(): Promise<void> {
  const name = (prompt('新类别名称：') || '').trim();
  if (!name) return;
  await dbCreateTagCategory(name);
  await renderCategories();
  await renderVisibilityConfig();
  w.showStatus('已新增类别：' + name, 'success');
}

export async function renameCategory(id: string): Promise<void> {
  const cats: any[] = await dbGetAllTagCategories();
  const cat = cats.find((c) => c.id === id);
  if (!cat) return;
  const name = (prompt('修改类别名称：', cat.name) || '').trim();
  if (!name || name === cat.name) return;
  try {
    await dbRenameTagCategory(id, name);
    await renderCategories();
    await renderVisibilityConfig();
    w.showStatus('已改名：' + name, 'success');
  } catch (e: any) {
    w.showStatus(e?.message || '改名失败', 'error');
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const cats: any[] = await dbGetAllTagCategories();
  const cat = cats.find((c) => c.id === id);
  if (!cat) return;
  if (!confirm('删除类别「' + cat.name + '」？该类别下的标签将退回未分类。')) return;
  try {
    await dbDeleteTagCategory(id);
    await renderCategories();
    await renderVisibilityConfig();
    await loadTags();
    w.showStatus('已删除类别：' + cat.name, 'success');
  } catch (e: any) {
    w.showStatus(e?.message || '删除失败', 'error');
  }
}

export async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  await dbMoveTagCategory(id, dir);
  await renderCategories();
}

async function renderVisibilityGroup(kind: VisibilityKind, containerId: string): Promise<void> {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.replaceChildren();
  const cats: any[] = await dbGetAllTagCategories();
  const config: VisibilityConfig = await getVisibilityConfig(kind);
  cats.forEach((cat: any) => {
    const label = document.createElement('label');
    label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--surface-dim);border:1px solid var(--border-light);border-radius:999px;font-size:13px;cursor:pointer;color:var(--text)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = config.ids.includes(cat.id);
    cb.onchange = () => toggleVisibility(kind, cat.id, cb.checked);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(cat.name));
    c.appendChild(label);
  });
  const unLabel = document.createElement('label');
  unLabel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--warning-light);border:1px solid var(--warning);border-radius:999px;font-size:13px;cursor:pointer;color:var(--warning-dark);font-weight:600';
  const unCb = document.createElement('input');
  unCb.type = 'checkbox';
  unCb.checked = config.unclassified;
  unCb.onchange = () => toggleUnclassified(kind, unCb.checked);
  unLabel.appendChild(unCb);
  unLabel.appendChild(document.createTextNode('未分类'));
  c.appendChild(unLabel);
}

export async function renderVisibilityConfig(): Promise<void> {
  await renderVisibilityGroup('chapter', 'chapter-visibility');
  await renderVisibilityGroup('topic', 'topic-visibility');
}

// 可见性配置是同一份 app_settings 的「读-改-写」。app-settings 的写透缓存使连续切换的读命中内存，
// 两次写入在同一微任务批次内发出，避免第二次写入被 reload 抢占（曾导致「未分类」勾选被回滚）。
export async function toggleVisibility(kind: VisibilityKind, catId: string, checked: boolean): Promise<void> {
  const config = await getVisibilityConfig(kind);
  const ids = new Set(config.ids);
  if (checked) ids.add(catId);
  else ids.delete(catId);
  await setVisibilityConfig(kind, { ids: Array.from(ids), unclassified: config.unclassified });
}

export async function toggleUnclassified(kind: VisibilityKind, checked: boolean): Promise<void> {
  const config = await getVisibilityConfig(kind);
  await setVisibilityConfig(kind, { ids: config.ids, unclassified: checked });
}

// ========== 1.4 批量分类未分类标签（Agent 预分类 + 列表分页 + 默认全勾） ==========
// 语义：每行默认勾选=同意预分类；取消勾选=不同意，该标签保持未分类（不写入），由用户后续自行修改。
const BATCH_PAGE_SIZE = 20;

interface BatchRow { tagId: string; name: string; catName: string | null; checked: boolean; }

let _batchRows: BatchRow[] = [];
let _batchPage = 0;
let _batchCatIdByName = new Map<string, string>();

export async function openBatchCategorize(): Promise<void> {
  const cats: any[] = (await dbGetAllTagCategories()).filter((c: any) => !c.is_system);
  _batchCatIdByName = new Map(cats.map((c: any) => [c.name as string, c.id as string]));
  const unclassified: any[] = (w.allTags || []).filter((t: any) => !t.category_id);
  if (!unclassified.length) { w.showStatus('没有未分类的标签', 'info'); return; }
  _batchRows = unclassified.map((t: any) => ({
    tagId: t.id, name: t.name, catName: guessCategoryForTag(t.name), checked: true,
  }));
  _batchPage = 0;
  openModal('batch-categorize-modal');
  renderBatchPage();
}

function renderBatchPage(): void {
  const list = document.getElementById('batch-list');
  if (!list) return;
  const totalPages = Math.max(1, Math.ceil(_batchRows.length / BATCH_PAGE_SIZE));
  if (_batchPage < 0) _batchPage = 0;
  if (_batchPage > totalPages - 1) _batchPage = totalPages - 1;
  const start = _batchPage * BATCH_PAGE_SIZE;
  list.replaceChildren();
  _batchRows.slice(start, start + BATCH_PAGE_SIZE).forEach((row, i) => {
    const idx = start + i;
    const rowEl = document.createElement('label');
    rowEl.className = 'batch-row';
    rowEl.dataset.tagName = row.name;
    rowEl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border-light);cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'batch-row-check';
    cb.checked = row.checked;
    cb.style.cssText = 'width:18px;height:18px;accent-color:var(--primary);flex:0 0 auto;cursor:pointer';
    cb.onchange = () => { _batchRows[idx].checked = cb.checked; updateBatchFooter(); };
    const nm = document.createElement('span');
    nm.className = 'batch-row-name';
    nm.textContent = row.name;
    nm.style.cssText = 'flex:1;min-width:0;font-size:13px;color:var(--text)';
    const sel = document.createElement('select');
    sel.className = 'batch-cat-select';
    sel.style.cssText = 'flex:0 0 auto;min-width:120px;max-width:160px;padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text)';
    let matched = false;
    for (const [name, id] of _batchCatIdByName) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = name;
      if (name === row.catName) { o.selected = true; matched = true; }
      sel.appendChild(o);
    }
    if (!matched && sel.options.length) _batchRows[idx].catName = sel.options[0].textContent;
    if (sel.options.length) {
      sel.onchange = () => { _batchRows[idx].catName = sel.options[sel.selectedIndex].textContent; };
    }
    rowEl.append(cb, nm, sel);
    list.appendChild(rowEl);
  });
  updateBatchFooter();
}

function updateBatchFooter(): void {
  const totalPages = Math.max(1, Math.ceil(_batchRows.length / BATCH_PAGE_SIZE));
  const pageInfo = document.getElementById('batch-page-info');
  if (pageInfo) pageInfo.textContent = '第 ' + (_batchPage + 1) + '/' + totalPages + ' 页';
  const prog = document.getElementById('batch-progress');
  if (prog) prog.textContent = '共 ' + _batchRows.length + ' 个未分类标签 · 已勾选 ' + _batchRows.filter((r) => r.checked).length;
  const prev = document.getElementById('batch-prev-btn') as HTMLButtonElement | null;
  const next = document.getElementById('batch-next-btn') as HTMLButtonElement | null;
  if (prev) { prev.disabled = _batchPage <= 0; prev.style.opacity = prev.disabled ? '0.4' : '1'; }
  if (next) { next.disabled = _batchPage >= totalPages - 1; next.style.opacity = next.disabled ? '0.4' : '1'; }
}

export function batchPrevPage(): void {
  if (_batchPage <= 0) return;
  _batchPage--;
  renderBatchPage();
}

export function batchNextPage(): void {
  if ((_batchPage + 1) * BATCH_PAGE_SIZE >= _batchRows.length) return;
  _batchPage++;
  renderBatchPage();
}

export function batchSelectAllPage(): void { setPageChecked(true); }

export function batchDeselectAllPage(): void { setPageChecked(false); }

function setPageChecked(checked: boolean): void {
  const start = _batchPage * BATCH_PAGE_SIZE;
  const end = Math.min(start + BATCH_PAGE_SIZE, _batchRows.length);
  for (let i = start; i < end; i++) _batchRows[i].checked = checked;
  renderBatchPage();
}

async function writeCheckedRows(rows: BatchRow[]): Promise<number> {
  let written = 0;
  for (const r of rows) {
    if (!r.checked || !r.catName) continue;
    const catId = _batchCatIdByName.get(r.catName);
    if (!catId) continue;
    await dbUpdateTag(r.tagId, { category_id: catId });
    written++;
  }
  return written;
}

export async function confirmBatchCategorize(): Promise<void> {
  const totalPages = Math.max(1, Math.ceil(_batchRows.length / BATCH_PAGE_SIZE));
  const start = _batchPage * BATCH_PAGE_SIZE;
  const written = await writeCheckedRows(_batchRows.slice(start, start + BATCH_PAGE_SIZE));
  if (_batchPage >= totalPages - 1) { await finishBatch(written); return; }
  _batchPage++;
  renderBatchPage();
  w.showStatus('本页已确认 ' + written + ' 个', 'success');
}

export async function batchAgreeAll(): Promise<void> {
  const written = await writeCheckedRows(_batchRows);
  await finishBatch(written);
}

async function finishBatch(written: number): Promise<void> {
  closeModal('batch-categorize-modal');
  await loadTags();
  w.showStatus('批量分类完成，已写入 ' + written + ' 个标签', 'success');
}

export function closeBatchCategorize(): void {
  closeModal('batch-categorize-modal');
}

// ========== N1 未打标签的题入口 ==========
export async function openUntaggedModal(): Promise<void> {
  openModal('untagged-modal');
  await renderUntaggedList();
}

export function closeUntaggedModal(): void {
  closeModal('untagged-modal');
}

async function renderUntaggedList(): Promise<void> {
  const list = document.getElementById('untagged-list');
  if (!list) return;
  const qs: any[] = await listUntaggedQuestions();
  const countEl = document.getElementById('untagged-modal-count');
  if (countEl) countEl.textContent = '（' + qs.length + '）';
  list.innerHTML = '';
  const sel = document.getElementById('untagged-tag') as HTMLSelectElement | null;
  if (sel) {
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— 选择标签 —';
    sel.appendChild(none);
    for (const t of (w.allTags || []) as any[]) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    }
  }
  if (!qs.length) { list.innerHTML = '<div class="empty-state">没有未打标签的题</div>'; return; }
  qs.forEach((q: any) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border-light);cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.qid = q.id;
    cb.style.cssText = 'width:18px;height:18px;accent-color:var(--primary);flex-shrink:0';
    const img = document.createElement('img');
    img.src = q.question_image_url || '';
    img.style.cssText = 'width:48px;height:48px;object-fit:cover;border-radius:6px;background:var(--surface-dim);flex-shrink:0';
    img.onclick = (e) => { e.preventDefault(); w.showQuestionDetail(q.id); };
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    const meta = [q.book_name, q.page_number ? 'p.' + q.page_number : '', q.question_number ? '第' + q.question_number + '题' : ''].filter(Boolean).join(' ');
    const metaEl = document.createElement('div');
    metaEl.style.cssText = 'font-size:13px;color:var(--text)';
    metaEl.textContent = meta || '未命名题';
    info.appendChild(metaEl);
    row.append(cb, img, info);
    list.appendChild(row);
  });
}

export async function untaggedBatchAdd(): Promise<void> {
  const sel = document.getElementById('untagged-tag') as HTMLSelectElement | null;
  const tagId = sel?.value || null;
  if (!tagId) { w.showStatus('请先选择标签', 'error'); return; }
  const list = document.getElementById('untagged-list');
  const boxes = list ? (Array.from(list.querySelectorAll('input[type="checkbox"]:checked')) as HTMLInputElement[]) : [];
  if (!boxes.length) { w.showStatus('请先勾选题目', 'error'); return; }
  for (const b of boxes) { await w.dbAddTagToQuestion(b.dataset.qid, tagId); }
  w.showStatus('已为 ' + boxes.length + ' 题添加标签', 'success');
  await renderUntaggedList();
  await refreshTagManageCounts();
  await Promise.resolve(w.loadQuestions?.());
}

