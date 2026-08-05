import { getChangelogCount, shouldForceFullSnapshot, smartBackup, importBackupData, exportFullBackup } from '../data/backup';
import { showStatus } from './common';

declare const Filesystem: unknown;

export async function updateBackupStatusUI(): Promise<void> {
  const el = document.getElementById('backup-status');
  if (!el) return;
  const last = localStorage.getItem('lastBackupTime');
  const changelogSize = await getChangelogCount();
  const needsFull = shouldForceFullSnapshot();
  el.textContent = last
    ? `上次备份: ${new Date(last).toLocaleString()} | 待同步变更: ${changelogSize} 条${needsFull ? ' (建议全量)' : ''}`
    : `尚未备份 | 待同步变更: ${changelogSize} 条`;
}

export async function doSmartBackup(): Promise<void> {
  try {
    const isNative = !!(window as unknown as Record<string, unknown>).Capacitor &&
      ((window as unknown as Record<string, { isNativePlatform?: () => boolean }>).Capacitor?.isNativePlatform?.());

    const result = await smartBackup();
    const jsonStr = JSON.stringify(result);

    if (isNative && Filesystem) {
      const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
      const backupPath = localStorage.getItem('backupPath')
        ? localStorage.getItem('backupPath') + '/question-bank-backup.json'
        : 'question-bank-backup.json';
      await (Filesystem as { writeFile: (opts: unknown) => Promise<void> }).writeFile({
        path: backupPath, data: base64, directory: 'DOCUMENTS',
      });
    } else {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `question-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    localStorage.setItem('lastBackupTime', new Date().toISOString());
    await updateBackupStatusUI();
    const isFull = 'is_full' in result && (result as { is_full: boolean }).is_full;
    showStatus(isFull ? '全量备份完成' : '增量备份完成', 'success');
  } catch (e) {
    showStatus('备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function doFullBackup(): Promise<void> {
  try {
    const data = await exportFullBackup();
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question-bank-full-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('lastBackupTime', new Date().toISOString());
    await updateBackupStatusUI();
    showStatus('全量备份已下载', 'success');
  } catch (e) {
    showStatus('全量备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function restoreFromBackup(file: File): Promise<void> {
  try {
    const data = JSON.parse(await file.text()) as Record<string, unknown>;
    const result = await importBackupData(data);
    showStatus(`恢复成功: ${result.questions} 题, ${result.tags} 标签`, 'success');
  } catch (e) {
    showStatus('恢复失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export function getBackupPath(): string {
  const custom = localStorage.getItem('backupPath');
  return custom ? custom + '/question-bank-backup.json' : 'question-bank-backup.json';
}

export function getBackupDir(): string { return 'DOCUMENTS'; }
