/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
import { STEM_PT_PRESETS, loadStemPt, saveStemPt, ptToMM, mmToPt } from '../data/pdf-print-size';
import { analyzeImage } from '../data/pdf-image';
import { MIN_PRINT_SCALE, singleColumnWidthMM } from '../data/pdf-layout-engine';
import { loadPageSetup, savePageSetup } from '../data/pdf-page-setup';
import type { PageSetup } from '../types';
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
  const toPaper = document.getElementById('export-to-paper') as HTMLInputElement | null;
  if (toPaper) toPaper.checked = false;
  loadExportFolders();
  renderPrintSizeOptions();
  renderPageSetupInputs();
  refreshPrintSizeHint();
  openModal('export-modal');
}

let hintToken = 0;

export function renderPrintSizeOptions(): void {
  const wrap = document.getElementById('print-size-options');
  if (!wrap) return;
  wrap.innerHTML = '';
  const cur = loadStemPt();
  STEM_PT_PRESETS.forEach(p => {
    const el = document.createElement('div');
    el.className = 'print-size-option' + (p.pt === cur ? ' selected' : '');
    el.innerHTML = p.label + '<br>' + p.pt + 'pt';
    el.onclick = () => selectPrintSize(el, p.pt);
    wrap.appendChild(el);
  });
}

export function selectPrintSize(el: HTMLElement, pt: number): void {
  saveStemPt(pt);
  renderPrintSizeOptions();
  refreshPrintSizeHint();
}

export function getPrintStemMM(): number {
  return ptToMM(loadStemPt());
}

export function loadPageSetupForExport(): PageSetup {
  return loadPageSetup();
}

export function renderPageSetupInputs(): void {
  const s = loadPageSetup();
  const top = document.getElementById('ps-margin-top') as HTMLInputElement | null;
  const bottom = document.getElementById('ps-margin-bottom') as HTMLInputElement | null;
  const side = document.getElementById('ps-margin-side') as HTMLInputElement | null;
  const showTitle = document.getElementById('ps-show-title') as HTMLInputElement | null;
  const showCount = document.getElementById('ps-show-count') as HTMLInputElement | null;
  if (top) top.value = String(s.marginTopMM);
  if (bottom) bottom.value = String(s.marginBottomMM);
  if (side) side.value = String(s.marginSideMM);
  if (showTitle) showTitle.checked = s.showTitle;
  if (showCount) { showCount.checked = s.showCount; showCount.disabled = !s.showTitle; }
}

export function onPageSetupInputChanged(inputId: string): void {
  const top = document.getElementById('ps-margin-top') as HTMLInputElement | null;
  const bottom = document.getElementById('ps-margin-bottom') as HTMLInputElement | null;
  const side = document.getElementById('ps-margin-side') as HTMLInputElement | null;
  const showTitle = document.getElementById('ps-show-title') as HTMLInputElement | null;
  const showCount = document.getElementById('ps-show-count') as HTMLInputElement | null;
  const saved = loadPageSetup();
  const topVal = top ? top.value : String(saved.marginTopMM);
  const bottomVal = bottom ? bottom.value : String(saved.marginBottomMM);
  const sideVal = side ? side.value : String(saved.marginSideMM);
  if (topVal === '') { if (top) top.value = String(saved.marginTopMM); }
  if (bottomVal === '') { if (bottom) bottom.value = String(saved.marginBottomMM); }
  if (sideVal === '') { if (side) side.value = String(saved.marginSideMM); }
  const next: PageSetup = {
    marginTopMM: Number(top && top.value !== '' ? top.value : saved.marginTopMM),
    marginBottomMM: Number(bottom && bottom.value !== '' ? bottom.value : saved.marginBottomMM),
    marginSideMM: Number(side && side.value !== '' ? side.value : saved.marginSideMM),
    showTitle: showTitle ? showTitle.checked : saved.showTitle,
    showCount: showCount ? showCount.checked : saved.showCount,
  };
  savePageSetup(next);
  if (inputId === 'ps-show-title' && showCount && showTitle) showCount.disabled = !showTitle.checked;
  if (inputId === 'ps-margin-side') refreshPrintSizeHint();
}

