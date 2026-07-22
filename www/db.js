/**
 * 本地数据库层 - 使用 IndexedDB (localForage) 替代 Supabase
 * 所有数据存储在本地，无需联网
 */

const dbQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'questions' });
const dbTags = localforage.createInstance({ name: 'questionBank', storeName: 'tags' });
const dbQuestionTags = localforage.createInstance({ name: 'questionBank', storeName: 'question_tags' });
const dbPapers = localforage.createInstance({ name: 'questionBank', storeName: 'papers' });
const dbPaperQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'paper_questions' });
const dbSimilarQuestionLinks = localforage.createInstance({ name: 'questionBank', storeName: 'similar_question_links' });
const dbTopics = localforage.createInstance({ name: 'questionBank', storeName: 'topics' });
const dbTopicQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'topic_questions' });
const dbQuestionNotes = localforage.createInstance({ name: 'questionBank', storeName: 'question_notes' });
const dbPendingPhotos = localforage.createInstance({ name: 'questionBank', storeName: 'pending_photos' });
const dbTeachingNodes = localforage.createInstance({ name: 'questionBank', storeName: 'teaching_nodes' });
const dbTeachingVersions = localforage.createInstance({ name: 'questionBank', storeName: 'teaching_versions' });
const dbNodeQuestions = localforage.createInstance({ name: 'questionBank', storeName: 'node_questions' });

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const hex = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
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

let _tagIndexCache = null;
let _tagIndexDirty = true;

let _questionsCache = null;
let _questionsDirty = true;

let _tagsCache = null;
let _tagsDirty = true;

function _invalidateTagIndex() {
  _tagIndexDirty = true;
  _tagsDirty = true;
}

function _invalidateQuestionsCache() {
  _questionsDirty = true;
}

async function _buildTagIndex() {
  if (_tagIndexCache && !_tagIndexDirty) return _tagIndexCache;
  
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

  _tagIndexCache = qtByQuestionId;
  _tagIndexDirty = false;
  return _tagIndexCache;
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
  if (!next.user_comment) next.user_comment = "";
  // 版本归属字段
  if (!next.versions) next.versions = [];
  // 书本信息字段
  if (!next.book_name) next.book_name = "";
  if (!next.page_number) next.page_number = "";
  if (!next.question_number) next.question_number = "";

  return next;
}

function _normalizeSimilarLinkPair(questionId, similarQuestionId) {
  if (!questionId || !similarQuestionId || questionId === similarQuestionId) return null;
  return [questionId, similarQuestionId].sort();
}

function _similarLinkKey(questionId, similarQuestionId) {
  const pair = _normalizeSimilarLinkPair(questionId, similarQuestionId);
  return pair ? pair[0] + "_" + pair[1] : null;
}

function _normalizeSimilarLinkRecord(link, key) {
  if (!link || typeof link !== 'object') return null;
  const pair = _normalizeSimilarLinkPair(link.question_id, link.similar_question_id);
  if (!pair) {
    if (key && key.includes("_")) {
      const parts = key.split("_");
      if (parts.length >= 2) {
        const keyPair = _normalizeSimilarLinkPair(parts[0], parts.slice(1).join("_"));
        if (!keyPair) return null;
        return { ...link, question_id: keyPair[0], similar_question_id: keyPair[1] };
      }
    }
    return null;
  }
  const next = { ...link, question_id: pair[0], similar_question_id: pair[1] };
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (!next.created_at) next.created_at = next.updated_at || _nowIso();
  if (!next.updated_at) next.updated_at = next.created_at;
  if (next.deleted_at === undefined) next.deleted_at = null;
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
  if (original === normalized) return false;
  return (
    original.id !== normalized.id ||
    original.name !== normalized.name ||
    original.title !== normalized.title ||
    original.color !== normalized.color ||
    original.question_image_url !== normalized.question_image_url ||
    original.answer_image_url !== normalized.answer_image_url ||
    original.question_image_blank_url !== normalized.question_image_blank_url ||
    original.layoutType !== normalized.layoutType ||
    original.layout_type !== normalized.layout_type ||
    original.createdAt !== normalized.created_at ||
    original.updatedAt !== normalized.updated_at ||
    original.deletedAt !== normalized.deleted_at ||
    original.purgedAt !== normalized.purged_at
  );
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
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
    return await resp.json();
  } catch (e) {
    console.warn('远程同步失败:', e.message);
    if (typeof window.showSyncStatus === 'function') window.showSyncStatus('同步失败: ' + e.message);
    return null;
  }
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
  const arr = dataurl.split(',');
  const match = arr[0].match(/:(.*?);/);
  if (!match || !arr[1]) throw new Error('Invalid data URL');
  const mime = match[1];
  const bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// ========== 标签 CRUD ==========

async function dbGetAllTags() {
  if (_tagsCache && !_tagsDirty) return _tagsCache.map(t => ({ ...t }));
  const tags = [];
  const updates = [];
  await dbTags.iterate((v, key) => {
    const tag = _normalizeTagRecord(v, key);
    if (!tag) return;
    if (_needsNormalization(v, tag)) updates.push(tag);
    if (!tag.deleted_at) tags.push(tag);
  });
  for (const tag of updates) await dbTags.setItem(tag.id, tag);
  _tagsCache = tags.sort((a, b) => a.name.localeCompare(b.name));
  _tagsDirty = false;
  return _tagsCache.map(t => ({ ...t }));
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
  _invalidateTagIndex();
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
  _invalidateTagIndex();
}

// ========== 题目 CRUD ==========

async function dbGetAllQuestions() {
  if (_questionsCache && !_questionsDirty) {
    const qtMap = await _buildTagIndex();
    return _questionsCache.map(q => { const c = { ...q }; c.question_tags = qtMap.get(c.id) || []; return c; });
  }
  const questions = [];
  const updates = [];
  await dbQuestions.iterate((v, key) => {
    const question = _normalizeQuestionRecord(v, key);
    if (!question) return;
    if (_needsNormalization(v, question)) updates.push(question);
    if (!question.deleted_at) questions.push({ ...question });
  });
  for (const question of updates) await dbQuestions.setItem(question.id, question);
  _questionsCache = questions.sort((a, b) => _toMillis(b.created_at) - _toMillis(a.created_at));
  _questionsDirty = false;
  const qtMap = await _buildTagIndex();
  for (const q of _questionsCache) q.question_tags = qtMap.get(q.id) || [];
  return _questionsCache.map(q => ({ ...q }));
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
  return questions.sort((a, b) => _toMillis(b.deleted_at) - _toMillis(a.deleted_at));
}

