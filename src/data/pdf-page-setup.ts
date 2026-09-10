import type { PageSetup } from '../types';

export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 30;

export const DEFAULT_PAGE_SETUP: PageSetup = {
  marginTopMM: 10,
  marginBottomMM: 10,
  marginSideMM: 10,
  showTitle: true,
  showCount: true,
};

function clampMargin(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, n));
}

function clampBool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  return Boolean(raw);
}

export function clampPageSetup(raw: Partial<PageSetup> | null | undefined): PageSetup {
  if (!raw) return { ...DEFAULT_PAGE_SETUP };
  return {
    marginTopMM: clampMargin(raw.marginTopMM, DEFAULT_PAGE_SETUP.marginTopMM),
    marginBottomMM: clampMargin(raw.marginBottomMM, DEFAULT_PAGE_SETUP.marginBottomMM),
    marginSideMM: clampMargin(raw.marginSideMM, DEFAULT_PAGE_SETUP.marginSideMM),
    showTitle: clampBool(raw.showTitle, DEFAULT_PAGE_SETUP.showTitle),
    showCount: clampBool(raw.showCount, DEFAULT_PAGE_SETUP.showCount),
  };
}

const STORAGE_KEY = 'pdfPageSetup';

export function loadPageSetup(): PageSetup {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return clampPageSetup(null);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clampPageSetup(null);
    return clampPageSetup(parsed as Partial<PageSetup>);
  } catch {
    return clampPageSetup(null);
  }
}

export function savePageSetup(s: PageSetup): void {
  try {
    const safe = clampPageSetup(s);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* ignore */
  }
}
