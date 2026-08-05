/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ---------- Module-level state ----------
const BAIDU_APP_KEY = 'DFMqpIgeUIcXZnDhJZOLeG5g6rqMdSFz';
const BAIDU_SECRET_KEY = 'XEkpYsamxI4kkEiNa20OJ3bFyd8DGRrB';
const BAIDU_REDIRECT = 'https://openapi.baidu.com/oauth/2.0/login_success';
const BAIDU_SCOPE = 'basic,netdisk';
const BAIDU_CLOUD_PATH = '/apps/本地题库/backup.json';
let autoBaiduEnabled = localStorage.getItem('autoBaidu') === '1';

// ---------- Functions ----------

export function getBaiduToken(): any {
  const t = localStorage.getItem('baidu_token');
  return t ? JSON.parse(t) : null;
}

export function setBaiduToken(token: any): void {
  localStorage.setItem('baidu_token', JSON.stringify(token));
}

export function updateBaiduUI(): void {
  const token = getBaiduToken();
  const statusEl = document.getElementById('baidu-status')!;
  const actionsEl = document.getElementById('baidu-actions')!;
  const bindEl = document.getElementById('baidu-bind-area')!;
  const toggle = document.getElementById('auto-baidu-toggle') as HTMLInputElement | null;

  if (token && token.access_token) {
    const expiresAt = new Date(token.created_at + token.expires_in * 1000);
    const expired = Date.now() > expiresAt.getTime();
    statusEl.innerHTML = '已绑定' + (expired ? ' <span style="color:var(--danger)">（token 已过期，上传时自动刷新）</span>' : ' <span style="color:var(--mint)">✓</span>');
    (statusEl as HTMLElement).style.color = 'var(--text)';
    actionsEl.classList.remove('hidden');
    bindEl.innerHTML = '';
    if (toggle) toggle.checked = autoBaiduEnabled;
  } else {
    statusEl.textContent = '未绑定';
    (statusEl as HTMLElement).style.color = 'var(--text-tertiary)';
    actionsEl.classList.add('hidden');
    bindEl.innerHTML = '<button onclick="showBaiduAuthModal()" style="width:100%;background:var(--sky);padding:10px;font-size:14px">🔗 绑定百度网盘</button>';
  }
}

export function showBaiduAuthModal(): void {
  document.getElementById('baidu-auth-modal')!.classList.add('active');
}

export function closeBaiduAuthModal(): void {
  document.getElementById('baidu-auth-modal')!.classList.remove('active');
}

export function openBaiduAuth(): void {
  const url = 'https://openapi.baidu.com/oauth/2.0/authorize?' +
    'client_id=' + BAIDU_APP_KEY +
    '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(BAIDU_REDIRECT) +
    '&scope=' + BAIDU_SCOPE +
    '&display=page';
  if (w.isNative && w.Capacitor?.Plugins?.Browser) {
    w.Capacitor.Plugins.Browser.open({ url });
  } else {
    window.open(url, '_blank');
  }
}

export async function exchangeBaiduToken(): Promise<void> {
  const code = (document.getElementById('baidu-auth-code') as HTMLInputElement).value.trim();
  if (!code) { w.showStatus('请粘贴授权码', 'error'); return; }
  try {
    w.showStatus('正在绑定...', 'success');
    const resp = await fetch('https://openapi.baidu.com/oauth/2.0/token?' +
      'grant_type=authorization_code' +
      '&code=' + code +
      '&client_id=' + BAIDU_APP_KEY +
      '&client_secret=' + BAIDU_SECRET_KEY +
      '&redirect_uri=' + encodeURIComponent(BAIDU_REDIRECT));
    const data = await resp.json();
    if (data.access_token) {
      data.created_at = Date.now();
      setBaiduToken(data);
      closeBaiduAuthModal();
      updateBaiduUI();
      w.showStatus('百度网盘绑定成功', 'success');
    } else {
      w.showStatus('绑定失败: ' + (data.error_description || data.error || '未知错误'), 'error');
    }
  } catch (e: any) { w.showStatus('绑定失败: ' + e.message, 'error'); }
}

