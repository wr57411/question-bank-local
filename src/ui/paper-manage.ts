/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
const w = window as any;

let currentAIRecommendedIds: string[] = [];

export function initPaperForm(): void {
  document.getElementById('paper-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('paper-name') as HTMLInputElement).value.trim();
    const tags = Array.from((document.getElementById('paper-tag-select') as HTMLSelectElement).selectedOptions).map(o => o.value);
    if (!name) return;
    await w.dbCreatePaper(name, tags);
    (document.getElementById('paper-form') as HTMLFormElement).reset();
    await loadPapers();
    w.showStatus('试卷创建成功', 'success');
  });
}

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

// AI 智能组卷
export async function startAIPaperGeneration(): Promise<void> {
  const requirement = (document.getElementById('ai-paper-requirement') as HTMLInputElement).value.trim();
  if (!requirement) { w.showStatus('请先输入您的组卷需求', 'error'); return; }
  const Gemma4 = w.Capacitor?.Plugins?.Gemma4;
  if (!Gemma4) { w.showStatus('AI 引擎未准备好 (仅限原生 App 使用)', 'error'); return; }
  const status = await Gemma4.checkModelStatus();
  if (!status.ready) { w.showStatus('Gemma 4 模型尚未就绪，请先下载或发现模型', 'error'); return; }
  w.showStatus('AI 正在根据您的需求筛选题目...', 'success');
  const candidates = w.allQuestions
    .filter((q: any) => q.semantic_summary && q.semantic_summary !== 'AI 正在分析中...')
    .map((q: any) => ({ id: q.id, tags: q.question_tags.map((t: any) => t.tags.name), summary: q.semantic_summary, difficulty: q.ai_metadata?.difficulty || 0 }));
  if (candidates.length === 0) { w.showStatus('题库中尚无经过 AI 分析的题目，请先添加题目并等待分析完成', 'error'); return; }
  try {
    const result = await Gemma4.recommendQuestions({ requirement, candidatesJson: JSON.stringify(candidates.slice(0, 50)) });
    renderAIRecommendations(result.recommended_ids, result.reason);
  } catch (e: any) { w.showStatus('AI 推荐失败: ' + e.message, 'error'); }
}

export function renderAIRecommendations(ids: string[], reason: string): void {
  currentAIRecommendedIds = ids;
  const modal = document.getElementById('ai-recommend-modal')!;
  const reasonEl = document.getElementById('ai-recommend-reason')!;
  const listEl = document.getElementById('ai-recommend-list')!;
  reasonEl.innerHTML = '<strong>AI 推荐思路:</strong><br>' + (reason || '根据您的要求挑选了以下题目。');
  listEl.replaceChildren();
  const recommendedQuestions = w.allQuestions.filter((q: any) => ids.includes(q.id));
  if (recommendedQuestions.length === 0) {
    listEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;padding:20px;color:#999">未找到完全符合条件的题目</p>';
  } else {
    recommendedQuestions.forEach((q: any) => {
      const card = document.createElement('div');
      card.className = 'question-card'; card.style.margin = '0';
      card.innerHTML = `<img src="${q.question_image_url}" style="height:100px"><div class="info"><div class="ai-summary-wrap" style="border-left-color:var(--mint);margin:0;font-size:10px">${q.semantic_summary}</div></div>`;
      listEl.appendChild(card);
    });
  }
  document.getElementById('ai-create-paper-btn')!.onclick = () => createPaperFromAI(ids);
  openModal('ai-recommend-modal');
}

export function closeAIRecommendModal(): void { closeModal('ai-recommend-modal'); }

export async function createPaperFromAI(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const name = 'AI 推荐试卷 ' + new Date().toLocaleDateString();
  const id = w.generateId();
  const now = new Date().toISOString();
  const paper = { id, name, created_at: now, updated_at: now, deleted_at: null };
  await w.dbPapers.setItem(id, paper);
  let n = 1;
  for (const qId of ids) { await w.dbPaperQuestions.setItem(`${id}_${qId}`, { paper_id: id, question_id: qId, order_num: n++ }); }
  closeAIRecommendModal();
  await loadPapers();
  w.showStatus('AI 试卷已生成', 'success');
  w.showTab('papers', document.querySelector('.tab[onclick*="papers"]'));
}
