export interface ComputeArgs {
  anchorBottom: number;
  anchorTop: number;
  viewportHeight: number;
  contentHeight: number;
  margin?: number;
  safeTop?: number;
  safeBottom?: number;
}

export interface ComputedPosition {
  top: number;
  maxHeight: number;
  placement: 'below' | 'above' | 'constrained-below';
}

export function computeAnchoredPosition(args: ComputeArgs): ComputedPosition {
  const margin = args.margin ?? 12;
  const safeTop = args.safeTop ?? 0;
  const safeBottom = args.safeBottom ?? 0;
  const vh = args.viewportHeight;
  const anchorBottom = args.anchorBottom;
  const anchorTop = args.anchorTop;

  if (anchorBottom <= 0) {
    const top = margin + safeTop;
    const maxHeight = vh - top - margin - safeBottom;
    return { top, maxHeight: Math.max(120, maxHeight), placement: 'below' };
  }

  const belowTop = anchorBottom + margin;
  const belowSpace = vh - belowTop - margin - safeBottom;
  const aboveSpace = anchorTop - margin - safeTop;

  const fitsBelow = args.contentHeight > 0 ? args.contentHeight <= belowSpace : true;
  if (fitsBelow) {
    return { top: belowTop, maxHeight: Math.max(120, belowSpace), placement: 'below' };
  }

  const fitsAbove = args.contentHeight > 0 ? args.contentHeight <= aboveSpace : false;
  if (fitsAbove && aboveSpace > belowSpace) {
    const top = Math.max(margin + safeTop, anchorTop - args.contentHeight - margin);
    return { top, maxHeight: Math.max(120, aboveSpace), placement: 'above' };
  }

  return { top: belowTop, maxHeight: Math.max(120, belowSpace), placement: 'constrained-below' };
}

export function getQuickImportAnchorRect(): DOMRect | null {
  return null;
}
export function applyModalPosition(_modal: HTMLElement, _content: HTMLElement, _anchor: DOMRect | null): void {}
export function bindModalToAnchor(_modalId: string): { destroy(): void } { return { destroy() {} }; }
export function initAnchoredModals(): void {}