async function dbCreateQuestion(questionFile, answerFile, selectedTagIds, layoutType, blankFile, versions, bookInfo) {
  const id = generateId();
  
  let qImg = null;
  if (questionFile) qImg = await compressImage(questionFile);
  let aImg = null;
  if (answerFile) aImg = await compressImage(answerFile);
  let bImg = null;
  if (blankFile) bImg = await compressImage(blankFile);
  
  // 远程同步：上传图片到服务器
  let qImgUrl = qImg, aImgUrl = aImg, bImgUrl = bImg;
  if (_syncEnabled) {
    if (qImg) qImgUrl = await _uploadImage(qImg);
    if (aImg) aImgUrl = await _uploadImage(aImg);
    if (bImg) bImgUrl = await _uploadImage(bImg);
  }
  
  const now = _nowIso();
  const question = {
    id,
    question_image_url: qImgUrl ? _normalizeServerAssetUrl(qImgUrl) : null,
    answer_image_url: aImgUrl ? _normalizeServerAssetUrl(aImgUrl) : null,
    question_image_blank_url: bImgUrl ? _normalizeServerAssetUrl(bImgUrl) : null,
    layout_type: layoutType || 0,
    versions: versions || [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
    semantic_summary: "",
    ai_metadata: {},
    book_name: (bookInfo && bookInfo.book_name) || "",
    page_number: (bookInfo && bookInfo.page_number) || "",
    question_number: (bookInfo && bookInfo.question_number) || ""
  };
  await dbQuestions.setItem(id, question);
  _invalidateQuestionsCache();

  for (const tagId of selectedTagIds) {
    await dbQuestionTags.setItem(`${id}_${tagId}`, { question_id: id, tag_id: tagId });
  }
  _invalidateTagIndex();
  return question;
}



async function dbSoftDeleteQuestion(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return;
  const now = _nowIso();
  await dbQuestions.setItem(questionId, { ...q, deleted_at: now, updated_at: now });
  _invalidateTagIndex();
  _invalidateQuestionsCache();
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
  _invalidateQuestionsCache();
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
  _invalidateQuestionsCache();
  await _markSimilarLinksForQuestionDeleted(questionId, now);
}

async function dbAddTagToQuestion(questionId, tagId) {
  await dbQuestionTags.setItem(`${questionId}_${tagId}`, { question_id: questionId, tag_id: tagId });
  const question = await dbQuestions.getItem(questionId);
  if (question) {
    await dbQuestions.setItem(questionId, { ...question, updated_at: _nowIso() });
    _invalidateQuestionsCache();
  }
  _invalidateTagIndex();
}

async function dbRemoveTagFromQuestion(questionId, tagId) {
  await dbQuestionTags.removeItem(`${questionId}_${tagId}`);
  const question = await dbQuestions.getItem(questionId);
  if (question) {
    await dbQuestions.setItem(questionId, { ...question, updated_at: _nowIso() });
    _invalidateQuestionsCache();
  }
  _invalidateTagIndex();
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
  _invalidateQuestionsCache();
  return question;
}

// 更新题目的版本归属
async function dbUpdateQuestionVersions(questionId, versions) {
  const question = await dbQuestions.getItem(questionId);
  if (!question) throw new Error('题目不存在');
  const now = _nowIso();
  await dbQuestions.setItem(questionId, {
    ...question,
    versions: versions || [],
    updated_at: now
  });
  _invalidateQuestionsCache();
  return question;
}

// 更新题目的书本信息
async function dbUpdateQuestionBookInfo(questionId, bookInfo) {
  const question = await dbQuestions.getItem(questionId);
  if (!question) throw new Error('题目不存在');
  const now = _nowIso();
  await dbQuestions.setItem(questionId, {
    ...question,
    book_name: (bookInfo && bookInfo.book_name) || "",
    page_number: (bookInfo && bookInfo.page_number) || "",
    question_number: (bookInfo && bookInfo.question_number) || "",
    updated_at: now
  });
  _invalidateQuestionsCache();
  return question;
}

// 获取所有不重复的书名（用于筛选）
async function dbGetAllBookNames() {
  const bookNames = new Set();
  await dbQuestions.iterate((q) => {
    if (q && !q.deleted_at && q.book_name) bookNames.add(q.book_name);
  });
  return Array.from(bookNames).sort();
}

// 从所有题目中移除某个版本 ID
async function dbRemoveVersionFromAllQuestions(versionId) {
  const updates = [];
  await dbQuestions.iterate((q, key) => {
    if (q && q.versions && q.versions.includes(versionId)) {
      updates.push({ id: q.id, question: q });
    }
  });
  const now = _nowIso();
  for (const item of updates) {
    await dbQuestions.setItem(item.id, {
      ...item.question,
      versions: item.question.versions.filter(v => v !== versionId),
      updated_at: now
    });
  }
  _invalidateQuestionsCache();
}

async function _markSimilarLinksForQuestionDeleted(questionId, now = _nowIso()) {
  const updates = [];
  await dbSimilarQuestionLinks.iterate((raw, key) => {
    const link = _normalizeSimilarLinkRecord(raw, key);
    if (!link) return;
    if (link.question_id === questionId || link.similar_question_id === questionId) {
      updates.push({ key: _similarLinkKey(link.question_id, link.similar_question_id), link: { ...link, deleted_at: now, updated_at: now } });
    }
  });
  for (const item of updates) await dbSimilarQuestionLinks.setItem(item.key, item.link);
}

async function dbGetAllSimilarLinks() {
  const links = [];
  const updates = [];
  await dbSimilarQuestionLinks.iterate((raw, key) => {
    const link = _normalizeSimilarLinkRecord(raw, key);
    if (!link) return;
    const normalizedKey = _similarLinkKey(link.question_id, link.similar_question_id);
    if (normalizedKey && (normalizedKey !== key || _needsNormalization(raw, link))) {
      updates.push({ oldKey: key, key: normalizedKey, link });
    }
    links.push(link);
  });
  for (const item of updates) {
    if (item.oldKey !== item.key) await dbSimilarQuestionLinks.removeItem(item.oldKey);
    await dbSimilarQuestionLinks.setItem(item.key, item.link);
  }
  return links;
}

async function dbGetSimilarQuestionIds(questionId) {
  const ids = [];
  const links = await dbGetAllSimilarLinks();
  for (const link of links) {
    if (link.deleted_at) continue;
    if (link.question_id === questionId) ids.push(link.similar_question_id);
    else if (link.similar_question_id === questionId) ids.push(link.question_id);
  }
  return Array.from(new Set(ids));
}

async function dbAddSimilarQuestionLinks(questionId, targetIds) {
  const now = _nowIso();
  for (const targetId of Array.from(new Set(targetIds || []))) {
    const key = _similarLinkKey(questionId, targetId);
    if (!key) continue;
    const pair = _normalizeSimilarLinkPair(questionId, targetId);
    const existing = _normalizeSimilarLinkRecord(await dbSimilarQuestionLinks.getItem(key), key);
    await dbSimilarQuestionLinks.setItem(key, {
      question_id: pair[0],
      similar_question_id: pair[1],
      created_at: existing?.created_at || now,
      updated_at: now,
      deleted_at: null
    });
  }
  const question = await dbQuestions.getItem(questionId);
  if (question) await dbQuestions.setItem(questionId, { ...question, updated_at: now });
  _invalidateQuestionsCache();
}

async function dbRemoveSimilarQuestionLink(questionId, targetId) {
  const key = _similarLinkKey(questionId, targetId);
  if (!key) return;
  const link = _normalizeSimilarLinkRecord(await dbSimilarQuestionLinks.getItem(key), key);
  if (!link) return;
  const now = _nowIso();
  await dbSimilarQuestionLinks.setItem(key, { ...link, deleted_at: now, updated_at: now });
  const question = await dbQuestions.getItem(questionId);
  if (question) await dbQuestions.setItem(questionId, { ...question, updated_at: now });
  _invalidateQuestionsCache();
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
    const questionIds = [];
    await dbPaperQuestions.iterate((pq) => { if (pq.paper_id === p.id) questionIds.push(pq.question_id); });
    for (const questionId of questionIds) {
      const question = _normalizeQuestionRecord(await dbQuestions.getItem(questionId), questionId);
      if (question && !question.deleted_at && !question.purged_at) count++;
    }
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
    const qtEntries = [];
    await dbQuestionTags.iterate((qt) => { if (selectedTagIds.includes(qt.tag_id)) qtEntries.push(qt); });
    await Promise.all(qtEntries.map(async (qt) => {
      const q = await dbQuestions.getItem(qt.question_id);
      if (q && !q.deleted_at) qIds.add(qt.question_id);
    }));
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
  
  const questions = await Promise.all(
    pqs.map(pq => dbQuestions.getItem(pq.question_id).then(q => _normalizeQuestionRecord(q, pq.question_id)))
  );
  
  const qtMap = await _buildTagIndex();
  const valid = questions.filter(q => q && !q.deleted_at);
  for (const q of valid) q.question_tags = qtMap.get(q.id) || [];
  return { paper, questions: valid };
}

// ========== 专题 CRUD ==========

function _normalizeTopicRecord(topic, key) {
  if (!topic || typeof topic !== 'object') return null;
  const next = { ...topic };
  if (!next.id && key) next.id = key;
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  if (next.deletedAt && !next.deleted_at) next.deleted_at = next.deletedAt;
  if (!next.description) next.description = '';
  return next;
}

function _normalizeTopicQuestionRecord(record, key) {
  if (!record || typeof record !== 'object') return null;
  const next = { ...record };
  if (!next.id && key) next.id = key;
  if (!next.teacher_comment) next.teacher_comment = '';
  if (!next.order_num) next.order_num = 0;
  return next;
}

async function dbGetAllTopics() {
  const topics = [];
  const updates = [];
  await dbTopics.iterate((v, key) => {
    const topic = _normalizeTopicRecord(v, key);
    if (!topic) return;
    if (_needsNormalization(v, topic)) updates.push(topic);
    if (!topic.deleted_at) topics.push(topic);
  });
  for (const topic of updates) await dbTopics.setItem(topic.id, topic);
  for (const t of topics) {
    let count = 0;
    await dbTopicQuestions.iterate((tq) => { if (tq.topic_id === t.id) count++; });
    t.question_count = count;
  }
  return topics.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function dbCreateTopic(name, description, questionIds) {
  const id = generateId();
  const now = _nowIso();
  const topic = { id, name, description: description || '', created_at: now, updated_at: now, deleted_at: null };
  await dbTopics.setItem(id, topic);
  if (questionIds && questionIds.length > 0) {
    let n = 1;
    for (const qId of questionIds) {
      await dbTopicQuestions.setItem(`${id}_${qId}`, { topic_id: id, question_id: qId, order_num: n++, teacher_comment: '' });
    }
  }
  return topic;
}

async function dbUpdateTopic(topicId, name, description) {
  const topic = await dbTopics.getItem(topicId);
  if (!topic) return;
  const now = _nowIso();
  await dbTopics.setItem(topicId, { ...topic, name, description: description || '', updated_at: now });
}

async function dbDeleteTopic(topicId) {
  const topic = await dbTopics.getItem(topicId);
  if (!topic) return;
  const now = _nowIso();
  await dbTopics.setItem(topicId, { ...topic, deleted_at: now, updated_at: now });
}

async function dbGetTopicQuestions(topicId) {
  const topic = _normalizeTopicRecord(await dbTopics.getItem(topicId), topicId);
  if (!topic || topic.deleted_at) return { topic: null, questions: [] };
  const tqList = [];
  await dbTopicQuestions.iterate((tq) => { if (tq.topic_id === topicId) tqList.push(tq); });
  tqList.sort((a, b) => a.order_num - b.order_num);
  const qtMap = await _buildTagIndex();
  const questions = [];
  for (const tq of tqList) {
    const q = _normalizeQuestionRecord(await dbQuestions.getItem(tq.question_id), tq.question_id);
    if (q && !q.deleted_at) {
      q.question_tags = qtMap.get(q.id) || [];
      q.teacher_comment = tq.teacher_comment || '';
      q.topic_question_id = tq.id;
      questions.push(q);
    }
  }
  return { topic, questions };
}

async function dbUpdateTopicQuestions(topicId, questionIds) {
  const oldKeys = [];
  await dbTopicQuestions.iterate((v, key) => { if (v.topic_id === topicId) oldKeys.push(key); });
  for (const key of oldKeys) await dbTopicQuestions.removeItem(key);
  let n = 1;
  for (const qId of questionIds || []) {
    await dbTopicQuestions.setItem(`${topicId}_${qId}`, { topic_id: topicId, question_id: qId, order_num: n++, teacher_comment: '' });
  }
}

async function dbAddQuestionToTopic(topicId, questionId) {
  const key = `${topicId}_${questionId}`;
  const existing = await dbTopicQuestions.getItem(key);
  if (existing) return;
  let maxOrder = 0;
  await dbTopicQuestions.iterate((tq) => { if (tq.topic_id === topicId && tq.order_num > maxOrder) maxOrder = tq.order_num; });
  await dbTopicQuestions.setItem(key, { topic_id: topicId, question_id: questionId, order_num: maxOrder + 1, teacher_comment: '' });
}

async function dbRemoveQuestionFromTopic(topicId, questionId) {
  await dbTopicQuestions.removeItem(`${topicId}_${questionId}`);
}

async function dbUpdateTopicQuestionComment(topicId, questionId, comment) {
  const key = `${topicId}_${questionId}`;
  const tq = await dbTopicQuestions.getItem(key);
  if (!tq) return;
  await dbTopicQuestions.setItem(key, { ...tq, teacher_comment: comment || '' });
}

async function _collectTopicQuestionIds(topicId) {
  const ids = [];
  await dbTopicQuestions.iterate((tq) => { if (tq.topic_id === topicId) ids.push(tq.question_id); });
  return ids;
}

async function _collectTopicQuestionDetails(topicId) {
  const details = [];
  await dbTopicQuestions.iterate((tq) => { if (tq.topic_id === topicId) details.push(tq); });
  details.sort((a, b) => a.order_num - b.order_num);
  return details;
}

async function _removeTopicQuestionsForTopic(topicId) {
  const keys = [];
  await dbTopicQuestions.iterate((v, key) => { if (v.topic_id === topicId) keys.push(key); });
  for (const key of keys) await dbTopicQuestions.removeItem(key);
}

// ========== 题目笔记版本 CRUD ==========

function _normalizeQuestionNoteRecord(record, key) {
  if (!record || typeof record !== 'object') return null;
  const next = { ...record };
  if (!next.id && key) next.id = key;
  if (!next.text_note) next.text_note = '';
  if (!next.label) next.label = '';
  if (next.createdAt && !next.created_at) next.created_at = next.createdAt;
  if (next.updatedAt && !next.updated_at) next.updated_at = next.updatedAt;
  return next;
}

async function dbGetQuestionNotes(questionId) {
  const notes = [];
  await dbQuestionNotes.iterate((v, key) => {
    const note = _normalizeQuestionNoteRecord(v, key);
    if (note && note.question_id === questionId) notes.push(note);
  });
  return notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function dbAddQuestionNote(questionId, imageUrl, label, textNote) {
  const id = generateId();
  const now = _nowIso();
  const note = {
    id,
    question_id: questionId,
    note_image_url: imageUrl,
    label: label || '笔记',
    text_note: textNote || '',
    created_at: now,
    updated_at: now
  };
  await dbQuestionNotes.setItem(id, note);
  return note;
}

async function dbUpdateQuestionNote(noteId, updates) {
  const note = await dbQuestionNotes.getItem(noteId);
  if (!note) return;
  const now = _nowIso();
  await dbQuestionNotes.setItem(noteId, { ...note, ...updates, updated_at: now });
}

async function dbDeleteQuestionNote(noteId) {
  await dbQuestionNotes.removeItem(noteId);
}

async function dbGetLastViewedNote(questionId) {
  return localStorage.getItem('lastNoteVersion_' + questionId) || null;
}

function dbSetLastViewedNote(questionId, noteId) {
  localStorage.setItem('lastNoteVersion_' + questionId, noteId);
}

async function _migrateQuestionNotes() {
  try {
    await dbQuestions.iterate(async (q, key) => {
      if (!q || q.deleted_at) return;
      if (q.semantic_summary === "AI 正在分析中...") {
        await dbQuestions.setItem(q.id, { ...q, semantic_summary: "" });
      }
      const notes = await dbGetQuestionNotes(q.id);
      if (notes.length === 0 && q.question_image_url) {
        await dbAddQuestionNote(q.id, q.question_image_url, '笔记 v1', '');
      }
    });
  } catch (e) { console.error("迁移失败:", e); }
}

async function _removeQuestionNotesForQuestion(questionId) {
  const notes = await dbGetQuestionNotes(questionId);
  for (const note of notes) {
    await dbQuestionNotes.removeItem(note.id);
  }
}

async function _collectQuestionNoteDetails(questionId) {
  return await dbGetQuestionNotes(questionId);
}

// ========== 待处理照片 CRUD ==========

async function dbGetPendingPhotos() {
  const photos = [];
  await dbPendingPhotos.iterate((v, key) => {
    if (v && !v.processed) photos.push(v);
  });
  return photos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function dbGetPendingPhotosGrouped() {
  const photos = await dbGetPendingPhotos();
  const groups = {};
  photos.forEach(p => {
    const gid = p.group_id || "未分组";
    if (!groups[gid]) groups[gid] = [];
    groups[gid].push(p);
  });
  return groups;
}

async function dbAddPendingPhoto(imageUrl, groupId) {
  const id = generateId();
  const now = _nowIso();
  const photo = {
    id,
    image_url: imageUrl,
    group_id: groupId || "未分组",
    created_at: now,
    processed: false,
    question_id: null
  };
  await dbPendingPhotos.setItem(id, photo);
  return photo;
}

async function dbMarkPendingPhotoProcessed(photoId, questionId) {
  const photo = await dbPendingPhotos.getItem(photoId);
  if (!photo) return;
  await dbPendingPhotos.setItem(photoId, {
    ...photo,
    processed: true,
    question_id: questionId,
    updated_at: _nowIso()
  });
}

async function dbBatchMarkGroupProcessed(groupId, questionId) {
  const photos = await dbGetPendingPhotos();
  for (const p of photos) {
    if (p.group_id === groupId) {
      await dbMarkPendingPhotoProcessed(p.id, questionId);
    }
  }
}

async function dbDeletePendingPhoto(photoId) {
  await dbPendingPhotos.removeItem(photoId);
}

async function dbGetPendingPhotoCount() {
  let count = 0;
  await dbPendingPhotos.iterate((v) => { if (v && !v.processed) count++; });
  return count;
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

// ========== 同步数据完整性检测 ==========

let _onSyncDataWarning = null;
function setOnSyncDataWarning(fn) { _onSyncDataWarning = fn; }

async function collectDataFingerprint() {
  let questions = 0, tags = 0, questionTags = 0, papers = 0, teachingNodes = 0;
  await dbQuestions.iterate(() => questions++);
  await dbTags.iterate(() => tags++);
  await dbQuestionTags.iterate(() => questionTags++);
  await dbPapers.iterate(() => papers++);
  await dbTeachingNodes.iterate(() => teachingNodes++);
  return { questions, tags, questionTags, papers, teachingNodes };
}

function checkSyncDataIntegrity(before, after) {
  const warnings = [];
  const tables = ['questions', 'tags', 'questionTags', 'papers', 'teachingNodes'];
  for (const table of tables) {
    const b = before[table] || 0;
    const a = after[table] || 0;
    if (b > 0 && a < b) {
      const ratio = (b - a) / b;
      if (ratio >= 0.1 || (b > 0 && a === 0)) {
        warnings.push({
          table,
          before: b,
          after: a,
          lost: b - a,
          severity: ratio >= 0.5 || a === 0 ? 'critical' : 'warning'
        });
      }
    }
  }
  return { passed: warnings.length === 0, warnings };
}

function _checkVersionsDiscard(localQ, remoteQ) {
  if (!localQ || !localQ.versions || localQ.versions.length === 0) return null;
  const remoteVersions = remoteQ.versions || [];
  if (remoteVersions.length === 0) {
    return {
      table: 'versions',
      before: localQ.versions.length,
      after: 0,
      lost: localQ.versions.length,
      severity: 'critical',
      detail: '题目 ' + localQ.id + ' 的版本信息丢失'
    };
  }
  return null;
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
      versions: question.versions || [],
      created_at: question.created_at || question.updated_at || _nowIso(),
      updated_at: question.updated_at || question.created_at || _nowIso(),
      deleted_at: question.deleted_at || null,
      purged_at: question.purged_at || null,
      user_comment: question.user_comment || '',
      semantic_summary: question.semantic_summary || '',
      ai_metadata: question.ai_metadata || {},
      book_name: question.book_name || '',
      page_number: question.page_number || '',
      question_number: question.question_number || '',
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

  const similarLinks = [];
  const similarUpdates = [];
  await dbSimilarQuestionLinks.iterate((rawLink, key) => {
    const link = _normalizeSimilarLinkRecord(rawLink, key);
    if (!link) return;
    const normalizedKey = _similarLinkKey(link.question_id, link.similar_question_id);
    if (normalizedKey && (normalizedKey !== key || _needsNormalization(rawLink, link))) {
      similarUpdates.push({ oldKey: key, key: normalizedKey, link });
    }
    similarLinks.push({
      question_id: link.question_id,
      similar_question_id: link.similar_question_id,
      created_at: link.created_at || link.updated_at || _nowIso(),
      updated_at: link.updated_at || link.created_at || _nowIso(),
      deleted_at: link.deleted_at || null
    });
  });
  for (const item of similarUpdates) {
    if (item.oldKey !== item.key) await dbSimilarQuestionLinks.removeItem(item.oldKey);
    await dbSimilarQuestionLinks.setItem(item.key, item.link);
  }

  const pending_link_list = JSON.parse(localStorage.getItem('pendingLinkList') || '[]');

  const topics = [];
  const topicUpdates = [];
  await dbTopics.iterate((rawTopic, key) => {
    const topic = _normalizeTopicRecord(rawTopic, key);
    if (!topic) return;
    if (_needsNormalization(rawTopic, topic)) topicUpdates.push(topic);
    topics.push(topic);
  });
  for (const topic of topicUpdates) await dbTopics.setItem(topic.id, topic);
  const topicPayload = [];
  for (const topic of topics) {
    topicPayload.push({
      id: topic.id,
      name: topic.name,
      description: topic.description || '',
      created_at: topic.created_at || topic.updated_at || _nowIso(),
      updated_at: topic.updated_at || topic.created_at || _nowIso(),
      deleted_at: topic.deleted_at || null,
      topic_questions: await _collectTopicQuestionDetails(topic.id)
    });
  }

  const questionNotes = [];
  await dbQuestionNotes.iterate((v) => { questionNotes.push(v); });

  return { tags, questions: questionPayload, papers: paperPayload, similar_links: similarLinks, pending_link_list, topics: topicPayload, question_notes: questionNotes };
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
  _invalidateQuestionsCache();
  _invalidateTagIndex();
  const fpBefore = await collectDataFingerprint();
  const syncWarnings = [];
  try {
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
      versions: question.versions !== undefined
        ? question.versions
        : (localQuestion ? localQuestion.versions || [] : []),
      created_at: question.created_at || question.updated_at || _nowIso(),
      updated_at: question.updated_at || question.created_at || _nowIso(),
      deleted_at: question.deleted_at || null,
      purged_at: question.purged_at || null,
      user_comment: question.user_comment || '',
      semantic_summary: question.semantic_summary || '',
      ai_metadata: question.ai_metadata || {},
      book_name: question.book_name !== undefined ? question.book_name : (localQuestion ? localQuestion.book_name || '' : ''),
      page_number: question.page_number !== undefined ? question.page_number : (localQuestion ? localQuestion.page_number || '' : ''),
      question_number: question.question_number !== undefined ? question.question_number : (localQuestion ? localQuestion.question_number || '' : '')
    };
    // 检测版本信息丢弃
    const versionsWarning = _checkVersionsDiscard(localQuestion, nextQuestion);
    if (versionsWarning) syncWarnings.push(versionsWarning);
    if (_isRemoteNewer(nextQuestion, localQuestion)) {
      if (nextQuestion.purged_at) {
        await dbQuestions.removeItem(question.id);
        await _replaceQuestionTags(question.id, []);
        await _removeSimilarLinksForQuestion(question.id);
        const pqKeys = [];
        await dbPaperQuestions.iterate((value, key) => {
          if (value.question_id === question.id) pqKeys.push(key);
        });
        for (const key of pqKeys) await dbPaperQuestions.removeItem(key);
        continue;
      }
      await dbQuestions.setItem(question.id, nextQuestion);
      if (question.tag_ids !== undefined) await _replaceQuestionTags(question.id, question.tag_ids);
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

  for (const link of snapshot.similar_links || []) {
    const nextLink = _normalizeSimilarLinkRecord(link);
    if (!nextLink) continue;
    const key = _similarLinkKey(nextLink.question_id, nextLink.similar_question_id);
    const localLink = _normalizeSimilarLinkRecord(await dbSimilarQuestionLinks.getItem(key), key);
    if (_isRemoteNewer(nextLink, localLink)) {
      await dbSimilarQuestionLinks.setItem(key, nextLink);
    }
  }

  for (const topic of snapshot.topics || []) {
    const localTopic = await dbTopics.getItem(topic.id);
    const nextTopic = {
      id: topic.id,
      name: topic.name,
      description: topic.description || '',
      created_at: topic.created_at || topic.updated_at || _nowIso(),
      updated_at: topic.updated_at || topic.created_at || _nowIso(),
      deleted_at: topic.deleted_at || null
    };
    if (_isRemoteNewer(nextTopic, localTopic)) {
      await dbTopics.setItem(topic.id, nextTopic);
      if (topic.topic_questions) {
        await _removeTopicQuestionsForTopic(topic.id);
        for (const tq of topic.topic_questions) {
          const key = `${topic.id}_${tq.question_id}`;
          await dbTopicQuestions.setItem(key, {
            topic_id: topic.id,
            question_id: tq.question_id,
            order_num: tq.order_num || 0,
            teacher_comment: tq.teacher_comment || ''
          });
        }
      }
    }
  }

  for (const note of snapshot.question_notes || []) {
    const localNote = await dbQuestionNotes.getItem(note.id);
    const nextNote = {
      id: note.id,
      question_id: note.question_id,
      note_image_url: note.note_image_url,
      label: note.label || '',
      text_note: note.text_note || '',
      created_at: note.created_at || note.updated_at || _nowIso(),
      updated_at: note.updated_at || note.created_at || _nowIso()
    };
    if (_isRemoteNewer(nextNote, localNote)) {
      await dbQuestionNotes.setItem(note.id, nextNote);
    }
  }

  if (Array.isArray(snapshot.pending_link_list)) {
    localStorage.setItem('pendingLinkList', JSON.stringify(snapshot.pending_link_list));
  }

  const fpAfter = await collectDataFingerprint();
  const integrity = checkSyncDataIntegrity(fpBefore, fpAfter);
  if (!integrity.passed) syncWarnings.push(...integrity.warnings);
  if (syncWarnings.length > 0) {
    console.warn('[Sync] 数据完整性警告:', syncWarnings);
    if (typeof _onSyncDataWarning === 'function') _onSyncDataWarning(syncWarnings);
  }
  return { passed: syncWarnings.length === 0, warnings: syncWarnings };

  } finally {
    _invalidateQuestionsCache();
    _invalidateTagIndex();
  }
}

async function dbFinalizeSuccessfulSync(applied) {
  for (const questionId of applied?.purged_question_ids || []) {
    await dbQuestions.removeItem(questionId);
    await _replaceQuestionTags(questionId, []);
    await _removeSimilarLinksForQuestion(questionId);
    const pqKeys = [];
    await dbPaperQuestions.iterate((value, key) => {
      if (value.question_id === questionId) pqKeys.push(key);
    });
    for (const key of pqKeys) await dbPaperQuestions.removeItem(key);
  }
  if (applied?.purged_question_ids?.length) {
    _invalidateQuestionsCache();
    _invalidateTagIndex();
  }
}

async function _removeSimilarLinksForQuestion(questionId) {
  const keys = [];
  await dbSimilarQuestionLinks.iterate((value, key) => {
    const link = _normalizeSimilarLinkRecord(value, key);
    if (link && (link.question_id === questionId || link.similar_question_id === questionId)) keys.push(key);
  });
  for (const key of keys) await dbSimilarQuestionLinks.removeItem(key);
}

async function dbClearAllData() {
  await dbQuestions.clear();
  await dbTags.clear();
  await dbQuestionTags.clear();
  await dbPapers.clear();
  await dbPaperQuestions.clear();
  await dbSimilarQuestionLinks.clear();
  await dbTopics.clear();
  await dbTopicQuestions.clear();
  await dbQuestionNotes.clear();
  await dbPendingPhotos.clear();
  await dbNodeQuestions.clear();
  _invalidateQuestionsCache();
  _invalidateTagIndex();
}

async function dbReplaceWithRemoteSnapshot(snapshot) {
  await dbClearAllData();
  await dbApplyRemoteSnapshot(snapshot);
}

// ========== PDF 生成 ==========

let _pdfFontBase64 = null;
let _pdfFontLoading = null;

async function generatePDF(questions, options = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 15, maxW = W - M * 2;
  const { mode = 'single', spacing = 'none', spacingCm = 5, title = '', noSave = false } = options;
  const spcMm = spacing !== 'none' ? spacingCm * 10 : 0;

  // 加载中文字体（全局缓存 base64，每次新 doc 都重新注册）
  async function _loadFontBase64() {
    if (_pdfFontBase64 !== null) return _pdfFontBase64;
    if (_pdfFontLoading) return await _pdfFontLoading;
    _pdfFontLoading = (async () => {
      for (const p of ['fonts/NotoSansSC-Regular.ttf', './fonts/NotoSansSC-Regular.ttf', '/public/fonts/NotoSansSC-Regular.ttf']) {
        try {
          const resp = await fetch(p);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const b64 = btoa(binary);
            _pdfFontBase64 = b64;
            return b64;
          }
        } catch (e) {}
      }
      // fallback: 尝试 XHR
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'fonts/NotoSansSC-Regular.ttf', false);
        xhr.overrideMimeType('text/plain; charset=x-user-defined');
        xhr.send();
        if (xhr.status === 0 || xhr.status === 200) {
          const binary = xhr.responseText;
          const b64 = btoa(binary);
          _pdfFontBase64 = b64;
          return b64;
        }
      } catch (e) {}
      return null;
    })();
    return await _pdfFontLoading;
  }
  const fontB64 = await _loadFontBase64();
  let CN = 'helvetica';
  if (fontB64) {
    doc.addFileToVFS('NotoSansSC-Regular.ttf', fontB64);
    doc.addFont('NotoSansSC-Regular.ttf', 'NotoSC', 'normal');
    CN = 'NotoSC';
  } else {
    console.warn('中文字体加载失败，使用回退字体');
  }

  function loadImg(dataUrl) {
    return new Promise((resolve) => {
      if (!dataUrl || dataUrl.length < 50) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 5000);
      img.src = dataUrl;
    });
  }

  function drawLabel(text, x, y, size) {
    doc.setFontSize(size || 10);
    doc.setFont(CN, 'normal');
    doc.text(text, x, y);
  }

  function drawCentered(text, y, size) {
    doc.setFontSize(size || 16);
    doc.setFont(CN, 'normal');
    doc.text(text, W / 2, y, { align: 'center' });
  }

  function placeImg(dataUrl, x, y, availW, maxH) {
    return new Promise((resolve) => {
      loadImg(dataUrl).then(img => {
        if (!img) { resolve(0); return; }
        const aH = maxH || (H - M - y);
        const r = Math.min(availW / img.width, aH / img.height, 1);
        const w = img.width * r, h = img.height * r;
        doc.addImage(dataUrl, 'JPEG', x, y, w, h);
        resolve(h);
      });
    });
  }

  function estH(dataUrl, availW) {
    return new Promise((resolve) => {
      loadImg(dataUrl).then(img => {
        if (!img) { resolve(0); return; }
        resolve(img.height * Math.min(availW / img.width, 1));
      });
    });
  }

  function addSpacing() {
    if (spcMm > 0) {
      doc.setDrawColor(200); doc.setLineDash([3, 3]);
      doc.line(M, y, W - M, y); doc.setLineDash([]);
      y += spcMm;
    }
  }

  // 标题
  if (title) {
    drawCentered(title, M + 5, 18);
    drawCentered(`共 ${questions.length} 题`, M + 13, 11);
  }
  let y = title ? M + 20 : M;

  // ===== 单栏模式 =====
  if (mode === 'single') {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (y > H - M - 30) { doc.addPage(); y = M; }
      drawLabel(`第 ${i + 1} 题`, M, y, 11);
      y += 5;
      y += await placeImg(q.question_image_url, M, y, maxW) + 2;
      if (q.answer_image_url) {
        if (y + 20 > H - M) { doc.addPage(); y = M; }
        drawLabel('答案:', M, y, 9);
        y += 4;
        const aw = maxW * 0.8;
        y += await placeImg(q.answer_image_url, M + (maxW - aw) / 2, y, aw) + 2;
      }
      addSpacing();
    }
  }

  // ===== 双栏模式 =====
  else if (mode === 'double') {
    const halfW = (maxW - 4) / 2;
    let i = 0;
    while (i < questions.length) {
      const q = questions[i];
      const nextQ = questions[i + 1];
      if (y > H - M - 30) { doc.addPage(); y = M; }

      if (nextQ) {
        const h1 = await estH(q.question_image_url, halfW);
        const h2 = await estH(nextQ.question_image_url, halfW);
        const labelH = 6;
        if (h1 > 0 && h2 > 0 && y + Math.max(h1, h2) + labelH + 2 <= H - M) {
          drawLabel(`第 ${i + 1} 题`, M, y, 10);
          drawLabel(`第 ${i + 2} 题`, M + halfW + 4, y, 10);
          y += labelH;
          const usedH = Math.max(
            await placeImg(q.question_image_url, M, y, halfW, H - M - y),
            await placeImg(nextQ.question_image_url, M + halfW + 4, y, halfW, H - M - y)
          );
          y += usedH + 2;
          // 答案
          const a1 = q.answer_image_url, a2 = nextQ.answer_image_url;
          if (a1 || a2) {
            const ah1 = a1 ? await estH(a1, halfW) : 0;
            const ah2 = a2 ? await estH(a2, halfW) : 0;
            const ansNeedH = Math.max(ah1, ah2) + 8;
            if (y + ansNeedH <= H - M && ah1 > 0 && ah2 > 0) {
              drawLabel('答案:', M, y, 9);
              if (a2) drawLabel('答案:', M + halfW + 4, y, 9);
              y += 5;
              y += Math.max(
                a1 ? await placeImg(a1, M, y, halfW, H - M - y) : 0,
                a2 ? await placeImg(a2, M + halfW + 4, y, halfW, H - M - y) : 0
              ) + 2;
            } else {
              if (a1) { if (y + ah1 + 7 > H - M) { doc.addPage(); y = M; } drawLabel('答案:', M, y, 9); y += 5; y += await placeImg(a1, M, y, halfW, H - M - y) + 2; }
              if (a2) { if (y + ah2 + 7 > H - M) { doc.addPage(); y = M; } drawLabel('答案:', M, y, 9); y += 5; y += await placeImg(a2, M, y, halfW, H - M - y) + 2; }
            }
          }
          i += 2; addSpacing(); continue;
        }
      }
      // 单题 fallback
      drawLabel(`第 ${i + 1} 题`, M, y, 11);
      y += 5;
      y += await placeImg(q.question_image_url, M, y, maxW) + 2;
      if (q.answer_image_url) {
        if (y + 15 > H - M) { doc.addPage(); y = M; }
        drawLabel('答案:', M, y, 9); y += 4;
        y += await placeImg(q.answer_image_url, M, y, maxW * 0.8) + 2;
      }
      addSpacing(); i++;
    }
  }

  // ===== 分开模式 =====
  else if (mode === 'separate') {
    for (let i = 0; i < questions.length; i++) {
      if (y > H - M - 20) { doc.addPage(); y = M; }
      drawLabel(`第 ${i + 1} 题`, M, y, 11);
      y += 5;
      y += await placeImg(questions[i].question_image_url, M, y, maxW) + 2;
      if (spcMm > 0) y += spcMm;
    }
    doc.addPage(); y = M;
    drawCentered('参考答案', y, 16); y += 10;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.answer_image_url) continue;
      if (y + 15 > H - M) { doc.addPage(); y = M; }
      drawLabel(`第 ${i + 1} 题`, M, y, 10);
      y += 5;
      y += await placeImg(q.answer_image_url, M, y, maxW * 0.8) + 3;
    }
  }

  if (noSave) return doc;

  // 保存
  const fileName = `${title || '题库导出'}.pdf`;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative && window.Capacitor?.Plugins?.Filesystem) {
    const pdfBase64 = doc.output('dataurlstring').split(',')[1];
    const folder = (typeof window.getExportFolder === 'function') ? window.getExportFolder() : '';
    const filePath = folder ? `${folder}/${fileName}` : fileName;
    try {
      await window.Capacitor.Plugins.Filesystem.writeFile({ path: filePath, data: pdfBase64, directory: 'DOCUMENTS' });
      alert('PDF 已保存: DOCUMENTS/' + filePath);
    } catch (e) { alert('保存失败: ' + e.message); }
  } else {
    doc.save(fileName);
  }
}

