/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

// ---------- Module-level state ----------
let apiToken = localStorage.getItem('apiToken') || '';
let serverUrl = localStorage.getItem('serverUrl') || 'http://100.94.79.16:3001';
let currentUser: any = JSON.parse(localStorage.getItem('currentUser') || 'null');
let autoSyncEnabled = localStorage.getItem('autoSync') !== '0';
let syncEnabled = localStorage.getItem('syncEnabled') !== '0';
let syncInFlight = false;
let syncQueued = false;
let lastSyncError: string | null = null;
let serverConnected: boolean | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncPollTimer: ReturnType<typeof setInterval> | null = null;
let supabaseSyncTimer: ReturnType<typeof setInterval> | null = null;
const SYNC_DEBOUNCE_MS = 800;
const SYNC_POLL_MS = 300000;
const SUPABASE_SYNC_MS = 300000;

// Expose on window for cross-module access
Object.defineProperty(w, 'apiToken', { get: () => apiToken, set: (v: any) => { apiToken = v; }, configurable: true });
Object.defineProperty(w, 'serverUrl', { get: () => serverUrl, set: (v: any) => { serverUrl = v; }, configurable: true });
Object.defineProperty(w, 'currentUser', { get: () => currentUser, set: (v: any) => { currentUser = v; }, configurable: true });
Object.defineProperty(w, 'autoSyncEnabled', { get: () => autoSyncEnabled, set: (v: any) => { autoSyncEnabled = v; }, configurable: true });
Object.defineProperty(w, 'syncEnabled', { get: () => syncEnabled, set: (v: any) => { syncEnabled = v; }, configurable: true });

// ---------- Functions ----------

export function apiHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiToken };
}

export function setSyncStatus(text: string): void {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text;
}

export function showSyncStatus(text: string): void {
  setSyncStatus(text);
  updateSyncBar();
}
w.showSyncStatus = showSyncStatus;

export async function checkServerConnection(): Promise<void> {
  const el = document.getElementById('sync-bar-server');
  if (!el) return;
  if (!currentUser || !serverUrl) {
    el.textContent = '⚪ 未登录';
    serverConnected = null;
    return;
  }
  try {
    await apiCall('/api/recovery/status');
    el.textContent = '🟢 Mac mini';
    serverConnected = true;
  } catch {
    el.textContent = '🔴 Mac mini';
    serverConnected = false;
  }
}

export function updateSyncBar(): void {
  const stateEl = document.getElementById('sync-bar-state');
  const timeEl = document.getElementById('sync-bar-time');
  const btn = document.getElementById('sync-bar-btn') as HTMLButtonElement | null;
  if (!stateEl) return;
  const canDoSync = canSync();
  if (btn) btn.disabled = !canDoSync || syncInFlight;
  if (!currentUser) {
    stateEl.textContent = '同步: 未登录';
    if (timeEl) timeEl.textContent = '';
    return;
  }
  if (syncInFlight) {
    stateEl.textContent = '🔄 同步中...';
    return;
  }
  if (lastSyncError) {
    stateEl.textContent = '🔴 同步失败';
    if (timeEl) timeEl.textContent = lastSyncError;
    return;
  }
  const lastSync = localStorage.getItem('lastSyncTime');
  if (!lastSync) {
    stateEl.textContent = '⚪ 从未同步';
    if (timeEl) timeEl.textContent = '';
    return;
  }
  const diffMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
  if (diffMin < 5) {
    stateEl.textContent = '🟢 同步: 最新';
  } else if (diffMin < 60) {
    stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin) + '分钟前';
  } else {
    stateEl.textContent = '🟡 同步: ' + Math.floor(diffMin / 60) + '小时前';
  }
  if (timeEl) timeEl.textContent = new Date(lastSync).toLocaleString();
}

export async function handleSyncBarClick(): Promise<void> {
  if (syncInFlight || !canSync()) return;
  const btn = document.getElementById('sync-bar-btn') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = '🔄 ...'; }
  lastSyncError = null;
  updateSyncBar();
  await runSync({ silent: false });
  if (btn) { btn.textContent = '🔄 同步'; btn.disabled = false; }
  updateSyncBar();
}

