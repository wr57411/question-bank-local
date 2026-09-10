export type LayoutMode = 'single' | 'double';

export interface LayoutImage {
  key: string;
  src: string;
  w: number;
  h: number;
  tH: number;
  lm: LayoutMode;
  label?: string;
  labelH?: number;
  afterGap?: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface LayoutCell {
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  label?: string;
  labelH: number;
  afterGap: number;
  isSp: boolean;
  si: number;
  p: number | string;
  t: number | string;
  crop?: CropRect;
}

export interface LayoutPage {
  L: LayoutCell[];
  R: LayoutCell[];
}

export interface PlanLayoutOptions {
  topReserveMM?: number;
  marginMM?: number;
  marginTopMM?: number;
  marginBottomMM?: number;
  marginSideMM?: number;
  stemMM?: number;
  cellPadMM?: number;
  minSplitMM?: number;
}

export interface StemPtPreset {
  pt: number;
  label: string;
}

export interface PrintMetrics {
  stemMM: number;
  numLabelPt: number;
  ansLabelPt: number;
  titlePt: number;
  subTitlePt: number;
  answerHeaderPt: number;
  pageNumPt: number;
  numLabelH: number;
  ansLabelH: number;
  numLabelBaselineMM: number;
  ansLabelBaselineMM: number;
  cellPadMM: number;
  minSplitMM: number;
  titleTopMM: number;
  subTitleYOffset: number;
}

export interface PlanLayoutResult {
  pages: LayoutPage[];
  nSplit: number;
  truncated: boolean;
}

export interface PDFGenerateOptions {
  mode?: 'single' | 'double' | 'separate' | 'merged';
  spacing?: 'none' | 'small' | 'large';
  spacingCm?: number;
  title?: string;
  noSave?: boolean;
  stemMM?: number;
  lmMap?: Record<string, LayoutMode>;
  setup?: PageSetup;
}

export interface PageSetup {
  marginTopMM: number;
  marginBottomMM: number;
  marginSideMM: number;
  showTitle: boolean;
  showCount: boolean;
}
