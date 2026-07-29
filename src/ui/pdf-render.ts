import {
  dbGetAllPdfCategories, dbGetAllPdfDocs, ensureTextbookStructure
} from '../data/pdf-docs';
import { escapeHtml } from './common';
import { getExpanded, setRenderCallback } from './pdf-tree-state';
import type { PdfDoc, PdfCategory } from '../types';

setRenderCallback(renderPdfLibrary);

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
      onclick="togglePdfNode('${escapeHtml(cat.id)}')">
      ${arrowIcon ? `<span style="font-size:12px;color:var(--text-tertiary);width:14px">${arrowIcon}</span>` : '<span style="width:14px"></span>'}
      <span style="font-size:${depth === 0 ? '15px' : '13px'};font-weight:${depth <= 1 ? '600' : '400'};color:${color}">${folderIcon} ${escapeHtml(cat.name)}</span>
      <span style="font-size:11px;color:var(--text-tertiary);margin-left:auto">${totalDocs > 0 ? totalDocs + ' 个文档' : ''}</span>
      <span style="cursor:pointer;font-size:16px;color:var(--text-tertiary);padding:0 4px" onclick="event.stopPropagation();showPdfCategoryMenu('${escapeHtml(cat.id)}')">⋮</span>
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
    html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-light);cursor:pointer" onclick="showPdfActions('${escapeHtml(doc.id)}')">
      <span style="font-size:18px">📄</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(doc.filename)}</div>
        <div style="font-size:11px;color:var(--text-tertiary)">${doc.page_count}页 · ${sizeMB}MB</div>
      </div>
    </div>`;
  }
  return html;
}

export function switchPdfView(_view: 'chapter' | 'topic'): void {
  renderPdfLibrary();
}
