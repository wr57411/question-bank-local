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
  const updates = [];
  await dbTags.iterate((tag, key) => {
    const normalized = _normalizeTagRecord(tag, key);
    if (!normalized) return;
    if (_needsNormalization(tag, normalized)) updates.push(normalized);
    if (!normalized.deleted_at) tagsById.set(normalized.id, normalized);
  });
  for (const tag of updates) await dbTags.setItem(tag.id, tag);

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

function _nowIso() {
  return new Date().toISOString();
}

function _toMillis(value) {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function _normalizeServerAssetUrl(url) {
  if (!url) return url;
  if (/^(data:|blob:|https?:\/\/)/i.test(url)) return url;
  if (url.startsWith('/') && _serverUrl) return _serverUrl + url;
  return url;
}

function _isDataUrl(url) {
  return typeof url === 'string' && url.startsWith('data:');
}

function _isRemoteUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function _isServerAssetPath(url) {
  return typeof url === 'string' && url.startsWith('/uploads/');
}

function _needsAssetUpload(url) {
  if (!url || typeof url !== 'string') return false;
  if (_isDataUrl(url)) return true;
  if (/^(blob:|file:|content:|capacitor:|filesystem:)/i.test(url)) return true;
  if (_isServerAssetPath(url)) return false;
  if (_isRemoteUrl(url)) return false;
  return false;
}

async function _blobFromImageSource(source) {
  if (!source || typeof source !== 'string') return null;
  if (_isDataUrl(source)) return dataURLtoBlob(source);
  const resp = await fetch(source);
  if (!resp.ok) throw new Error('无法读取本地图片资源');
  return await resp.blob();
}

function _isRemoteNewer(remoteRecord, localRecord) {
  if (!localRecord) return true;
  const remoteTs = _toMillis(remoteRecord.updated_at || remoteRecord.deleted_at || remoteRecord.created_at);
  const localTs = _toMillis(localRecord.updated_at || localRecord.deleted_at || localRecord.created_at);
  return remoteTs >= localTs;
}

function _normalizeTagRecord(tag, key) {
  if (!tag || typeof tag !== 'object') return null;
  const next = { ...tag };
  if (!next.id && key) next.id = key;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (!next.color) next.color = '#3B82F6';
  return next;
}

function _normalizeQuestionRecord(question, key) {
  if (!question || typeof question !== 'object') return null;
  const next = { ...question };
  if (!next.id && key) next.id = key;
  if (!next.question_image_url) {
    next.question_image_url = next.questionImageUrl || next.question_image || next.image_url || next.image || next.question || null;
  }
  if (!next.answer_image_url) {
    next.answer_image_url = next.answerImageUrl || next.answer_image || next.answer || null;
  }
  // 新增：空白题目图片（学生用）
  if (next.question_image_blank_url === undefined) {
    next.question_image_blank_url = next.questionImageBlankUrl || next.question_blank_url || next.blank_image || null;
  }
  if (next.layoutType != null && next.layout_type == null) next.layout_type = next.layoutType;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (next.purgedAt && !next.purged_at) next.purged_at = next.purgedAt;
  
  // 新增 AI 字段
  if (!next.semantic_summary) next.semantic_summary = "";
  if (!next.ai_metadata) next.ai_metadata = {};

  return next;
}

function _normalizePaperRecord(paper, key) {
  if (!paper || typeof paper !== 'object') return null;
  const next = { ...paper };
  if (!next.id && key) next.id = key;
  if (!next.name && next.title) next.name = next.title;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  return next;
}

function _needsNormalization(original, normalized) {
  if (!original || !normalized) return false;
  return JSON.stringify(original) !== JSON.stringify(normalized);
}

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
async function _uploadImage(source) {
  if (!_syncEnabled || !_serverUrl || !source) return source;
  if (_isServerAssetPath(source)) return _normalizeServerAssetUrl(source);
  if (_isRemoteUrl(source) && !source.startsWith(_serverUrl)) return source;
  try {
    const blob = await _blobFromImageSource(source);
    if (!blob) return source;
    const form = new FormData();
    const ext = (blob.type && blob.type.includes('/')) ? blob.type.split('/')[1].replace('jpeg', 'jpg') : 'jpg';
    form.append('file', blob, `image.${ext}`);
    const resp = await fetch(_serverUrl + '/api/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _apiToken },
      body: form
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.absolute_url || _normalizeServerAssetUrl(data.url) || source;
    }
  } catch (e) { console.warn('图片上传失败:', e.message); }
  return source;
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
  const updates = [];
  await dbTags.iterate((v, key) => {
    const tag = _normalizeTagRecord(v, key);
    if (!tag) return;
    if (_needsNormalization(v, tag)) updates.push(tag);
    if (!tag.deleted_at) tags.push(tag);
  });
  for (const tag of updates) await dbTags.setItem(tag.id, tag);
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

async function dbCreateTag(name, color) {
  const id = generateId();
  const now = _nowIso();
  const tag = {
    id,
    name,
    color: color || '#3B82F6',
    created_at: now,
    updated_at: now,
    deleted_at: null
  };
  await dbTags.setItem(id, tag);
  return tag;
}

async function dbDeleteTag(tagId) {
  const tag = await dbTags.getItem(tagId);
  if (!tag) return;
  const now = _nowIso();
  await dbTags.setItem(tagId, {
    ...tag,
    deleted_at: now,
    updated_at: now
  });
}

// ========== 题目 CRUD ==========

async function dbGetAllQuestions() {
  const questions = [];
  const updates = [];
  await dbQuestions.iterate((v, key) => {
    const question = _normalizeQuestionRecord(v, key);
    if (!question) return;
    if (_needsNormalization(v, question)) updates.push(question);
    if (!question.deleted_at) questions.push({ ...question });
  });
  for (const question of updates) await dbQuestions.setItem(question.id, question);
  const qtMap = await _buildTagIndex();
  for (const q of questions) q.question_tags = qtMap.get(q.id) || [];
  return questions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function dbGetTrashedQuestions() {
  const questions = [];
  const updates = [];
  await dbQuestions.iterate((v, key) => {
    const question = _normalizeQuestionRecord(v, key);
    if (!question) return;
    if (_needsNormalization(v, question)) updates.push(question);
    if (question.deleted_at && !question.purged_at) questions.push({ ...question });
  });
  for (const question of updates) await dbQuestions.setItem(question.id, question);
  const qtMap = await _buildTagIndex();
  for (const q of questions) q.question_tags = qtMap.get(q.id) || [];
  return questions.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

async function dbCreateQuestion(questionFile, answerFile, selectedTagIds, layoutType) {
  const id = generateId();
  const qImg = await compressImage(questionFile);
  let aImg = null;
  if (answerFile) aImg = await compressImage(answerFile);
  
  // 远程同步：上传图片到服务器
  let qImgUrl = qImg, aImgUrl = aImg;
  if (_syncEnabled) {
    qImgUrl = await _uploadImage(qImg);
    if (aImg) aImgUrl = await _uploadImage(aImg);
  }
  
  const now = _nowIso();
  const question = {
    id,
    question_image_url: _normalizeServerAssetUrl(qImgUrl),
    answer_image_url: _normalizeServerAssetUrl(aImgUrl),
    layout_type: layoutType || 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    semantic_summary: "AI 正在分析中...",
    ai_metadata: {}
  };
  await dbQuestions.setItem(id, question);

  // 异步触发 Gemma 4 分析 (不阻塞主 UI 入库)
  _triggerAIAnalysis(id, qImg);

  for (const tagId of selectedTagIds) {
    await dbQuestionTags.setItem(`${id}_${tagId}`, { question_id: id, tag_id: tagId });
  }
  return question;
}

/**
 * 内部方法：调用 Gemma 4 插件进行分析
 */
async function _triggerAIAnalysis(questionId, imageBase64) {
  try {
    const Gemma4 = window.Capacitor?.Plugins?.Gemma4;
    if (!Gemma4) return;

    // 先发现或检查状态
    const status = await Gemma4.checkModelStatus();
    if (!status.ready) {
      const discovery = await Gemma4.discoverModel();
      if (!discovery.found) return;
    }

    const analysis = await Gemma4.analyzeQuestion({ imageBase64 });
    const question = await dbQuestions.getItem(questionId);
    if (question) {
      question.semantic_summary = analysis.summary;
      question.ai_metadata = {
        difficulty: analysis.difficulty,
        tags_suggested: analysis.tags,
        analyzed_at: new Date().toISOString()
      };
      await dbQuestions.setItem(questionId, question);
      
      // 发送自定义事件通知 UI 刷新
      window.dispatchEvent(new CustomEvent('question-ai-ready', { detail: { questionId } }));
    }
  } catch (e) {
    console.error("Gemma 4 分析失败:", e);
  }
}

async function dbSoftDeleteQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return;
  const now = _nowIso();
  await dbQuestions.setItem(questionId, { ...q, deleted_at: now, updated_at: now });
}

async function dbRestoreQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return;
  await dbQuestions.setItem(questionId, {
    ...q,
    deleted_at: null,
    purged_at: null,
    updated_at: _nowIso()
  });
}

async function dbPermanentDeleteQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return;
  const now = _nowIso();
  await dbQuestions.setItem(questionId, {
    ...q,
    deleted_at: q.deleted_at || now,
    purged_at: now,
    updated_at: now
  });
}

async function dbAddTagToQuestion(questionId, tagId) {
  await dbQuestionTags.setItem(`${questionId}_${tagId}`, { question_id: questionId, tag_id: tagId });
  const question = await dbQuestions.getItem(questionId);
  if (question) {
    await dbQuestions.setItem(questionId, { ...question, updated_at: _nowIso() });
  }
}

// 更新题目的空白版图片
async function dbUpdateQuestionBlankImage(questionId, blankImageUrl) {
  const question = await dbQuestions.getItem(questionId);
  if (!question) throw new Error('题目不存在');
  const now = _nowIso();
  await dbQuestions.setItem(questionId, {
    ...question,
    question_image_blank_url: blankImageUrl,
    updated_at: now
  });
  return question;
}

// ========== 试卷 CRUD ==========

async function dbGetAllPapers() {
  const papers = [];
  const updates = [];
  await dbPapers.iterate((v, key) => {
    const paper = _normalizePaperRecord(v, key);
    if (!paper) return;
    if (_needsNormalization(v, paper)) updates.push(paper);
    if (!paper.deleted_at) papers.push(paper);
  });
  for (const paper of updates) await dbPapers.setItem(paper.id, paper);
  for (const p of papers) {
    let count = 0;
    await dbPaperQuestions.iterate((pq) => { if (pq.paper_id === p.id) count++; });
    p.question_count = count;
  }
  return papers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function dbCreatePaper(name, selectedTagIds) {
  const id = generateId();
  const now = _nowIso();
  const paper = { id, name, created_at: now, updated_at: now, deleted_at: null };
  await dbPapers.setItem(id, paper);
  if (selectedTagIds.length > 0) {
    const qIds = new Set();
    await dbQuestionTags.iterate((qt) => {
      if (selectedTagIds.includes(qt.tag_id)) {
        dbQuestions.getItem(qt.question_id).then(q => {
          if (q && !q.deleted_at) qIds.add(qt.question_id);
        });
      }
    });
    await new Promise(r => setTimeout(r, 50));
    let n = 1;
    for (const qId of qIds) {
      await dbPaperQuestions.setItem(`${id}_${qId}`, { paper_id: id, question_id: qId, order_num: n++ });
    }
  }
  return paper;
}

async function dbDeletePaper(paperId) {
  const paper = await dbPapers.getItem(paperId);
  if (!paper) return;
  const now = _nowIso();
  await dbPapers.setItem(paperId, { ...paper, deleted_at: now, updated_at: now });
}

async function dbGetPaperQuestions(paperId) {
  const paper = _normalizePaperRecord(await dbPapers.getItem(paperId), paperId);
  if (!paper || paper.deleted_at) return { paper: null, questions: [] };
  const pqs = [];
  await dbPaperQuestions.iterate((pq) => { if (pq.paper_id === paperId) pqs.push(pq); });
  pqs.sort((a, b) => a.order_num - b.order_num);
  const questions = [];
  for (const pq of pqs) {
    const q = _normalizeQuestionRecord(await dbQuestions.getItem(pq.question_id), pq.question_id);
    if (q && !q.deleted_at) {
      const qtMap = await _buildTagIndex();
      q.question_tags = qtMap.get(q.id) || [];
      questions.push(q);
    }
  }
  return { paper, questions };
}

async function _collectQuestionTagIds(questionId) {
  const rawTagIds = [];
  await dbQuestionTags.iterate((qt) => {
    if (qt.question_id === questionId) rawTagIds.push(qt.tag_id);
  });
  const tagIds = [];
  for (const tagId of rawTagIds) {
    const tag = _normalizeTagRecord(await dbTags.getItem(tagId), tagId);
    if (tag && !tag.deleted_at) tagIds.push(tagId);
  }
  return Array.from(new Set(tagIds));
}

async function _collectPaperQuestionIds(paperId) {
  const rawRows = [];
  await dbPaperQuestions.iterate((pq) => {
    if (pq.paper_id === paperId) rawRows.push(pq);
  });
  const rows = [];
  for (const row of rawRows) {
    const question = _normalizeQuestionRecord(await dbQuestions.getItem(row.question_id), row.question_id);
    if (question && !question.deleted_at && !question.purged_at) rows.push(row);
  }
  rows.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
  return rows.map((row) => row.question_id);
}

async function _prepareQuestionForSync(question) {
  const nextQuestion = { ...question };
  let changed = false;

  if (_needsAssetUpload(nextQuestion.question_image_url)) {
    const uploaded = await _uploadImage(nextQuestion.question_image_url);
    if (uploaded !== nextQuestion.question_image_url) {
      nextQuestion.question_image_url = uploaded;
      changed = true;
    }
  }

  if (_needsAssetUpload(nextQuestion.answer_image_url)) {
    const uploaded = await _uploadImage(nextQuestion.answer_image_url);
    if (uploaded !== nextQuestion.answer_image_url) {
      nextQuestion.answer_image_url = uploaded;
      changed = true;
    }
  }

  nextQuestion.question_image_url = _normalizeServerAssetUrl(nextQuestion.question_image_url);
  nextQuestion.answer_image_url = _normalizeServerAssetUrl(nextQuestion.answer_image_url);

  if (changed) {
    await dbQuestions.setItem(nextQuestion.id, nextQuestion);
  }

  return nextQuestion;
}

async function dbBuildSyncPayload() {
  const tags = [];
  const tagUpdates = [];
  await dbTags.iterate((rawTag, key) => {
    const tag = _normalizeTagRecord(rawTag, key);
    if (!tag) return;
    if (_needsNormalization(rawTag, tag)) tagUpdates.push(tag);
    tags.push({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      created_at: tag.created_at || tag.updated_at || _nowIso(),
      updated_at: tag.updated_at || tag.created_at || _nowIso(),
      deleted_at: tag.deleted_at || null
    });
  });
  for (const tag of tagUpdates) await dbTags.setItem(tag.id, tag);

  const questions = [];
  const questionUpdates = [];
  await dbQuestions.iterate((rawQuestion, key) => {
    const question = _normalizeQuestionRecord(rawQuestion, key);
    if (!question) return;
    if (_needsNormalization(rawQuestion, question)) questionUpdates.push(question);
    questions.push(question);
  });
  for (const question of questionUpdates) await dbQuestions.setItem(question.id, question);
  for (let i = 0; i < questions.length; i++) {
    questions[i] = await _prepareQuestionForSync(questions[i]);
  }

  const questionPayload = [];
  for (const question of questions) {
    questionPayload.push({
      id: question.id,
      question_image_url: question.question_image_url,
      answer_image_url: question.answer_image_url,
      layout_type: question.layout_type || 0,
      created_at: question.created_at || question.updated_at || _nowIso(),
      updated_at: question.updated_at || question.created_at || _nowIso(),
      deleted_at: question.deleted_at || null,
      purged_at: question.purged_at || null,
      tag_ids: await _collectQuestionTagIds(question.id)
    });
  }

  const papers = [];
  const paperUpdates = [];
  await dbPapers.iterate((rawPaper, key) => {
    const paper = _normalizePaperRecord(rawPaper, key);
    if (!paper) return;
    if (_needsNormalization(rawPaper, paper)) paperUpdates.push(paper);
    papers.push(paper);
  });
  for (const paper of paperUpdates) await dbPapers.setItem(paper.id, paper);
  const paperPayload = [];
  for (const paper of papers) {
    paperPayload.push({
      id: paper.id,
      name: paper.name,
      created_at: paper.created_at || paper.updated_at || _nowIso(),
      updated_at: paper.updated_at || paper.created_at || _nowIso(),
      deleted_at: paper.deleted_at || null,
      question_ids: await _collectPaperQuestionIds(paper.id)
    });
  }

  return { tags, questions: questionPayload, papers: paperPayload };
}

async function _replaceQuestionTags(questionId, tagIds) {
  const keys = [];
  await dbQuestionTags.iterate((value, key) => {
    if (value.question_id === questionId) keys.push(key);
  });
  for (const key of keys) await dbQuestionTags.removeItem(key);
  for (const tagId of tagIds || []) {
    await dbQuestionTags.setItem(`${questionId}_${tagId}`, { question_id: questionId, tag_id: tagId });
  }
}

async function _replacePaperQuestions(paperId, questionIds) {
  const keys = [];
  await dbPaperQuestions.iterate((value, key) => {
    if (value.paper_id === paperId) keys.push(key);
  });
  for (const key of keys) await dbPaperQuestions.removeItem(key);
  let order = 1;
  for (const questionId of questionIds || []) {
    await dbPaperQuestions.setItem(`${paperId}_${questionId}`, {
      paper_id: paperId,
      question_id: questionId,
      order_num: order++
    });
  }
}

async function _cacheImageIfRemote(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
  if (imageUrl.startsWith('data:')) return imageUrl; // 已经是本地 base64
  if (!/^https?:\/\//i.test(imageUrl)) return imageUrl; // 不是远程 URL
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) { console.warn('缓存图片失败:', imageUrl, resp.status); return imageUrl; }
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(imageUrl);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('缓存图片失败:', imageUrl, e.message);
    return imageUrl;
  }
}

async function dbApplyRemoteSnapshot(snapshot) {
  for (const tag of snapshot.tags || []) {
    const localTag = await dbTags.getItem(tag.id);
    const nextTag = {
      id: tag.id,
      name: tag.name,
      color: tag.color || '#3B82F6',
      created_at: tag.created_at || tag.updated_at || _nowIso(),
      updated_at: tag.updated_at || tag.created_at || _nowIso(),
      deleted_at: tag.deleted_at || null
    };
    if (_isRemoteNewer(nextTag, localTag)) {
      await dbTags.setItem(tag.id, nextTag);
    }
  }

  for (const question of snapshot.questions || []) {
    const localQuestion = await dbQuestions.getItem(question.id);
    let qImg = _normalizeServerAssetUrl(question.question_image_url);
    let aImg = _normalizeServerAssetUrl(question.answer_image_url);
    // 缓存远程图片到本地
    qImg = await _cacheImageIfRemote(qImg);
    aImg = await _cacheImageIfRemote(aImg);
    const nextQuestion = {
      id: question.id,
      question_image_url: qImg,
      answer_image_url: aImg,
      layout_type: question.layout_type || 0,
      created_at: question.created_at || question.updated_at || _nowIso(),
      updated_at: question.updated_at || question.created_at || _nowIso(),
      deleted_at: question.deleted_at || null,
      purged_at: question.purged_at || null
    };
    if (_isRemoteNewer(nextQuestion, localQuestion)) {
      if (nextQuestion.purged_at) {
        await dbQuestions.removeItem(question.id);
        await _replaceQuestionTags(question.id, []);
        const pqKeys = [];
        await dbPaperQuestions.iterate((value, key) => {
          if (value.question_id === question.id) pqKeys.push(key);
        });
        for (const key of pqKeys) await dbPaperQuestions.removeItem(key);
        continue;
      }
      await dbQuestions.setItem(question.id, nextQuestion);
      await _replaceQuestionTags(question.id, question.tag_ids || []);
    }
  }

  for (const paper of snapshot.papers || []) {
    const localPaper = await dbPapers.getItem(paper.id);
    const nextPaper = {
      id: paper.id,
      name: paper.name,
      created_at: paper.created_at || paper.updated_at || _nowIso(),
      updated_at: paper.updated_at || paper.created_at || _nowIso(),
      deleted_at: paper.deleted_at || null
    };
    if (_isRemoteNewer(nextPaper, localPaper)) {
      await dbPapers.setItem(paper.id, nextPaper);
      await _replacePaperQuestions(paper.id, paper.question_ids || []);
    }
  }
}

async function dbFinalizeSuccessfulSync(applied) {
  for (const questionId of applied?.purged_question_ids || []) {
    await dbQuestions.removeItem(questionId);
    await _replaceQuestionTags(questionId, []);
    const pqKeys = [];
    await dbPaperQuestions.iterate((value, key) => {
      if (value.question_id === questionId) pqKeys.push(key);
    });
    for (const key of pqKeys) await dbPaperQuestions.removeItem(key);
  }
}

async function dbClearAllData() {
  await dbQuestions.clear();
  await dbTags.clear();
  await dbQuestionTags.clear();
  await dbPapers.clear();
  await dbPaperQuestions.clear();
}

async function dbReplaceWithRemoteSnapshot(snapshot) {
  await dbClearAllData();
  await dbApplyRemoteSnapshot(snapshot);
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
