import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, authHeaders } from './helpers/auth.js';

// Phase 0（D6）服务端：question_tags 升级为带版本实体。覆盖：
//   - push 接收 question_tags（含时间戳），pull 返回（含时间戳）
//   - upsertQuestionTag 按 isIncomingNewer 逐条合并：较旧更新被忽略，较新软删生效
//   - listQuestionTagIds 过滤软删（question.tag_ids 不再包含已取消的标签）
//   - D3 病根移除：upsertQuestion 不再 replaceQuestionTags（题目不带 tag_ids，关联独立上行）

function uniq(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

describe('关联同步（Phase 0 / D6）服务端', () => {
  let token: string;

  beforeEach(async () => {
    token = await createTestUser(app, `139${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`);
  });

  it('push 接收 question_tags 并能在 pull 取回（含时间戳）', async () => {
    const qid = uniq('q');
    const tid = uniq('t');
    const push = await request(app)
      .post('/api/sync/push')
      .set(authHeaders(token))
      .send({
        questions: [{ id: qid }],
        tags: [{ id: tid, name: '物理' }],
        question_tags: [{ question_id: qid, tag_id: tid, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }],
      });
    expect(push.status).toBe(200);

    const pull = await request(app).get('/api/sync/pull?since=0').set(authHeaders(token));
    expect(pull.status).toBe(200);
    const qt = pull.body.question_tags.find((x: any) => x.question_id === qid && x.tag_id === tid);
    expect(qt).toBeTruthy();
    expect(qt.deleted_at).toBeNull();
    expect(qt.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('逐条合并：较旧更新被忽略，较新软删生效，题目 tag_ids 过滤软删', async () => {
    const qid = uniq('q');
    const tid = uniq('t');
    const newTs = '2026-03-01T00:00:00.000Z';
    const oldTs = '2026-01-01T00:00:00.000Z';

    await request(app).post('/api/sync/push').set(authHeaders(token)).send({
      questions: [{ id: qid }],
      tags: [{ id: tid, name: '物理' }],
      question_tags: [{ question_id: qid, tag_id: tid, created_at: newTs, updated_at: newTs, deleted_at: null }],
    });

    // 推一个更旧的更新 → 不应覆盖
    await request(app).post('/api/sync/push').set(authHeaders(token)).send({
      question_tags: [{ question_id: qid, tag_id: tid, created_at: oldTs, updated_at: oldTs, deleted_at: null }],
    });
    let pull = await request(app).get('/api/sync/pull?since=0').set(authHeaders(token));
    let qt = pull.body.question_tags.find((x: any) => x.question_id === qid && x.tag_id === tid);
    expect(qt.updated_at).toBe(newTs);

    // 推一个更晚的软删 → 生效（修复 D6 取消关联被复活）
    const delTs = '2026-05-01T00:00:00.000Z';
    await request(app).post('/api/sync/push').set(authHeaders(token)).send({
      question_tags: [{ question_id: qid, tag_id: tid, created_at: delTs, updated_at: delTs, deleted_at: delTs }],
    });
    pull = await request(app).get('/api/sync/pull?since=0').set(authHeaders(token));
    qt = pull.body.question_tags.find((x: any) => x.question_id === qid && x.tag_id === tid);
    expect(qt.deleted_at).toBe(delTs);

    // listQuestionTagIds 过滤软删：题目的 tag_ids 不应再包含 tid
    const q = pull.body.questions.find((x: any) => x.id === qid);
    expect(q.tag_ids).not.toContain(tid);
  });

  it('D3 病根移除：题目被 push 为更新后，其关联不被全量清空', async () => {
    const qid = uniq('q');
    const tid = uniq('t');
    // 先建立关联
    await request(app).post('/api/sync/push').set(authHeaders(token)).send({
      questions: [{ id: qid }],
      tags: [{ id: tid, name: '物理' }],
      question_tags: [{ question_id: qid, tag_id: tid, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }],
    });
    // 仅 push 题目（不带 question_tags），模拟「题目被判为更新」的旧链路
    await request(app).post('/api/sync/push').set(authHeaders(token)).send({
      questions: [{ id: qid, updated_at: '2026-02-01T00:00:00.000Z' }],
    });
    const pull = await request(app).get('/api/sync/pull?since=0').set(authHeaders(token));
    const qt = pull.body.question_tags.find((x: any) => x.question_id === qid && x.tag_id === tid);
    // 关联仍在（未被 replaceQuestionTags([]) 清空）
    expect(qt).toBeTruthy();
    expect(qt.deleted_at).toBeNull();
  });
});
