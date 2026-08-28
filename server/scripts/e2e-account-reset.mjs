#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT_DIR = path.dirname(SERVER_DIR);
const DB_PATH = path.join(SERVER_DIR, 'data.db');
const ENV_PATH = path.join(ROOT_DIR, '.env');

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function appendEnvFile(entries) {
  const block = Object.entries(entries).map(([k, v]) => `${k}=${v}`).join('\n');
  const current = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const sep = current.endsWith('\n') || current === '' ? '' : '\n';
  fs.writeFileSync(ENV_PATH, current + sep + block + '\n');
}

const envFile = readEnvFile();
const mainPhone = process.env.MAIN_ACCOUNT_PHONE || envFile.MAIN_ACCOUNT_PHONE;
let e2ePhone = process.env.E2E_TEST_PHONE || envFile.E2E_TEST_PHONE;
let e2ePassword = process.env.E2E_TEST_PASSWORD || envFile.E2E_TEST_PASSWORD;

if (!mainPhone) {
  console.error('缺少 MAIN_ACCOUNT_PHONE：请在根目录 .env 中设置为主账号手机号（如 13320087034）');
  process.exit(1);
}
let credsGenerated = false;
if (!e2ePhone || !e2ePassword) {
  e2ePhone = e2ePhone || '19000000001';
  e2ePassword = e2ePassword || crypto.randomBytes(12).toString('base64url');
  credsGenerated = true;
}
if (e2ePhone === mainPhone) {
  console.error('E2E_TEST_PHONE 不能与主账号手机号相同（防止清空主账号数据）');
  process.exit(1);
}

const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma('journal_mode = WAL');

const uuid = () => crypto.randomUUID();

function ensureAccount(phone, password, nickname) {
  let userId;
  let created = false;
  try {
    const id = uuid();
    db.prepare('INSERT INTO users (id, phone, password, nickname, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .run(id, phone, bcrypt.hashSync(password, 10), nickname);
    userId = id;
    created = true;
    console.log(`已创建测试账号: ${phone} (${nickname})`);
  } catch (e) {
    if (e && (String(e.code).includes('SQLITE_CONSTRAINT') || String(e.message).includes('UNIQUE'))) {
      userId = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone).id;
    } else {
      throw e;
    }
  }
  if (created && credsGenerated) {
    appendEnvFile({ E2E_TEST_PHONE: phone, E2E_TEST_PASSWORD: password });
    console.log(`已在 .env 生成测试账号凭据: E2E_TEST_PHONE=${phone}`);
  }
  if (!created && credsGenerated) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), userId);
    appendEnvFile({ E2E_TEST_PHONE: phone, E2E_TEST_PASSWORD: password });
    console.log('已重置既有测试账号密码并更新 .env');
  }
  return userId;
}

function listActive(db, table, userId) {
  return db.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`).all(userId);
}

const mainUserId = db.prepare('SELECT id FROM users WHERE phone = ?').get(mainPhone)?.id;
if (!mainUserId) {
  console.error(`主账号 ${mainPhone} 不存在于数据库`);
  process.exit(1);
}

const e2eUserId = ensureAccount(e2ePhone, e2ePassword, 'E2E专用-勿动');

console.log(`主账号(${mainPhone}) 活跃标签/题目: 复制中...`);
const copied = db.transaction(() => {
  db.prepare('DELETE FROM question_tags WHERE question_id IN (SELECT id FROM questions WHERE user_id = ?)').run(e2eUserId);
  db.prepare('DELETE FROM similar_question_links WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM node_questions WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM question_notes WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM paper_questions WHERE question_id IN (SELECT id FROM questions WHERE user_id = ?)').run(e2eUserId);
  db.prepare('DELETE FROM topic_questions WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM pdf_doc_tags WHERE tag_id IN (SELECT id FROM tags WHERE user_id = ?)').run(e2eUserId);
  db.prepare('DELETE FROM questions WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM tags WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM papers WHERE user_id = ?').run(e2eUserId);
  db.prepare('DELETE FROM topics WHERE user_id = ?').run(e2eUserId);

  const tagMap = new Map();
  const insertTag = db.prepare('INSERT INTO tags (id, user_id, name, color, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const t of listActive(db, 'tags', mainUserId)) {
    const newId = uuid();
    tagMap.set(t.id, newId);
    insertTag.run(newId, e2eUserId, t.name, t.color, t.created_at, t.updated_at, t.deleted_at);
  }

  const insertQuestion = db.prepare(`INSERT INTO questions (id, user_id, question_image_url, answer_image_url, layout_type, created_at, updated_at, deleted_at, user_comment, semantic_summary, ai_metadata, versions, purged_at, book_name, page_number, question_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const questionMap = new Map();
  for (const q of listActive(db, 'questions', mainUserId)) {
    const newId = uuid();
    questionMap.set(q.id, newId);
    insertQuestion.run(newId, e2eUserId, q.question_image_url, q.answer_image_url, q.layout_type, q.created_at, q.updated_at, q.deleted_at, q.user_comment, q.semantic_summary, q.ai_metadata, q.versions, q.purged_at, q.book_name, q.page_number, q.question_number);
  }

  const insertLink = db.prepare('INSERT OR IGNORE INTO question_tags (question_id, tag_id) VALUES (?, ?)');
  let links = 0;
  for (const [oldQid, newQid] of questionMap) {
    for (const row of db.prepare('SELECT tag_id FROM question_tags WHERE question_id = ?').all(oldQid)) {
      const newTagId = tagMap.get(row.tag_id);
      if (newTagId) { insertLink.run(newQid, newTagId); links += 1; }
    }
  }
  return { tags: tagMap.size, questions: questionMap.size, links };
});

const stats = copied();
const e2eTags = db.prepare('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?').get(e2eUserId).c;
const e2eQuestions = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE user_id = ?').get(e2eUserId).c;
console.log(`测试账号(${e2ePhone}) 重置完成: 标签 ${e2eTags} | 题目 ${e2eQuestions} | 标签关联 ${stats.links}`);
console.log(`主账号数据未做任何修改（只读复制）。`);
db.close();
