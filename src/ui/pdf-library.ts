import {
  dbGetAllPdfCategories, dbGetAllPdfDocs, dbCreatePdfCategory,
  dbUpdatePdfCategory, dbDeletePdfCategory, dbUpdatePdfDoc, ensureTextbookStructure,
  dbGetAllPdfTopics, dbCreatePdfTopic, dbUpdatePdfTopic, dbDeletePdfTopic
} from '../data/pdf-docs';
import { uploadPdfToServer, fetchPdfPages, downloadPdfToLocal, deleteRemotePdf, updateRemotePdfMeta, setPdfTagsRemote } from '../services/pdf-cloud';
import { showStatus } from './common';
import type { PdfDoc, PdfCategory, PdfTopic } from '../types';

let expandedNodes: string[] = [];
let currentView: 'chapter' | 'topic' = 'chapter';
let currentPreviewLoadingTask: { destroy: () => Promise<void> } | null = null;

function getExpanded(): string[] {
  try { return JSON.parse(localStorage.getItem('pdf_tree_expanded') || '[]'); } catch { return []; }
}

function setExpanded(ids: string[]): void {
  expandedNodes = ids;
  localStorage.setItem('pdf_tree_expanded', JSON.stringify(ids));
}

function toggleExpand(id: string): void {
  const ids = getExpanded();
  const idx = ids.indexOf(id);
  if (idx >= 0) ids.splice(idx, 1); else ids.push(id);
  setExpanded(ids);
  renderPdfLibrary();
}