async function generatePaperPDF(paperId) {
  const { paper, questions } = await dbGetPaperQuestions(paperId);
  if (!paper) { alert('试卷不存在'); return; }
  await generatePDF(questions, { mode: 'merged', title: paper.name });
}

// ========== 数据导入/导出 ==========

async function exportAllData() {
  const data = { questions: [], tags: [], question_tags: [], papers: [], paper_questions: [], similar_question_links: [], pending_link_list: [], topics: [], topic_questions: [], question_notes: [], pending_photos: [], teaching_nodes: [], teaching_versions: [], node_questions: [] };
  await dbQuestions.iterate((v) => data.questions.push(v));
  await dbTags.iterate((v) => data.tags.push(v));
  await dbQuestionTags.iterate((v) => data.question_tags.push(v));
  await dbPapers.iterate((v) => data.papers.push(v));
  await dbPaperQuestions.iterate((v) => data.paper_questions.push(v));
  await dbSimilarQuestionLinks.iterate((v) => data.similar_question_links.push(v));
  await dbTopics.iterate((v) => data.topics.push(v));
  await dbTopicQuestions.iterate((v) => data.topic_questions.push(v));
  await dbQuestionNotes.iterate((v) => data.question_notes.push(v));
  await dbPendingPhotos.iterate((v) => data.pending_photos.push(v));
  await dbTeachingNodes.iterate((v) => data.teaching_nodes.push(v));
  await dbTeachingVersions.iterate((v) => data.teaching_versions.push(v));
  await dbNodeQuestions.iterate((v) => data.node_questions.push(v));
  data.pending_link_list = JSON.parse(localStorage.getItem('pendingLinkList') || '[]');
  const jsonStr = JSON.stringify(data);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative && window.Capacitor?.Plugins?.Filesystem) {
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const fileName = `question-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      await window.Capacitor.Plugins.Filesystem.writeFile({ path: fileName, data: base64, directory: 'DOCUMENTS' });
      alert('备份已保存: DOCUMENTS/' + fileName);
    } catch (e) { alert('保存失败: ' + e.message); }
  } else {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `question-bank-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
}

