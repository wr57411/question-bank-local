/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

export async function checkPendingReviews(): Promise<void> {
  const pending = await w.dbGetPendingReviews();
  if (pending.length === 0) return;
  showReviewReminder(pending);
}

export function showReviewReminder(questions: Record<string, any>[]): void {
  const existing = document.getElementById('review-reminder-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'review-reminder-modal';
  modal.className = 'modal active';
  modal.style.cssText = 'z-index:9998';
  modal.innerHTML = `<div class="modal-content" style="max-width:500px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2 style="margin:0;font-size:17px;font-weight:700;color:var(--accent)">📝 今日复习提醒</h2>
          <span style="cursor:pointer;font-size:24px;color:var(--text-tertiary)" onclick="document.getElementById('review-reminder-modal').remove()">×</span>
      </div>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">以下 ${questions.length} 道题目需要复习（艾宾浩斯遗忘曲线）：</p>
      <div id="review-reminder-list" style="display:flex;flex-direction:column;gap:8px"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
          <button onclick="document.getElementById('review-reminder-modal').remove()" class="secondary" style="flex:1">关闭</button>
      </div>
  </div>`;
  document.body.appendChild(modal);
  const list = document.getElementById('review-reminder-list')!;
  questions.forEach(q => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--border-light);border-radius:var(--radius-md)';
    const thumb = q.question_image_url
      ? `<img src="${q.question_image_url}" style="width:50px;height:50px;object-fit:contain;border-radius:4px;background:var(--surface-dim)">`
      : '<div style="width:50px;height:50px;background:var(--surface-dim);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:20px">📝</div>';
    const summary = q.semantic_summary || q.user_comment || '题目 ' + q.id.substring(0, 8);
    const intervalIdx = q.review_interval_index || 0;
    const intervals = [1, 2, 4, 7, 15, 30];
    const nextDays = intervals[Math.min(intervalIdx + 1, intervals.length - 1)];
    item.innerHTML = `${thumb}
        <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${summary}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">第${(q.review_count || 0) + 1}次复习 · 下次间隔${nextDays}天</div>
        </div>
        <button onclick="markReviewed('${q.id}', this)" style="font-size:12px;padding:6px 12px;background:var(--primary);flex-shrink:0">已复习</button>`;
    list.appendChild(item);
  });
}

export async function markReviewed(questionId: string, btn: HTMLButtonElement): Promise<void> {
  await w.dbCompleteReview(questionId);
  btn.textContent = '✓ 已完成';
  btn.disabled = true;
  btn.style.background = 'var(--mint)';
  btn.style.color = '#fff';
  w.showStatus('已标记为复习完成', 'success');
}

export async function toggleReviewForQuestion(questionId: string): Promise<void> {
  const { dbQuestions } = await import('../data/stores');
  const q = await dbQuestions.getItem<Record<string, any>>(questionId);
  if (!q) return;
  if (q.review_enabled) {
    await w.dbDisableReview(questionId);
    w.showStatus('已关闭复习提醒', 'info');
  } else {
    await w.dbEnableReview(questionId);
    w.showStatus('已开启复习提醒，明天开始第一次复习', 'success');
  }
  if (typeof w.showQuestionDetail === 'function') {
    w.showQuestionDetail(questionId);
  }
}

export function initReviewCheck(): void {
  (async () => {
    try { await checkPendingReviews(); } catch (e) { console.warn('复习提醒检查失败:', e); }
  })();
}
