import type { Question } from '../types';

declare const jspdf: { jsPDF: new (opts?: Record<string, unknown>) => JsPDFInstance };

interface JsPDFInstance {
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void;
  addPage(): void;
  save(filename: string): void;
  getNumberOfPages(): number;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

export interface PDFOptions {
  title?: string;
  spacing?: 'none' | 'small' | 'large';
  mode?: 'single' | 'two_per_page';
}

export async function generatePDF(questions: Question[], options: PDFOptions = {}): Promise<void> {
  const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const spacing = options.spacing === 'large' ? 10 : options.spacing === 'small' ? 5 : 2;

  let y = margin;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const images: string[] = [];
    if (q.question_image_url) images.push(q.question_image_url);
    if (q.answer_image_url) images.push(q.answer_image_url);

    for (const imgUrl of images) {
      if (!imgUrl) continue;
      try {
        const dims = await getImageDimensions(imgUrl);
        const imgWidth = usableWidth;
        const imgHeight = (dims.height / dims.width) * imgWidth;

        if (y + imgHeight > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }

        doc.addImage(imgUrl, 'JPEG', margin, y, imgWidth, imgHeight);
        y += imgHeight + spacing;
      } catch (e) {
        console.warn('PDF 生成中图片添加失败:', e);
        continue;
      }
    }

    if (i < questions.length - 1 && options.mode === 'single') {
      if (y + 20 > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    }
  }

  const title = options.title || '题目导出';
  doc.save(`${title}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = src;
  });
}
