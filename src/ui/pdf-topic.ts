import {
  dbGetAllPdfTopics, dbCreatePdfTopic, dbUpdatePdfTopic, dbDeletePdfTopic
} from '../data/pdf-docs';
import { escapeHtml, showStatus } from './common';
import { getExpanded, setExpanded } from './pdf-tree-state';
import { renderPdfLibrary } from './pdf-render';
import { closePdfManageModal } from './pdf-category';
import type { PdfTopic } from '../types';

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
    <h3 style="margin:0 0 12px 0;font-size:16px">🏷 ${escapeHtml(topic.name)}</h3>
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
