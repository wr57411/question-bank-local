import type { PrintMetrics, StemPtPreset, PageSetup } from '../types';

export const PT_TO_MM = 0.3528;

export const STEM_PT_PRESETS: StemPtPreset[] = [
  { pt: 9, label: '小五' },
  { pt: 10.5, label: '五号' },
  { pt: 12, label: '小四' },
  { pt: 14, label: '四号' },
  { pt: 16, label: '三号' },
];

export const DEFAULT_STEM_PT = 10.5;
export const DEFAULT_STEM_MM = ptToMM(DEFAULT_STEM_PT);

export const STEM_PT_MIN = STEM_PT_PRESETS[0].pt;
export const STEM_PT_MAX = STEM_PT_PRESETS[STEM_PT_PRESETS.length - 1].pt;

const RATIO = {
  numLabel: 0.97,
  ansLabel: 0.79,
  title: 1.59,
  subTitle: 0.97,
  answerHeader: 1.41,
  pageNum: 0.71,
};

const LABEL_H_FACTOR = 1.28;
const MIN_SPLIT_FACTOR = 6.25;
const TITLE_TOP_FACTOR = 1.25;
const TITLE_GAP_FACTOR = 2.0;
const BASELINE_OFFSET_FACTOR = 0.8;

const CELL_PAD_MM = 6;
export const DOUBLE_MIN_RATIO = 0.75;

export function ptToMM(pt: number): number {
  return pt * PT_TO_MM;
}

export function mmToPt(mm: number): number {
  return mm / PT_TO_MM;
}

export function clampStemPt(pt: number): number {
  if (!Number.isFinite(pt)) return DEFAULT_STEM_PT;
  return Math.min(STEM_PT_MAX, Math.max(STEM_PT_MIN, pt));
}

export function parseStemPt(raw: string | null | undefined): number {
  const n = Number(raw);
  return clampStemPt(Number.isFinite(n) && n > 0 ? n : DEFAULT_STEM_PT);
}

export function derivePrintMetrics(stemMM: number): PrintMetrics {
  const numLabelMM = stemMM * RATIO.numLabel;
  const ansLabelMM = stemMM * RATIO.ansLabel;
  const subTitleMM = stemMM * RATIO.subTitle;
  const titleTopMM = stemMM * TITLE_TOP_FACTOR;
  const subTitleYOffset = stemMM * TITLE_GAP_FACTOR;

  return {
    stemMM,
    numLabelPt: mmToPt(numLabelMM),
    ansLabelPt: mmToPt(ansLabelMM),
    titlePt: mmToPt(stemMM * RATIO.title),
    subTitlePt: mmToPt(subTitleMM),
    answerHeaderPt: mmToPt(stemMM * RATIO.answerHeader),
    pageNumPt: mmToPt(stemMM * RATIO.pageNum),
    numLabelH: numLabelMM * LABEL_H_FACTOR,
    ansLabelH: ansLabelMM * LABEL_H_FACTOR,
    numLabelBaselineMM: numLabelMM * BASELINE_OFFSET_FACTOR,
    ansLabelBaselineMM: ansLabelMM * BASELINE_OFFSET_FACTOR,
    cellPadMM: CELL_PAD_MM,
    minSplitMM: stemMM * MIN_SPLIT_FACTOR,
    titleTopMM,
    subTitleYOffset,
  };
}

export function deriveTopReserveMM(setup: PageSetup, metrics: PrintMetrics): number {
  if (!setup.showTitle) return 0;
  const titleMM = ptToMM(metrics.titlePt);
  const subTitleMM = ptToMM(metrics.subTitlePt);
  const titleBaselineMM = setup.marginTopMM + metrics.titleTopMM;
  const blockBottom = setup.showCount
    ? titleBaselineMM + metrics.subTitleYOffset + subTitleMM * 0.2
    : titleBaselineMM + titleMM * 0.2;
  return Math.max(0, blockBottom - setup.marginBottomMM);
}

export function deriveHeaderReserveMM(setup: PageSetup, metrics: PrintMetrics): number {
  const headerMM = ptToMM(metrics.answerHeaderPt);
  return Math.max(0, setup.marginTopMM + headerMM - setup.marginBottomMM);
}

export function metricsForStemPt(pt: number): PrintMetrics {
  return derivePrintMetrics(ptToMM(clampStemPt(pt)));
}

const STORAGE_KEY = 'printStemPt';

export function loadStemMM(): number {
  return ptToMM(loadStemPt());
}

export function loadStemPt(): number {
  try {
    return parseStemPt(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_STEM_PT;
  }
}

export function saveStemPt(pt: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampStemPt(pt)));
  } catch {
    /* ignore */
  }
}
