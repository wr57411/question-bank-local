/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
const w = window as any;

export function toggleBasket(qId: string): void {
  const basket: Set<string> = w.questionBasket;
  if (basket.has(qId)) basket.delete(qId); else basket.add(qId);
  updateBasketBadge();
}

export function updateBasketBadge(): void {
  const basket: Set<string> = w.questionBasket;
  const b = document.getElementById('basket-badge')!;
  if (basket.size > 0) { b.style.display = 'flex'; b.textContent = String(basket.size); }
  else b.style.display = 'none';
}

export function openBasketModal(): void {
  const basket: Set<string> = w.questionBasket;
  const allQuestions: any[] = w.allQuestions;
  if (!basket.size) { w.showStatus('试题篮是空的，请先勾选题目', 'error'); return; }
  document.getElementById('basket-modal-count')!.textContent = '(' + basket.size + '题)';
  const c = document.getElementById('basket-items')!;
  c.replaceChildren();
  allQuestions.filter(q => basket.has(q.id)).forEach((q, i) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;gap:10px;align-items:center;padding:8px;border-bottom:1px solid var(--border-light)';
    const img = document.createElement('img');
    img.src = q.question_image_url;
    img.style.cssText = 'width:50px;height:50px;object-fit:contain;border-radius:var(--radius-sm);background:var(--surface-dim)';
    const label = document.createElement('span');
    label.textContent = '第' + (i + 1) + '题';
    label.style.flex = '1';
    label.style.fontSize = '13px';
    const rm = document.createElement('button');
    rm.className = 'danger';
    rm.style.cssText = 'padding:4px 10px;font-size:12px';
    rm.textContent = '移除';
    rm.onclick = () => { basket.delete(q.id); updateBasketBadge(); openBasketModal(); w.renderQuestions(); };
    d.append(img, label, rm);
    c.appendChild(d);
  });
  openModal('basket-modal');
}

export function closeBasketModal(): void {
  closeModal('basket-modal');
}

export function exportFromBasket(): void {
  const basket: Set<string> = w.questionBasket;
  const allQuestions: any[] = w.allQuestions;
  const qs = allQuestions.filter(q => basket.has(q.id));
  closeBasketModal();
  w.showExportModal(qs);
}
