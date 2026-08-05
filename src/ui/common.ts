export function showStatus(msg: string, type: 'success' | 'error' | 'info'): void {
  const c = document.getElementById('status-message');
  if (!c) return;
  c.replaceChildren();
  const d = document.createElement('div');
  d.className = 'status ' + type;
  d.textContent = msg;
  c.appendChild(d);
  if (type === 'success') setTimeout(() => c.replaceChildren(), 3000);
}

export function escapeHtml(s: string | null | undefined): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function openModal(id: string): void {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

export function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

export function showTab(tabName: string, btn?: HTMLElement): void {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('div[id$="-tab"]').forEach(t => t.classList.add('hidden'));
  if (btn) btn.classList.add('active');
  const target = document.getElementById(tabName + '-tab');
  if (target) target.classList.remove('hidden');
}
