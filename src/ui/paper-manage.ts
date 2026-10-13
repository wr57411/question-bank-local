/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
const w = window as any;

export async function loadPapers(): Promise<void> {
  const papers = await w.dbGetAllPapers();
  const c = document.getElementById('papers-list')!;
  if (!papers.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📋</div>暂无试卷</div>'; return; }
  c.replaceChildren();
  papers.forEach((p: any) => {
    const card = document.createElement('div'); card.className = 'paper-card';
    const title = document.createElement('h3'); title.textContent = p.name;
    const count = document.createElement('p'); count.textContent = '题目数量: ' + (p.question_count || 0);
    const created = document.createElement('p'); created.textContent = '创建时间: ' + new Date(p.created_at).toLocaleString();
    const bg = document.createElement('div'); bg.className = 'btn-group'; bg.style.marginTop = '10px';
    const dl = document.createElement('button'); dl.textContent = '下载 PDF'; dl.onclick = () => w.generatePaperPDF(p.id);
    const vw = document.createElement('button'); vw.className = 'secondary'; vw.textContent = '查看题目'; vw.onclick = () => showPaperDetail(p.id);
    const del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
    del.onclick = async () => { if (!confirm('确定删除？')) return; await w.dbDeletePaper(p.id); await loadPapers(); };
    bg.append(dl, vw, del); card.append(title, count, created, bg); c.appendChild(card);
  });
}

export async function showPaperDetail(pId: string): Promise<void> {
  w.currentPaperId = pId;
  const { paper, questions } = await w.dbGetPaperQuestions(pId);
  if (!paper) return;
  document.getElementById('paper-modal-title')!.textContent = paper.name;
  const c = document.getElementById('paper-modal-questions')!;
  const openBtn = document.getElementById('paper-open-pdf-btn')!;
  const hasPdf = !!(paper.pdf_url || paper.pdf_local_path);
  openBtn.style.display = hasPdf ? '' : 'none';
  if (hasPdf) openBtn.onclick = () => openPaperPdf(paper);
  if (!questions.length) { c.innerHTML = '<p style="color:#999">该试卷暂无题目</p>'; }
  else {
    c.replaceChildren();
    questions.forEach((q: any, i: number) => {
      const d = document.createElement('div');
      d.style.cssText = 'margin-bottom:16px;padding:10px;background:var(--surface-dim);border-radius:var(--radius-md)';
      d.innerHTML = '<p style="font-weight:500;margin-bottom:8px">第' + (i + 1) + '题</p><img src="' + q.question_image_url + '" style="max-width:100%;border-radius:var(--radius-sm)">' + (q.answer_image_url ? '<p style="font-weight:500;margin:8px 0 4px;color:var(--text-secondary)">答案:</p><img src="' + q.answer_image_url + '" style="max-width:100%;border-radius:var(--radius-sm)">' : '');
      c.appendChild(d);
    });
  }
  openModal('paper-modal');
}

export async function openPaperPdf(paper: any): Promise<void> {
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  const serverUrl = (localStorage.getItem('serverUrl') || '').replace(/\/+$/, '');
  if (!isNative) {
    if (paper.pdf_url && serverUrl) window.open(serverUrl + paper.pdf_url, '_blank');
    else w.showStatus('Web 端需要先在手机上导出并同步该试卷', 'error');
    return;
  }
  try {
    const localPath = await w.dbEnsurePaperPdfLocal(paper);
    if (!localPath) { w.showStatus('PDF 不可用（未上传云端且本地无缓存）', 'error'); return; }
    const uriResult = await w.Capacitor.Plugins.Filesystem.getUri({ path: localPath, directory: 'DOCUMENTS' });
    if (w.Capacitor.Plugins.FileOpener) {
      await w.Capacitor.Plugins.FileOpener.open({ filePath: uriResult.uri, contentType: 'application/pdf' });
    } else {
      await w.Capacitor.Plugins.Browser.open({ url: uriResult.uri });
    }
  } catch (e: any) {
    w.showStatus('打开 PDF 失败: ' + (e.message || e), 'error');
  }
}

export function closePaperModal(): void { closeModal('paper-modal'); }

export function exportPaperAsPDF(): void {
  if (!w.currentPaperId) return;
  w.generatePaperPDF(w.currentPaperId);
}

export function exportPaperAsImages(): void {
  if (!w.currentPaperId) return;
  const title = document.getElementById('paper-modal-title')!.textContent;
  (document.getElementById('export-images-folder') as HTMLInputElement).value = title || '';
  document.getElementById('export-images-summary')!.textContent = '';
  document.getElementById('export-images-progress')!.style.display = 'none';
  openModal('export-images-modal');
}

export function getExportImgMode(): string { return localStorage.getItem('exportImgMode') || 'manual'; }
export function setExportImgMode(m: string): void { localStorage.setItem('exportImgMode', m); updateExportImgModeBtn(); }

export function updateExportImgModeBtn(): void {
  const btn = document.getElementById('export-img-mode-btn');
  if (!btn) return;
  const m = getExportImgMode();
  btn.textContent = m === 'manual' ? '✏️ 手动输入' : '⚡ 自动填入';
  btn.title = m === 'manual' ? '点击切换为自动填入' : '点击切换为手动输入';
}

export function toggleExportImgMode(): void { setExportImgMode(getExportImgMode() === 'manual' ? 'auto' : 'manual'); }

export function _doExportImagesModalConfirm(): void {
  const folderName = (document.getElementById('export-images-folder') as HTMLInputElement).value.trim();
  if (!folderName) { alert('请输入文件夹名称'); return; }
  const basketQuestions = w._exportQuestions;
  if (basketQuestions && basketQuestions.length && !w.currentPaperId) {
    closeExportImagesModal();
    _runExportImagesFromBasket(basketQuestions, folderName);
  } else {
    doExportImages();
  }
}

export function closeExportImagesModal(): void { closeModal('export-images-modal'); }

export async function exportImagesToFolder(imageList: any[], folderName: string, answerImageList?: any[]): Promise<boolean> {
  if (!imageList || !imageList.length) { alert('没有可导出的图片'); return false; }
  const Filesystem = w.Capacitor?.Plugins?.Filesystem;
  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());
  if (!isNative || !Filesystem) { alert('图片文件夹导出功能仅支持原生 App（Android/iOS）'); return false; }
  try {
    const directory = 'DOCUMENTS';
    try { await Filesystem.mkdir({ path: folderName, directory, recursive: true }); } catch (_e) { /* exists */ }
    for (let i = 0; i < imageList.length; i++) {
      const img = imageList[i];
      const progress = ((i + 1) / imageList.length) * 100;
      document.getElementById('export-images-progress-bar')!.style.width = progress + '%';
      document.getElementById('export-images-progress-text')!.textContent = `导出题目图片... (${i + 1}/${imageList.length})`;
      try {
        let blob: Blob;
        if (img.url.startsWith('data:') || img.url.startsWith('http')) { const res = await fetch(img.url); blob = await res.blob(); }
        else { continue; }
        const base64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.readAsDataURL(blob); });
        await Filesystem.writeFile({ path: `${folderName}/${img.name}`, data: base64, directory });
      } catch (e: any) { console.warn('导出图片失败:', img.name, e.message); }
    }
    if (answerImageList && answerImageList.length > 0) {
      const answerFolder = `${folderName}/答案`;
      try { await Filesystem.mkdir({ path: answerFolder, directory, recursive: true }); } catch (_e) { /* exists */ }
      for (let i = 0; i < answerImageList.length; i++) {
        const img = answerImageList[i];
        if (!img.url) continue;
        document.getElementById('export-images-progress-text')!.textContent = `导出答案图片... (${i + 1}/${answerImageList.length})`;
        try {
          let blob: Blob;
          if (img.url.startsWith('data:') || img.url.startsWith('http')) { const res = await fetch(img.url); blob = await res.blob(); }
          else { continue; }
          const base64 = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.readAsDataURL(blob); });
          await Filesystem.writeFile({ path: `${answerFolder}/${img.name}`, data: base64, directory });
        } catch (e: any) { console.warn('导出答案图片失败:', img.name, e.message); }
      }
    }
    return true;
  } catch (e: any) { console.error('导出失败:', e); alert('导出失败: ' + e.message); return false; }
}

