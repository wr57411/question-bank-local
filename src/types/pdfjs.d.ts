declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export interface PdfPage {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
  }
  export interface PdfDocument {
    numPages: number;
    getPage(pageNum: number): Promise<PdfPage>;
  }
  export interface PdfLoadingTask {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  }
  export function getDocument(params: unknown): PdfLoadingTask;
}
