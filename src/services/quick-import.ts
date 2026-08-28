export interface GalleryMediaLite {
  identifier: string;
  data?: string;
  creationDate?: string;
}

export interface QuickPair {
  question: GalleryMediaLite;
  answer: GalleryMediaLite;
}

export function filterFreshMedias(medias: GalleryMediaLite[], importedIds: Set<string>): GalleryMediaLite[] {
  return (medias || []).filter((m) => !!m && !!m.identifier && !importedIds.has(m.identifier));
}

export function countFreshMedias(medias: GalleryMediaLite[], importedIds: Set<string>): number {
  return filterFreshMedias(medias, importedIds).length;
}

export function pickQuestionAnswerPair(medias: GalleryMediaLite[], importedIds: Set<string>): QuickPair | null {
  const fresh = filterFreshMedias(medias, importedIds);
  if (fresh.length < 2) return null;
  return { answer: fresh[0], question: fresh[1] };
}

const IMPORTED_KEY = 'quickImportImportedIds';
const IMPORTED_LIMIT = 200;

export function loadImportedIds(): string[] {
  const raw = localStorage.getItem(IMPORTED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function markImportedIds(idsOldestFirst: string[]): void {
  const newestFirst = [...idsOldestFirst].reverse();
  const merged = [...new Set([...newestFirst, ...loadImportedIds()])].slice(0, IMPORTED_LIMIT);
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(merged));
}

export function clearImportedIds(): void {
  localStorage.removeItem(IMPORTED_KEY);
}

export interface QuickCreateArgs {
  questionImageUrl: string;
  answerImageUrl: string | null;
  tagIds: string[];
  layoutType: number;
  blankImageUrl: string | null;
  versions: string[];
  bookInfo: null;
}

export function buildQuickCreateArgs(
  questionImageUrl: string,
  answerImageUrl: string | null,
  tagIds: string[],
  comboVersionIds: string[],
  layoutType: number
): QuickCreateArgs {
  return {
    questionImageUrl,
    answerImageUrl,
    tagIds: [...tagIds],
    layoutType: layoutType === 0 ? 0 : 1,
    blankImageUrl: null,
    versions: [...comboVersionIds],
    bookInfo: null,
  };
}

const LAYOUT_KEY = 'quickImportLayoutType';

export function loadQuickLayoutType(): number {
  return localStorage.getItem(LAYOUT_KEY) === '0' ? 0 : 1;
}

export function saveQuickLayoutType(layoutType: number): void {
  localStorage.setItem(LAYOUT_KEY, layoutType === 0 ? '0' : '1');
}

export function toggleLayoutType(current: number): number {
  return current === 0 ? 1 : 0;
}

export function layoutLabel(layoutType: number): string {
  return layoutType === 0 ? '📐 仅适合单栏' : '📏 单双栏均可';
}
