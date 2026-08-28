import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

let createCanvas: ((w: number, h: number) => any) | null = null;
let canvasAvailable = false;
try {
  const canvasMod = await import('canvas');
  createCanvas = canvasMod.createCanvas;
  canvasAvailable = true;
} catch { console.warn('[pdf-render] canvas 模块不可用，PDF 预览功能将禁用'); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewsDir = path.join(__dirname, '..', '..', 'uploads', 'previews');

if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });

export function getPreviewsDir(): string {
  return previewsDir;
}

export async function getPdfPageCount(pdfPath: string): Promise<number> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
    const doc = await loadingTask.promise;
    const count = doc.numPages;
    await loadingTask.destroy();
    return count;
  } catch (e) {
    console.error(`[pdf-render] getPdfPageCount failed for ${pdfPath}:`, e);
    throw e;
  }
}

class CanvasV3Factory {
  create(width: number, height: number) {
    if (!canvasAvailable || !createCanvas) throw new Error('canvas 模块不可用');
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(canvasAndContext: { canvas: any }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(_canvasAndContext: any) {}
}

export async function renderPdfPages(pdfPath: string, from: number, to: number): Promise<{ page: number; image_url: string }[]> {
  const pdfId = path.basename(pdfPath, path.extname(pdfPath));
  const results: { page: number; image_url: string }[] = [];

  try {
    if (!canvasAvailable || !createCanvas) throw new Error('PDF 预览功能不可用（canvas 模块未安装）');
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true, CanvasFactory: CanvasV3Factory });
    const doc = await loadingTask.promise;

    const scale = 1.5;
    for (let pageNum = from; pageNum <= Math.min(to, doc.numPages); pageNum++) {
      const cacheFile = path.join(previewsDir, `${pdfId}_p${pageNum}.jpg`);
      if (fs.existsSync(cacheFile)) {
        results.push({ page: pageNum, image_url: `/pdf-previews/${pdfId}_p${pageNum}.jpg` });
        continue;
      }

      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      context.fillStyle = 'white';
      context.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({ canvas, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;

      const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
      fs.writeFileSync(cacheFile, buffer);
      results.push({ page: pageNum, image_url: `/pdf-previews/${pdfId}_p${pageNum}.jpg` });
    }

    await loadingTask.destroy();
  } catch (e) {
    console.error(`[pdf-render] renderPdfPages failed for ${pdfPath} (from=${from}, to=${to}):`, e);
    throw e;
  }

  return results;
}
