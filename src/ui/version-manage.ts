import {
  getAppVersions,
  getAppVersionById,
  getCurrentVersionId,
  saveAppVersions,
  applyVersionTheme,
} from '../services/version-skin';
import { closeModal, openModal, showStatus } from './common';
import { renderVersionSwitcher, renderVersionCheckboxes, renderVersionFilterTags, DEFAULT_VERSION_ID } from './version-skin';

const w = window as unknown as Record<string, unknown>;

let editingVersionId: string | null = null;
let deletingVersionId: string | null = null;

export function showAddVersionModal(): void {
  editingVersionId = null;
  (document.getElementById('version-modal-title') as HTMLElement).textContent = '添加版本';
  (document.getElementById('version-name-input') as HTMLInputElement).value = '';
  (document.getElementById('version-emoji-input') as HTMLInputElement).value = '';
  (document.getElementById('version-tagline-input') as HTMLInputElement).value = '';
  (document.getElementById('version-delete-btn') as HTMLElement).style.display = 'none';
  openModal('version-modal');
}

export function showEditVersionModal(versionId: string): void {
  const version = getAppVersionById(versionId);
  if (!version) return;
  editingVersionId = versionId;
  (document.getElementById('version-modal-title') as HTMLElement).textContent = '编辑版本';
  (document.getElementById('version-name-input') as HTMLInputElement).value = version.name;
  (document.getElementById('version-emoji-input') as HTMLInputElement).value = version.emoji;
  (document.getElementById('version-tagline-input') as HTMLInputElement).value = version.tagline || '';
  (document.getElementById('version-delete-btn') as HTMLElement).style.display = 'inline-block';
  openModal('version-modal');
}

export function closeVersionModal(): void {
  closeModal('version-modal');
  editingVersionId = null;
}

export function saveVersion(): void {
  const name = (document.getElementById('version-name-input') as HTMLInputElement).value.trim();
  const emoji = (document.getElementById('version-emoji-input') as HTMLInputElement).value.trim();
  const tagline = (document.getElementById('version-tagline-input') as HTMLInputElement).value.trim();

  if (!name) { showStatus('请输入版本名称', 'error'); return; }
  if (!emoji) { showStatus('请选择版本图标', 'error'); return; }

  const versions = getAppVersions();

  if (editingVersionId) {
    const idx = versions.findIndex(v => v.id === editingVersionId);
    if (idx !== -1) {
      versions[idx].name = name;
      versions[idx].emoji = emoji;
      versions[idx].tagline = tagline;
    }
  } else {
    const id = 'custom_' + Date.now();
    const hue = Math.floor(Math.random() * 360);
    versions.push({
      id,
      name,
      emoji,
      tagline,
      theme: {
        primary: `hsl(${hue}, 70%, 45%)`,
        primaryLight: `hsl(${hue}, 70%, 95%)`,
        primaryDark: `hsl(${hue}, 70%, 30%)`,
        accent: `hsl(${(hue + 180) % 360}, 70%, 45%)`,
        accentLight: `hsl(${(hue + 180) % 360}, 70%, 95%)`,
        headerGradStart: `hsl(${hue}, 70%, 45%)`,
        headerGradEnd: `hsl(${hue + 20}, 60%, 50%)`,
      }
    });
  }

  saveAppVersions(versions);
  closeVersionModal();
  renderVersionSwitcher();
  renderVersionCheckboxes();
  renderVersionFilterTags();
  showStatus(editingVersionId ? '版本已更新' : '版本已添加', 'success');
}

export function deleteVersion(): void {
  if (!editingVersionId) return;
  const systemPassword = localStorage.getItem('systemPassword');
  if (!systemPassword) {
    showStatus('请先在设置中设置系统密码', 'error');
    return;
  }
  deletingVersionId = editingVersionId;
  (document.getElementById('version-delete-password') as HTMLInputElement).value = '';
  (document.getElementById('version-delete-error') as HTMLElement).style.display = 'none';
  openModal('version-delete-modal');
}

export function closeVersionDeleteModal(): void {
  closeModal('version-delete-modal');
  deletingVersionId = null;
}

export async function confirmDeleteVersion(): Promise<void> {
  if (!deletingVersionId) return;
  const password = (document.getElementById('version-delete-password') as HTMLInputElement).value;
  const systemPassword = localStorage.getItem('systemPassword');

  if (password !== systemPassword) {
    (document.getElementById('version-delete-error') as HTMLElement).textContent = '密码错误';
    (document.getElementById('version-delete-error') as HTMLElement).style.display = 'block';
    return;
  }

  const versions = getAppVersions().filter(v => v.id !== deletingVersionId);
  saveAppVersions(versions);

  const dbRemoveVersionFromAllQuestions = w.dbRemoveVersionFromAllQuestions as ((id: string) => Promise<void>) | undefined;
  if (dbRemoveVersionFromAllQuestions) await dbRemoveVersionFromAllQuestions(deletingVersionId);

  if (getCurrentVersionId() === deletingVersionId) {
    localStorage.setItem('appVersion', versions[0]?.id || DEFAULT_VERSION_ID);
    applyVersionTheme(getCurrentVersionId());
  }

  closeVersionDeleteModal();
  closeVersionModal();
  renderVersionSwitcher();
  renderVersionCheckboxes();
  renderVersionFilterTags();
  const loadQuestions = w.loadQuestions as (() => Promise<void>) | undefined;
  if (loadQuestions) await loadQuestions();
  showStatus('版本已删除', 'success');
}

export function showSystemPasswordModal(): void {
  const hasPassword = !!localStorage.getItem('systemPassword');
  (document.getElementById('system-password-label') as HTMLElement).textContent = hasPassword ? '修改密码' : '设置密码';
  (document.getElementById('system-password-confirm-group') as HTMLElement).style.display = hasPassword ? 'none' : 'block';
  (document.getElementById('system-password-input') as HTMLInputElement).value = '';
  (document.getElementById('system-password-confirm') as HTMLInputElement).value = '';
  (document.getElementById('system-password-error') as HTMLElement).style.display = 'none';
  openModal('system-password-modal');
}

export function closeSystemPasswordModal(): void {
  closeModal('system-password-modal');
}

export function saveSystemPassword(): void {
  const hasPassword = !!localStorage.getItem('systemPassword');
  const password = (document.getElementById('system-password-input') as HTMLInputElement).value;
  const confirm = (document.getElementById('system-password-confirm') as HTMLInputElement).value;

  if (!password) {
    (document.getElementById('system-password-error') as HTMLElement).textContent = '请输入密码';
    (document.getElementById('system-password-error') as HTMLElement).style.display = 'block';
    return;
  }

  if (!hasPassword && password !== confirm) {
    (document.getElementById('system-password-error') as HTMLElement).textContent = '两次输入的密码不一致';
    (document.getElementById('system-password-error') as HTMLElement).style.display = 'block';
    return;
  }

  localStorage.setItem('systemPassword', password);
  closeSystemPasswordModal();
  showStatus(hasPassword ? '密码已修改' : '密码已设置', 'success');
}
