import {
  dbGetAllPdfCategories, dbCreatePdfCategory, dbUpdatePdfCategory, dbDeletePdfCategory
} from '../data/pdf-docs';
import { closeModal, escapeHtml, openModal, showStatus } from './common';
import { getExpanded, setExpanded, toggleExpand } from './pdf-tree-state';
import { renderPdfLibrary } from './pdf-render';
import type { PdfCategory } from '../types';

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
    <h3 style="margin:0 0 12px 0;font-size:16px">${escapeHtml(cat.name)}</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <input id="cat-sub-name" placeholder="子分类名称" style="width:100%;padding:10px;font-size:13px;border:1.5px solid var(--border);border-radius:var(--radius-md)" />
      <button onclick="addPdfSubCategory('${catId}')" style="padding:10px;background:var(--accent);box-shadow:none;font-size:13px">➕ 添加子分类</button>
      <button onclick="renamePdfCategory('${catId}')" style="padding:10px;background:var(--warning);box-shadow:none;font-size:13px">✏️ 重命名</button>
      <button onclick="deletePdfCategory('${catId}')" style="padding:10px;background:var(--danger);box-shadow:none;color:#fff;font-size:13px">🗑 删除分类${children.length > 0 ? '（含子分类）' : ''}</button>
      <button onclick="closePdfManageModal()" class="secondary" style="padding:10px;font-size:13px">取消</button>
    </div>`;
  openModal('pdf-manage-modal');
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

export function closePdfManageModal(): void {
  closeModal('pdf-manage-modal');
}
