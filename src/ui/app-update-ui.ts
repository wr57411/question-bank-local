import { APP_VERSION_CODE, APP_VERSION_NAME } from '../services/app-update';
import { showStatus } from './common';

interface UpdateInfo {
  has_update: boolean;
  version_name: string;
  version_code: number;
  release_notes: string;
  download_url: string;
}

let _updateInfo: UpdateInfo | null = null;

function getServerUrl(): string {
  return localStorage.getItem('serverUrl') || '';
}

export function initAppUpdateUI(): void {
  const el = document.getElementById('current-version-display');
  if (el) el.textContent = APP_VERSION_NAME;
}

export async function manualCheckUpdate(): Promise<void> {
  const btn = document.getElementById('check-update-btn') as HTMLButtonElement;
  const status = document.getElementById('check-update-status') as HTMLElement;
  const serverUrl = getServerUrl();
  btn.disabled = true;
  btn.textContent = '检查中...';
  status.textContent = '';
  status.style.color = 'var(--text-tertiary)'
  if (!serverUrl) {
    status.textContent = '⚠️ 未配置服务器地址，请先登录';
    status.style.color = 'var(--warning)';
    btn.disabled = false;
    btn.textContent = '检查更新';
    return;
  }
  try {
    const resp = await fetch(serverUrl + '/api/version/latest?current_code=' + APP_VERSION_CODE);
    if (!resp.ok) throw new Error('服务器响应异常 ' + resp.status);
    const data = await resp.json() as UpdateInfo;
    if (data.has_update) {
      status.textContent = '🎉 发现新版本 ' + data.version_name;
      status.style.color = 'var(--mint)';
      _updateInfo = data;
      showUpdateModal(data);
    } else {
      status.textContent = '✅ 已是最新版本';
      status.style.color = 'var(--mint)';
    }
  } catch (e: any) {
    status.textContent = '❌ 连接失败: ' + e.message;
    status.style.color = 'var(--danger)';
  }
  btn.disabled = false;
  btn.textContent = '检查更新';
}

export async function checkAppUpdate(): Promise<void> {
  const serverUrl = getServerUrl();
  if (!serverUrl) return;
  try {
    const resp = await fetch(serverUrl + '/api/version/latest?current_code=' + APP_VERSION_CODE);
    if (!resp.ok) return;
    const data = await resp.json() as UpdateInfo;
    if (!data.has_update) return;
    const skipped = localStorage.getItem('skip_version_code');
    if (skipped && parseInt(skipped) >= data.version_code) return;
    _updateInfo = data;
    showUpdateModal(data);
  } catch { /* silent */ }
}

function showUpdateModal(data: UpdateInfo): void {
  (document.getElementById('update-version-name') as HTMLElement).textContent = data.version_name;
  (document.getElementById('update-release-notes') as HTMLElement).textContent = data.release_notes || '优化体验，修复问题';
  (document.getElementById('update-progress') as HTMLElement).style.display = 'none';
  (document.getElementById('update-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('update-btn') as HTMLButtonElement).textContent = '下载更新';
  document.getElementById('update-modal')!.classList.add('active');
}

export function dismissUpdate(): void {
  document.getElementById('update-modal')!.classList.remove('active');
  if (_updateInfo) localStorage.setItem('skip_version_code', String(_updateInfo.version_code));
}

export async function downloadAndInstall(): Promise<void> {
  const serverUrl = getServerUrl();
  if (!_updateInfo || !serverUrl) return;
  const btn = document.getElementById('update-btn') as HTMLButtonElement;
  const progressWrap = document.getElementById('update-progress') as HTMLElement;
  btn.disabled = true;
  btn.textContent = '打开下载...';
  progressWrap.style.display = 'none';
  try {
    const dlUrl = serverUrl + _updateInfo.download_url;
    window.open(dlUrl, '_system');
    btn.textContent = '已跳转浏览器';
    showStatus('正在浏览器中下载，请安装后重启APP', 'success');
  } catch (e: any) {
    showStatus('跳转失败: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '重试下载';
  }
}
