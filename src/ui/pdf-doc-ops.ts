import {
  dbGetAllPdfCategories, dbGetAllPdfDocs, dbUpdatePdfDoc
} from '../data/pdf-docs';
import { uploadPdfToServer, downloadPdfToLocal, deleteRemotePdf, updateRemotePdfMeta } from '../services/pdf-cloud';
import { escapeHtml, showStatus } from './common';
import { renderPdfLibrary } from './pdf-render';
import type { PdfCategory, PdfDoc } from '../types';

export async function handlePdfUpload(): Promise<void> {
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      (window as unknown as Record<string, unknown>)._pendingPdfFile = file;
      await showPdfUploadConfirm(file);
    };
    input.click();
  } catch {
    showStatus('选择文件失败', 'error');
  }
}

async function showPdfUploadConfirm(file: File): Promise<void> {
  const modal = document.getElementById('pdf-action-modal');
  const content = document.getElementById('pdf-action-content');
  if (!modal || !content) return;

  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const apiToken = localStorage.getItem('apiToken') || '';
  const serverReady = !!(serverUrl && apiToken);

  const categories = await dbGetAllPdfCategories();
  const rootCats = categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  let categoryOptions = '<option value="">—— 不指定分类 ——</option>';
  for (const book of rootCats) {
    const chapters = categories.filter(c => c.parent_id === book.id).sort((a, b) => a.sort_order - b.sort_order);
    for (const ch of chapters) {
      const sections = categories.filter(c => c.parent_id === ch.id).sort((a, b) => a.sort_order - b.sort_order);
      if (sections.length > 0) {
        for (const sec of sections) {
          categoryOptions += `<option value="${sec.id}">${escapeHtml(book.name)} › ${escapeHtml(ch.name)} › ${escapeHtml(sec.name)}</option>`;
        }
      } else {
        categoryOptions += `<option value="${ch.id}">${escapeHtml(book.name)} › ${escapeHtml(ch.name)}</option>`;
      }
    }
    categoryOptions += `<option value="${book.id}">${escapeHtml(book.name)}</option>`;
  }

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 style="margin:0;font-size:16px">📄 上传 PDF</h3>
      <span style="cursor:pointer;font-size:22px;color:var(--text-tertiary)" onclick="closePdfUploadConfirm()">×</span>
    </div>
    <div style="padding:10px;background:var(--surface);border-radius:var(--radius-md);border:1px solid var(--border-light);margin-bottom:10px">
      <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(file.name)}</div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${sizeMB} MB · PDF 文档</div>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">归类到（可后补）</label>
      <select id="upload-category-select" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md)">${categoryOptions}</select>
    </div>
    <div id="pdf-upload-preview" style="border:1px solid var(--border-light);border-radius:var(--radius-md);overflow-y:auto;margin-bottom:10px;height:35vh;padding:8px">
      <p style="text-align:center;color:var(--text-tertiary)">加载预览中...</p>
    </div>
    ${serverReady ? '' : '<p style="font-size:12px;color:var(--danger);margin-bottom:10px">⚠️ 服务器未配置</p>'}
    <div id="upload-progress-area" style="margin-bottom:10px"></div>
    <div style="display:flex;gap:8px">
      <button id="confirm-upload-btn" onclick="doConfirmUpload()" style="flex:1;padding:12px;background:var(--accent);box-shadow:none" ${serverReady ? '' : 'disabled'}>📤 确认上传</button>
      <button onclick="closePdfUploadConfirm()" class="secondary" style="padding:12px">取消</button>
    </div>`;
  modal.style.display = 'flex';

  const previewContainer = document.getElementById('pdf-upload-preview');
  if (previewContainer) {
    await renderPdfPreviewOnCanvas(file, previewContainer, 1, 5);
  }
}

export function closePdfUploadConfirm(): void {
  delete (window as unknown as Record<string, unknown>)._pendingPdfFile;
  closePdfActionModal();
}

export async function doConfirmUpload(): Promise<void> {
  const file = (window as unknown as Record<string, unknown>)._pendingPdfFile as File | undefined;
  if (!file) return;

  const btn = document.getElementById('confirm-upload-btn') as HTMLButtonElement;
  const progressArea = document.getElementById('upload-progress-area');
  const categorySelect = document.getElementById('upload-category-select') as HTMLSelectElement;
  const categoryId = categorySelect?.value || undefined;

  if (btn) { btn.disabled = true; btn.textContent = '⬆️ 上传中...'; }
  if (progressArea) {
    progressArea.innerHTML = `<div style="padding:10px;background:var(--surface);border-radius:var(--radius-md);text-align:center">
      <div style="font-size:13px;color:var(--text-secondary)">正在上传 ${(file.size / 1024 / 1024).toFixed(1)}MB...</div>
    </div>`;
  }

  try {
    const doc = await uploadPdfToServer(file, file.name, categoryId);
    if (progressArea) {
      progressArea.innerHTML = `<div style="padding:10px;background:var(--mint-light);border-radius:var(--radius-md);text-align:center;font-size:13px;color:var(--mint-dark)">✅ 上传成功！${doc.page_count > 0 ? `共 ${doc.page_count} 页` : ''}</div>`;
    }
    delete (window as unknown as Record<string, unknown>)._pendingPdfFile;
    setTimeout(async () => {
      closePdfActionModal();
      await renderPdfLibrary();
    }, 800);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📤 确认上传'; }
    if (progressArea) {
      progressArea.innerHTML = `<div style="padding:10px;background:var(--danger-light);border-radius:var(--radius-md);font-size:13px;color:var(--danger-dark)">❌ 上传失败：${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    }
  }
}

