/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal, showStatus } from './common';
import {
  dbGetAllGroups, dbGetGroup, dbCreateGroup, dbUpdateGroup, dbDeleteGroup,
  getGroupManualMemberCount, getGroupMemberQuestionIds, buildGroupQuestionTagMap,
  dbGetAllTags, dbGetAllTagCategories, getVisibilityConfig,
  evalExpr, formatExpr, collectExprTagIds, collectDeadTagRefs,
  type QuestionTagMap, type ExprCountNode,
} from '../data';
import type { ExprNode, Tag } from '../types';

interface GroupEditorState {
  id: string | null;
  kind: 'chapter' | 'topic';
  name: string;
  expr: ExprNode;
  memberTagId: string | null;
  counts: ExprCountNode | null;
  tagMap: Map<string, Tag>;
  tagCounts: Map<string, number>;
  questionTags: QuestionTagMap;
  sysCategoryId: string | null;
  crossRefs: Map<string, string[]>;
  visCategoryIds: string[];
  visUnclassified: boolean;
  pickerPath: string | null;
  pickerQuery: string;
  hideUnused: boolean;
}

let _editor: GroupEditorState | null = null;
let _pendingDeleteGroupId: string | null = null;

function cloneExpr(expr: ExprNode): ExprNode {
  return JSON.parse(JSON.stringify(expr)) as ExprNode;
}

function updateGroupAtPath(
  expr: ExprNode,
  path: string,
  updater: (group: { op: 'and' | 'or'; children: ExprNode[] }) => void,
): ExprNode {
  const clone = cloneExpr(expr);
  let node: any = clone;
  if (path) for (const p of path.split('.')) node = node.children[Number(p)];
  updater(node);
  return clone;
}

function countsAtPath(counts: ExprCountNode | null, path: string): ExprCountNode | null {
  if (!counts || !path) return counts;
  let node: ExprCountNode = counts;
  for (const p of path.split('.')) {
    if ('tag' in node) return null;
    node = node.children[Number(p)];
    if (!node) return null;
  }
  return node;
}

function manualQuestionIds(tagId: string | null, questionTags: QuestionTagMap): Set<string> {
  const ids = new Set<string>();
  if (!tagId) return ids;
  for (const [qid, tags] of questionTags) if (tags.has(tagId)) ids.add(qid);
  return ids;
}

// 裁决1（§0.5 A5）：章节只允许「或」，且不允许分组；专题允许且/或 + 一层子分组。
// 数据结构同构，限制只在此 UI 校验（保存前兜底）。
function validateExpr(expr: ExprNode, kind: 'chapter' | 'topic'): string | null {
  if ('tag' in expr) return null;
  if (kind === 'chapter') {
    if (expr.op !== 'or') return '章节仅支持「或」关系';
    if (expr.children.some((ch) => !('tag' in ch))) return '章节不支持分组条件';
    return null;
  }
  for (const ch of expr.children) {
    if ('op' in ch && ch.children.some((gc) => !('tag' in gc))) return '条件最多嵌套两层';
  }
  return null;
}

export async function openGroupEditor(groupId?: string, kind?: 'chapter' | 'topic'): Promise<void> {
  const tagMap = new Map<string, Tag>((await dbGetAllTags()).map((t) => [t.id, t]));
  const questionTags = await buildGroupQuestionTagMap();
  const tagCounts = new Map<string, number>();
  for (const tags of questionTags.values()) {
    for (const id of tags) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }
  const cats = await dbGetAllTagCategories();
  const sys = cats.find((c) => c.is_system);
  const all = await dbGetAllGroups();
  const crossRefs = new Map<string, string[]>();
  for (const g of all) {
    if (groupId && g.id === groupId) continue;
    for (const tid of new Set(collectExprTagIds(g.expr))) {
      if (!crossRefs.has(tid)) crossRefs.set(tid, []);
      crossRefs.get(tid)!.push(g.name);
    }
  }

  let base: Pick<GroupEditorState, 'id' | 'kind' | 'name' | 'expr' | 'memberTagId'>;
  if (groupId) {
    const g = await dbGetGroup(groupId);
    if (!g) { showStatus('未找到该项', 'error'); return; }
    base = { id: g.id, kind: g.kind, name: g.name, expr: cloneExpr(g.expr), memberTagId: g.member_tag_id };
  } else {
    const k = kind ?? 'topic';
    base = { id: null, kind: k, name: '', expr: { op: 'or', children: [] }, memberTagId: null };
  }

  const vis = await getVisibilityConfig(base.kind);
  _editor = {
    ...base,
    counts: null,
    tagMap,
    tagCounts,
    questionTags,
    sysCategoryId: sys ? sys.id : null,
    crossRefs,
    visCategoryIds: vis.ids,
    visUnclassified: vis.unclassified,
    pickerPath: null,
    pickerQuery: '',
    hideUnused: true,
  };
  openModal('group-editor-modal');
  renderEditor();
}

