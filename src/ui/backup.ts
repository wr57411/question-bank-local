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

export function showBackupModal(): void {
  const toggle = document.getElementById('auto-backup-toggle') as HTMLInputElement | null;
  const autoBackupEnabled = localStorage.getItem('autoBackup') === '1';
  if (toggle) toggle.checked = autoBackupEnabled;
  updateBackupStatusUI();
  const info = document.getElementById('backup-path-info');
  if (info) {
    const custom = localStorage.getItem('backupPath');
    info.innerHTML = custom ? '备份到 <b>' + custom + '/</b> 目录下' : '文件将保存在 <b>Documents/question-bank-backup.json</b>';
  }
  document.getElementById('backup-modal')!.classList.add('active');
}

export function closeBackupModal(): void {
  document.getElementById('backup-modal')!.classList.remove('active');
}

export function toggleAutoBackup(enabled: boolean): void {
  localStorage.setItem('autoBackup', enabled ? '1' : '0');
  if (enabled) void doAutoBackup();
}

export async function doAutoBackup(): Promise<void> {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Filesystem = isNative ? cap?.Plugins?.Filesystem : null;
  if (localStorage.getItem('autoBackup') !== '1' || !isNative || !Filesystem) return;
  try {
    const data = await smartBackup();
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    await Filesystem.writeFile({ path: getBackupPath(), data: content, directory: getBackupDir() });
    localStorage.setItem('lastBackupTime', new Date().toISOString());
  } catch (e) { console.error('自动备份失败:', e); }
}

export async function buildBackupData(): Promise<{ questions: any[]; tags: any[]; question_tags: any[]; papers: any[]; paper_questions: any[]; similar_question_links: any[] }> {
  const { dbQuestions, dbTags, dbQuestionTags, dbPapers, dbPaperQuestions, dbSimilarQuestionLinks } = await import('../data/stores');
  const data: any = { questions: [], tags: [], question_tags: [], papers: [], paper_questions: [], similar_question_links: [] };
  await dbQuestions.iterate((v: any) => data.questions.push(v));
  await dbTags.iterate((v: any) => data.tags.push(v));
  await dbQuestionTags.iterate((v: any) => data.question_tags.push(v));
  await dbPapers.iterate((v: any) => data.papers.push(v));
  await dbPaperQuestions.iterate((v: any) => data.paper_questions.push(v));
  await dbSimilarQuestionLinks.iterate((v: any) => data.similar_question_links.push(v));
  return data;
}

export async function saveBackupToDevice(): Promise<void> {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Filesystem = isNative ? cap?.Plugins?.Filesystem : null;
  try {
    const data = await smartBackup();
    if (isNative && Filesystem) {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      await Filesystem.writeFile({ path: getBackupPath(), data: content, directory: getBackupDir() });
      localStorage.setItem('lastBackupTime', new Date().toISOString());
      updateBackupStatusUI();
      showStatus('备份已保存', 'success');
    } else {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a') as HTMLAnchorElement;
      a.href = url; a.download = 'question-bank-backup.json';
      a.click(); URL.revokeObjectURL(url);
      showStatus('备份已下载', 'success');
    }
  } catch (e) { showStatus('备份失败: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
}

export async function loadBackupFromDevice(): Promise<void> {
  const cap = (window as any).Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Filesystem = isNative ? cap?.Plugins?.Filesystem : null;
  const existingQS = await (window as any).dbGetAllQuestions?.() ?? [];
  const existingCount = existingQS.length;
  if (existingCount > 0 && !confirm('当前已有 ' + existingCount + ' 道题目，加载备份将覆盖同名数据。\n\n确定要继续吗？')) return;
  try {
    if (isNative && Filesystem) {
      const result = await Filesystem.readFile({ path: 'question-bank-backup.json', directory: getBackupDir() });
      const json = decodeURIComponent(escape(atob(result.data)));
      const data = JSON.parse(json);
      const backupCount = data.questions?.length || 0;
      if (!confirm('备份包含 ' + backupCount + ' 道题目，确定导入？')) return;
      await importBackupData(data);
      await (window as any).refreshAll?.();
      showStatus('备份恢复成功: ' + backupCount + ' 题', 'success');
    } else {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
        const data = JSON.parse(await file.text());
        await importBackupData(data); await (window as any).refreshAll?.();
        showStatus('备份恢复成功: ' + (data.questions?.length || 0) + ' 题', 'success');
      };
      input.click();
    }
  } catch (e) { showStatus('恢复失败: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
}
