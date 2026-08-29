import type { Question, LayoutImage, LayoutCell, PDFGenerateOptions } from '../types';
import { planLayout } from './pdf-layout-engine';
import { estimateTH, cropImage, loadImageDims } from './pdf-image';
import { loadCnFontBase64 } from './pdf-font';

declare const jspdf: { jsPDF: new (opts?: Record<string, unknown>) => JsPDFInstance };

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Filesystem?: { writeFile(opts: Record<string, unknown>): Promise<unknown> } } };
    getExportFolder?: () => string;
  }
}

interface JsPDFInstance {
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  save(filename: string): void;
  output(kind: string): unknown;
  text(text: string, x: number, y: number, opts?: Record<string, unknown>): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g?: number, b?: number): void;
  setFont(name: string): void;
  setDrawColor(r: number, g?: number, b?: number): void;
  setLineWidth(w: number): void;
  setLineDash(segments: number[]): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  addFileToVFS(name: string, data: string): void;
  addFont(name: string, alias: string, style: string): void;
  getNumberOfPages(): number;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

export const _internals = { estimateTH, cropImage, loadImageDims, loadCnFontBase64 };

const W = 210, H = 297, M = 15, MAXW = W - M * 2;

async function registerCnFont(doc: JsPDFInstance): Promise<string> {
  const b64 = await _internals.loadCnFontBase64();
  if (b64) {
    doc.addFileToVFS('NotoSansSC-Regular.ttf', b64);
    doc.addFont('NotoSansSC-Regular.ttf', 'NotoSC', 'normal');
    return 'NotoSC';
  }
  return 'helvetica';
}

function drawCentered(doc: JsPDFInstance, cn: string, text: string, y: number, size: number): void {
  doc.setFont(cn);
  doc.setFontSize(size);
  doc.text(text, W / 2, y, { align: 'center' });
}

function drawLabel(doc: JsPDFInstance, cn: string, text: string, x: number, y: number, size: number): void {
  doc.setFont(cn);
  doc.setFontSize(size);
  doc.text(text, x, y);
}

async function placeImg(doc: JsPDFInstance, src: string | null | undefined, x: number, y: number, maxW: number, maxH?: number): Promise<number> {
  if (!src) return 0;
  try {
    const { w, h } = await _internals.loadImageDims(src);
    const height = (h / w) * maxW;
    const drawH = maxH && height > maxH ? maxH : height;
    doc.addImage(src, 'JPEG', x, y, maxW, drawH);
    return drawH;
  } catch (e) {
    console.warn('PDF 生成中图片添加失败:', e);
    return 0;
  }
}

async function estH(src: string | null | undefined, maxW: number): Promise<number> {
  if (!src) return 0;
  try {
    const { w, h } = await _internals.loadImageDims(src);
    return (h / w) * maxW;
  } catch { return 0; }
}

