import { describe, it, expect, vi, beforeEach } from 'vitest';

// 分片恢复链路防回归：写侧逐片写出（planShards + manifest.json）→ 读侧逐片 readFile + importStoreRecords。
// 参考 backup-export-completeness.spec.ts / backup-utf8-write.spec.ts 的两个坑：
//   - vi.mock 会被提升，故用 vi.hoisted 准备 mock 数据
//   - mock 的 iterate 必须复刻 localforage「回调返回非 undefined 即终止」语义（用块体回调返回 undefined）
//
// 用内存 Map 当假文件系统，断言：
//   1) 写侧产出的不是单文件，而是 manifest.json + 若干 ≤2MB 分片（encoding utf8，无 btoa）
//   2) 读侧逐片导入后各 store 记录数与源一致
//   3) question_tags 之类特殊键规则（${question_id}_${tag_id}）与既有 importBackupData 一致
//   4) 旧版单文件备份（question-bank-backup.json）仍能恢复 —— 硬要求

const H = vi.hoisted(() => {
  // storeRegistry 让测试能回查每个 mock store 的 setItem 调用，证明逐片导入真的写入了正确数量与键名
  const storeRegistry: Record<string, any> = {};
  const mk = (name: string, records: Array<[string, unknown]>) => {
    const store = {
      iterate: async (cb: (v: unknown, k: string, n: number) => unknown) => {
        let n = 1;
        for (const [k, v] of records) {
          const r = cb(v, k, n++);
          if (r !== undefined) return r;
        }
        return undefined;
      },
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    storeRegistry[name] = store;
    return store;
  };

  const QUESTIONS: Array<[string, unknown]> = [
    ['q1', { id: 'q1', title: '题一' }],
    ['q2', { id: 'q2', title: '题二' }],
    ['q3', { id: 'q3', title: '题三' }],
  ];
  const TAGS: Array<[string, unknown]> = [
    ['t1', { id: 't1', name: '甲' }],
    ['t2', { id: 't2', name: '乙' }],
  ];
  // 注意：question_tags 的记录是 {question_id, tag_id}，由 importStoreRecords 拼成 ${question_id}_${tag_id} 键，
  // 这正是今日 FF-1 潜伏过的特殊键逻辑，必须逐片导入后仍一致
  const QUESTION_TAGS: Array<[string, unknown]> = [
    ['q1_t1', { question_id: 'q1', tag_id: 't1' }],
    ['q2_t1', { question_id: 'q2', tag_id: 't1' }],
    ['q3_t2', { question_id: 'q3', tag_id: 't2' }],
  ];

  return { mk, storeRegistry, QUESTIONS, TAGS, QUESTION_TAGS };
});

vi.mock('../src/data/stores', () => ({
  dbQuestions: H.mk('dbQuestions', H.QUESTIONS),
  dbTags: H.mk('dbTags', H.TAGS),
  dbQuestionTags: H.mk('dbQuestionTags', H.QUESTION_TAGS),
  dbPapers: H.mk('dbPapers', []),
  dbPaperQuestions: H.mk('dbPaperQuestions', []),
  dbSimilarQuestionLinks: H.mk('dbSimilarQuestionLinks', []),
  dbTopics: H.mk('dbTopics', []),
  dbTopicQuestions: H.mk('dbTopicQuestions', []),
  dbQuestionNotes: H.mk('dbQuestionNotes', []),
  dbPendingPhotos: H.mk('dbPendingPhotos', []),
  dbTeachingNodes: H.mk('dbTeachingNodes', []),
  dbTeachingVersions: H.mk('dbTeachingVersions', []),
  dbNodeQuestions: H.mk('dbNodeQuestions', []),
  dbChangelog: H.mk('dbChangelog', []),
  dbTagCategories: H.mk('dbTagCategories', []),
  dbAppSettings: H.mk('dbAppSettings', []),
  dbGroups: H.mk('dbGroups', []),
  generateId: () => 'test-' + Math.random().toString(36).slice(2),
  nowIso: () => new Date().toISOString(),
  toMillis: (s: string) => (s ? Date.parse(s) || 0 : 0),
}));

import { writeFullBackup, loadBackupFromDevice } from '../src/ui/backup';

describe('备份分片：写侧逐片写出 + 读侧逐片导入', () => {
  // 内存假文件系统：path -> JSON 字符串
  let fs: Map<string, string>;
  let writeFile: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;
  let btoaSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fs = new Map();
    writeFile = vi.fn(async ({ path, data }: { path: string; data: string }) => {
      fs.set(path, data);
      return { uri: path };
    });
    readFile = vi.fn(async ({ path }: { path: string }) => {
      if (!fs.has(path)) {
        const err: any = new Error('FileDoesNotExist: ' + path);
        err.message = 'FileDoesNotExist: ' + path;
        throw err;
      }
      return { data: fs.get(path) as string };
    });
    const fakeFilesystem = { writeFile, readFile, mkdir: vi.fn(async () => ({})) };
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Filesystem: fakeFilesystem },
    };
    (window as any).confirm = vi.fn(() => true);
    (window as any).dbGetAllQuestions = vi.fn(() => []);
    (window as any).refreshAll = vi.fn();
    // 每个用例清零各 store 的 setItem 调用计数，避免跨用例累积
    for (const store of Object.values(H.storeRegistry)) store.setItem.mockClear();
    btoaSpy = vi.spyOn(globalThis, 'btoa');
  });

  afterEach(() => {
    btoaSpy.mockRestore();
    (window as any).Capacitor = undefined;
    (window as any).confirm = undefined;
    (window as any).dbGetAllQuestions = undefined;
    (window as any).refreshAll = undefined;
  });

  it('写侧：native 导出产出 manifest.json + 分片文件（非单文件），encoding utf8，无 btoa', async () => {
    await writeFullBackup();

    // 必须是分片目录形态，而非单文件 question-bank-backup.json
    expect(fs.has('question-bank-backup/manifest.json')).toBe(true);
    expect(fs.has('question-bank-backup/questions-000.json')).toBe(true);
    expect(fs.has('question-bank-backup.json')).toBe(false);

    // 防回归：utf8 直写，杜绝 btoa 链（4 份副本 → OOM 闪退）
    expect(writeFile).toHaveBeenCalled();
    for (const call of writeFile.mock.calls) {
      expect((call[0] as any).encoding).toBe('utf8');
    }
    expect(btoaSpy).not.toHaveBeenCalled();

    // manifest 记录的真实数据量正确
    const manifest = JSON.parse(fs.get('question-bank-backup/manifest.json') as string);
    expect(manifest.format).toBe('sharded_v1');
    const q = manifest.stores.find((s: any) => s.name === 'questions');
    expect(q.count).toBe(3);
    const qt = manifest.stores.find((s: any) => s.name === 'question_tags');
    expect(qt.count).toBe(3);
  });

  it('读侧：逐片导入后各 store 记录数与源一致，且 question_tags 用复合键', async () => {
    // 先写侧分片（与生产代码同一入口）
    await writeFullBackup();
    // 清除写侧可能触发的 setItem（写侧只调 Filesystem，不应有 setItem；这里清零保证只统计读侧）
    for (const store of Object.values(H.storeRegistry)) store.setItem.mockClear();

    await loadBackupFromDevice();

    // 记录数与源一致
    expect(H.storeRegistry.dbQuestions.setItem).toHaveBeenCalledTimes(3);
    expect(H.storeRegistry.dbTags.setItem).toHaveBeenCalledTimes(2);
    expect(H.storeRegistry.dbQuestionTags.setItem).toHaveBeenCalledTimes(3);

    // question_tags 复合键规则与既有 importBackupData 一致
    const qtKeys = H.storeRegistry.dbQuestionTags.setItem.mock.calls.map((c: any[]) => c[0]);
    expect(qtKeys).toEqual(['q1_t1', 'q2_t1', 'q3_t2']);
  });

  it('旧版单文件备份（question-bank-backup.json）仍能恢复', async () => {
    // 只放旧版单文件，不放分片目录 → 读侧必须回退到单文件路径并成功导入
    const legacy = JSON.stringify({
      questions: [{ id: 'q-old1' }, { id: 'q-old2' }],
      tags: [{ id: 't-old1' }],
      question_tags: [{ question_id: 'q-old1', tag_id: 't-old1' }],
    });
    fs.set('question-bank-backup.json', legacy);

    await loadBackupFromDevice();

    // 证明走了单文件回退（而非分片路径）：dbQuestions 写入的是旧文件里的 2 题
    expect(H.storeRegistry.dbQuestions.setItem).toHaveBeenCalledTimes(2);
    const qKeys = H.storeRegistry.dbQuestions.setItem.mock.calls.map((c: any[]) => c[0]);
    expect(qKeys).toEqual(['q-old1', 'q-old2']);
    expect(H.storeRegistry.dbTags.setItem).toHaveBeenCalledTimes(1);
    expect(H.storeRegistry.dbQuestionTags.setItem).toHaveBeenCalledTimes(1);
    expect(H.storeRegistry.dbQuestionTags.setItem.mock.calls[0][0]).toBe('q-old1_t-old1');
  });
});