async function renderPdfPreviewOnCanvas(file: File | Blob, container: HTMLElement, startPage = 1, maxPages = 3): Promise<number> {
  try {
    const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    currentPreviewLoadingTask = loadingTask;

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

async function renderPdfPreviewFromCache(pdfId: string, container: HTMLElement, startPage: number, maxPages: number): Promise<number> {
  const docs = await dbGetAllPdfDocs();
  const doc = docs.find(d => d.id === pdfId);
  if (!doc?.local_cache_path) {
    try {
      const cachePath = await downloadPdfToLocal(pdfId);
      const { Filesystem } = await import('@capacitor/filesystem');
      const result = await Filesystem.readFile({ path: cachePath.split('/').pop() || '', directory: 'CACHE' as never });
      const blob = new Blob([result.data as unknown as ArrayBuffer], { type: 'application/pdf' });
      return await renderPdfPreviewOnCanvas(blob, container, startPage, maxPages);
    } catch {
      return 0;
    }
  }
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    const fileName = doc.local_cache_path.split('/').pop() || '';
    const result = await Filesystem.readFile({ path: fileName, directory: 'CACHE' as never });
    const blob = new Blob([result.data as unknown as ArrayBuffer], { type: 'application/pdf' });
    return await renderPdfPreviewOnCanvas(blob, container, startPage, maxPages);
  } catch {
    return 0;
  }
}

export async function renderPdfLibrary(): Promise<void> {
  const container = document.getElementById('pdf-library-content');
  if (!container) return;

  await ensureTextbookStructure();

  const docs = await dbGetAllPdfDocs();
  const categories = await dbGetAllPdfCategories();
  const expanded = getExpanded();

  const rootCats = categories.filter(c => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const docsByCategory = new Map<string, PdfDoc[]>();
  const uncategorized: PdfDoc[] = [];
  for (const doc of docs) {
    if (doc.category_id) {
      const arr = docsByCategory.get(doc.category_id) || [];
      arr.push(doc);
      docsByCategory.set(doc.category_id, arr);
    } else {
      uncategorized.push(doc);
    }
  }

  let html = '';
  for (const cat of rootCats) {
    html += renderTreeNode(cat, categories, docsByCategory, expanded, 0);
  }

  if (uncategorized.length > 0) {
    html += `<div style="margin-top:8px;padding:8px;border-top:2px dashed var(--border-light)">
      <div style="font-size:13px;color:var(--text-tertiary);margin-bottom:6px">📄 未分类 (${uncategorized.length})</div>
      ${renderDocList(uncategorized)}
    </div>`;
  }

  if (rootCats.length === 0 && uncategorized.length === 0) {
    html = `<p style="color:var(--text-tertiary);font-size:14px;text-align:center;padding:40px 0">暂无 PDF 文档，点击下方上传</p>`;
  }

  html += `<div style="display:flex;gap:8px;margin-top:16px">
    <button onclick="handlePdfUpload()" style="flex:1;background:var(--accent);box-shadow:0 4px 0 #5A3DC0;padding:12px;font-size:14px">📤 上传 PDF</button>
  </div>`;

  container.innerHTML = html;
}

function renderTreeNode(cat: PdfCategory, allCats: PdfCategory[], docsByCategory: Map<string, PdfDoc[]>, expanded: string[], depth: number): string {
  const children = allCats.filter(c => c.parent_id === cat.id).sort((a, b) => a.sort_order - b.sort_order);
  const docs = docsByCategory.get(cat.id) || [];
  const isExpanded = expanded.includes(cat.id);
  const totalDocs = countDocsRecursive(cat, allCats, docsByCategory);
  const indent = depth * 20;
  const folderIcon = isExpanded ? '📂' : '📁';
  const arrowIcon = children.length > 0 ? (isExpanded ? '▾' : '▸') : '';
  const levelColors = ['var(--accent)', 'var(--warning)', 'var(--text-secondary)'];
  const color = levelColors[cat.level] || 'var(--text-secondary)';

  let html = `<div style="margin-left:${indent}px;margin-bottom:4px">
    <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:var(--radius-md);cursor:pointer;background:${depth === 0 ? 'var(--surface)' : 'transparent'};border:1px solid ${depth === 0 ? 'var(--border-light)' : 'transparent'}"
      onclick="togglePdfNode('${cat.id}')">
      ${arrowIcon ? `<span style="font-size:12px;color:var(--text-tertiary);width:14px">${arrowIcon}</span>` : '<span style="width:14px"></span>'}
      <span style="font-size:${depth === 0 ? '15px' : '13px'};font-weight:${depth <= 1 ? '600' : '400'};color:${color}">${folderIcon} ${escapeHtmlLocal(cat.name)}</span>
      <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">${totalDocs > 0 ? totalDocs + ' 个文档' : ''}</span>
      <span style="cursor:pointer;font-size:16px;color:var(--text-tertiary);padding:0 4px" onclick="event.stopPropagation();showPdfCategoryMenu('${cat.id}')">⋮</span>
    </div>`;

  if (isExpanded) {
    if (docs.length > 0) {
      html += `<div style="margin-left:28px;margin-top:4px">${renderDocList(docs)}</div>`;
    }
    for (const child of children) {
      html += renderTreeNode(child, allCats, docsByCategory, expanded, depth + 1);
    }
    if (docs.length === 0 && children.length === 0) {
      html += `<div style="margin-left:28px;padding:4px 8px;font-size:12px;color:var(--text-tertiary)">（空）</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function countDocsRecursive(cat: PdfCategory, allCats: PdfCategory[], docsByCategory: Map<string, PdfDoc[]>): number {
  let count = (docsByCategory.get(cat.id) || []).length;
  const children = allCats.filter(c => c.parent_id === cat.id);
  for (const child of children) {
    count += countDocsRecursive(child, allCats, docsByCategory);
  }
  return count;
}

function renderDocList(docs: PdfDoc[]): string {
  let html = '';
  for (const doc of docs) {
    const sizeMB = (doc.file_size / 1024 / 1024).toFixed(1);
    html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-light);cursor:pointer" onclick="showPdfActions('${doc.id}')">
      <span style="font-size:18px">📄</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtmlLocal(doc.filename)}</div>
        <div style="font-size:11px;color:var(--text-tertiary)">${doc.page_count}页 · ${sizeMB}MB</div>
      </div>
    </div>`;
  }
  return html;
}

export function switchPdfView(view: 'chapter' | 'topic'): void {
  currentView = view;
  renderPdfLibrary();
}

export function togglePdfNode(id: string): void {
  toggleExpand(id);
}

export async function showPdfCategoryMenu(catId: string): Promise<void> {
  const categories = await dbGetAllPdfCategories();
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  const modal = document.getElementById('pdf-manage-modal');
  const content = document.getElementById('pdf-manage-content');
  if (!modal || !content) return;

  const children = categories.filter(c => c.parent_id === catId);

  content.innerHTML = `
    <h3 style="margin:0 0 12px 0;font-size:16px">${escapeHtmlLocal(cat.name)}</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <input id="cat-sub-name" placeholder="子分类名称" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md)" />
      <button onclick="addPdfSubCategory('${catId}')" style="padding:10px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0;font-size:13px">➕ 添加子分类</button>
      <button onclick="renamePdfCategory('${catId}')" style="padding:10px;background:var(--warning);box-shadow:0 3px 0 #B07A08;font-size:13px">✏️ 重命名</button>
      <button onclick="deletePdfCategory('${catId}')" style="padding:10px;background:#ef4444;box-shadow:0 3px 0 #b91c1c;color:#fff;font-size:13px">🗑 删除分类${children.length > 0 ? '（含子分类）' : ''}</button>
      <button onclick="closePdfManageModal()" class="secondary" style="padding:10px;font-size:13px">取消</button>
    </div>`;
  modal.style.display = 'flex';
}

export async function addPdfSubCategory(parentId: string): Promise<void> {
  const input = document.getElementById('cat-sub-name') as HTMLInputElement;
  if (!input?.value.trim()) { showStatus('请输入分类名称', 'error'); return; }
  const categories = await dbGetAllPdfCategories();
  const parent = categories.find(c => c.id === parentId);
  if (!parent) return;
  const siblings = categories.filter(c => c.parent_id === parentId);
  await dbCreatePdfCategory(input.value.trim(), parentId, parent.level + 1, siblings.length);
  showStatus('已添加子分类', 'success');
  closePdfManageModal();
  const expanded = getExpanded();
  if (!expanded.includes(parentId)) { expanded.push(parentId); setExpanded(expanded); }
  await renderPdfLibrary();
}

export async function renamePdfCategory(catId: string): Promise<void> {
  const categories = await dbGetAllPdfCategories();
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  const newName = prompt('输入新名称', cat.name);
  if (!newName?.trim() || newName.trim() === cat.name) return;
  await dbUpdatePdfCategory(catId, { name: newName.trim() });
  showStatus('已重命名', 'success');
  closePdfManageModal();
  await renderPdfLibrary();
}

export async function deletePdfCategory(catId: string): Promise<void> {
  if (!confirm('删除此分类及其子分类？分类下的 PDF 文档不会被删除，将变为未分类。')) return;
  const categories = await dbGetAllPdfCategories();
  const toDelete = [catId];
  const collectChildren = (pid: string) => {
    for (const c of categories) {
      if (c.parent_id === pid) { toDelete.push(c.id); collectChildren(c.id); }
    }
  };
  collectChildren(catId);
  for (const id of toDelete) await dbDeletePdfCategory(id);
  showStatus('已删除分类', 'success');
  closePdfManageModal();
  await renderPdfLibrary();
}

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
          categoryOptions += `<option value="${sec.id}">${escapeHtmlLocal(book.name)} › ${escapeHtmlLocal(ch.name)} › ${escapeHtmlLocal(sec.name)}</option>`;
        }
      } else {
        categoryOptions += `<option value="${ch.id}">${escapeHtmlLocal(book.name)} › ${escapeHtmlLocal(ch.name)}</option>`;
      }
    }
    categoryOptions += `<option value="${book.id}">${escapeHtmlLocal(book.name)}</option>`;
  }

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h3 style="margin:0;font-size:16px">📄 上传 PDF</h3>
      <span style="cursor:pointer;font-size:22px;color:#999" onclick="closePdfUploadConfirm()">×</span>
    </div>
    <div style="padding:10px;background:var(--surface);border-radius:var(--radius-md);border:1px solid var(--border-light);margin-bottom:10px">
      <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtmlLocal(file.name)}</div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${sizeMB} MB · PDF 文档</div>
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">归类到（可后补）</label>
      <select id="upload-category-select" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md)">${categoryOptions}</select>
    </div>
    <div id="pdf-upload-preview" style="border:1px solid var(--border-light);border-radius:var(--radius-md);overflow-y:auto;margin-bottom:10px;height:35vh;padding:8px">
      <p style="text-align:center;color:var(--text-tertiary)">加载预览中...</p>
    </div>
    ${serverReady ? '' : '<p style="font-size:12px;color:#ef4444;margin-bottom:10px">⚠️ 服务器未配置</p>'}
    <div id="upload-progress-area" style="margin-bottom:10px"></div>
    <div style="display:flex;gap:8px">
      <button id="confirm-upload-btn" onclick="doConfirmUpload()" style="flex:1;padding:12px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0" ${serverReady ? '' : 'disabled'}>📤 确认上传</button>
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
      progressArea.innerHTML = `<div style="padding:10px;background:#ecfdf5;border-radius:var(--radius-md);text-align:center;font-size:13px;color:#059669">✅ 上传成功！${doc.page_count > 0 ? `共 ${doc.page_count} 页` : ''}</div>`;
    }
    delete (window as unknown as Record<string, unknown>)._pendingPdfFile;
    setTimeout(async () => {
      closePdfActionModal();
      await renderPdfLibrary();
    }, 800);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📤 确认上传'; }
    if (progressArea) {
      progressArea.innerHTML = `<div style="padding:10px;background:#fef2f2;border-radius:var(--radius-md);font-size:13px;color:#dc2626">❌ 上传失败：${escapeHtmlLocal(e instanceof Error ? e.message : String(e))}</div>`;
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
    <h3 style="margin:0 0 8px 0;font-size:16px">${escapeHtmlLocal(doc.filename)}</h3>
    <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px">${doc.page_count}页 · ${(doc.file_size / 1024 / 1024).toFixed(1)}MB</p>
    ${catName ? `<p style="font-size:12px;color:var(--accent);margin-bottom:12px">📂 ${escapeHtmlLocal(catName)}</p>` : '<p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px">📂 未分类</p>'}
    <div style="display:flex;flex-direction:column;gap:10px">
      <button onclick="startPdfPreview('${doc.id}')" style="padding:12px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0">📖 试读</button>
      <button onclick="showMovePdfModal('${doc.id}')" style="padding:12px;background:var(--warning);box-shadow:0 3px 0 #B07A08">📂 移动分类</button>
      <button onclick="doDeletePdf('${doc.id}')" style="padding:12px;background:#ef4444;box-shadow:0 3px 0 #b91c1c;color:#fff">🗑 删除</button>
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
    options += `<option value="${cat.id}">${prefix}${escapeHtmlLocal(cat.name)}</option>`;
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
      <button onclick="confirmMovePdf('${pdfId}')" style="flex:1;padding:12px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0">✔️ 确认</button>
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

let previewPdfId = '';
let previewLoadedPages = 0;
let previewTotalPages = 0;

export async function startPdfPreview(pdfId: string): Promise<void> {
  closePdfActionModal();
  const modal = document.getElementById('pdf-preview-modal');
  const container = document.getElementById('pdf-preview-pages');
  const progress = document.getElementById('pdf-preview-progress');
  if (!modal || !container || !progress) return;

  previewPdfId = pdfId;
  (window as unknown as Record<string, unknown>)._previewPdfId = pdfId;
  previewLoadedPages = 0;
  previewTotalPages = 0;
  container.innerHTML = '<p style="text-align:center;color:var(--text-tertiary)">加载中...</p>';
  modal.style.display = 'flex';

  await loadMorePreviewPages();

  container.onscroll = () => {
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
      if (previewLoadedPages < previewTotalPages) loadMorePreviewPages();
    }
  };
}