export function closeGroupEditor(): void {
  _editor = null;
  closeModal('group-editor-modal');
}

function renderEditor(): void {
  const s = _editor;
  if (!s) return;

  const title = document.getElementById('group-editor-title');
  if (title) title.textContent = (s.id ? '编辑' : '新建') + (s.kind === 'chapter' ? '章节' : '专题');
  const nameInput = document.getElementById('group-editor-name') as HTMLInputElement | null;
  if (nameInput) nameInput.value = s.name;
  const kindSel = document.getElementById('group-editor-kind') as HTMLSelectElement | null;
  if (kindSel) {
    kindSel.value = s.kind;
    kindSel.onchange = async () => {
      const inst = _editor;
      if (!inst) return;
      inst.kind = kindSel.value === 'chapter' ? 'chapter' : 'topic';
      const vis = await getVisibilityConfig(inst.kind);
      inst.visCategoryIds = vis.ids;
      inst.visUnclassified = vis.unclassified;
      renderEditor();
    };
  }
  const kindGroup = document.getElementById('group-editor-kind-group');
  if (kindGroup) kindGroup.style.display = s.id ? 'none' : 'block';

  const evaluated = evalExpr(s.expr, s.questionTags);
  s.counts = evaluated.counts;
  const manual = manualQuestionIds(s.memberTagId, s.questionTags);
  const union = new Set<string>(evaluated.hits);
  for (const id of manual) union.add(id);

  renderTree();
  renderSummary(evaluated.hits.size, manual.size, union.size);
}

function renderSummary(exprHits: number, manualHits: number, unionSize: number): void {
  const s = _editor;
  if (!s) return;
  const summary = document.getElementById('group-editor-summary');
  if (summary) {
    summary.textContent = s.kind === 'topic'
      ? `最终题数：${unionSize} 题（表达式 ${exprHits} 题 ∪ 手动归入 ${manualHits} 题）`
      : `最终题数：${exprHits} 题`;
  }
  const echo = document.getElementById('group-editor-echo');
  if (echo) {
    const nameOf = (id: string) => s.tagMap.get(id)?.name ?? '已删除标签';
    echo.textContent = '回显：' + formatExpr(s.expr, nameOf);
  }
  const warn = document.getElementById('group-editor-warn');
  if (warn) {
    const dead = collectDeadTagRefs(s.expr, s.tagMap.keys());
    warn.textContent = dead.length ? `含 ${dead.length} 个已删除标签引用，建议移除` : '';
  }
}

function renderTree(): void {
  const s = _editor;
  if (!s) return;
  const c = document.getElementById('group-editor-tree');
  if (!c) return;
  c.replaceChildren();
  if (!('tag' in s.expr)) c.appendChild(renderGroupNode(s.expr, '', true));
  if (s.pickerPath !== null) {
    renderPickerResults();
    const input = document.getElementById('group-editor-tag-search') as HTMLInputElement | null;
    if (input) input.focus();
  }
}

function makeOpToggle(path: string, op: 'and' | 'or'): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'gexpr-op-group';
  for (const o of ['or', 'and'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gexpr-op' + (o === op ? ' active' : '');
    b.dataset.op = o;
    b.dataset.path = path;
    b.textContent = o === 'or' ? '或' : '且';
    b.onclick = () => applyEdit((expr) => updateGroupAtPath(expr, path, (g) => { g.op = o; }));
    wrap.appendChild(b);
  }
  return wrap;
}