export function canSync(): boolean {
  return !!(currentUser && syncEnabled && apiToken && serverUrl);
}

export function getSyncCursor(): string {
  return localStorage.getItem('syncCursor') || '';
}

export function setSyncCursor(value: string): void {
  if (value) localStorage.setItem('syncCursor', value);
}

export function clearSyncCursor(): void {
  localStorage.removeItem('syncCursor');
}

export async function apiCall(path: string, method = 'GET', body: any = null): Promise<any> {
  if (!serverUrl) throw new Error('未配置服务器地址');
  const opts: RequestInit = { method, headers: apiHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(serverUrl + path, opts);
  const raw = await resp.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    const snippet = raw.substring(0, 100).replace(/\n/g, ' ');
    throw new Error(`服务器返回非JSON (${resp.status}): ${snippet}`);
  }
  if (!resp.ok) throw new Error(data.error || '请求失败');
  return data;
}

export function updateLoginUI(): void {
  const btn = document.getElementById('login-btn');
  const status = document.getElementById('user-status');
  if (currentUser) {
    if (btn) {
      btn.textContent = '☁️ ' + (currentUser.nickname || currentUser.phone || '已登录');
      btn.onclick = () => showSyncModal();
    }
    if (status) status.textContent = '已登录 · 云端同步可用';
  } else {
    if (btn) {
      btn.textContent = '👤 登录';
      btn.onclick = () => showLoginModal();
    }
    if (status) status.textContent = '数据存储在本地，无需联网';
  }
}

export function showLoginModal(): void {
  (document.getElementById('server-url') as HTMLInputElement).value = serverUrl;
  (document.getElementById('login-phone') as HTMLInputElement).value = localStorage.getItem('lastPhone') || '';
  (document.getElementById('login-error') as HTMLElement).style.display = 'none';
  document.getElementById('login-modal')!.classList.add('active');
}

export function closeLoginModal(): void {
  document.getElementById('login-modal')!.classList.remove('active');
}

export function showSyncModal(): void {
  (document.getElementById('sync-user-name') as HTMLElement).textContent = currentUser?.nickname || currentUser?.phone || '';
  (document.getElementById('auto-sync-toggle') as HTMLInputElement).checked = autoSyncEnabled;
  (document.getElementById('sync-toggle') as HTMLInputElement).checked = syncEnabled;
  (document.getElementById('backup-server-url') as HTMLInputElement).value = serverUrl;
  const lastSync = localStorage.getItem('lastSyncTime');
  (document.getElementById('sync-status') as HTMLElement).textContent = lastSync ? '上次同步: ' + new Date(lastSync).toLocaleString() : '尚未同步';
  document.getElementById('sync-modal')!.classList.add('active');
  checkRecoveryStatus();
}

export function closeSyncModal(): void {
  document.getElementById('sync-modal')!.classList.remove('active');
}

export function showSyncWarning(warnings: any[]): void {
  const detailsEl = document.getElementById('sync-warning-details')!;
  detailsEl.innerHTML = warnings.map((warn: any) =>
    `<div style="margin-bottom:6px"><strong>${warn.table}</strong>: ${warn.before} → ${warn.after} 条 (丢失 ${warn.lost} 条)${warn.detail ? '<br><span style="color:var(--text-tertiary)">' + warn.detail + '</span>' : ''}</div>`
  ).join('');
  const msgEl = document.getElementById('sync-warning-message')!;
  const hasCritical = warnings.some((warn: any) => warn.severity === 'critical');
  msgEl.textContent = hasCritical
    ? '同步过程中检测到严重数据丢失，部分题目可能未同步成功。'
    : '同步过程中检测到部分数据量减少，可能存在数据丢弃。';
  document.getElementById('sync-warning-modal')!.classList.add('active');
  const log = JSON.parse(localStorage.getItem('syncWarningLog') || '[]');
  log.push({ time: new Date().toISOString(), warnings });
  if (log.length > 50) log.splice(0, log.length - 50);
  localStorage.setItem('syncWarningLog', JSON.stringify(log));
}

