/* eslint-disable @typescript-eslint/no-explicit-any */
const w = window as any;

let currentTopicId: string | null = null;

export function renderTopicQuestionPicker(): void {
  const container = document.getElementById('topic-question-picker');
  if (!container) return;
  const currentVersionId = w.getCurrentVersionId();
  const filtered = w.allQuestions.filter((q: any) => { const versions = q.versions || []; return versions.length === 0 || versions.includes(currentVersionId); });
  container.innerHTML = '';
  if (!filtered.length) { container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px">暂无题目</div>'; return; }
  filtered.forEach((q: any) => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border-light);cursor:pointer';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = 'topic_questions'; cb.value = q.id; cb.style.cssText = 'accent-color:var(--primary)';
    const img = document.createElement('img'); img.src = q.question_image_url; img.style.cssText = 'width:40px;height:40px;object-fit:contain;border-radius:4px;background:var(--surface-dim)';
    const info = document.createElement('div'); info.style.cssText = 'flex:1;font-size:13px;color:var(--text)';
    info.textContent = q.semantic_summary || q.user_comment || q.question_tags.map((qt: any) => qt.tags.name).join('、') || '题目 ' + q.id.substring(0, 8);
    label.append(cb, img, info); container.appendChild(label);
  });
}

export function getSelectedTopicQuestions(): string[] {
  return Array.from(document.querySelectorAll('input[name="topic_questions"]:checked')).map((cb: any) => cb.value);
}

export function initTopicForm(): void {
  document.getElementById('topic-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('topic-name') as HTMLInputElement).value.trim();
    const desc = (document.getElementById('topic-desc') as HTMLInputElement).value.trim();
    if (!name) return;
    const questionIds = getSelectedTopicQuestions();
    await w.dbCreateTopic(name, desc, questionIds);
    (document.getElementById('topic-form') as HTMLFormElement).reset();
    await loadTopics();
    w.showStatus('专题创建成功', 'success');
  });
}

export async function loadTopics(): Promise<void> {
  const topics = await w.dbGetAllTopics();
  const c = document.getElementById('topics-list')!;
  if (!topics.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📚</div>暂无专题</div>'; return; }
  c.replaceChildren();
  topics.forEach((t: any) => {
    const card = document.createElement('div'); card.className = 'paper-card';
    const title = document.createElement('h3'); title.textContent = t.name;
    const desc = document.createElement('p'); desc.textContent = t.description || '暂无描述'; desc.style.cssText = 'color:var(--text-secondary);font-size:13px';
    const count = document.createElement('p'); count.textContent = (t.question_count || 0) + ' 题 · 创建于 ' + new Date(t.created_at).toLocaleDateString(); count.style.cssText = 'color:var(--text-tertiary);font-size:12px';
    const bg = document.createElement('div'); bg.className = 'btn-group'; bg.style.marginTop = '10px';
    const vw = document.createElement('button'); vw.textContent = '查看'; vw.onclick = () => showTopicDetail(t.id);
    const dl = document.createElement('button'); dl.className = 'secondary'; dl.textContent = '导出 PDF'; dl.onclick = () => exportTopicPDFForId(t.id);
    const del = document.createElement('button'); del.className = 'danger'; del.textContent = '删除';
    del.onclick = async () => { if (!confirm('确定删除专题？')) return; await w.dbDeleteTopic(t.id); await loadTopics(); };
    bg.append(vw, dl, del); card.append(title, desc, count, bg); c.appendChild(card);
  });
}

export async function showTopicDetail(topicId: string): Promise<void> {
  currentTopicId = topicId;
  const { topic, questions } = await w.dbGetTopicQuestions(topicId);
  if (!topic) return;
  document.getElementById('topic-detail-title')!.textContent = topic.name;
  document.getElementById('topic-detail-desc')!.textContent = topic.description || '';
  const c = document.getElementById('topic-detail-questions')!;
  if (!questions.length) {
    c.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:20px">该专题暂无题目</p>';
  } else {
    c.replaceChildren();
    questions.forEach((q: any, i: number) => {
      const d = document.createElement('div');
      d.style.cssText = 'margin-bottom:16px;padding:12px;background:var(--surface-dim);border-radius:var(--radius-md)';
      const header = document.createElement('div'); header.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:14px'; header.textContent = '第' + (i + 1) + '题';
      const img = document.createElement('img'); img.src = q.question_image_url; img.style.cssText = 'max-width:100%;border-radius:6px;margin-bottom:8px';
      const commentLabel = document.createElement('div'); commentLabel.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-bottom:4px;font-weight:600'; commentLabel.textContent = '📝 教师评价';
      const textarea = document.createElement('textarea'); textarea.value = q.teacher_comment || ''; textarea.placeholder = '输入教师对这道题在本专题中的评价...'; textarea.rows = 2;
      textarea.style.cssText = 'width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;resize:none;margin-bottom:6px';
      const saveBtn = document.createElement('button'); saveBtn.textContent = '保存评价'; saveBtn.style.cssText = 'padding:6px 14px;font-size:12px';
      saveBtn.onclick = async () => { await w.dbUpdateTopicQuestionComment(topicId, q.id, textarea.value); w.showStatus('评价已保存', 'success'); };
      d.append(header, img, commentLabel, textarea, saveBtn); c.appendChild(d);
    });
  }
  document.getElementById('topic-detail-modal')!.classList.add('active');
}

export function closeTopicDetailModal(): void {
  document.getElementById('topic-detail-modal')!.classList.remove('active');
  currentTopicId = null;
}

export async function exportTopicPDF(): Promise<void> {
  if (!currentTopicId) return;
  await exportTopicPDFForId(currentTopicId);
}

export async function exportTopicPDFForId(topicId: string): Promise<void> {
  const { topic, questions } = await w.dbGetTopicQuestions(topicId);
  if (!topic || !questions.length) { w.showStatus('专题暂无题目', 'error'); return; }
  await w.generatePDF(questions, { mode: 'merged', title: topic.name });
  w.showStatus('PDF 已生成', 'success');
}

export async function deleteTopic(): Promise<void> {
  if (!currentTopicId) return;
  if (!confirm('确定删除这个专题？')) return;
  await w.dbDeleteTopic(currentTopicId);
  closeTopicDetailModal();
  await loadTopics();
  w.showStatus('专题已删除', 'success');
}
