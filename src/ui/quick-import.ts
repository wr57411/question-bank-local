import { fetchLatestMedias, getGalleryImageDataUrl } from './camera';
import { showStatus } from './common';
import {
  pickQuestionAnswerPair,
  countFreshMedias,
  loadImportedIds,
  markImportedIds,
  buildQuickCreateArgs,
  loadQuickLayoutType,
  saveQuickLayoutType,
  toggleLayoutType,
  layoutLabel,
  layoutFullLabel,
  type GalleryMediaLite,
  type QuickPair,
} from '../services/quick-import';
import {
  resolveActiveCombo,
  comboVersionNames,
  comboPreviewText,
  getComboById,
  getComboDisplayText,
  getActiveComboId,
  loadVersionCombos,
  createVersionCombo,
  updateVersionCombo,
  deleteVersionCombo,
  setActiveComboId,
  type VersionCombo,
} from '../services/version-combo';
import { getAppVersions, getCurrentVersionId, type AppVersion } from '../services/version-skin';

const w = window as unknown as Record<string, any>;
const MODE_KEY = 'quickImportMode';
const FETCH_COUNT = 6;

let quickMode = false;
let pair: QuickPair | null = null;
let questionThumb = '';
let answerThumb = '';
let quickTagIds: string[] = [];
let loading = false;
let lastFetchAt = 0;
let tagPollTimer: number | null = null;
let lastTagInputValue = '';

function bar(): HTMLElement | null {
  return document.getElementById('quick-import-bar');
}

export function isQuickMode(): boolean {
  return quickMode;
}

export function toggleQuickImportMode(): void {
  quickMode = !quickMode;
  localStorage.setItem(MODE_KEY, quickMode ? '1' : '0');
  const btn = document.getElementById('quick-import-toggle');
  if (btn) btn.style.background = quickMode ? 'var(--primary)' : '';
  render();
  if (quickMode) void refreshGalleryPair();
  showStatus(quickMode ? '快速导入已开启' : '快速导入已关闭', 'success');
}

export async function refreshGalleryPair(): Promise<void> {
  if (!quickMode || loading) return;
  const now = Date.now();
  if (now - lastFetchAt < 3000) return;
  lastFetchAt = now;
  loading = true;
  renderHint('正在读取相册...');
  try {
    const medias = await fetchLatestMedias(FETCH_COUNT);
    if (!medias) {
      renderHint('当前不是原生环境，快速导入需要相册权限');
      pair = null;
      return;
    }
    const imported = new Set(loadImportedIds());
    pair = pickQuestionAnswerPair(medias as GalleryMediaLite[], imported);
    if (!pair) {
      const fresh = countFreshMedias(medias as GalleryMediaLite[], imported);
      renderHint(fresh === 1 ? '只检测到 1 张新照片，请再拍一张后返回' : '相册没有新照片，拍两张后切回本 App');
    } else {
      questionThumb = thumbOf(pair.question);
      answerThumb = thumbOf(pair.answer);
      renderHint('');
    }
  } catch (e: any) {
    renderHint('相册读取失败：' + (e?.message || e));
    pair = null;
  } finally {
    loading = false;
    render();
  }
}

function thumbOf(m: GalleryMediaLite): string {
  if (!m?.data) return '';
  return m.data.startsWith('data:') ? m.data : 'data:image/jpeg;base64,' + m.data;
}

function renderHint(text: string): void {
  const el = document.getElementById('qi-hint');
  if (el) el.textContent = text;
}

export function swapQuickPair(): void {
  if (!pair) return;
  pair = { question: pair.answer, answer: pair.question };
  const t = questionThumb;
  questionThumb = answerThumb;
  answerThumb = t;
  render();
}

