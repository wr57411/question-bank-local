import { getQuickImportAnchorRect, applyModalPosition } from './modal-anchor';

const TOAST_DURATION_MS = 3000;

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, type: 'success' | 'info'): void {
  const wrap = document.getElementById('toast');
  const box = document.getElementById('toast-msg');
  if (!wrap || !box) return;
  box.textContent = msg;
  box.style.background = type === 'success' ? 'var(--mint-light)' : 'var(--sky-light)';
  box.style.color = type === 'success' ? 'var(--mint-dark)' : 'var(--sky-dark)';
  wrap.style.background = type === 'success' ? 'var(--mint-light)' : 'var(--sky-light)';
  wrap.style.color = 'var(--text)';
  wrap.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { wrap.style.display = 'none'; toastTimer = null; }, TOAST_DURATION_MS);
}

export function showErrorModal(msg: string): void {
  const m = document.getElementById('error-modal');
  const t = document.getElementById('error-modal-msg');
  if (!m || !t) return;
  t.textContent = msg;
  openModal('error-modal');
}

export function closeErrorModal(): void {
  closeModal('error-modal');
}

export function showStatus(msg: string, type: 'success' | 'error' | 'info'): void {
  if (type === 'error') { showErrorModal(msg); return; }
  showToast(msg, type);
}

export function escapeHtml(s: string | null | undefined): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function openModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active');
  const content = el.querySelector('.modal-content') as HTMLElement | null;
  if (content) {
    const anchor = getQuickImportAnchorRect();
    applyModalPosition(el as HTMLElement, content, anchor);
  }
}

export function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active');
  const content = el.querySelector('.modal-content') as HTMLElement | null;
  if (content) {
    content.style.maxHeight = '';
    content.style.overflowY = '';
  }
  (el as HTMLElement).style.top = '';
  (el as HTMLElement).style.height = '';
  (el as HTMLElement).style.alignItems = '';
  (el as HTMLElement).style.paddingTop = '';
}

export function showTab(tabName: string, btn?: HTMLElement): void {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('div[id$="-tab"]').forEach(t => t.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  const target = document.getElementById(tabName + '-tab');
  if (target) target.classList.remove('hidden');
}