export async function showPdfActions(pdfId: string): Promise<void> {
  const docs = await dbGetAllPdfDocs();
  const doc = docs.find(d => d.id === pdfId);
  if (!doc) return;

  const modal = document.getElementById('pdf-action-modal');
  const content = document.getElementById('pdf-action-content');
  if (!modal || !content) return;

  const categories = await dbGetAllPdfCategories();
  const catName = doc.category_id ? categories.find(c => c.id === doc.category_id)?.name : null;

  content.innerHTML = `
    <h3 style="margin:0 0 8px 0;font-size:16px">${escapeHtml(doc.filename)}</h3>
    <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px">${doc.page_count}页 · ${(doc.file_size / 1024 / 1024).toFixed(1)}MB</p>
    ${catName ? `<p style="font-size:12px;color:var(--accent);margin-bottom:12px">📂 ${escapeHtml(catName)}</p>` : '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">📂 未分类</p>'}
    <div style="display:flex;flex-direction:column;gap:10px">
      <button onclick="startPdfPreview('${doc.id}')" style="padding:12px;background:var(--accent);box-shadow:none">📖 试读</button>
      <button onclick="showMovePdfModal('${doc.id}')" style="padding:12px;background:var(--warning);box-shadow:none">📂 移动分类</button>
      <button onclick="doDeletePdf('${doc.id}')" style="padding:12px;background:var(--danger);box-shadow:none;color:#fff">🗑 删除</button>
      <button onclick="closePdfActionModal()" class="secondary" style="padding:12px">取消</button>
    </div>`;
  modal.style.display = 'flex';
}

export function closePdfActionModal(): void {
  const modal = document.getElementById('pdf-action-modal');
  if (modal) modal.style.display = 'none';
}

export async function showMovePdfModal(pdfId: string): Promise<void> {
  const categories = await dbGetAllPdfCategories();
  const rootCats = categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  let options = '<option value="">—— 未分类 ——</option>';
  function buildOptions(cat: PdfCategory, depth: number) {
    const prefix = '  '.repeat(depth);
    options += `<option value="${cat.id}">${prefix}${escapeHtml(cat.name)}</option>`;
    const children = categories.filter(c => c.parent_id === cat.id).sort((a, b) => a.sort_order - b.sort_order);
    for (const child of children) buildOptions(child, depth + 1);
  }
  for (const root of rootCats) buildOptions(root, 0);

  const modal = document.getElementById('pdf-action-modal');
  const content = document.getElementById('pdf-action-content');
  if (!modal || !content) return;

  content.innerHTML = `
    <h3 style="margin:0 0 12px 0;font-size:16px">📂 移动分类</h3>
    <select id="move-category-select" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md);margin-bottom:12px">${options}</select>
    <div style="display:flex;gap:8px">
      <button onclick="confirmMovePdf('${pdfId}')" style="flex:1;padding:12px;background:var(--accent);box-shadow:none">✔️ 确认</button>
      <button onclick="closePdfActionModal()" class="secondary" style="padding:12px">取消</button>
    </div>`;
  modal.style.display = 'flex';
}

export async function confirmMovePdf(pdfId: string): Promise<void> {
  const select = document.getElementById('move-category-select') as HTMLSelectElement;
  const categoryId = select?.value || undefined;
  try {
    await updateRemotePdfMeta(pdfId, { category_id: categoryId });
    await dbUpdatePdfDoc(pdfId, { category_id: categoryId });
    showStatus('已移动分类', 'success');
    closePdfActionModal();
    await renderPdfLibrary();
  } catch (e) {
    showStatus('移动失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function doDownloadPdf(pdfId: string): Promise<void> {
  closePdfActionModal();
  showStatus('正在下载...', 'info');
  try {
    await downloadPdfToLocal(pdfId);
    showStatus('下载完成，已缓存到本地', 'success');
    await renderPdfLibrary();
  } catch (e) {
    showStatus('下载失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

export async function doDeletePdf(pdfId: string): Promise<void> {
  if (!confirm('确定删除此 PDF？')) return;
  closePdfActionModal();
  try {
    await deleteRemotePdf(pdfId);
    showStatus('已删除', 'success');
    await renderPdfLibrary();
  } catch (e) {
    showStatus('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
  }
}

async function renderPdfPreviewOnCanvas(file: File | Blob, container: HTMLElement, startPage = 1, maxPages = 3): Promise<number> {
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;

    const endPage = Math.min(startPage + maxPages - 1, pdf.numPages);
    container.innerHTML = '';

    for (let i = startPage; i <= endPage; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.cssText = 'width:100%;margin-bottom:8px;border-radius:4px;border:1px solid var(--border-light)';
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      container.appendChild(canvas);
    }

    return pdf.numPages;
  } catch (e) {
    container.innerHTML = `<p style="text-align:center;color:var(--text-tertiary);font-size:13px">PDF 预览不可用: ${(e as Error).message}</p>`;
    return 0;
  }
}