export async function doExportImagesFromBasket(): Promise<void> {
  const questions = w._exportQuestions;
  if (!questions || !questions.length) { alert('没有可导出的题目'); return; }
  if (getExportImgMode() === 'auto') {
    const folderName = '题库导出_' + new Date().toISOString().slice(0, 10);
    await _runExportImagesFromBasket(questions, folderName);
  } else {
    (document.getElementById('export-images-folder') as HTMLInputElement).value = '';
    document.getElementById('export-images-summary')!.textContent = '';
    document.getElementById('export-images-progress')!.style.display = 'none';
    openModal('export-images-modal');
  }
}

export async function _runExportImagesFromBasket(questions: any[], folderName: string): Promise<void> {
  const selectedFolder = w.getExportFolder ? w.getExportFolder() : '';
  if (selectedFolder) folderName = selectedFolder + '/' + folderName;
  const exportType = (document.querySelector('input[name="export-type"]:checked') as HTMLInputElement)?.value || 'with_notes';
  const tasks: any[] = [];
  if (exportType === 'with_notes' || exportType === 'both') {
    tasks.push({ folderName, imageList: questions.map((q, i) => ({ url: q.question_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })).filter((img: any) => img.url), answerImageList: questions.map((q, i) => ({ url: q.answer_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })), label: '带笔记版' });
  }
  if (exportType === 'blank' || exportType === 'both') {
    tasks.push({ folderName: exportType === 'both' ? folderName + '-空白' : folderName, imageList: questions.map((q, i) => ({ url: q.question_image_blank_url, name: String(i + 1).padStart(3, '0') + '.jpg' })).filter((img: any) => img.url), answerImageList: questions.map((q, i) => ({ url: q.answer_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })), label: '空白版' });
  }
  if (!tasks.length) { alert('没有可导出的图片'); return; }
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    document.getElementById('export-images-summary')!.textContent = `共 ${task.imageList.length} 张题目图片（${task.label}），准备导出...`;
    document.getElementById('export-images-progress')!.style.display = 'block';
    document.getElementById('export-images-progress-bar')!.style.width = '0%';
    document.getElementById('export-images-progress-text')!.textContent = '导出中...';
    const success = await exportImagesToFolder(task.imageList, task.folderName, task.answerImageList);
    if (!success) { document.getElementById('export-images-progress')!.style.display = 'none'; return; }
    if (i < tasks.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
  }
  document.getElementById('export-images-progress-bar')!.style.width = '100%';
  document.getElementById('export-images-progress-text')!.textContent = '导出完成！';
  const taskLabels = tasks.map(t => t.label).join(' 和 ');
  const folderNames = tasks.length > 1 ? `${folderName}/ 和 ${folderName}-空白/` : `${folderName}/`;
  document.getElementById('export-images-summary')!.textContent = `✅ 已导出 ${taskLabels} 到 ${folderNames}`;
  setTimeout(() => closeExportImagesModal(), 2000);
}