async function loadMorePreviewPages(): Promise<void> {
  const container = document.getElementById('pdf-preview-pages');
  const progress = document.getElementById('pdf-preview-progress');
  if (!container || !progress) return;

  const from = previewLoadedPages + 1;
  const batchSize = 3;

  try {
    if (previewLoadedPages === 0) container.innerHTML = '';
    const total = await renderPdfPreviewFromCache(previewPdfId, container, from, batchSize);
    if (total > 0) {
      previewTotalPages = total;
      previewLoadedPages = Math.min(from + batchSize - 1, total);
      progress.textContent = `第 1-${previewLoadedPages} 页 / 共 ${previewTotalPages} 页`;
    } else {
      container.innerHTML = '<p style="text-align:center;color:#ef4444">无法加载预览，请先下载 PDF</p>';
    }
  } catch (e) {
    if (previewLoadedPages === 0) {
      container.innerHTML = `<p style="text-align:center;color:#ef4444">加载失败: ${(e as Error).message}</p>`;
    }
  }
}

export function closePdfPreview(): void {
  const modal = document.getElementById('pdf-preview-modal');
  if (modal) modal.style.display = 'none';
  if (currentPreviewLoadingTask) {
    currentPreviewLoadingTask.destroy().catch(() => { /* ignore */ });
    currentPreviewLoadingTask = null;
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

export function closePdfManageModal(): void {
  const modal = document.getElementById('pdf-manage-modal');
  if (modal) modal.style.display = 'none';
}

export async function showAddTopicModal(parentId?: string): Promise<void> {
  const modal = document.getElementById('pdf-manage-modal');
  const content = document.getElementById('pdf-manage-content');
  if (!modal || !content) return;

  const title = parentId ? '➕ 新建子专题' : '➕ 新建专题';
  content.innerHTML = `
    <h3 style="margin:0 0 12px 0;font-size:16px">${title}</h3>
    <input id="topic-name-input" placeholder="专题名称" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md);margin-bottom:12px" />
    <div style="display:flex;gap:8px">
      <button onclick="confirmAddTopic('${parentId || ''}')" style="flex:1;padding:10px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0;font-size:13px">✔️ 创建</button>
      <button onclick="closePdfManageModal()" class="secondary" style="padding:10px;font-size:13px">取消</button>
    </div>`;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('topic-name-input')?.focus(), 100);
}

export async function confirmAddTopic(parentId?: string): Promise<void> {
  const input = document.getElementById('topic-name-input') as HTMLInputElement;
  if (!input?.value.trim()) { showStatus('请输入专题名称', 'error'); return; }
  const topics = await dbGetAllPdfTopics();
  const siblings = topics.filter(t => (t.parent_id || '') === (parentId || ''));
  await dbCreatePdfTopic(input.value.trim(), parentId || undefined, siblings.length);
  showStatus('专题已创建', 'success');
  closePdfManageModal();
  if (parentId) {
    const expanded = getExpanded();
    if (!expanded.includes(parentId)) { expanded.push(parentId); setExpanded(expanded); }
  }
  await renderPdfLibrary();
}

export async function showPdfTopicMenu(topicId: string): Promise<void> {
  const topics = await dbGetAllPdfTopics();
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return;

  const modal = document.getElementById('pdf-manage-modal');
  const content = document.getElementById('pdf-manage-content');
  if (!modal || !content) return;

  content.innerHTML = `
    <h3 style="margin:0 0 12px 0;font-size:16px">🏷 ${escapeHtmlLocal(topic.name)}</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button onclick="closePdfManageModal();showAddTopicModal('${topicId}')" style="padding:10px;background:var(--accent);box-shadow:0 3px 0 #5A3DC0;font-size:13px">➕ 添加子专题</button>
      <button onclick="renamePdfTopic('${topicId}')" style="padding:10px;background:var(--warning);box-shadow:0 3px 0 #B07A08;font-size:13px">✏️ 重命名</button>
      <button onclick="deletePdfTopic('${topicId}')" style="padding:10px;background:#ef4444;box-shadow:0 3px 0 #b91c1c;color:#fff;font-size:13px">🗑 删除专题</button>
      <button onclick="closePdfManageModal()" class="secondary" style="padding:10px;font-size:13px">取消</button>
    </div>`;
  modal.style.display = 'flex';
}

export async function renamePdfTopic(topicId: string): Promise<void> {
  const topics = await dbGetAllPdfTopics();
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return;
  const newName = prompt('输入新名称', topic.name);
  if (!newName?.trim() || newName.trim() === topic.name) return;
  await dbUpdatePdfTopic(topicId, { name: newName.trim() });
  showStatus('已重命名', 'success');
  closePdfManageModal();
  await renderPdfLibrary();
}

export async function deletePdfTopic(topicId: string): Promise<void> {
  if (!confirm('删除此专题及其子专题？PDF 文档不会被删除，将变为未归入专题。')) return;
  const topics = await dbGetAllPdfTopics();
  const toDelete = [topicId];
  const collectChildren = (pid: string) => {
    for (const t of topics) {
      if (t.parent_id === pid) { toDelete.push(t.id); collectChildren(t.id); }
    }
  };
  collectChildren(topicId);
  for (const id of toDelete) await dbDeletePdfTopic(id);
  showStatus('已删除专题', 'success');
  closePdfManageModal();
  await renderPdfLibrary();
}

function escapeHtmlLocal(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