async function generateWithEngine(
  questions: Question[],
  doc: JsPDFInstance,
  cn: string,
  opts: { spacing: 'none' | 'small' | 'large'; spacingCm: number; title: string; targetTextMM: number; lmMap?: Record<string, 'single' | 'double'> },
): Promise<void> {
  const spcMm = opts.spacing !== 'none' ? opts.spacingCm * 10 : 0;

  if (opts.title) {
    drawCentered(doc, cn, opts.title, M + 5, 18);
    drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
  }

  const units: LayoutImage[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const lm = (opts.lmMap && opts.lmMap[q.id]) || (q.layout_type === 1 ? 'double' : 'single');
    if (q.question_image_url) {
      try {
        const dims = await _internals.loadImageDims(q.question_image_url);
        const tH = await _internals.estimateTH(q.question_image_url);
        units.push({ key: `q${i}`, src: q.question_image_url, w: dims.w, h: dims.h, tH, lm, label: `第 ${i + 1} 题`, labelH: 5, afterGap: spcMm });
      } catch (e) {
        console.warn('跳过无法读取的题目图片:', e);
      }
    }
    if (q.answer_image_url) {
      try {
        const dims = await _internals.loadImageDims(q.answer_image_url);
        const tH = await _internals.estimateTH(q.answer_image_url);
        units.push({ key: `a${i}`, src: q.answer_image_url, w: dims.w, h: dims.h, tH, lm, label: '答案:', labelH: 4, afterGap: 0 });
      } catch (e) {
        console.warn('跳过无法读取的答案图片:', e);
      }
    }
  }

  const { pages, truncated } = planLayout(units, { targetTextMM: opts.targetTextMM, topReserveMM: opts.title ? 35 : 0 });

  if (truncated) {
    console.warn('PDF 排版迭代上限，部分内容未排版');
    alert('部分题目未能完成排版，请减少单次导出数量');
  }

  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0) doc.addPage();
    doc.setFontSize(8);
    doc.setTextColor(180);
    doc.text(`— ${pi + 1}/${pages.length} —`, W / 2, H - 4, { align: 'center' });
    doc.setTextColor(0);
    const cells: LayoutCell[] = pages[pi].L.concat(pages[pi].R);
    for (const cell of cells) {
      if (cell.label) {
        drawLabel(doc, cn, cell.label, cell.x, cell.y + 3, cell.label === '答案:' ? 9 : 11);
      }
      const src = cell.crop ? await _internals.cropImage(cell.src, cell.crop) : cell.src;
      doc.addImage(src, 'JPEG', cell.x, cell.y + cell.labelH, cell.w, cell.h);
      const bottomY = cell.y + cell.labelH + cell.h + 0.4;
      if (cell.isSp) {
        doc.setDrawColor(251, 191, 36);
        doc.setLineWidth(0.25);
        doc.line(cell.x, bottomY, cell.x + cell.w, bottomY);
      }
      if (cell.afterGap > 0) {
        doc.setDrawColor(200);
        doc.setLineDash([3, 3]);
        doc.line(cell.x, bottomY + 2, cell.x + cell.w, bottomY + 2);
        doc.setLineDash([]);
      }
    }
  }
}

async function generateLegacyDouble(questions: Question[], doc: JsPDFInstance, cn: string, y0: number, spcMm: number): Promise<void> {
  let y = y0;
  const halfW = (MAXW - 4) / 2;
  let i = 0;
  while (i < questions.length) {
    const q = questions[i];
    const nextQ = questions[i + 1];
    if (y > H - M - 30) { doc.addPage(); y = M; }
    if (nextQ) {
      const h1 = await estH(q.question_image_url, halfW);
      const h2 = await estH(nextQ.question_image_url, halfW);
      const labelH = 6;
      if (h1 > 0 && h2 > 0 && y + Math.max(h1, h2) + labelH + 2 <= H - M) {
        drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 10);
        drawLabel(doc, cn, `第 ${i + 2} 题`, M + halfW + 4, y + 4, 10);
        y += labelH;
        const usedH = Math.max(
          await placeImg(doc, q.question_image_url, M, y, halfW, H - M - y),
          await placeImg(doc, nextQ.question_image_url, M + halfW + 4, y, halfW, H - M - y),
        );
        y += usedH + 2;
        const a1 = q.answer_image_url, a2 = nextQ.answer_image_url;
        if (a1 || a2) {
          const ah1 = a1 ? await estH(a1, halfW) : 0;
          const ah2 = a2 ? await estH(a2, halfW) : 0;
          const ansNeedH = Math.max(ah1, ah2) + 8;
          if (y + ansNeedH <= H - M && ah1 > 0 && ah2 > 0) {
            drawLabel(doc, cn, '答案:', M, y + 4, 9);
            if (a2) drawLabel(doc, cn, '答案:', M + halfW + 4, y + 4, 9);
            y += 5;
            y += Math.max(
              a1 ? await placeImg(doc, a1, M, y, halfW, H - M - y) : 0,
              a2 ? await placeImg(doc, a2, M + halfW + 4, y, halfW, H - M - y) : 0,
            ) + 2;
          } else {
            if (a1) {
              if (y + ah1 + 7 > H - M) { doc.addPage(); y = M; }
              drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 5;
              y += await placeImg(doc, a1, M, y, halfW, H - M - y) + 2;
            }
            if (a2) {
              if (y + ah2 + 7 > H - M) { doc.addPage(); y = M; }
              drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 5;
              y += await placeImg(doc, a2, M, y, halfW, H - M - y) + 2;
            }
          }
        }
        if (spcMm > 0) {
          doc.setDrawColor(200); doc.setLineDash([3, 3]);
          doc.line(M, y, W - M, y); doc.setLineDash([]);
          y += spcMm;
        }
        i += 2;
        continue;
      }
    }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 11);
    y += 5;
    y += await placeImg(doc, q.question_image_url, M, y, MAXW) + 2;
    if (q.answer_image_url) {
      if (y + 15 > H - M) { doc.addPage(); y = M; }
      drawLabel(doc, cn, '答案:', M, y + 4, 9); y += 4;
      y += await placeImg(doc, q.answer_image_url, M, y, MAXW * 0.8) + 2;
    }
    if (spcMm > 0) {
      doc.setDrawColor(200); doc.setLineDash([3, 3]);
      doc.line(M, y, W - M, y); doc.setLineDash([]);
      y += spcMm;
    }
    i++;
  }
}

