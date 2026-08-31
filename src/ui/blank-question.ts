/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbQuestions } from '../data/stores';
import { openModal, closeModal } from './common';

const w = window as any;

let _pendingBlankList: string[] = JSON.parse(localStorage.getItem('pendingBlankList') || '[]');

export async function showPendingBlankList(): Promise<void> {
  const container = document.getElementById('pending-blank-list')!;
  container.innerHTML = '';

  if (!_pendingBlankList.length) {
    container.innerHTML = '<div style="text-align:center;color:#999;padding:20px">暂无待补拍题目</div>';
    openModal('pending-blank-modal');
    return;
  }

  for (const questionId of _pendingBlankList) {
    try {
      const question = await dbQuestions.getItem<Record<string, any>>(questionId);
      if (!question) {
        _pendingBlankList = _pendingBlankList.filter(id => id !== questionId);
        continue;
      }
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border-light)';

      const img = document.createElement('img');
      img.src = question.question_image_url;
      img.style.cssText = 'width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0';
      div.appendChild(img);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1';
      const title = document.createElement('div');
      title.textContent = question.semantic_summary || '题目 ' + questionId.substring(0, 8);
      title.style.cssText = 'font-size:14px;color:#333;margin-bottom:4px';
      info.appendChild(title);

      const hint = document.createElement('div');
      hint.textContent = '此题暂无空白版，请在题目详情中补拍';
      hint.style.cssText = 'font-size:12px;color:#888';
      info.appendChild(hint);

      div.appendChild(info);

      const btn = document.createElement('button');
      btn.textContent = '❌';
      btn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;padding:4px';
      btn.onclick = (e) => {
        e.stopPropagation();
        removeFromPendingBlank(questionId);
      };
      div.appendChild(btn);

      container.appendChild(div);
    } catch (e) {
      console.warn('加载题目失败:', questionId, e);
    }
  }

  openModal('pending-blank-modal');
}

export function closePendingBlankModal(): void {
  closeModal('pending-blank-modal');
}

export function removeFromPendingBlank(questionId: string): void {
  _pendingBlankList = _pendingBlankList.filter(id => id !== questionId);
  localStorage.setItem('pendingBlankList', JSON.stringify(_pendingBlankList));
  showPendingBlankList();
  updatePendingBlankCount();
}

export function updatePendingBlankCount(): void {
  const count = _pendingBlankList.length;
  const badge = document.getElementById('pending-blank-count');
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}