function renderGroupNode(node: { op: 'and' | 'or'; children: ExprNode[] }, path: string, isRoot: boolean): HTMLElement {
  const s = _editor!;
  const box = document.createElement('div');
  box.className = 'gexpr-node gexpr-group';
  box.dataset.path = path;

  const head = document.createElement('div');
  head.className = 'gexpr-node-head';
  // 章节只给「或」：不渲染 op 切换（裁决1）
  if (s.kind !== 'chapter') head.appendChild(makeOpToggle(path, node.op));
  const count = document.createElement('span');
  count.className = 'gexpr-count';
  count.textContent = (countsAtPath(s.counts, path)?.count ?? 0) + ' 题';
  head.appendChild(count);
  box.appendChild(head);

  const children = document.createElement('div');
  children.className = 'gexpr-children';
  node.children.forEach((child, i) => {
    const childPath = path ? `${path}.${i}` : String(i);
    if ('tag' in child) children.appendChild(renderLeafNode(child.tag, childPath));
    else children.appendChild(renderGroupNode(child, childPath, false));
  });
  box.appendChild(children);

  const actions = document.createElement('div');
  actions.className = 'gexpr-node-actions';
  const addMember = document.createElement('button');
  addMember.type = 'button';
  addMember.className = 'gexpr-add-member';
  addMember.dataset.path = path;
  addMember.textContent = '＋ 标签';
  addMember.onclick = () => openPicker(path);
  actions.appendChild(addMember);
  if (isRoot && s.kind === 'topic') {
    const addSub = document.createElement('button');
    addSub.type = 'button';
    addSub.className = 'gexpr-add-subgroup';
    addSub.textContent = '＋ 子分组';
    addSub.onclick = () => applyEdit((expr) => updateGroupAtPath(expr, '', (g) => { g.children.push({ op: 'or', children: [] }); }));
    actions.appendChild(addSub);
  }
  box.appendChild(actions);

  if (s.pickerPath === path) box.appendChild(renderPickerBox());
  return box;
}

function renderLeafNode(tagId: string, path: string): HTMLElement {
  const s = _editor!;
  const row = document.createElement('div');
  row.className = 'gexpr-node gexpr-leaf';
  row.dataset.path = path;
  const tag = s.tagMap.get(tagId);
  const dot = document.createElement('span');
  dot.className = 'gexpr-dot';
  dot.style.background = tag ? tag.color : 'var(--text-tertiary)';
  const name = document.createElement('span');
  name.className = 'gexpr-leaf-name';
  name.textContent = tag ? tag.name : '已删除标签';
  const count = document.createElement('span');
  count.className = 'gexpr-count';
  count.textContent = (countsAtPath(s.counts, path)?.count ?? 0) + ' 题';
  const rm = document.createElement('span');
  rm.className = 'gexpr-remove';
  rm.textContent = '×';
  rm.onclick = () => removeChildAtPath(path);
  row.append(dot, name, count, rm);
  return row;
}

function renderPickerBox(): HTMLElement {
  const s = _editor!;
  const box = document.createElement('div');
  box.id = 'gexpr-picker';
  box.className = 'gexpr-picker';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'group-editor-tag-search';
  input.placeholder = '搜索标签…';
  input.autocomplete = 'off';
  input.value = s.pickerQuery;
  input.addEventListener('input', () => {
    s.pickerQuery = input.value;
    renderPickerResults();
  });
  box.appendChild(input);

  const label = document.createElement('label');
  label.className = 'gexpr-hide-unused-label';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'group-editor-hide-unused';
  cb.checked = s.hideUnused;
  cb.addEventListener('change', () => {
    s.hideUnused = cb.checked;
    renderPickerResults();
  });
  label.appendChild(cb);
  label.appendChild(document.createTextNode(' 隐藏未使用'));
  box.appendChild(label);

  const results = document.createElement('div');
  results.id = 'group-editor-tag-results';
  results.className = 'gexpr-tag-results';
  box.appendChild(results);

  const hint = document.createElement('div');
  hint.id = 'group-editor-unclassified-hint';
  hint.className = 'gexpr-unclassified-hint';
  box.appendChild(hint);
  return box;
}

