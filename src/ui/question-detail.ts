/* eslint-disable @typescript-eslint/no-explicit-any */
import { openModal, closeModal } from './common';
import { isSystemMemberTag } from './question-core';
import { getAllVectors } from '../data/embeddings';
import { cosineSimilarity } from '../services/semantic';
const w = window as any;

// Expose _detailLoadToken on window (note-version.ts reads/writes it)
w._detailLoadToken = 0;

export function showQuestionDetail(qId: string): void {
  w.currentQuestionId = qId;
  w.filteredList = w.getFilteredQuestions();
  w.detailIndex = w.filteredList.findIndex((q: any) => q.id === qId);
  if (w.detailIndex < 0) w.detailIndex = 0;
  renderDetailContent(w.filteredList[w.detailIndex]);
  openModal('question-modal');
}

export function renderDetailContent(q: any): void {
  w._detailLoadToken++;
  document.getElementById('modal-question-image')!.innerHTML = '<div style="text-align:center;padding:20px"><p style="color:var(--text-tertiary)">加载中...</p></div>';
  w.loadNoteVersionsForDetail(q.id);

  document.getElementById('modal-answer-image')!.innerHTML = q.answer_image_url ? '<h3 style="margin-top:12px">答案</h3><img src="' + q.answer_image_url + '" style="max-width:100%;border-radius:var(--radius-sm)">' : '<p style="color:var(--text-tertiary);margin-top:12px">无答案图片</p>';
  const tags = q.question_tags;
  // 2.12 系统成员标签（专题·X）以 chip 显示并加区分标记；扁平契约 t.id/t.name/t.color
  document.getElementById('modal-tags')!.innerHTML = tags.length ? '<h3 style="margin-top:12px">标签（点击移除）</h3><div class="tag-container">' + tags.map((t: any) => {
    const sys = isSystemMemberTag(t.id);
    return '<span class="tag' + (sys ? ' tag-system' : '') + '" style="background:' + t.color + '20;border:1px solid ' + t.color + ';cursor:pointer" onclick="removeTagFromQuestion(\'' + t.id + '\')">' + (sys ? '📁 ' : '') + t.name + ' ✕</span>';
  }).join('') + '</div>' : '';

  // 版本归属编辑
  const versions = q.versions || [];
  const allVersions = w.getAppVersions();
  let versionHtml = '<h3 style="margin-top:12px">适用版本</h3><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">';
  allVersions.forEach((v: any) => {
    const checked = versions.includes(v.id);
    versionHtml += `<div style="display:flex;align-items:center;gap:4px;padding:6px 10px;border:1.5px solid ${checked ? v.theme.primary : 'var(--border)'};border-radius:var(--radius-md);cursor:pointer;font-size:12px;transition:border-color .2s,background-color .2s;background:${checked ? v.theme.primaryLight : 'var(--surface)'}" onclick="if(event.target.tagName!=='INPUT'){var cb=this.querySelector('input');cb.checked=!cb.checked;var p=cb.parentElement;p.style.borderColor=cb.checked?'${v.theme.primary}':'var(--border)';p.style.background=cb.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',cb.checked)}"><input type="checkbox" onchange="var p=this.parentElement;p.style.borderColor=this.checked?'${v.theme.primary}':'var(--border)';p.style.background=this.checked?'${v.theme.primaryLight}':'var(--surface)';toggleQuestionVersion('${q.id}','${v.id}',this.checked)" ${checked ? 'checked' : ''} style="accent-color:${v.theme.primary};width:18px;height:18px;cursor:pointer;flex-shrink:0"><span>${v.emoji} ${v.name}</span></div>`;
  });
  versionHtml += '</div><small style="color:var(--text-secondary);font-size:11px">不勾选则所有版本均可见</small>';
  document.getElementById('modal-tags')!.innerHTML += versionHtml;

  // 复习提醒开关
  const reviewEnabled = q.review_enabled || false;
  const reviewNextDate = q.review_next_date || '未设置';
  const reviewCount = q.review_count || 0;
  const reviewHtml = `<h3 style="margin-top:12px">🧠 复习提醒</h3>
    <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
        <input type="checkbox" ${reviewEnabled ? 'checked' : ''} onchange="toggleReviewForQuestion('${q.id}')" style="accent-color:var(--accent);width:18px;height:18px;cursor:pointer" />
        开启艾宾浩斯复习提醒
      </label>
    </div>
    ${reviewEnabled ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">已复习 ${reviewCount} 次 · 下次复习: ${reviewNextDate}</div>` : ''}`;
  document.getElementById('modal-tags')!.innerHTML += reviewHtml;

  const tagsEl = document.getElementById('modal-tags');
  if (tagsEl) {
    tagsEl.innerHTML += `<div style="margin-top:16px"><button onclick="showSimilarQuestions('${q.id}')" style="width:100%;padding:12px 20px;border:none;border-radius:18px;background:linear-gradient(135deg,#9D7BFF,#7C58E8);color:#fff;font-size:14px;font-weight:700;cursor:pointer">🔍 找相似题</button></div>`;
  }
  // 2.10 单题加入/移出专题入口（独立容器，避免与 #modal-tags 内既有按钮产生选择器歧义）
  const assignEl = document.getElementById('modal-group-assign');
  if (assignEl) {
    assignEl.innerHTML = `<div style="margin-top:8px"><button onclick="openDetailGroupAssign()" style="width:100%;padding:10px 20px;border:1.5px solid var(--border);border-radius:14px;background:var(--surface-dim);color:var(--text);font-size:13px;font-weight:600;cursor:pointer">📁 加入 / 移出专题</button></div>`;
  }

  // AI 摘要
  const aiDiv = document.getElementById('modal-ai-summary')!;
  const aiText = document.getElementById('modal-ai-text')!;
  if (q.semantic_summary && q.semantic_summary !== '' && q.semantic_summary !== 'AI 正在分析中...') {
    aiDiv.style.display = 'block';
    aiText.textContent = q.semantic_summary;
  } else {
    aiDiv.style.display = 'none';
  }
  // 用户评价
  const userComment = q.user_comment || '';
  const commentInput = document.getElementById('user-comment') as HTMLInputElement | null;
  if (commentInput && document.activeElement !== commentInput) {
    commentInput.value = userComment;
  }
  document.getElementById('detail-nav-info')!.textContent = (w.detailIndex + 1) + ' / ' + w.filteredList.length;
  (document.getElementById('btn-prev') as HTMLButtonElement).disabled = w.detailIndex <= 0;
  document.getElementById('btn-prev')!.style.opacity = w.detailIndex <= 0 ? '0.4' : '1';
  (document.getElementById('btn-next') as HTMLButtonElement).disabled = w.detailIndex >= w.filteredList.length - 1;
  document.getElementById('btn-next')!.style.opacity = w.detailIndex >= w.filteredList.length - 1 ? '0.4' : '1';
  updateDetailBasketBtn(q.id);
}

export async function toggleQuestionVersion(questionId: string, versionId: string, checked: boolean): Promise<void> {
  const q = await w.dbQuestions.getItem(questionId);
  if (!q) return;
  let versions = q.versions || [];
  if (checked) { if (!versions.includes(versionId)) versions.push(versionId); }
  else { versions = versions.filter((v: string) => v !== versionId); }
  await w.dbUpdateQuestionVersions(questionId, versions);
  await w.loadQuestions();
  w.showStatus('版本归属已更新', 'success');
}

export function updateDetailBasketBtn(qId: string): void {
  const btn = document.getElementById('detail-basket-btn')!;
  if (w.questionBasket.has(qId)) { btn.textContent = '✓'; btn.style.background = 'var(--sky)'; btn.style.color = '#fff'; }
  else { btn.textContent = '🧺'; btn.style.background = 'rgba(255,255,255,.9)'; btn.style.color = 'var(--text)'; }
}

export function toggleBasketInDetail(): void {
  if (!w.currentQuestionId) return;
  w.toggleBasket(w.currentQuestionId);
  updateDetailBasketBtn(w.currentQuestionId);
  w.renderQuestions();
}

export function navigateDetail(dir: number): void {
  const ni = w.detailIndex + dir;
  if (ni < 0 || ni >= w.filteredList.length) return;
  w.detailIndex = ni;
  w.currentQuestionId = w.filteredList[ni].id;
  renderDetailContent(w.filteredList[ni]);
}

export function closeQuestionModal(): void {
  closeModal('question-modal');
  w.currentQuestionId = null;
}

// 触摸滑动初始化
export function initDetailSwipe(): void {
  let sx = 0, sy = 0, st = 0;
  const m = document.getElementById('question-modal');
  if (!m) return;
  m.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  m.addEventListener('touchend', (e: TouchEvent) => {
    if (!m.classList.contains('active')) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, dt = Date.now() - st;
    if (Math.abs(dx) > 60 && dt < 500 && Math.abs(dy) < 100) { dx < 0 ? navigateDetail(1) : navigateDetail(-1); }
  }, { passive: true });
}

export function closeSimilarModal(): void {
  closeModal('similar-modal');
}

export async function showSimilarQuestions(qId: string): Promise<void> {
  const vectors = await getAllVectors();
  const self = vectors.get(qId);
  if (!self) {
    w.showStatus('该题暂无语义索引（需在服务端执行一次建库）', 'error');
    return;
  }
  const hits: { id: string; score: number }[] = [];
  vectors.forEach((vec, id) => {
    if (id !== qId) hits.push({ id, score: cosineSimilarity(self, vec) });
  });
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, 6);
  const byId = new Map((w.allQuestions as any[]).map((q: any) => [q.id, q]));
  const list = document.getElementById('similar-list');
  if (!list) return;
  list.replaceChildren();
  top.forEach((h) => {
    const q = byId.get(h.id);
    if (!q || q.deleted_at) return;
    const card = document.createElement('div');
    card.className = 'similar-card';
    card.innerHTML = `<img src="${q.question_image_url}" alt=""><span class="score">${Math.round(h.score * 100)}%</span>`;
    card.onclick = () => { closeModal('similar-modal'); w.showQuestionDetail(q.id); };
    list.appendChild(card);
  });
  openModal('similar-modal');
}
