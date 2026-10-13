import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureEmbeddingsTable } from '../src/db/schema.js';

describe('question_embeddings 复合主键', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE questions (id TEXT PRIMARY KEY, question_image_url TEXT, deleted_at TEXT)');
    ensureEmbeddingsTable(db);
  });

  it('同一题可为两个引擎各存一份向量', () => {
    db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)')
      .run('mac', 'q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)')
      .run('linux', 'q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    const n = db.prepare('SELECT COUNT(*) AS c FROM question_embeddings WHERE question_id = ?').get('q-001') as { c: number };
    expect(n.c).toBe(2);
  });

  it('同引擎同题重复写入被主键拒绝', () => {
    const ins = db.prepare('INSERT INTO question_embeddings (engine_id, question_id, model, dim, vector) VALUES (?,?,?,?,?)');
    ins.run('mac', 'q-001', 'm', 2048, Buffer.alloc(8192));
    expect(() => ins.run('mac', 'q-001', 'm', 2048, Buffer.alloc(8192))).toThrow(/UNIQUE/);
  });
});

describe('旧库迁移（复现并守护顺序缺陷）', () => {
  const LEGACY_DDL = `CREATE TABLE question_embeddings (
    question_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`;

  function legacyDb() {
    const d = new Database(':memory:');
    d.exec(LEGACY_DDL);
    d.prepare('INSERT INTO question_embeddings (question_id, model, dim, vector) VALUES (?,?,?,?)')
      .run('q-001', 'wemm-embedding-2b', 2048, Buffer.from(new Float32Array(2048).buffer));
    return d;
  }

  it('旧库（无 engine_id 列）迁移不抛异常 —— 建索引必须在迁移之后', () => {
    const d = legacyDb();
    expect(() => ensureEmbeddingsTable(d)).not.toThrow();
  });

  it('旧行全部归入 legacy-default，向量逐字节不变', () => {
    const d = legacyDb();
    const before = d.prepare('SELECT vector FROM question_embeddings WHERE question_id = ?').get('q-001') as { vector: Buffer };
    ensureEmbeddingsTable(d);
    const rows = d.prepare('SELECT engine_id, question_id, vector FROM question_embeddings').all() as { engine_id: string; question_id: string; vector: Buffer }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].engine_id).toBe('legacy-default');
    expect(Buffer.compare(rows[0].vector, before.vector)).toBe(0);
  });

  it('迁移后索引存在，且无 _old 残留表', () => {
    const d = legacyDb();
    ensureEmbeddingsTable(d);
    expect(d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_embeddings_engine'").all()).toHaveLength(1);
    expect(d.prepare("SELECT name FROM sqlite_master WHERE name='question_embeddings_old'").all()).toHaveLength(0);
  });

  it('重复执行幂等', () => {
    const d = legacyDb();
    ensureEmbeddingsTable(d);
    expect(() => ensureEmbeddingsTable(d)).not.toThrow();
    const n = d.prepare('SELECT COUNT(*) AS c FROM question_embeddings').get() as { c: number };
    expect(n.c).toBe(1);
  });

  it('迁移中途失败时回滚：抛异常、无 _old 残留、原表结构与数据不变、无悬挂事务', () => {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE question_embeddings (
      question_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL
    )`);
    const vector = Buffer.from(new Float32Array(2048).buffer);
    d.prepare('INSERT INTO question_embeddings (question_id, model, dim, vector) VALUES (?,?,?,?)')
      .run('q-001', 'wemm-embedding-2b', 2048, vector);

    expect(() => ensureEmbeddingsTable(d)).toThrow(/no such column: updated_at/);

    expect(d.prepare("SELECT name FROM sqlite_master WHERE name = 'question_embeddings_old'").all()).toHaveLength(0);
    const cols = d.prepare('PRAGMA table_info(question_embeddings)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('engine_id');
    const rows = d.prepare('SELECT question_id, model, dim, vector FROM question_embeddings').all() as
      { question_id: string; model: string; dim: number; vector: Buffer }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].question_id).toBe('q-001');
    expect(rows[0].model).toBe('wemm-embedding-2b');
    expect(rows[0].dim).toBe(2048);
    expect(Buffer.compare(rows[0].vector, vector)).toBe(0);
    expect(() => d.exec('BEGIN; COMMIT;')).not.toThrow();
  });
});