async function importAllData(file) {
  const data = JSON.parse(await file.text());
  await Promise.all([
    ...(data.tags || []).map(t => dbTags.setItem(t.id, t)),
    ...(data.questions || []).map(q => dbQuestions.setItem(q.id, q)),
    ...(data.question_tags || []).map(qt => dbQuestionTags.setItem(`${qt.question_id}_${qt.tag_id}`, qt)),
    ...(data.papers || []).map(p => dbPapers.setItem(p.id, p)),
    ...(data.paper_questions || []).map(pq => dbPaperQuestions.setItem(`${pq.paper_id}_${pq.question_id}`, pq)),
    ...(data.topics || []).map(t => dbTopics.setItem(t.id, t)),
    ...(data.topic_questions || []).map(tq => dbTopicQuestions.setItem(`${tq.topic_id}_${tq.question_id}`, tq)),
    ...(data.question_notes || []).map(n => dbQuestionNotes.setItem(n.id, n)),
    ...(data.pending_photos || []).map(p => dbPendingPhotos.setItem(p.id, p)),
  ]);
  if (data.similar_question_links) {
    await Promise.all(data.similar_question_links.map(link => {
      const normalized = _normalizeSimilarLinkRecord(link);
      const key = normalized ? _similarLinkKey(normalized.question_id, normalized.similar_question_id) : null;
      if (key) return dbSimilarQuestionLinks.setItem(key, normalized);
    }));
  }
  if (data.pending_link_list) localStorage.setItem('pendingLinkList', JSON.stringify(data.pending_link_list));
  if (data.teaching_nodes) {
    await Promise.all(data.teaching_nodes.map(n => dbTeachingNodes.setItem(n.id, n)));
  }
  if (data.teaching_versions) {
    await Promise.all(data.teaching_versions.map(v => dbTeachingVersions.setItem(v.id, v)));
  }
  if (data.node_questions) {
    await Promise.all(data.node_questions.map(nq => dbNodeQuestions.setItem(nq.id, nq)));
  }
  _invalidateQuestionsCache();
  _invalidateTagIndex();
  return { questions: data.questions?.length || 0, tags: data.tags?.length || 0, papers: data.papers?.length || 0, topics: data.topics?.length || 0, question_notes: data.question_notes?.length || 0, pending_photos: data.pending_photos?.length || 0, teaching_nodes: data.teaching_nodes?.length || 0 };
}

