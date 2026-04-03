/**
 * 本地数据库层 - 使用 IndexedDB (localForage) 替代 Supabase
 * 所有数据存储在本地，无需联网
 */

const dbQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'questions' });
const dbTags = localforage.createInstance({ name: 'questionBank', storeName: 'tags' });
const dbQuestionTags = localforage.createInstance({ name: 'questionBank', storeName: 'question_tags' });
const dbPapers = localforage.createInstance({ name: 'questionBank', storeName: 'papers' });
const dbPaperQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'paper_questions' });

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ========== 图片处理 ==========

function compressImage(input, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > maxWidth) { height = (maxWidth / width) * height; width = maxWidth; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    if (typeof input === 'string') { img.src = input; }
    else {
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      reader.onerror = reject;
      reader.readAsDataURL(input);
    }
  });
}

// ========== 辅助：构建标签索引 ==========

async function _buildTagIndex() {
  const tagsById = new Map();
  await dbTags.iterate((tag) => { tagsById.set(tag.id, tag); });

  const qtByQuestionId = new Map();
  await dbQuestionTags.iterate((qt) => {
    const tag = tagsById.get(qt.tag_id);
    if (!tag) return;
    if (!qtByQuestionId.has(qt.question_id)) qtByQuestionId.set(qt.question_id, []);
    qtByQuestionId.get(qt.question_id).push({ tags: tag });
  });

  return qtByQuestionId;
}

// ========== 远程同步 ==========

// 远程同步开关（由index.html控制）
let _syncEnabled = false;
let _serverUrl = '';
let _apiToken = '';

function initRemoteSync(serverUrl, apiToken, syncEnabled) {
  _serverUrl = serverUrl;
  _apiToken = apiToken;
  _syncEnabled = syncEnabled && !!apiToken;
}

// 远程调用
async function _remoteCall(path, method = 'GET', body = null) {
  if (!_syncEnabled || !_serverUrl) return null;
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _apiToken } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(_serverUrl + path, opts);
    return await resp.json();
  } catch (e) { console.warn('远程同步失败:', e.message); return null; }
}

// 上传图片到服务器
async function _uploadImage(base64Data) {
  if (!_syncEnabled || !_serverUrl) return base64Data;
  try {
    const resp = await fetch(_serverUrl + '/api/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _apiToken },
      body: base64Data.split(',')[1] ? (() => {
        const form = new FormData();
        form.append('file', dataURLtoBlob(base64Data), 'image.jpg');
        return form;
      })() : null
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.url;
    }
  } catch (e) { console.warn('图片上传失败:', e.message); }
  return base64Data;
}

// Base64转Blob
function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// ========== 标签 CRUD ==========