function render(): void {
  const el = bar();
  if (!el) return;
  el.style.display = quickMode ? '' : 'none';
  document.body.style.paddingTop = quickMode ? '196px' : '';
  if (!quickMode) return;

  const q = document.getElementById('qi-thumb-question') as HTMLImageElement | null;
  const a = document.getElementById('qi-thumb-answer') as HTMLImageElement | null;
  if (q) q.src = questionThumb;
  if (a) a.src = answerThumb;

  renderQuickSelectedTags();

  syncComboButton();

  const layoutBtn = document.getElementById('qi-layout-btn');
  if (layoutBtn) layoutBtn.textContent = layoutLabel(loadQuickLayoutType());

  const confirmBtn = document.getElementById('qi-confirm-btn') as HTMLButtonElement | null;
  if (confirmBtn) {
    confirmBtn.disabled = !pair;
    confirmBtn.style.opacity = pair ? '1' : '.45';
  }

  const tagInput = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  if (tagInput && !tagInput.dataset.qiBound) {
    tagInput.dataset.qiBound = '1';
    tagInput.addEventListener('input', onQuickTagInput);
    tagInput.addEventListener('focus', startQuickTagPoll);
    tagInput.addEventListener('blur', () => {
      stopQuickTagPoll();
    });
    tagInput.addEventListener('keydown', onQuickTagKeydown);
  }
}

function syncComboButton(): void {
  const comboBtn = document.getElementById('qi-combo-btn');
  if (!comboBtn) return;
  const combo = getComboById(getActiveComboId());
  const names = comboVersionNames(combo, (id) => getAppVersions().find((v) => v.id === id)?.name ?? null);
  comboBtn.textContent = (getComboDisplayText(combo) || '组合') + ' ▾';
  comboBtn.title = combo?.name ? combo.name + '：' + names.join('、') : '点击新建版本组合';
}

export async function confirmQuickImport(): Promise<void> {
  if (!pair || loading) return;
  const combo = resolveActiveCombo(() => getAppVersions().map((v) => v.id));
  const ids = [pair.question.identifier, pair.answer.identifier];
  loading = true;
  renderHint('正在导入...');
  try {
    const qUrl = await compress(await getGalleryImageDataUrl(pair.question.identifier));
    const aUrl = await compress(await getGalleryImageDataUrl(pair.answer.identifier));
    const args = buildQuickCreateArgs(qUrl, aUrl, quickTagIds, combo.versionIds, loadQuickLayoutType());
    const created = await w.dbCreateQuestion(
      args.questionImageUrl,
      args.answerImageUrl,
      args.tagIds,
      args.layoutType,
      args.blankImageUrl,
      args.versions,
      args.bookInfo
    );
    if (created?.question_image_url) {
      await w.dbAddQuestionNote(created.id, created.question_image_url, '笔记 v1', '');
    }
    markImportedIds(ids);
    quickTagIds = [];
    pair = null;
    questionThumb = '';
    answerThumb = '';
    showStatus('题目已导入', 'success');
    await Promise.resolve(w.loadQuestions?.());
    await Promise.resolve(w.loadBookFilter?.());
  } catch (e: any) {
    showStatus('导入失败：' + (e?.message || e), 'error');
  } finally {
    loading = false;
    lastFetchAt = 0;
    render();
    void refreshGalleryPair();
  }
}

async function compress(dataUrl: string): Promise<string> {
  const fn = w.compressImage as ((i: string, m?: number, q?: number) => Promise<string>) | undefined;
  return fn ? fn(dataUrl, 1200, 0.8) : dataUrl;
}

export function onQuickTagInput(): void {
  const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  const box = document.getElementById('qi-tag-results');
  if (!input || !box) return;
  const query = input.value.trim().toLowerCase();
  const all: any[] = w.allTags || [];
  let matches = all.filter((t: any) => !quickTagIds.includes(t.id));
  if (query) matches = matches.filter((t: any) => String(t.name).toLowerCase().includes(query));
  matches = matches.slice(0, 50);

  box.innerHTML = '';
  if (matches.length === 0 && !query) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';

  if (matches.length === 0) {
    box.appendChild(createTagChip(input.value.trim()));
    return;
  }
  for (const t of matches) box.appendChild(tagCandidateChip(t, input));
}

function tagCandidateChip(tag: any, input: HTMLInputElement): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:var(--surface-dim);border:1px solid var(--border-light);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;flex-shrink:0';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + tag.color + ';flex-shrink:0';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = tag.name;
  btn.append(dot, nameSpan);
  btn.onclick = () => {
    addQuickTag(tag.id);
    input.value = '';
    onQuickTagInput();
  };
  return btn;
}

function createTagChip(name: string): HTMLSpanElement {
  const btn = document.createElement('span');
  btn.style.cssText = 'display:inline-flex;align-items:center;padding:5px 10px;background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius-xl);font-size:12px;cursor:pointer;color:var(--accent);flex-shrink:0';
  btn.textContent = '＋ 创建: "' + name + '"';
  btn.onclick = () => void createQuickTag(name);
  return btn;
}