export async function refreshBaiduToken(): Promise<any> {
  const token = getBaiduToken();
  if (!token || !token.refresh_token) return null;
  try {
    const resp = await fetch('https://openapi.baidu.com/oauth/2.0/token?' +
      'grant_type=refresh_token' +
      '&refresh_token=' + token.refresh_token +
      '&client_id=' + BAIDU_APP_KEY +
      '&client_secret=' + BAIDU_SECRET_KEY);
    const data = await resp.json();
    if (data.access_token) {
      data.created_at = Date.now();
      if (!data.refresh_token) data.refresh_token = token.refresh_token;
      setBaiduToken(data);
      return data;
    }
  } catch (e) { console.error('刷新 token 失败:', e); }
  return null;
}

export async function getValidBaiduToken(): Promise<any> {
  let token = getBaiduToken();
  if (!token) { w.showStatus('请先绑定百度网盘', 'error'); return null; }
  const expiresAt = token.created_at + token.expires_in * 1000;
  if (Date.now() > expiresAt - 60000) {
    token = await refreshBaiduToken();
    if (!token) { w.showStatus('token 已过期，请重新绑定', 'error'); return null; }
  }
  return token;
}

export async function uploadToBaidu(): Promise<void> {
  const token = await getValidBaiduToken();
  if (!token) return;
  try {
    w.showStatus('正在上传到百度网盘...', 'success');
    const data = await w.buildBackupData();
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', blob, 'backup.json');
    const resp = await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
      'method=upload&access_token=' + token.access_token +
      '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH) +
      '&ondup=overwrite', {
      method: 'POST',
      body: formData
    });
    const result = await resp.json();
    if (result.path) {
      localStorage.setItem('lastBaiduBackup', new Date().toISOString());
      w.showStatus('已上传到百度网盘', 'success');
    } else {
      w.showStatus('上传失败: ' + (result.error_msg || result.error || '未知错误'), 'error');
    }
  } catch (e: any) { w.showStatus('上传失败: ' + e.message, 'error'); }
}

export async function downloadFromBaidu(): Promise<void> {
  const token = await getValidBaiduToken();
  if (!token) return;
  const existingQs = await w.dbGetAllQuestions();
  if (existingQs.length > 0 && !confirm('当前已有 ' + existingQs.length + ' 道题目，从百度网盘下载将覆盖同名数据。\n\n确定要继续吗？')) return;
  try {
    w.showStatus('正在从百度网盘下载...', 'success');
    const resp = await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
      'method=download&access_token=' + token.access_token +
      '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH));
    if (!resp.ok) { w.showStatus('下载失败（文件可能不存在）', 'error'); return; }
    const jsonStr = await resp.text();
    const data = JSON.parse(jsonStr);
    if (!confirm('备份包含 ' + (data.questions?.length || 0) + ' 道题目，确定导入？')) return;
    await w.importBackupData(data);
    await w.refreshAll();
    w.showStatus('从百度网盘恢复成功: ' + (data.questions?.length || 0) + ' 题', 'success');
  } catch (e: any) { w.showStatus('下载失败: ' + e.message, 'error'); }
}

export function unbindBaidu(): void {
  if (!confirm('确定解除百度网盘绑定？')) return;
  localStorage.removeItem('baidu_token');
  autoBaiduEnabled = false;
  localStorage.setItem('autoBaidu', '0');
  updateBaiduUI();
  w.showStatus('已解除绑定', 'success');
}

export function toggleAutoBaidu(enabled: boolean): void {
  autoBaiduEnabled = enabled;
  localStorage.setItem('autoBaidu', enabled ? '1' : '0');
  if (enabled) doAutoBaiduBackup();
}

export async function doAutoBaiduBackup(): Promise<void> {
  if (!autoBaiduEnabled) return;
  const token = await getValidBaiduToken();
  if (!token) return;
  try {
    const data = await w.buildBackupData();
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const formData = new FormData();
    formData.append('file', blob, 'backup.json');
    await fetch('https://d.pcs.baidu.com/rest/2.0/pcs/file?' +
      'method=upload&access_token=' + token.access_token +
      '&path=' + encodeURIComponent(BAIDU_CLOUD_PATH) +
      '&ondup=overwrite', {
      method: 'POST',
      body: formData
    });
    localStorage.setItem('lastBaiduBackup', new Date().toISOString());
  } catch (e) { console.error('百度网盘自动备份失败:', e); }
}
