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

  const tagBox = document.getElementById('qi-tags');
  if (tagBox) {
    const names = quickTagIds
      .map((id) => (w.allTags || []).find((t: any) => t.id === id)?.name)
      .filter(Boolean);
    tagBox.textContent = names.length ? '🏷 ' + names.join('、') : '（未选标签）';
  }

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