async function dbGetAllTags() {
  const tags = [];
  await dbTags.iterate((v) => tags.push(v));
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

async function dbCreateTag(name, color) {
  const id = generateId();
  const tag = { id, name, color: color || '#3B82F6', created_at: new Date().toISOString() };
  await dbTags.setItem(id, tag);
  if (_syncEnabled) _remoteCall('/api/tags', 'POST', tag);
  return tag;
}

async function dbDeleteTag(tagId) {
  await dbTags.removeItem(tagId);
  const toRemove = [];
  await dbQuestionTags.iterate((v, key) => { if (v.tag_id === tagId) toRemove.push(key); });
  for (const k of toRemove) await dbQuestionTags.removeItem(k);
  if (_syncEnabled) _remoteCall('/api/tags/' + tagId, 'DELETE');
}

// ========== 题目 CRUD ==========

async function dbGetAllQuestions() {
  const questions = [];
  await dbQuestions.iterate((v) => { if (!v.deleted_at) questions.push({ ...v }); });
  const qtMap = await _buildTagIndex();
  for (const q of questions) q.question_tags = qtMap.get(q.id) || [];
  return questions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function dbGetTrashedQuestions() {
  const questions = [];
  await dbQuestions.iterate((v) => { if (v.deleted_at) questions.push({ ...v }); });
  const qtMap = await _buildTagIndex();
  for (const q of questions) q.question_tags = qtMap.get(q.id) || [];
  return questions.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

async function dbCreateQuestion(questionFile, answerFile, selectedTagIds, layoutType) {
  const id = generateId();
  const qImg = await compressImage(questionFile);
  let aImg = null;
  if (answerFile) aImg = await compressImage(answerFile);
  const question = {
    id, question_image_url: qImg, answer_image_url: aImg,
    layout_type: layoutType || 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  await dbQuestions.setItem(id, question);
  for (const tagId of selectedTagIds) {
    await dbQuestionTags.setItem(`${id}_${tagId}`, { question_id: id, tag_id: tagId });
  }
  return question;
}

async function dbSoftDeleteQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (q) { q.deleted_at = new Date().toISOString(); await dbQuestions.setItem(questionId, q); }
}

async function dbRestoreQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (q) { delete q.deleted_at; await dbQuestions.setItem(questionId, q); }
}

async function dbPermanentDeleteQuestion(questionId) {
  await dbQuestions.removeItem(questionId);
  const toRemove = [];
  await dbQuestionTags.iterate((v, key) => { if (v.question_id === questionId) toRemove.push(key); });
  for (const k of toRemove) await dbQuestionTags.removeItem(k);
  const pqRemove = [];
  await dbPaperQuestions.iterate((v, key) => { if (v.question_id === questionId) pqRemove.push(key); });
  for (const k of pqRemove) await dbPaperQuestions.removeItem(k);
}

async function dbAddTagToQuestion(questionId, tagId) {
  await dbQuestionTags.setItem(`${questionId}_${tagId}`, { question_id: questionId, tag_id: tagId });
}

// ========== 试卷 CRUD ==========

async function dbGetAllPapers() {
  const papers = [];
  await dbPapers.iterate((v) => papers.push(v));
  for (const p of papers) {
    let count = 0;
    await dbPaperQuestions.iterate((pq) => { if (pq.paper_id === p.id) count++; });
    p.question_count = count;
  }
  return papers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function dbCreatePaper(name, selectedTagIds) {
  const id = generateId();
  const paper = { id, name, created_at: new Date().toISOString() };
  await dbPapers.setItem(id, paper);
  if (selectedTagIds.length > 0) {
    const qIds = new Set();
    await dbQuestionTags.iterate((qt) => {
      if (selectedTagIds.includes(qt.tag_id)) {
        // 只加入未删除的题目
        dbQuestions.getItem(qt.question_id).then(q => {
          if (q && !q.deleted_at) qIds.add(qt.question_id);
        });
      }
    });
    // 等待上面的异步操作完成
    await new Promise(r => setTimeout(r, 50));
    let n = 1;
    for (const qId of qIds) {
      await dbPaperQuestions.setItem(`${id}_${qId}`, { paper_id: id, question_id: qId, order_num: n++ });
    }
  }
  return paper;
}

async function dbDeletePaper(paperId) {
  await dbPapers.removeItem(paperId);
  const toRemove = [];
  await dbPaperQuestions.iterate((v, key) => { if (v.paper_id === paperId) toRemove.push(key); });
  for (const k of toRemove) await dbPaperQuestions.removeItem(k);
}

async function dbGetPaperQuestions(paperId) {
  const paper = await dbPapers.getItem(paperId);
  const pqs = [];
  await dbPaperQuestions.iterate((pq) => { if (pq.paper_id === paperId) pqs.push(pq); });
  pqs.sort((a, b) => a.order_num - b.order_num);
  const questions = [];
  for (const pq of pqs) {
    const q = await dbQuestions.getItem(pq.question_id);
    if (q && !q.deleted_at) {
      const qtMap = await _buildTagIndex();
      q.question_tags = qtMap.get(q.id) || [];
      questions.push(q);
    }
  }
  return { paper, questions };
}

// ========== PDF 生成 ==========

async function generatePDF(questions, options = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 20, maxW = W - M * 2;
  const { mode = 'merged', spacing = 'none', spacingCm = 5, title = '' } = options;
  const spcMm = spacing !== 'none' ? spacingCm * 10 : 0;

  function addImg(dataUrl, y, maxH) {
    return new Promise((resolve) => {
      if (!dataUrl || dataUrl.length < 50) { resolve(y + 5); return; }
      const img = new Image();
      img.onload = () => {
        const aH = maxH || (H - M - y);
        const r = Math.min(maxW / img.width, aH / img.height, 1);
        const w = img.width * r, h = img.height * r;
        if (y + h > H - M) { doc.addPage(); y = M; }
        doc.addImage(dataUrl, 'JPEG', (W - w) / 2, y, w, h);
        resolve(y + h + 4);
      };
      img.onerror = () => resolve(y + 5);
      setTimeout(() => resolve(y + 5), 5000);
      img.src = dataUrl;
    });
  }

  if (title) {
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text(title, W / 2, M + 5, { align: 'center' });
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text(`共 ${questions.length} 题`, W / 2, M + 13, { align: 'center' });
  }

  let y = M + 20;

  if (mode === 'merged') {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (y > H - M - 30) { doc.addPage(); y = M; }
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text(`第 ${i + 1} 题`, M, y); y += 6;
      y = await addImg(q.question_image_url, y);
      if (q.answer_image_url) {
        if (y > H - M - 20) { doc.addPage(); y = M; }
        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        doc.text('答案:', M, y); y += 5;
        y = await addImg(q.answer_image_url, y);
      }
      if (spcMm > 0) {
        y += 2;
        doc.setDrawColor(200); doc.setLineDash([3, 3]);
        doc.line(M, y, W - M, y); doc.setLineDash([]);
        y += spcMm;
      }
    }
  } else {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (y > H - M - 30) { doc.addPage(); y = M; }
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text(`第 ${i + 1} 题`, M, y); y += 6;
      y = await addImg(q.question_image_url, y);
      if (spcMm > 0) { y += spcMm; }
    }
    doc.addPage(); y = M;
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('参考答案', W / 2, y, { align: 'center' }); y += 12;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.answer_image_url) continue;
      if (y > H - M - 20) { doc.addPage(); y = M; }
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(`第 ${i + 1} 题`, M, y); y += 5;
      y = await addImg(q.answer_image_url, y);
    }
  }

  doc.save(`${title || '题库导出'}.pdf`);
}

