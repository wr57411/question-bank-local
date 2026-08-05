/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbQuestions } from '../data/stores';
import { dbGetPendingPhotoCount, dbAddPendingPhoto } from '../data/pending-photos';

const w = window as any;

let _pendingLinkList: string[] = JSON.parse(localStorage.getItem('pendingLinkList') || '[]');

export function getPendingLinkList(): string[] { return _pendingLinkList; }

export function savePendingLinkList(arr: string[]): void {
  _pendingLinkList = arr;
  localStorage.setItem('pendingLinkList', JSON.stringify(arr));
  updatePendingLinkBadge();
}

export function togglePendingLink(qId: string): void {
  const idx = _pendingLinkList.indexOf(qId);
  if (idx !== -1) {
    _pendingLinkList.splice(idx, 1);
  } else {
    _pendingLinkList.unshift(qId);
  }
  savePendingLinkList(_pendingLinkList);
}

export function isPendingLink(qId: string): boolean { return _pendingLinkList.includes(qId); }

export function updatePendingLinkBadge(): void {
  const count = _pendingLinkList.length;
  const badge = document.getElementById('pending-link-count');
  const textEl = document.getElementById('pending-link-count-text');
  if (badge) { badge.textContent = String(count); badge.style.display = count > 0 ? 'inline-block' : 'none'; }
  if (textEl) textEl.textContent = count > 0 ? `(${count})` : '';
}

export async function updatePendingPhotosBadge(): Promise<void> {
  const count = await dbGetPendingPhotoCount();
  const badge = document.getElementById('pending-photos-count');
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

export async function importPendingPhotosFromNative(filePaths: string[], groupInfo?: string): Promise<void> {
  if (!filePaths || !filePaths.length) return;

  const isNative = !!(w.Capacitor && w.Capacitor.isNativePlatform && w.Capacitor.isNativePlatform());

  for (const filePath of filePaths) {
    try {
      const match = filePath.match(/photo_\d+_\d+_(.+)\.jpg$/);
      let groupId = '未分组';
      if (match) {
        const rawGroupId = match[1];
        if (rawGroupId.startsWith('group_')) {
          groupId = rawGroupId;
        }
      }

      let imageDataUrl: string | null = null;
      if (isNative && w.Capacitor?.Plugins?.Filesystem) {
        try {
          const result = await w.Capacitor.Plugins.Filesystem.readFile({
            path: filePath,
            directory: 'DATA'
          });
          imageDataUrl = 'data:image/jpeg;base64,' + result.data;
        } catch (e) {
          console.warn('无法读取文件:', filePath, e);
          continue;
        }
      } else {
        console.warn('非原生环境，无法读取文件:', filePath);
        continue;
      }

      if (imageDataUrl) {
        await dbAddPendingPhoto(imageDataUrl, groupId);
      }
    } catch (e) {
      console.error('导入照片失败:', filePath, e);
    }
  }

  await updatePendingPhotosBadge();
  w.showStatus('已导入 ' + filePaths.length + ' 张待处理照片', 'success');
}

export function togglePendingLinkInDetail(): void {
  const currentQuestionId = w.currentQuestionId;
  if (!currentQuestionId) return;
  togglePendingLink(currentQuestionId);
  updatePendingLinkBtnStyle(currentQuestionId);
  const tab = document.getElementById('pending-link-tab');
  if (tab && !tab.classList.contains('hidden')) renderPendingLinkList();
}

export function updatePendingLinkBtnStyle(qId: string): void {
  const btn = document.getElementById('detail-pending-link-btn');
  if (!btn) return;
  btn.style.background = isPendingLink(qId) ? 'var(--warning)' : 'rgba(255,255,255,.9)';
  btn.style.color = isPendingLink(qId) ? '#fff' : '';
}

export async function renderPendingLinkList(): Promise<void> {
  const container = document.getElementById('pending-link-list')!;
  container.innerHTML = '';
  if (!_pendingLinkList.length) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:30px">暂无待关联题目</div>';
    return;
  }
  const validIds: string[] = [];
  for (const qId of _pendingLinkList) {
    try {
      const q = await dbQuestions.getItem<Record<string, any>>(qId);
      if (!q || q.deleted_at) continue;
      validIds.push(qId);
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border-light);cursor:pointer';
      div.onclick = () => { w.showQuestionDetail(qId); };
      const img = document.createElement('img');
      img.src = q.question_image_url;
      img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0';
      div.appendChild(img);
      const info = document.createElement('div');
      info.style.cssText = 'flex:1';
      const title = document.createElement('div');
      title.textContent = q.semantic_summary || '题目 ' + qId.substring(0, 8);
      title.style.cssText = 'font-size:14px;color:#333;margin-bottom:4px';
      info.appendChild(title);
      const hint = document.createElement('div');
      hint.textContent = '点击查看';
      hint.style.cssText = 'font-size:12px;color:#888';
      info.appendChild(hint);
      div.appendChild(info);
      const btn = document.createElement('button');
      btn.textContent = '❌';
      btn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;padding:4px';
      btn.onclick = (e) => { e.stopPropagation(); removeFromPendingLink(qId); };
      div.appendChild(btn);
      container.appendChild(div);
    } catch (e) { console.warn('加载题目失败:', qId, e); }
  }
  if (validIds.length !== _pendingLinkList.length) savePendingLinkList(validIds);
}

export function removeFromPendingLink(qId: string): void {
  const idx = _pendingLinkList.indexOf(qId);
  if (idx !== -1) _pendingLinkList.splice(idx, 1);
  savePendingLinkList(_pendingLinkList);
  renderPendingLinkList();
}
