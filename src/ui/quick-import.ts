import { fetchLatestMedias, getGalleryImageDataUrl } from './camera';
import { showStatus } from './common';
import {
  pickQuestionAnswerPair,
  countFreshMedias,
  loadImportedIds,
  markImportedIds,
  buildQuickCreateArgs,
  loadQuickLayoutType,
  layoutLabel,
  type GalleryMediaLite,
  type QuickPair,
} from '../services/quick-import';
import {
  resolveActiveCombo,
  comboVersionNames,
  getComboById,
  getActiveComboId,
} from '../services/version-combo';

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
  document.body.style.paddingTop = quickMode ? '150px' : '';
  if (!quickMode) return;

  const q = document.getElementById('qi-thumb-question') as HTMLImageElement | null;
  const a = document.getElementById('qi-thumb-answer') as HTMLImageElement | null;
  if (q) q.src = questionThumb;
  if (a) a.src = answerThumb;

  renderQuickSelectedTags();

  const comboBtn = document.getElementById('qi-combo-btn');
  if (comboBtn) {
    const combo = getComboById(getActiveComboId());
    const names = comboVersionNames(combo, (id) => w.getAppVersions?.().find((v: any) => v.id === id)?.name ?? null);
    comboBtn.textContent = (combo?.name || '组合') + (names.length ? '：' + names.join('+') : '') + ' ▾';
  }

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

export async function confirmQuickImport(): Promise<void> {
  if (!pair || loading) return;
  const combo = resolveActiveCombo(() => (w.getAppVersions?.() || []).map((v: any) => v.id));
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
