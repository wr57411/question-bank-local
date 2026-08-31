import { dbGetAllPdfDocs } from '../data/pdf-docs';
import { downloadPdfToLocal } from '../services/pdf-cloud';
import { showPdfActions } from './pdf-doc-ops';
import { closeModal, openModal } from './common';

let currentPreviewLoadingTask: { destroy: () => Promise<void> } | null = null;
let previewPdfId = '';
let previewLoadedPages = 0;
let previewTotalPages = 0;

export async function startPdfPreview(pdfId: string): Promise<void> {
  closePdfActionModal();
  const modal = document.getElementById('pdf-preview-modal');
  const container = document.getElementById('pdf-preview-pages');
  const progress = document.getElementById('pdf-preview-progress');
  if (!modal || !container || !progress) return;

  previewPdfId = pdfId;
  (window as unknown as Record<string, unknown>)._previewPdfId = pdfId;
  previewLoadedPages = 0;
  previewTotalPages = 0;
  container.innerHTML = '<p style="text-align:center;color:var(--text-tertiary)">加载中...</p>';
  openModal('pdf-preview-modal');

  await loadMorePreviewPages();

  container.onscroll = () => {
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
      if (previewLoadedPages < previewTotalPages) loadMorePreviewPages();
    }
  };
}

async function loadMorePreviewPages(): Promise<void> {
  const container = document.getElementById('pdf-preview-pages');
  const progress = document.getElementById('pdf-preview-progress');
  if (!container || !progress) return;

  const from = previewLoadedPages + 1;
  const batchSize = 3;

  try {
    if (previewLoadedPages === 0) container.innerHTML = '';
    const total = await renderPdfPreviewFromCache(previewPdfId, container, from, batchSize);
    if (total > 0) {
      previewTotalPages = total;
      previewLoadedPages = Math.min(from + batchSize - 1, total);
      progress.textContent = `第 1-${previewLoadedPages} 页 / 共 ${previewTotalPages} 页`;
    } else {
      container.innerHTML = '<p style="text-align:center;color:#ef4444">无法加载预览，请先下载 PDF</p>';
    }
  } catch (e) {
    if (previewLoadedPages === 0) {
      container.innerHTML = `<p style="text-align:center;color:#ef4444">加载失败: ${(e as Error).message}</p>`;
    }
  }
}

export function closePdfPreview(): void {
  closeModal('pdf-preview-modal');
  if (currentPreviewLoadingTask) {
    currentPreviewLoadingTask.destroy().catch(() => { /* ignore */ });
    currentPreviewLoadingTask = null;
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function readPdfBlobFromCache(localPath: string): Promise<Blob> {
  const { Filesystem } = await import('@capacitor/filesystem');
  const fileName = localPath.split('/').pop() || '';
  const result = await Filesystem.readFile({ path: fileName, directory: 'CACHE' as never });
  const buffer: ArrayBuffer = typeof result.data === 'string' ? base64ToArrayBuffer(result.data) : (result.data as unknown as ArrayBuffer);
  return new Blob([buffer], { type: 'application/pdf' });
}

async function renderPdfPreviewFromCache(pdfId: string, container: HTMLElement, startPage: number, maxPages: number): Promise<number> {
  const docs = await dbGetAllPdfDocs();
  const doc = docs.find(d => d.id === pdfId);

  if (!doc?.local_cache_path) {
    try {
      const cachePath = await downloadPdfToLocal(pdfId);
      const blob = await readPdfBlobFromCache(cachePath);
      return await renderPdfPreviewOnCanvas(blob, container, startPage, maxPages);
    } catch (e) {
      console.error('PDF 预览（下载路径）加载失败:', e);
      return 0;
    }
  }

  try {
    const blob = await readPdfBlobFromCache(doc.local_cache_path);
    return await renderPdfPreviewOnCanvas(blob, container, startPage, maxPages);
  } catch (e) {
    console.error('PDF 预览（缓存路径）加载失败:', e);
    return 0;
  }
}

async function renderPdfPreviewOnCanvas(file: File | Blob, container: HTMLElement, startPage = 1, maxPages = 3): Promise<number> {
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    currentPreviewLoadingTask = loadingTask;

    const endPage = Math.min(startPage + maxPages - 1, pdf.numPages);
    container.innerHTML = '';

    for (let i = startPage; i <= endPage; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.cssText = 'width:100%;margin-bottom:8px;border-radius:4px;border:1px solid var(--border-light)';
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      container.appendChild(canvas);
    }

    return pdf.numPages;
  } catch (e) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-tertiary);font-size:13px">PDF 预览不可用: ${(e as Error).message}</p>`;
    return 0;
  }
}

function closePdfActionModal(): void {
  closeModal('pdf-action-modal');
}
