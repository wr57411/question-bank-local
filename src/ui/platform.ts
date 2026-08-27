export function hideEl(id: string): void {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

export function applyPlatformUI(): void {
  const cap = (window as any).Capacitor;
  const platform = (cap && cap.getPlatform) ? cap.getPlatform() : 'web';
  if (platform === 'android') return;
  hideEl('floating-toggle-btn');
  hideEl('pending-blank-tab');
  hideEl('pending-photos-tab');
  const aiLabel = document.getElementById('ai-status-label');
  const aiDesc = document.getElementById('ai-status-desc');
  hideEl('ai-load-btn');
  hideEl('ai-batch-btn');
  if (aiLabel) { aiLabel.textContent = '暂不支持'; aiLabel.style.background = 'var(--text-tertiary)'; }
  if (aiDesc) aiDesc.textContent = 'iOS 版暂不支持端侧 AI（Gemma4），可使用下方"模型服务商管理"接入云端 API。';
}

export function selectLayout(el: HTMLElement, _val: string): void {
  document.querySelectorAll('.layout-option').forEach(l => {
    (l as HTMLElement).style.borderColor = 'var(--border-light)';
    (l as HTMLElement).style.background = 'var(--surface)';
  });
  el.style.borderColor = 'var(--sky)';
  el.style.background = 'var(--sky-light)';
}