async function generateLegacySeparate(questions: Question[], doc: JsPDFInstance, cn: string, y0: number, spcMm: number): Promise<void> {
  let y = y0;
  for (let i = 0; i < questions.length; i++) {
    if (y > H - M - 20) { doc.addPage(); y = M; }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 11);
    y += 5;
    y += await placeImg(doc, questions[i].question_image_url, M, y, MAXW) + 2;
    if (spcMm > 0) y += spcMm;
  }
  doc.addPage(); y = M;
  drawCentered(doc, cn, '参考答案', y, 16);
  y += 10;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.answer_image_url) continue;
    if (y + 15 > H - M) { doc.addPage(); y = M; }
    drawLabel(doc, cn, `第 ${i + 1} 题`, M, y + 4, 10);
    y += 5;
    y += await placeImg(doc, q.answer_image_url, M, y, MAXW * 0.8) + 3;
  }
}

export async function generatePDF(questions: Question[], options: PDFGenerateOptions = {}): Promise<JsPDFInstance | undefined> {
  const doc = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const cn = await registerCnFont(doc);
  const mode = options.mode || 'single';
  const spacing = options.spacing || 'none';
  const spacingCm = options.spacingCm ?? 5;
  const title = options.title || '';
  const spcMm = spacing !== 'none' ? spacingCm * 10 : 0;

  if (mode === 'single' || mode === 'merged') {
    await generateWithEngine(questions, doc, cn, {
      spacing, spacingCm, title,
      targetTextMM: options.targetTextMM ?? 4,
      lmMap: options.lmMap,
    });
  } else if (mode === 'double') {
    if (title) {
      drawCentered(doc, cn, title, M + 5, 18);
      drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
    }
    await generateLegacyDouble(questions, doc, cn, title ? M + 20 : M, spcMm);
  } else if (mode === 'separate') {
    if (title) {
      drawCentered(doc, cn, title, M + 5, 18);
      drawCentered(doc, cn, `共 ${questions.length} 题`, M + 13, 11);
    }
    await generateLegacySeparate(questions, doc, cn, title ? M + 20 : M, spcMm);
  }

  if (options.noSave) return doc;

  const fileName = `${title || '题库导出'}.pdf`;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative && window.Capacitor?.Plugins?.Filesystem) {
    const pdfBase64 = String(doc.output('dataurlstring')).split(',')[1];
    const folder = (typeof window.getExportFolder === 'function') ? window.getExportFolder() : '';
    const filePath = folder ? `${folder}/${fileName}` : fileName;
    try {
      await window.Capacitor.Plugins.Filesystem.writeFile({ path: filePath, data: pdfBase64, directory: 'DOCUMENTS' });
      alert('PDF 已保存: DOCUMENTS/' + filePath);
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  } else {
    doc.save(fileName);
  }
  return undefined;
}
