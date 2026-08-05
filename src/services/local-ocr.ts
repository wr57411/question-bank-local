import { compressImage } from './image';
import type { OcrHealth, OcrResult } from '../types';

const OCR_URL_KEY = 'ocr_server_url';
const DEFAULT_OCR_URL = 'http://localhost:8766';

export function getOcrServerUrl(): string {
  return localStorage.getItem(OCR_URL_KEY) || DEFAULT_OCR_URL;
}

export function setOcrServerUrl(url: string): void {
  localStorage.setItem(OCR_URL_KEY, url.trim());
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function checkOcrHealth(url: string, timeoutMs = 5000): Promise<OcrHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeBase(url)}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`OCR 服务响应异常 HTTP ${response.status}`);
    return (await response.json()) as OcrHealth;
  } finally {
    clearTimeout(timer);
  }
}

async function callOcr(dataUrl: string, url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<OcrResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }
  try {
    const image = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
    const response = await fetch(`${normalizeBase(url)}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: image }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      const detail = err?.detail || `OCR HTTP ${response.status}`;
      throw new Error(String(detail));
    }
    return (await response.json()) as OcrResult;
  } finally {
    clearTimeout(timer);
  }
}

export async function ocrImage(dataUrl: string, url: string, signal?: AbortSignal): Promise<OcrResult> {
  const compressed = await compressImage(dataUrl, 2000, 0.85);
  return callOcr(compressed, url, signal, 120000);
}

export async function ocrBatch(
  dataUrls: string[],
  url: string,
  signal?: AbortSignal
): Promise<Array<OcrResult | { error: string }>> {
  let firstLoad = true;
  try {
    const health = await checkOcrHealth(url, 3000);
    firstLoad = health.status !== 'ready';
  } catch {
    firstLoad = true;
  }
  const timeoutMs = firstLoad ? 120000 : 45000;
  const results: Array<OcrResult | { error: string }> = [];
  for (const dataUrl of dataUrls) {
    try {
      const compressed = await compressImage(dataUrl, 2000, 0.85);
      results.push(await callOcr(compressed, url, signal, timeoutMs));
    } catch (err) {
      results.push({ error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