// ========== 教学内容节点 (Teaching Nodes) ==========

async function dbCreateTeachingNode(node) {
  const now = _nowIso();
  const record = {
    id: node.id || generateId(),
    chapter: node.chapter || '',
    subject: node.subject || '物理',
    name: node.name || '',
    difficulty: node.difficulty || '基础',
    key_concept: node.key_concept || '',
    diagram: node.diagram || '',
    current_version_id: node.current_version_id || null,
    created_at: now,
    updated_at: now
  };
  await dbTeachingNodes.setItem(record.id, record);
  return record;
}

async function dbGetTeachingNode(id) {
  return await dbTeachingNodes.getItem(id);
}

async function dbGetTeachingNodesByStatus(status) {
  const result = [];
  await dbTeachingNodes.iterate((node) => {
    if (node && node.status === status) result.push(node);
  });
  return result;
}

async function dbGetTeachingNodesByChapter(chapter) {
  const result = [];
  await dbTeachingNodes.iterate((node) => {
    if (node && node.chapter === chapter) result.push(node);
  });
  return result;
}

async function dbGetAllTeachingNodes() {
  const result = [];
  await dbTeachingNodes.iterate((node) => {
    if (node) result.push(node);
  });
  result.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return result;
}

async function dbUpdateTeachingNode(id, updates) {
  const node = await dbTeachingNodes.getItem(id);
  if (!node) return null;
  const updated = { ...node, ...updates, updated_at: _nowIso() };
  await dbTeachingNodes.setItem(id, updated);
  return updated;
}