export function addQuickTag(id: string): void {
  if (quickTagIds.includes(id)) return;
  quickTagIds.push(id);
  render();
}

export function removeQuickTag(id: string): void {
  quickTagIds = quickTagIds.filter((x) => x !== id);
  render();
  onQuickTagInput();
}

export async function createQuickTag(name: string): Promise<void> {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    showStatus('请输入标签名', 'error');
    return;
  }
  let tag = (w.allTags || []).find((t: any) => t.name === trimmed);
  if (!tag) {
    tag = await w.dbCreateTag(trimmed, '#4CC3FF');
    await Promise.resolve(w.loadTags?.());
  }
  if (tag?.id) addQuickTag(tag.id);
  const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
  if (input) input.value = '';
  onQuickTagInput();
  showStatus('已添加标签: ' + trimmed, 'success');
}

export function onQuickTagKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const box = document.getElementById('qi-tag-results');
  const first = box ? box.querySelector('span') : null;
  if (first) (first as HTMLElement).click();
}

export function renderQuickSelectedTags(): void {
  const div = document.getElementById('qi-tags');
  if (!div) return;
  div.innerHTML = '';
  if (quickTagIds.length === 0) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:11px;color:var(--text-tertiary);flex-shrink:0';
    empty.textContent = '（未选标签）';
    div.appendChild(empty);
    return;
  }
  quickTagIds.forEach((tagId) => {
    const tag = (w.allTags || []).find((t: any) => t.id === tagId);
    if (!tag) return;
    const el = document.createElement('span');
    el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:' + tag.color + '15;border:1px solid ' + tag.color + '40;border-radius:var(--radius-xl);font-size:11px;font-weight:500;color:var(--text);white-space:nowrap;flex-shrink:0';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + tag.color + ';flex-shrink:0';
    const name = document.createElement('span');
    name.textContent = tag.name;
    const rm = document.createElement('span');
    rm.textContent = '✕';
    rm.style.cssText = 'cursor:pointer;color:var(--text-tertiary);margin-left:2px';
    rm.onclick = () => removeQuickTag(tag.id);
    el.append(dot, name, rm);
    div.appendChild(el);
  });
}

export function startQuickTagPoll(): void {
  stopQuickTagPoll();
  lastTagInputValue = (document.getElementById('qi-tag-input') as HTMLInputElement | null)?.value || '';
  tagPollTimer = window.setInterval(() => {
    const input = document.getElementById('qi-tag-input') as HTMLInputElement | null;
    if (!input) return;
    if (input.value !== lastTagInputValue) {
      lastTagInputValue = input.value;
      onQuickTagInput();
    }
  }, 150);
}

export function stopQuickTagPoll(): void {
  if (tagPollTimer !== null) {
    clearInterval(tagPollTimer);
    tagPollTimer = null;
  }
}

export function openComboPanel(): void {
  const panel = document.getElementById('quick-combo-panel');
  if (!panel) return;
  panel.style.display = '';
  renderComboList();
}

export function closeComboPanel(): void {
  const panel = document.getElementById('quick-combo-panel');
  if (panel) panel.style.display = 'none';
}

export function renderComboList(): void {
  const list = document.getElementById('qi-combo-list');
  if (!list) return;
  const combos = loadVersionCombos();
  const activeId = getActiveComboId();
  list.innerHTML = '';
  if (combos.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'font-size:12px;color:var(--text-tertiary);margin:0 0 8px';
    empty.textContent = '还没有组合，下面输入名称新建一个。';
    list.appendChild(empty);
  }
  for (const c of combos) list.appendChild(comboRow(c, c.id === activeId));
}

