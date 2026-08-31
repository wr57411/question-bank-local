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

const ANCHOR_ID = 'quick-import-bar';
const MARGIN = 12;
const EXCLUDED_IDS = new Set(['crop-modal', 'projection-overlay']);

function readSafe(): { top: number; bottom: number } {
  const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-top') || '0', 10);
  const bottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom') || '0', 10);
  return { top: isNaN(top) ? 0 : top, bottom: isNaN(bottom) ? 0 : bottom };
}

export function isQuickImportBarVisible(): boolean {
  const bar = document.getElementById(ANCHOR_ID);
  if (!bar) return false;
  const cs = getComputedStyle(bar);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const rect = bar.getBoundingClientRect();
  return rect.height > 0 && rect.width > 0;
}

export function getQuickImportAnchorRect(): DOMRect | null {
  const bar = document.getElementById(ANCHOR_ID);
  if (!bar || !isQuickImportBarVisible()) return null;
  return bar.getBoundingClientRect();
}

export function applyModalPosition(modal: HTMLElement, content: HTMLElement, anchorRect: DOMRect | null): void {
  if (EXCLUDED_IDS.has(modal.id)) return;
  if (!anchorRect) {
    modal.style.top = '';
    modal.style.height = '';
    modal.style.alignItems = '';
    modal.style.paddingTop = '';
    content.style.maxHeight = '';
    content.style.overflowY = '';
    content.style.marginTop = '';
    return;
  }
  const vh = window.innerHeight;
  const contentH = content.getBoundingClientRect().height || parseInt(getComputedStyle(content).height, 10) || 0;
  const safe = readSafe();
  const computed = computeAnchoredPosition({
    anchorBottom: anchorRect.bottom,
    anchorTop: anchorRect.top,
    viewportHeight: vh,
    contentHeight: contentH,
    margin: MARGIN,
    safeTop: safe.top,
    safeBottom: safe.bottom,
  });
  modal.style.top = anchorRect.bottom + 'px';
  modal.style.height = (vh - anchorRect.bottom) + 'px';
  modal.style.alignItems = 'flex-start';
  modal.style.paddingTop = MARGIN + 'px';
  modal.style.boxSizing = 'border-box';
  content.style.maxHeight = computed.maxHeight + 'px';
  content.style.overflowY = 'auto';
  content.style.marginTop = '0';
}

let rafId: number | null = null;
function schedule(fn: () => void): void {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => { rafId = null; fn(); });
}

export function bindModalToAnchor(modalId: string): { destroy(): void } {
  const modal = document.getElementById(modalId);
  if (!modal) return { destroy() {} };
  const content = modal.querySelector('.modal-content') as HTMLElement | null;
  if (!content) return { destroy() {} };

  let destroyed = false;

  const sync = () => {
    if (destroyed) return;
    if (!modal.classList.contains('active')) return;
    const anchor = getQuickImportAnchorRect();
    applyModalPosition(modal, content, anchor);
  };

  const RO: any = typeof ResizeObserver !== 'undefined' ? ResizeObserver : class { observe() {} disconnect() {} unobserve() {} };
  const ro = new RO(() => schedule(sync));
  const bar = document.getElementById(ANCHOR_ID);
  if (bar) ro.observe(bar);
  ro.observe(content);

  const mo = new MutationObserver(() => schedule(sync));
  mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
  if (bar) mo.observe(bar, { attributes: true, attributeFilter: ['style', 'class'] });

  const onResize = () => schedule(sync);
  const onScroll = () => schedule(sync);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });

  schedule(sync);

  return {
    destroy() {
      destroyed = true;
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    },
  };
}

export function initAnchoredModals(): void {
  const modals = document.querySelectorAll('.modal');
  modals.forEach((m) => {
    const el = m as HTMLElement;
    if (EXCLUDED_IDS.has(el.id)) return;
    bindModalToAnchor(el.id);
  });
  const combo = document.getElementById('quick-combo-panel');
  if (combo) {
    const panelCard = combo.querySelector('div[onclick="event.stopPropagation()"]') as HTMLElement | null;
    if (panelCard) {
      const syncCombo = () => {
        const anchor = getQuickImportAnchorRect();
        if (!anchor) {
          panelCard.style.top = '';
          panelCard.style.maxHeight = '';
          return;
        }
        panelCard.style.top = (anchor.bottom + 12) + 'px';
        panelCard.style.maxHeight = (window.innerHeight - anchor.bottom - 24) + 'px';
        panelCard.style.overflowY = 'auto';
      };
      const RO2: any = typeof ResizeObserver !== 'undefined' ? ResizeObserver : class { observe() {} disconnect() {} };
      const ro = new RO2(() => schedule(syncCombo));
      const bar = document.getElementById(ANCHOR_ID);
      if (bar) ro.observe(bar);
      window.addEventListener('resize', () => schedule(syncCombo));
      const mo = new MutationObserver(() => schedule(syncCombo));
      if (bar) mo.observe(bar, { attributes: true, attributeFilter: ['style', 'class'] });
      mo.observe(combo, { attributes: true, attributeFilter: ['style'] });
    }
  }
}