async function dbDeleteTeachingNode(id) {
  await dbTeachingNodes.removeItem(id);
  const verKeys = [];
  await dbTeachingVersions.iterate((v, key) => { if (v && v.node_id === id) verKeys.push(key); });
  for (const key of verKeys) await dbTeachingVersions.removeItem(key);
  const nqKeys = [];
  await dbNodeQuestions.iterate((v, key) => { if (v && v.node_id === id) nqKeys.push(key); });
  for (const key of nqKeys) await dbNodeQuestions.removeItem(key);
}

// ========== 教学版本 (Teaching Versions) ==========

async function dbCreateVersion(nodeId, versionData) {
  const now = _nowIso();
  const existingVersions = await dbGetVersionsByNode(nodeId);
  const versionNum = existingVersions.length > 0 ? Math.max(...existingVersions.map(v => v.version_num)) + 1 : 1;
  const record = {
    id: versionData.id || generateId(),
    node_id: nodeId,
    version_num: versionData.version_num || versionNum,
    model_name: versionData.model_name || '',
    status: versionData.status || 'PENDING',
    content_markdown: versionData.content_markdown || '',
    content_json: versionData.content_json || null,
    drawings: versionData.drawings || {},
    error_msg: versionData.error_msg || null,
    retry_count: versionData.retry_count || 0,
    is_current: versionData.is_current || false,
    created_at: now,
    updated_at: now
  };
  await dbTeachingVersions.setItem(record.id, record);
  if (record.is_current) {
    await dbTeachingNodes.setItem(nodeId, { ...(await dbTeachingNodes.getItem(nodeId)), current_version_id: record.id, updated_at: now });
  }
  return record;
}

