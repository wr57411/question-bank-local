import {
  getAppVersions,
  getAppVersionById,
  getCurrentVersionId,
  getCurrentVersion,
  saveAppVersions,
  applyVersionTheme,
  DEFAULT_VERSION_ID,
} from '../services/version-skin';
import { showStatus } from './common';

const w = window as unknown as Record<string, unknown>;

export function renderVersionSwitcher(): void {
  const container = document.getElementById('version-switcher');
  if (!container) return;

  const currentId = getCurrentVersionId();
  const versions = getAppVersions();
  container.innerHTML = '';

  versions.forEach(version => {
    const isActive = version.id === currentId;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'flex:1;min-width:100px;position:relative';

    const card = document.createElement('div');
    card.style.cssText = `padding:14px;border:2px solid ${isActive ? version.theme.primary : 'var(--border)'};border-radius:var(--radius-md);cursor:pointer;transition:all .2s;text-align:center;background:${isActive ? version.theme.primaryLight : 'var(--surface)'}`;
    card.onclick = () => setAppVersion(version.id);

    const emoji = document.createElement('div');
    emoji.style.cssText = 'font-size:28px;margin-bottom:6px';
    emoji.textContent = version.emoji;

    const name = document.createElement('div');
    name.style.cssText = `font-size:13px;font-weight:700;color:${isActive ? version.theme.primary : 'var(--text)'};margin-bottom:2px`;
    name.textContent = version.name;

    const tagline = document.createElement('div');
    tagline.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.3';
    tagline.textContent = version.tagline;

    const badge = document.createElement('div');
    if (isActive) {
      badge.style.cssText = `margin-top:6px;display:inline-block;padding:2px 8px;background:${version.theme.primary};color:#fff;border-radius:10px;font-size:10px;font-weight:700`;
      badge.textContent = '当前使用';
    }

    card.append(emoji, name, tagline, badge);
    wrapper.appendChild(card);

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️';
    editBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;border:none;background:rgba(255,255,255,.9);font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.2);z-index:5';
    editBtn.onclick = (e) => { e.stopPropagation(); (w.showEditVersionModal as (id: string) => void)(version.id); };
    wrapper.appendChild(editBtn);

    container.appendChild(wrapper);
  });

  const addBtn = document.createElement('div');
  addBtn.style.cssText = 'flex:0 0 auto;padding:14px;border:2px dashed var(--border);border-radius:var(--radius-md);cursor:pointer;transition:all .2s;text-align:center;min-width:80px;display:flex;flex-direction:column;align-items:center;justify-content:center';
  addBtn.onclick = () => { (w.showAddVersionModal as () => void)(); };
  addBtn.innerHTML = '<div style="font-size:28px;margin-bottom:6px;color:var(--text-tertiary)">+</div><div style="font-size:13px;font-weight:600;color:var(--text-tertiary)">添加版本</div>';
  container.appendChild(addBtn);

  const systemPasswordStatus = document.getElementById('system-password-status');
  const systemPasswordBtn = document.getElementById('system-password-btn');
  if (systemPasswordStatus) {
    const hasPassword = !!localStorage.getItem('systemPassword');
    systemPasswordStatus.textContent = hasPassword ? '已设置密码' : '尚未设置密码';
    systemPasswordStatus.style.color = hasPassword ? '#10b981' : '#888';
  }
  if (systemPasswordBtn) {
    const hasPassword = !!localStorage.getItem('systemPassword');
    systemPasswordBtn.textContent = hasPassword ? '修改密码' : '设置密码';
  }
}

export function renameCurrentVersion(): void {
  const v = getCurrentVersion();
  if (!v) return;
  const newName = prompt('输入新版本名称', v.name);
  if (!newName || newName.trim() === v.name) return;
  const versions = getAppVersions();
  const target = versions.find(x => x.id === v.id);
  if (target) {
    target.name = newName.trim();
    saveAppVersions(versions);
    applyVersionTheme(v.id);
    renderVersionSwitcher();
    renderVersionCheckboxes();
    showStatus('版本已改名', 'success');
  }
}

export function setAppVersion(versionId: string): void {
  const version = getAppVersionById(versionId);
  if (!version) return;
  localStorage.setItem('appVersion', versionId);
  applyVersionTheme(versionId);
  renderVersionSwitcher();
  renderVersionFilterTags();
  const renderQuestions = w.renderQuestions as (() => void) | undefined;
  if (renderQuestions) renderQuestions();
  showStatus('已切换到' + version.name, 'success');
}

export function renderVersionFilterTags(): void {
  const currentId = getCurrentVersionId();
  const currentVersion = getAppVersionById(currentId);
  const statusEl = document.getElementById('user-status');
  if (statusEl && currentVersion) {
    statusEl.textContent = currentVersion.tagline || '数据存储在本地，无需联网';
  }
}

export function renderVersionCheckboxes(): void {
  const container = document.getElementById('version-checkboxes');
  if (!container) return;
  const checkedIds = new Set(
    Array.from(container.querySelectorAll('input[name="question_versions"]:checked'))
      .map(cb => (cb as HTMLInputElement).value)
  );
  const versions = getAppVersions();
  const SERIES_ORDER: Record<string, number> = { '高三': 0, '同步': 1 };
  const DIFF_ORDER: Record<string, number> = { '培优': 0, '中等': 1, '基础': 2 };
  versions.sort((a, b) => {
    const sa = Object.keys(SERIES_ORDER).find(k => a.name.includes(k)) || '';
    const sb = Object.keys(SERIES_ORDER).find(k => b.name.includes(k)) || '';
    const sd = (SERIES_ORDER[sa] ?? 9) - (SERIES_ORDER[sb] ?? 9);
    if (sd !== 0) return sd;
    const da = Object.keys(DIFF_ORDER).find(k => a.name.includes(k)) || '';
    const db = Object.keys(DIFF_ORDER).find(k => b.name.includes(k)) || '';
    return (DIFF_ORDER[da] ?? 9) - (DIFF_ORDER[db] ?? 9);
  });
  container.innerHTML = '';
  versions.forEach(v => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-md);cursor:pointer;font-size:13px;font-weight:500;transition:border-color .2s,background-color .2s;background:var(--surface)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'question_versions';
    cb.value = v.id;
    cb.checked = checkedIds.has(v.id);
    cb.style.cssText = 'accent-color:' + v.theme.primary + ';width:18px;height:18px;cursor:pointer;flex-shrink:0';
    const updateStyle = () => {
      wrap.style.background = cb.checked ? v.theme.primary + '15' : 'var(--surface)';
      wrap.style.borderColor = cb.checked ? v.theme.primary : 'var(--border)';
    };
    cb.onchange = updateStyle;
    wrap.onclick = (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      updateStyle();
    };
    const span = document.createElement('span');
    span.textContent = v.emoji + ' ' + v.name;
    wrap.append(cb, span);
    if (cb.checked) {
      wrap.style.background = v.theme.primary + '15';
      wrap.style.borderColor = v.theme.primary;
    }
    container.appendChild(wrap);
  });
}

export function getSelectedVersions(): string[] {
  return Array.from(document.querySelectorAll('input[name="question_versions"]:checked'))
    .map(cb => (cb as HTMLInputElement).value);
}

export function resetVersionCheckboxes(): void {
  document.querySelectorAll('input[name="question_versions"]').forEach(cb => {
    (cb as HTMLInputElement).checked = false;
  });
}

export { DEFAULT_VERSION_ID };