export async function refreshPrintSizeHint(): Promise<void> {
  const myToken = ++hintToken;
  const hint = document.getElementById('print-size-hint');
  const qs = w._exportQuestions as any[] | undefined;
  if (!hint) return;
  if (!qs || !qs.length) { hint.textContent = '没有可测量的题目'; return; }
  const imgs = (qs.map((q: any) => q.question_image_url).filter((u: any) => u) as string[]).slice(0, 8);
  if (!imgs.length) { hint.textContent = '没有可测量的题目'; return; }
  hint.textContent = '测量中…';
  const stemMM = getPrintStemMM();
  const printedArr: number[] = [];
  let capped = 0;
  for (const src of imgs) {
    try {
      const r = await analyzeImage(src);
      if (myToken !== hintToken) return;
      const natural = (r.tH / r.w) * singleColumnWidthMM(loadPageSetup().marginSideMM);
      const printed = Math.min(natural, Math.max(MIN_PRINT_SCALE * natural, stemMM));
      printedArr.push(printed);
      if (natural < stemMM) capped++;
    } catch (_e) { /* skip */ }
  }
  if (myToken !== hintToken) return;
  if (!printedArr.length) { hint.textContent = '测量失败'; return; }
  const sorted = [...printedArr].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const x = mmToPt(mid);
  let text = `实测题干 ≈ ${x.toFixed(1)} pt（按单栏栏宽估算，抽样 ${imgs.length} 题）`;
  if (capped > 0) text += ` · ${capped} 题受纸宽上限，印不到目标字号`;
  hint.textContent = text;
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
  const doc = await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName(), noSave: true, stemMM: getPrintStemMM() });
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

export function closeExportModal(): void { closeModal('export-modal'); }

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
  const addToPaper = !!(document.getElementById('export-to-paper') as HTMLInputElement | null)?.checked;
  closeExportModal();
  w.showStatus('正在生成 PDF...', 'success');
  const spc = w.exportSpacing === 'large' ? parseFloat((document.getElementById('spc-large') as HTMLInputElement).value) : w.exportSpacing === 'small' ? parseFloat((document.getElementById('spc-small') as HTMLInputElement).value) : 0;
  const pdfPath = await w.generatePDF(qs, { mode: w.exportMode || 'single', spacing: w.exportSpacing, spacingCm: spc, title: getExportFileName(), stemMM: getPrintStemMM() });
  w.showStatus('PDF 已生成', 'success');
  if (addToPaper) await addExportToPaper(getExportFileName(), qs, typeof pdfPath === 'string' ? pdfPath : null);
}

async function addExportToPaper(name: string, qs: any[], pdfLocalPath: string | null): Promise<void> {
  let pdfUrl: string | null = null;
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  if (isNative && pdfLocalPath && w.Capacitor?.Plugins?.Filesystem) {
    try {
      const read = await w.Capacitor.Plugins.Filesystem.readFile({ path: pdfLocalPath, directory: 'DOCUMENTS' });
      const b64 = typeof read.data === 'string' ? read.data : '';
      const blob = base64ToBlob(b64, 'application/pdf');
      const serverUrl = (localStorage.getItem('serverUrl') || '').replace(/\/+$/, '');
      const token = localStorage.getItem('apiToken') || '';
      if (serverUrl && token) {
        const fd = new FormData();
        fd.append('file', blob, name.endsWith('.pdf') ? name : name + '.pdf');
        const resp = await fetch(serverUrl + '/api/upload-pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.url) pdfUrl = data.url;
      }
    } catch (_e) { pdfUrl = null; }
  }
  await w.dbCreatePaperFromExport(name, qs.map((q: any) => q.id), pdfUrl, pdfLocalPath);
  if (pdfUrl) w.showStatus('已添加到试卷管理（云端）', 'success');
  else if (isNative) w.showStatus('已加入试卷（网络未上传，仅本机可打开）', 'warning');
  else w.showStatus('已添加到试卷管理', 'success');
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
