export interface OcrResult {
  text: string;
  formulas: string[];
  markdown: string;
}

export interface OcrHealth {
  status: 'not_loaded' | 'loading' | 'ready' | 'error';
  engines?: { paddle: boolean; unimer: boolean };
  errors?: Record<string, string | null>;
}

export type WikiExtractMode = 'vision' | 'ocr';