async function dbGetVersionsByNode(nodeId) {
  const result = [];
  await dbTeachingVersions.iterate((v) => {
    if (v && v.node_id === nodeId) result.push(v);
  });
  result.sort((a, b) => (a.version_num || 0) - (b.version_num || 0));
  return result;
}

async function dbGetVersion(versionId) {
  return await dbTeachingVersions.getItem(versionId);
}

async function dbUpdateVersion(versionId, updates) {
  const version = await dbTeachingVersions.getItem(versionId);
  if (!version) return null;
  const updated = { ...version, ...updates, updated_at: _nowIso() };
  await dbTeachingVersions.setItem(versionId, updated);
  return updated;
}

async function dbDeleteVersion(versionId) {
  const version = await dbTeachingVersions.getItem(versionId);
  if (!version) return;
  await dbTeachingVersions.removeItem(versionId);
  if (version.is_current) {
    const remaining = await dbGetVersionsByNode(version.node_id);
    const newCurrent = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    const node = await dbTeachingNodes.getItem(version.node_id);
    if (node) {
      await dbTeachingNodes.setItem(version.node_id, { ...node, current_version_id: newCurrent ? newCurrent.id : null, updated_at: _nowIso() });
    }
    if (newCurrent) {
      await dbTeachingVersions.setItem(newCurrent.id, { ...newCurrent, is_current: true });
    }
  }
}