async function generatePaperPDF(paperId) {
  const { paper, questions } = await dbGetPaperQuestions(paperId);
  if (!paper) { alert('试卷不存在'); return; }
  await generatePDF(questions, { mode: 'merged', title: paper.name });
}

// ========== 数据导入/导出 ==========

async function exportAllData() {
  const data = { questions: [], tags: [], question_tags: [], papers: [], paper_questions: [] };
  await dbQuestions.iterate((v) => data.questions.push(v));
  await dbTags.iterate((v) => data.tags.push(v));
  await dbQuestionTags.iterate((v) => data.question_tags.push(v));
  await dbPapers.iterate((v) => data.papers.push(v));
  await dbPaperQuestions.iterate((v) => data.paper_questions.push(v));
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `question-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}

async function importAllData(file) {
  const data = JSON.parse(await file.text());
  if (data.tags) for (const t of data.tags) await dbTags.setItem(t.id, t);
  if (data.questions) for (const q of data.questions) await dbQuestions.setItem(q.id, q);
  if (data.question_tags) for (const qt of data.question_tags) await dbQuestionTags.setItem(`${qt.question_id}_${qt.tag_id}`, qt);
  if (data.papers) for (const p of data.papers) await dbPapers.setItem(p.id, p);
  if (data.paper_questions) for (const pq of data.paper_questions) await dbPaperQuestions.setItem(`${pq.paper_id}_${pq.question_id}`, pq);
  return { questions: data.questions?.length || 0, tags: data.tags?.length || 0, papers: data.papers?.length || 0 };
}
