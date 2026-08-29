/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

export function exportSelectedOrAll(): void {
  const filtered = w.getFilteredQuestions();
  const qs = w.selectedQuestions.size > 0 ? w.allQuestions.filter((q: any) => w.selectedQuestions.has(q.id)) : filtered;
  showExportModal(qs);
}

export function showExportModal(questions: any[]): void {
  w._exportQuestions = questions;
  document.getElementById('export-summary')!.textContent = '将导出 ' + questions.length + ' 道题目';
  const now = new Date();
  const ts = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  (document.getElementById('export-filename') as HTMLInputElement).value = '题库导出_' + ts;
  loadExportFolders();
  document.getElementById('export-modal')!.classList.add('active');
}

export async function loadExportFolders(): Promise<void> {
  const sel = document.getElementById('export-folder-select') as HTMLSelectElement;
  sel.innerHTML = '<option value="">加载中...</option>';
  try {
    const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
    if (isNative && w.Capacitor?.Plugins?.Filesystem) {
      const result = await w.Capacitor.Plugins.Filesystem.readdir({ path: '.', directory: 'DOCUMENTS' });
      const dirs = (result.files || []).filter((f: any) => typeof f === 'object' && f.type === 'directory');
      sel.innerHTML = '';
      dirs.forEach((d: any) => { const o = document.createElement('option'); o.value = d.name; o.textContent = '📁 ' + d.name; sel.appendChild(o); });
    }
  } catch (_e) { sel.innerHTML = ''; }
  const opt = document.createElement('option'); opt.value = '__new__'; opt.textContent = '＋ 新建文件夹...';
  sel.appendChild(opt);
  sel.onchange = () => { document.getElementById('export-new-folder-wrap')!.style.display = sel.value === '__new__' ? 'flex' : 'none'; };
}

export async function confirmNewExportFolder(): Promise<void> {
  const name = (document.getElementById('export-new-folder-name') as HTMLInputElement).value.trim();
  if (!name) return;
  try { await w.Capacitor.Plugins.Filesystem.mkdir({ path: name, directory: 'DOCUMENTS', recursive: true }); } catch (_e) { /* ignore */ }
  await loadExportFolders();
  const sel = document.getElementById('export-folder-select') as HTMLSelectElement;
  sel.value = name;
  sel.onchange!(null as any);
  w.showStatus('文件夹已创建: ' + name, 'success');
}

export function getExportFolder(): string {
  const sel = document.getElementById('export-folder-select') as HTMLSelectElement | null;
  return (sel && sel.value && sel.value !== '__new__') ? sel.value : '';
}

export function getExportFileName(): string {
  return (document.getElementById('export-filename') as HTMLInputElement)?.value?.trim() || '题库导出';
}

export async function previewExportPDF(): Promise<void> {
  const qs = w._exportQuestions;
  if (!qs || !qs.length) { w.showStatus('没有可导出的题目', 'error'); return; }
  w.showStatus('正在生成预览，请稍候...', 'success');
  const spc = w.exportSpacing === 'large' ? parseFloat((document.getElementById('spc-large') as HTMLInputElement).value) : w.exportSpacing === 'small' ? parseFloat((document.getElementById('spc-small') as HTMLInputElement).value) : 0;
  const doc = await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName(), noSave: true });
  if (!doc) { w.showStatus('生成失败', 'error'); return; }
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  if (isNative && w.Capacitor?.Plugins?.Filesystem) {
    const ab = doc.output('arraybuffer');
    const bytes = new Uint8Array(ab);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) { binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk))); }
    const b64 = btoa(binary);
    const tmpFile = 'preview_temp.pdf';
    try {
      try { await w.Capacitor.Plugins.Filesystem.deleteFile({ path: tmpFile, directory: 'CACHE' }); } catch (_) { /* ignore */ }
      await w.Capacitor.Plugins.Filesystem.writeFile({ path: tmpFile, data: b64, directory: 'CACHE' });
      const uriResult = await w.Capacitor.Plugins.Filesystem.getUri({ path: tmpFile, directory: 'CACHE' });
      if (w.Capacitor.Plugins.FileOpener) {
        await w.Capacitor.Plugins.FileOpener.open({ filePath: uriResult.uri, contentType: 'application/pdf' });
      } else {
        await w.Capacitor.Plugins.Browser.open({ url: uriResult.uri });
      }
      w.showStatus('预览已打开', 'success');
      setTimeout(() => { try { w.Capacitor.Plugins.Filesystem.deleteFile({ path: tmpFile, directory: 'CACHE' }); } catch (_) { /* ignore */ } }, 30000);
    } catch (e: any) { w.showStatus('预览失败: ' + e.message, 'error'); }
  } else {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }
}

export function closeExportModal(): void { document.getElementById('export-modal')!.classList.remove('active'); }

export function selectExportMode(el: HTMLElement, mode: string): void {
  w.exportMode = mode;
  document.querySelectorAll('#export-modal .mode-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

export function selectSpacing(el: HTMLElement, sp: string): void {
  w.exportSpacing = sp;
  document.querySelectorAll('#export-modal .spacing-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

export async function doExportPDF(): Promise<void> {
  const qs = w._exportQuestions;
  if (!qs || !qs.length) { w.showStatus('没有可导出的题目', 'error'); return; }
  closeExportModal();
  w.showStatus('正在生成 PDF...', 'success');
  const spc = w.exportSpacing === 'large' ? parseFloat((document.getElementById('spc-large') as HTMLInputElement).value) : w.exportSpacing === 'small' ? parseFloat((document.getElementById('spc-small') as HTMLInputElement).value) : 0;
  await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName() });
  w.showStatus('PDF 已生成', 'success');
}