function renderPickerResults(): void {
  const s = _editor;
  if (!s) return;
  const box = document.getElementById('group-editor-tag-results');
  if (!box) return;
  box.replaceChildren();

  const used = new Set(collectExprTagIds(s.expr));
  const q = s.pickerQuery.trim().toLowerCase();
  const vis = new Set(s.visCategoryIds);
  const list = [...s.tagMap.values()]
    .filter((t) => {
      if (s.sysCategoryId && t.category_id === s.sysCategoryId) return false;
      if (t.category_id) {
        if (!vis.has(t.category_id)) return false;
      } else {
        // D-b：章节选择器不显示未分类标签（改提示去分类）；专题选择器保留。
        if (s.kind === 'chapter') return false;
        if (!s.visUnclassified) return false;
      }
      if (used.has(t.id)) return false;
      if (s.hideUnused && (s.tagCounts.get(t.id) ?? 0) === 0) return false;
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => (s.tagCounts.get(b.id) ?? 0) - (s.tagCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'zh'));

  const capped = list.slice(0, 60);
  if (!capped.length) {
    const empty = document.createElement('div');
    empty.className = 'gexpr-picker-empty';
    empty.textContent = q ? '无匹配标签' : '无可选标签';
    box.appendChild(empty);
  } else {
    for (const t of capped) box.appendChild(renderTagItem(t));
  }

  const hint = document.getElementById('group-editor-unclassified-hint');
  if (hint) {
    hint.textContent = '';
    if (s.kind === 'chapter') {
      const unclassified = [...s.tagMap.values()].filter((t) => !t.category_id).length;
      if (unclassified > 0) {
        hint.appendChild(document.createTextNode(`还有 ${unclassified} 个未分类标签 → `));
        const a = document.createElement('span');
        a.className = 'gexpr-goto-category';
        a.textContent = '去分类';
        a.style.cursor = 'pointer';
        a.onclick = () => {
          closeGroupEditor();
          (window as any).openBatchCategorize?.();
        };
        hint.appendChild(a);
      }
    }
  }
}

function renderTagItem(t: Tag): HTMLElement {
  const s = _editor!;
  const item = document.createElement('span');
  item.className = 'gexpr-tag-item';
  item.dataset.tagId = t.id;
  const dot = document.createElement('span');
  dot.className = 'gexpr-tag-dot';
  dot.style.background = t.color;
  const name = document.createElement('span');
  name.className = 'gexpr-tag-name';
  name.textContent = t.name;
  const count = document.createElement('span');
  count.className = 'gexpr-tag-count';
  count.textContent = (s.tagCounts.get(t.id) ?? 0) + ' 题';
  item.append(dot, name, count);

  const refs = s.crossRefs.get(t.id);
  if (refs && refs.length) {
    const badge = document.createElement('span');
    badge.className = 'gexpr-tag-ref';
    badge.textContent = '已用于 ' + refs.slice(0, 2).join('、') + (refs.length > 2 ? ' 等' : '');
    item.appendChild(badge);
  }
  item.onclick = () => {
    if (s.pickerPath === null) return;
    const target = s.pickerPath;
    s.expr = updateGroupAtPath(s.expr, target, (g) => { g.children.push({ tag: t.id }); });
    renderEditor();
  };
  return item;
}

function openPicker(path: string): void {
  const s = _editor;
  if (!s) return;
  s.pickerPath = path;
  s.pickerQuery = '';
  renderEditor();
}

function applyEdit(mutate: (expr: ExprNode) => ExprNode): void {
  const s = _editor;
  if (!s) return;
  s.expr = mutate(s.expr);
  renderEditor();
}

function removeChildAtPath(path: string): void {
  const idx = path.lastIndexOf('.');
  const parent = idx < 0 ? '' : path.slice(0, idx);
  const childIndex = Number(path.slice(idx + 1));
  applyEdit((expr) => updateGroupAtPath(expr, parent, (g) => { g.children.splice(childIndex, 1); }));
}

export async function saveGroupEditor(): Promise<void> {
  const s = _editor;
  if (!s) return;
  const nameInput = document.getElementById('group-editor-name') as HTMLInputElement | null;
  const name = (nameInput?.value || '').trim();
  if (!name) { showStatus('请填写名称', 'error'); return; }
  const err = validateExpr(s.expr, s.kind);
  if (err) { showStatus(err, 'error'); return; }
  const isNew = !s.id;
  if (s.id) await dbUpdateGroup(s.id, { name, expr: s.expr });
  else await dbCreateGroup({ kind: s.kind, name, expr: s.expr });
  closeGroupEditor();
  await Promise.resolve((window as any).refreshAll?.());
  await renderGroupManage();
  showStatus(isNew ? '已创建' : '已保存', 'success');
}

// ========== 2.5 设置落点：标签管理 Tab「章节 · 专题」分区 ==========
export async function renderGroupManage(): Promise<void> {
  const c = document.getElementById('groups-list');
  if (!c) return;
  c.replaceChildren();
  const all = await dbGetAllGroups();
  const nameOf = new Map((await dbGetAllTags()).map((t) => [t.id, t.name]));

  for (const [kind, label] of [['chapter', '章节'], ['topic', '专题']] as const) {
    const sec = document.createElement('div');
    sec.className = 'group-section';
    const head = document.createElement('h3');
    head.className = 'group-section-head';
    const list = all.filter((g) => g.kind === kind);
    head.textContent = `${label}（${list.length}）`;
    sec.appendChild(head);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'gexpr-picker-empty';
      empty.textContent = `暂无${label}`;
      sec.appendChild(empty);
    }
    for (const g of list) {
      const row = document.createElement('div');
      row.className = 'group-row';
      row.dataset.groupId = g.id;

      const main = document.createElement('div');
      main.className = 'group-row-main';
      const nm = document.createElement('div');
      nm.className = 'group-row-name';
      nm.textContent = g.name;
      const echo = document.createElement('div');
      echo.className = 'group-row-echo';
      echo.textContent = formatExpr(g.expr, (id) => nameOf.get(id) ?? '已删除标签');
      main.append(nm, echo);

      const meta = document.createElement('div');
      meta.className = 'group-row-meta';
      meta.textContent = (await getGroupMemberQuestionIds(g.id)).length + ' 题';

      const actions = document.createElement('div');
      actions.className = 'group-row-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn-mini';
      edit.textContent = '编辑';
      edit.onclick = () => { void openGroupEditor(g.id); };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-mini';
      del.textContent = '删除';
      del.onclick = () => { void requestDeleteGroup(g.id); };
      actions.append(edit, del);

      row.append(main, meta, actions);
      sec.appendChild(row);
    }
    c.appendChild(sec);
  }
}