async function dbSetCurrentVersion(nodeId, versionId) {
  const versions = await dbGetVersionsByNode(nodeId);
  for (const v of versions) {
    if (v.is_current) {
      await dbTeachingVersions.setItem(v.id, { ...v, is_current: false });
    }
  }
  const version = await dbTeachingVersions.getItem(versionId);
  if (version) {
    await dbTeachingVersions.setItem(versionId, { ...version, is_current: true });
  }
  const node = await dbTeachingNodes.getItem(nodeId);
  if (node) {
    await dbTeachingNodes.setItem(nodeId, { ...node, current_version_id: versionId, updated_at: _nowIso() });
  }
}

async function migrateTeachingNodesToVersions() {
  const nodes = await dbGetAllTeachingNodes();
  let migrated = 0;
  for (const node of nodes) {
    if (node.current_version_id) continue;
    const hasOldContent = node.content_markdown || node.status !== 'PENDING';
    if (hasOldContent) {
      const version = await dbCreateVersion(node.id, {
        version_num: 1,
        status: node.status || 'PENDING',
        content_markdown: node.content_markdown || '',
        content_json: node.content_json || null,
        drawings: node.drawings || {},
        error_msg: node.error_msg || null,
        retry_count: node.retry_count || 0,
        is_current: true
      });
      const cleaned = { ...node };
      delete cleaned.status;
      delete cleaned.content_markdown;
      delete cleaned.content_json;
      delete cleaned.drawings;
      delete cleaned.error_msg;
      delete cleaned.retry_count;
      cleaned.current_version_id = version.id;
      cleaned.updated_at = _nowIso();
      await dbTeachingNodes.setItem(node.id, cleaned);
    } else {
      const version = await dbCreateVersion(node.id, {
        version_num: 1,
        status: 'PENDING',
        is_current: true
      });
      const cleaned = { ...node };
      delete cleaned.status;
      delete cleaned.content_markdown;
      delete cleaned.content_json;
      delete cleaned.drawings;
      delete cleaned.error_msg;
      delete cleaned.retry_count;
      cleaned.current_version_id = version.id;
      cleaned.updated_at = _nowIso();
      await dbTeachingNodes.setItem(node.id, cleaned);
    }
    migrated++;
  }
  return migrated;
}

// ========== 知识点↔题目关联 (Node Questions) ==========

async function dbLinkQuestionToNode(nodeId, questionId, module, order) {
  const id = generateId();
  const record = {
    id,
    node_id: nodeId,
    question_id: questionId,
    module: module || '',
    order: order || 0,
    created_at: _nowIso()
  };
  await dbNodeQuestions.setItem(id, record);
  return record;
}

async function dbUnlinkQuestionFromNode(nodeId, questionId) {
  const keysToRemove = [];
  await dbNodeQuestions.iterate((v, key) => {
    if (v && v.node_id === nodeId && v.question_id === questionId) keysToRemove.push(key);
  });
  for (const key of keysToRemove) await dbNodeQuestions.removeItem(key);
}

async function dbGetNodeQuestions(nodeId) {
  const result = [];
  await dbNodeQuestions.iterate((v) => {
    if (v && v.node_id === nodeId) result.push(v);
  });
  result.sort((a, b) => (a.order || 0) - (b.order || 0));
  const enriched = [];
  for (const nq of result) {
    const q = _normalizeQuestionRecord(await dbQuestions.getItem(nq.question_id), nq.question_id);
    if (q && !q.deleted_at) {
      enriched.push({ ...nq, question_data: q });
    }
  }
  return enriched;
}

async function dbGetQuestionNodes(questionId) {
  const result = [];
  await dbNodeQuestions.iterate((v) => {
    if (v && v.question_id === questionId) result.push(v);
  });
  return result;
}

async function dbGetAllNodeQuestions() {
  const result = [];
  await dbNodeQuestions.iterate((v) => { if (v) result.push(v); });
  return result;
}

// ========== 艾宾浩斯复习提醒 ==========

const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30];

async function dbEnableReview(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return null;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const updated = {
    ...q,
    review_enabled: true,
    review_next_date: tomorrow.toISOString().slice(0, 10),
    review_interval_index: 0,
    review_count: 0
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

async function dbDisableReview(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return null;
  const updated = {
    ...q,
    review_enabled: false,
    review_next_date: null,
    review_interval_index: 0,
    review_count: 0
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

async function dbCompleteReview(questionId) {
  const q = await dbQuestions.getItem(questionId);
  if (!q) return null;
  const idx = Math.min((q.review_interval_index || 0) + 1, EBBINGHAUS_INTERVALS.length - 1);
  const days = EBBINGHAUS_INTERVALS[idx];
  const next = new Date();
  next.setDate(next.getDate() + days);
  const updated = {
    ...q,
    review_next_date: next.toISOString().slice(0, 10),
    review_interval_index: idx,
    review_count: (q.review_count || 0) + 1
  };
  await dbQuestions.setItem(questionId, updated);
  return updated;
}

async function dbGetPendingReviews() {
  const today = new Date().toISOString().slice(0, 10);
  const result = [];
  await dbQuestions.iterate((q) => {
    if (q && q.review_enabled && q.review_next_date && q.review_next_date <= today && !q.deleted_at) {
      result.push(q);
    }
  });
  result.sort((a, b) => (a.review_next_date || '').localeCompare(b.review_next_date || ''));
  return result;
}