export function closeSyncWarning(): void {
  document.getElementById('sync-warning-modal')!.classList.remove('active');
}

export function handleAuthError(e: any): void {
  const msg = e.message || '';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION_REFUSED')) {
    showLoginError('服务器不可达，请确认：1) 服务端已启动 2) 地址正确');
  } else {
    showLoginError('连接失败: ' + msg);
  }
}

export async function doLogin(): Promise<void> {
  const url = (document.getElementById('server-url') as HTMLInputElement).value.trim().replace(/\/$/, '');
  const phone = (document.getElementById('login-phone') as HTMLInputElement).value.trim();
  const password = (document.getElementById('login-password') as HTMLInputElement).value;
  if (!url || !phone || !password) { showLoginError('请填写完整信息'); return; }
  try {
    const resp = await fetch(url + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      showLoginError(data.error || '服务器错误 (' + resp.status + ')');
      return;
    }
    const data = await resp.json();
    if (data.error) { showLoginError(data.error); return; }
    serverUrl = url; apiToken = data.token; currentUser = data;
    localStorage.setItem('serverUrl', url);
    localStorage.setItem('apiToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data));
    localStorage.setItem('lastPhone', phone);
    initRemoteSync(serverUrl, apiToken, syncEnabled);
    clearSyncCursor();
    closeLoginModal(); updateLoginUI();
    restartSyncPolling();
    if (autoSyncEnabled && syncEnabled) queueAutoSync(true);
    startSupabaseAutoSync();
    w.showStatus('登录成功', 'success');
  } catch (e) { handleAuthError(e); }
}

export async function doRegister(): Promise<void> {
  const url = (document.getElementById('server-url') as HTMLInputElement).value.trim().replace(/\/$/, '');
  const phone = (document.getElementById('login-phone') as HTMLInputElement).value.trim();
  const password = (document.getElementById('login-password') as HTMLInputElement).value;
  if (!url || !phone || !password) { showLoginError('请填写完整信息'); return; }
  try {
    const resp = await fetch(url + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      showLoginError(data.error || '服务器错误 (' + resp.status + ')');
      return;
    }
    const data = await resp.json();
    if (data.error) { showLoginError(data.error); return; }
    serverUrl = url; apiToken = data.token; currentUser = data;
    localStorage.setItem('serverUrl', url);
    localStorage.setItem('apiToken', data.token);
    localStorage.setItem('currentUser', JSON.stringify(data));
    localStorage.setItem('lastPhone', phone);
    initRemoteSync(serverUrl, apiToken, syncEnabled);
    clearSyncCursor();
    closeLoginModal(); updateLoginUI();
    restartSyncPolling();
    if (autoSyncEnabled && syncEnabled) queueAutoSync(true);
    startSupabaseAutoSync();
    w.showStatus('注册成功', 'success');
  } catch (e) { handleAuthError(e); }
}

export function showLoginError(msg: string): void {
  const el = document.getElementById('login-error')!;
  el.textContent = msg;
  (el as HTMLElement).style.display = 'block';
}

export function doLogout(): void {
  if (!confirm('确定退出登录？本地数据不会删除。')) return;
  apiToken = ''; currentUser = null;
  localStorage.removeItem('apiToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('lastSyncTime');
  clearSyncCursor();
  stopSyncPolling();
  closeSyncModal(); updateLoginUI();
  w.showStatus('已退出登录', 'success');
}

export async function checkRecoveryStatus(): Promise<void> {
  const el = document.getElementById('recovery-status');
  if (!el) return;
  try {
    const resp = await apiCall('/api/recovery/status');
    el.textContent = resp.supabase_enabled ? '✅ Supabase 已连接' : '⚠️ Supabase 未配置';
    (el as HTMLElement).style.color = resp.supabase_enabled ? 'var(--mint)' : 'var(--warning)';
  } catch {
    el.textContent = '❌ 无法连接服务器';
    (el as HTMLElement).style.color = 'var(--danger)';
  }
}

export async function fullSyncToCloud(): Promise<void> {
  if (!confirm('将所有数据全量推送到 Supabase，用于容灾备份。\n\n确定继续？')) return;
  try {
    w.showStatus('正在同步到云端...', 'info');
    const resp = await apiCall('/api/recovery/sync-to-supabase', 'POST');
    if (resp.error) { w.showStatus('同步失败: ' + resp.error, 'error'); return; }
    w.showStatus(resp.message || '☁️ 云端同步已启动，后台执行中', 'success');
  } catch (e: any) {
    w.showStatus('同步失败: ' + e.message, 'error');
  }
}

export async function silentSupabaseSync(): Promise<void> {
  if (!currentUser || !apiToken || !serverUrl) return;
  try {
    await apiCall('/api/recovery/sync-to-supabase', 'POST');
  } catch (e: any) {
    console.warn('[Supabase自动同步] 失败:', e.message);
  }
}

export function startSupabaseAutoSync(): void {
  if (supabaseSyncTimer) clearInterval(supabaseSyncTimer);
  silentSupabaseSync();
  supabaseSyncTimer = setInterval(silentSupabaseSync, SUPABASE_SYNC_MS);
}

export function switchToBackupServer(): void {
  const url = (document.getElementById('backup-server-url') as HTMLInputElement).value.trim().replace(/\/$/, '');
  if (!url) { w.showStatus('请输入备用服务器地址', 'error'); return; }
  if (!confirm('即将切换到备用服务器：' + url + '\n\n切换后将从备用服务器同步数据。\n确定继续？')) return;
  serverUrl = url;
  localStorage.setItem('serverUrl', url);
  initRemoteSync(serverUrl, apiToken, syncEnabled);
  restartSyncPolling();
  w.showStatus('已切换到备用服务器', 'success');
  (document.getElementById('server-url') as HTMLInputElement).value = url;
}

export async function syncFromPrimaryServer(): Promise<void> {
  if (!confirm('从主服务器拉取最新数据到本地备用服务器。\n\n确定继续？')) return;
  try {
    w.showStatus('正在从主服务器拉取数据...', 'info');
    const resp = await apiCall('/api/recovery/sync-from-primary', 'POST');
    if (resp.error) { w.showStatus('同步失败: ' + resp.error, 'error'); return; }
    w.showStatus(resp.message || '📥 主服务器数据拉取已启动', 'success');
  } catch (e: any) {
    w.showStatus('同步失败: ' + e.message, 'error');
  }
}

export async function updateServerSyncStatus(): Promise<void> {
  const el = document.getElementById('server-sync-status');
  if (!el) return;
  try {
    const resp = await apiCall('/api/recovery/server-sync-status', 'GET');
    if (!resp.server_sync_enabled) {
      el.textContent = '未配置（需设置 PRIMARY_SERVER_URL）';
      (el as HTMLElement).style.color = 'var(--text-tertiary)';
    } else if (resp.sync_in_progress) {
      el.textContent = '正在同步中...';
      (el as HTMLElement).style.color = 'var(--sky)';
    } else if (resp.last_result && !resp.last_result.error) {
      el.textContent = '✅ 上次同步: ' + (resp.last_sync_at || '--');
      (el as HTMLElement).style.color = 'var(--mint)';
    } else {
      el.textContent = resp.last_result?.error ? '❌ ' + resp.last_result.error : '待同步';
      (el as HTMLElement).style.color = 'var(--warning)';
    }
  } catch {
    el.textContent = '❌ 无法获取状态';
    (el as HTMLElement).style.color = 'var(--danger)';
  }
}

export function stopSyncPolling(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
}

export function restartSyncPolling(): void {
  stopSyncPolling();
  if (!autoSyncEnabled || !canSync()) return;
  syncPollTimer = setInterval(() => { runSync({ silent: true }); }, SYNC_POLL_MS);
}

export function queueAutoSync(immediate = false): void {
  if (!autoSyncEnabled || !canSync()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { runSync({ silent: true }); }, immediate ? 0 : SYNC_DEBOUNCE_MS);
}

export async function runSync(opts: { forceFullPull?: boolean; skipPush?: boolean; silent?: boolean } = {}): Promise<boolean> {
  const { skipPush = false, silent = false } = opts;
  if (!currentUser) {
    if (!silent) w.showStatus('请先登录', 'error');
    return false;
  }
  if (!syncEnabled) {
    if (!silent) w.showStatus('请先开启实时同步', 'error');
    return false;
  }
  if (syncInFlight) {
    syncQueued = true;
    return false;
  }

  syncInFlight = true;
  try {
    setSyncStatus(skipPush ? '正在下载...' : '正在同步...');

    if (!skipPush) {
      const payload = await w.dbBuildSyncPayload();
      const pushResp = await apiCall('/api/sync/push', 'POST', payload);
      await w.dbFinalizeSuccessfulSync(pushResp.applied || {});
    }

    const pullResp = await apiCall('/api/sync/pull');
    await w.dbApplyRemoteSnapshot(pullResp);
    w.cloudProviders = JSON.parse(localStorage.getItem('cloud_providers') || '[]');
    w.currentProviderId = localStorage.getItem('current_provider_id') || '';
    await w.refreshAll();

    const syncTime = pullResp.now || new Date().toISOString();
    localStorage.setItem('lastSyncTime', syncTime);
    setSyncCursor(syncTime);
    setSyncStatus('上次同步: ' + new Date(syncTime).toLocaleString());

    if (!silent) w.showStatus(skipPush ? '下载完成' : '同步完成', 'success');
    lastSyncError = null;
    return true;
  } catch (e: any) {
    setSyncStatus((skipPush ? '下载' : '同步') + '失败: ' + e.message);
    if (!silent) w.showStatus((skipPush ? '下载' : '同步') + '失败: ' + e.message, 'error');
    lastSyncError = e.message;
    return false;
  } finally {
    syncInFlight = false;
    updateSyncBar();
    if (syncQueued && canSync()) {
      syncQueued = false;
      setTimeout(() => { runSync({ silent: true }); }, 0);
    } else {
      syncQueued = false;
    }
  }
}

export async function doSync(): Promise<boolean> {
  return runSync({ silent: false });
}

export async function doSyncDown(): Promise<boolean> {
  if (!currentUser) { w.showStatus('请先登录', 'error'); return false; }
  if (!confirm('将以服务器上的数据为准，重建当前手机上的本地缓存。\n\n如果这台手机有还没同步到服务器的数据，请先不要继续。\n\n确定继续吗？')) return false;
  try {
    setSyncStatus('正在从云端重建数据...');
    const pullResp = await apiCall('/api/sync/pull');
    await w.dbReplaceWithRemoteSnapshot(pullResp);
    await w.refreshAll();
    const syncTime = pullResp.now || new Date().toISOString();
    localStorage.setItem('lastSyncTime', syncTime);
    setSyncCursor(syncTime);
    setSyncStatus('上次同步: ' + new Date(syncTime).toLocaleString());
    w.showStatus('已按服务器数据重建本地缓存', 'success');
    return true;
  } catch (e: any) {
    setSyncStatus('下载失败: ' + e.message);
    w.showStatus('下载失败: ' + e.message, 'error');
    return false;
  }
}

export function toggleAutoSync(enabled: boolean): void {
  autoSyncEnabled = enabled;
  localStorage.setItem('autoSync', enabled ? '1' : '0');
  restartSyncPolling();
  if (enabled) queueAutoSync(true);
}

export function toggleSync(enabled: boolean): void {
  syncEnabled = enabled;
  localStorage.setItem('syncEnabled', enabled ? '1' : '0');
  initRemoteSync(serverUrl, apiToken, syncEnabled);
  restartSyncPolling();
  if (enabled) queueAutoSync(true);
  w.showStatus(enabled ? '实时同步已开启' : '实时同步已关闭', 'success');
}

export function initRemoteSync(_url: string, _token: string, _enabled: boolean): void {
  /* state already tracked in module */
}

export function initSyncUI(): void {
  updateLoginUI();
}