// ========== 2.8 删专题：级联移除系统成员标签 + 提示手动归入题数 ==========
export async function requestDeleteGroup(groupId: string): Promise<void> {
  const g = await dbGetGroup(groupId);
  if (!g) return;
  const isTopic = g.kind === 'topic';
  const manual = isTopic ? await getGroupManualMemberCount(groupId) : 0;
  _pendingDeleteGroupId = groupId;
  const title = document.getElementById('group-delete-title');
  if (title) title.textContent = `删除${isTopic ? '专题' : '章节'}「${g.name}」`;
  const msg = document.getElementById('group-delete-message');
  if (msg) {
    msg.textContent = isTopic
      ? `该专题有 ${manual} 道手动归入的题，删除后这些归入关系解除（题目本身不受影响）。其系统成员标签会一并移除，避免标签池堆积死标签。`
      : '删除后该章节从列表移除；题目本身不受影响。';
  }
  openModal('group-delete-modal');
}

export async function confirmDeleteGroup(): Promise<void> {
  const id = _pendingDeleteGroupId;
  _pendingDeleteGroupId = null;
  closeModal('group-delete-modal');
  if (!id) return;
  await dbDeleteGroup(id);
  await Promise.resolve((window as any).refreshAll?.());
  await renderGroupManage();
  showStatus('已删除', 'success');
}

export function closeGroupDeleteModal(): void {
  _pendingDeleteGroupId = null;
  closeModal('group-delete-modal');
}