function comboRow(combo: VersionCombo, active: boolean): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = 'padding:10px;border:1.5px solid ' + (active ? 'var(--primary)' : 'var(--border)')
    + ';border-radius:var(--radius-md);margin-bottom:8px;background:' + (active ? 'var(--primary-light)' : 'var(--surface)');

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px';

  const title = document.createElement('span');
  title.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:700;cursor:pointer';
  title.textContent = (active ? '✅ ' : '') + combo.name;
  title.onclick = () => {
    setActiveComboId(combo.id);
    renderComboList();
    render();
  };

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.textContent = '✏️';
  rename.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px';
  rename.onclick = () => {
    const next = prompt('组合名称', combo.name);
    if (next && next.trim()) {
      updateVersionCombo(combo.id, { name: next.trim() });
      renderComboList();
      render();
    }
  };

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = '🗑';
  del.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px';
  del.onclick = () => {
    if (!confirm('删除组合「' + combo.name + '」？')) return;
    deleteVersionCombo(combo.id);
    renderComboList();
    render();
  };

  head.append(title, rename, del);

  const displayInput = document.createElement('input');
  displayInput.type = 'text';
  displayInput.value = combo.displayName || '';
  displayInput.placeholder = '显示名（留空用组合名）';
  displayInput.autocomplete = 'off';
  displayInput.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:8px 0 2px;padding:7px 9px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:13px;background:var(--surface);color:var(--text)';
  displayInput.oninput = () => {
    updateVersionCombo(combo.id, { displayName: displayInput.value.trim() });
    syncComboButton();
  };

  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
  for (const v of getAppVersions()) chips.appendChild(versionChip(combo, v));

  row.append(head, displayInput, chips);
  return row;
}

function versionChip(combo: VersionCombo, version: AppVersion): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 9px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:12px;cursor:pointer;background:var(--surface)';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = combo.versionIds.includes(version.id);
  cb.style.cssText = 'accent-color:' + version.theme.primary + ';width:15px;height:15px;cursor:pointer';

  const span = document.createElement('span');
  span.textContent = version.emoji + ' ' + version.name;

  const updateStyle = () => {
    wrap.style.background = cb.checked ? version.theme.primary + '15' : 'var(--surface)';
    wrap.style.borderColor = cb.checked ? version.theme.primary : 'var(--border)';
  };

  const toggle = () => {
    const nextIds = cb.checked
      ? [...new Set([...combo.versionIds, version.id])]
      : combo.versionIds.filter((id) => id !== version.id);
    updateVersionCombo(combo.id, { versionIds: nextIds });
    combo.versionIds = nextIds;
    updateStyle();
    render();
  };

  cb.onchange = toggle;
  wrap.onclick = (e) => {
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    toggle();
  };

  updateStyle();
  wrap.append(cb, span);
  return wrap;
}

export function createComboFromPanel(): void {
  const input = document.getElementById('qi-combo-name') as HTMLInputElement | null;
  const name = input?.value.trim();
  if (!name) {
    showStatus('请输入组合名称', 'error');
    return;
  }
  const currentVersionId = getCurrentVersionId();
  const combo = createVersionCombo(name, currentVersionId ? [currentVersionId] : []);
  const suggested = comboPreviewText(combo, (id) => getAppVersions().find((v) => v.id === id)?.name ?? null);
  if (suggested) updateVersionCombo(combo.id, { displayName: suggested });
  setActiveComboId(combo.id);
  if (input) input.value = '';
  renderComboList();
  render();
  showStatus('已创建' + combo.name, 'success');
}

export function toggleQuickLayout(): void {
  const next = toggleLayoutType(loadQuickLayoutType());
  saveQuickLayoutType(next);
  syncFormLayoutRadio(next);
  render();
  showStatus('已设为' + layoutFullLabel(next), 'success');
}

function syncFormLayoutRadio(layoutType: number): void {
  const radio = document.querySelector('input[name="layout_type"][value="' + layoutType + '"]') as HTMLInputElement | null;
  if (!radio) return;
  radio.checked = true;
  const option = radio.closest('.layout-option') as HTMLElement | null;
  if (option && typeof w.selectLayout === 'function') w.selectLayout(option, String(layoutType));
}

export function renderQuickImportBar(): void {
  render();
}

export function initQuickImportMode(): void {
  quickMode = localStorage.getItem(MODE_KEY) === '1';
  const btn = document.getElementById('quick-import-toggle');
  if (btn) btn.style.background = quickMode ? 'var(--primary)' : '';
  syncFormLayoutRadio(loadQuickLayoutType());
  render();

  const onForeground = () => {
    if (!quickMode) return;
    lastFetchAt = 0;
    void refreshGalleryPair();
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) onForeground();
  });
  window.addEventListener('focus', onForeground);
  window.addEventListener('pageshow', onForeground);

  if (quickMode) void refreshGalleryPair();
}