export async function doExportImages(): Promise<void> {
  if (!w.currentPaperId) return;
  const folderName = (document.getElementById('export-images-folder') as HTMLInputElement).value.trim();
  if (!folderName) { alert('请输入文件夹名称'); return; }
  const { questions } = await w.dbGetPaperQuestions(w.currentPaperId);
  if (!questions || !questions.length) { alert('该试卷暂无题目'); return; }
  const exportType = (document.querySelector('input[name="export-type"]:checked') as HTMLInputElement)?.value || 'with_notes';
  const tasks: any[] = [];
  if (exportType === 'with_notes' || exportType === 'both') {
    tasks.push({ folderName, imageList: questions.map((q: any, i: number) => ({ url: q.question_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })).filter((img: any) => img.url), answerImageList: questions.map((q: any, i: number) => ({ url: q.answer_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })), label: '带笔记版' });
  }
  if (exportType === 'blank' || exportType === 'both') {
    tasks.push({ folderName: exportType === 'both' ? folderName + '-空白' : folderName, imageList: questions.map((q: any, i: number) => ({ url: q.question_image_blank_url, name: String(i + 1).padStart(3, '0') + '.jpg' })).filter((img: any) => img.url), answerImageList: questions.map((q: any, i: number) => ({ url: q.answer_image_url, name: String(i + 1).padStart(3, '0') + '.jpg' })), label: '空白版' });
  }
  if (!tasks.length) { alert('没有可导出的图片'); return; }
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    document.getElementById('export-images-summary')!.textContent = `共 ${task.imageList.length} 张题目图片（${task.label}），准备导出...`;
    document.getElementById('export-images-progress')!.style.display = 'block';
    document.getElementById('export-images-progress-bar')!.style.width = '0%';
    document.getElementById('export-images-progress-text')!.textContent = '导出中...';
    const success = await exportImagesToFolder(task.imageList, task.folderName, task.answerImageList);
    if (!success) { document.getElementById('export-images-progress')!.style.display = 'none'; return; }
    if (i < tasks.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
  }
  document.getElementById('export-images-progress-bar')!.style.width = '100%';
  document.getElementById('export-images-progress-text')!.textContent = '导出完成！';
  const taskLabels = tasks.map(t => t.label).join(' 和 ');
  const folderNames = tasks.length > 1 ? `${folderName}/ 和 ${folderName}-空白/` : `${folderName}/`;
  document.getElementById('export-images-summary')!.textContent = `✅ 已导出 ${taskLabels} 到 ${folderNames}`;
  setTimeout(() => closeExportImagesModal(), 2000);
}
