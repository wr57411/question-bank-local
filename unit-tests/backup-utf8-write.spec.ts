import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 方案 A 防回归（utf8 直写，去掉 btoa 链）
// 真机「📤 导出」与「💾 保存备份到设备」闪退根因：
//   btoa(unescape(encodeURIComponent(jsonStr))) 同时留 4 份数据副本
//   → 50MB 数据实测峰值 heapUsed 244MB → 手机 WebView OOM → 进程被杀（闪退）。
// 修复：改用 writeFile({ data: jsonStr, encoding: 'utf8' }) 直写，去掉整条 btoa 链；
//       读取侧改 readFile({ encoding: 'utf8' })。
//
// 本测试直接断言三道防线：
//   1) writeFile 收到的参数里 encoding === 'utf8'
//   2) writeFile 收到的 data 是明文 JSON（以 { 开头、可 JSON.parse、含 questions 键，非 base64）
//   3) 全局 btoa 一次都没被调用（根因直接防线——只要有 btoa 就说明 4 份副本回来了）
// 另测 loadBackupFromDevice 的 native 读取：readFile 用 utf8 且能解析题目数，且不调用 atob。
//
// 参考 backup-export-completeness.spec.ts 的两个坑：
//   - vi.mock 会被提升，故用 vi.hoisted 准备 mock 数据
//   - mock 的 iterate 必须复刻 localforage「回调返回非 undefined 即终止」语义（用块体回调返回 undefined）

const H = vi.hoisted(() => {
  // storeRegistry 让测试能回查各 store 的 mock（尤其是 dbQuestions.setItem 调用次数），
  // 以证明 loadBackupFromDevice 确实把明文 JSON 解析并写入了正确数量的题目。
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

  // 少量数据即可：2 题 2 标签
  const QUESTIONS: Array<[string, unknown]> = [
    ['q1', { id: 'q1', title: '题一' }],
    ['q2', { id: 'q2', title: '题二' }],
  ];
  const TAGS: Array<[string, unknown]> = [
    ['t1', { id: 't1', name: '甲' }],
    ['t2', { id: 't2', name: '乙' }],
  ];

  return { mk, storeRegistry, QUESTIONS, TAGS };
});

vi.mock('../src/data/stores', () => ({
  dbQuestions: H.mk('dbQuestions', H.QUESTIONS),
  dbTags: H.mk('dbTags', H.TAGS),
  dbQuestionTags: H.mk('dbQuestionTags', []),
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
  generateId: () => 'test-' + Math.random().toString(36).slice(2),
  nowIso: () => new Date().toISOString(),
  toMillis: (s: string) => (s ? Date.parse(s) || 0 : 0),
}));

import { exportAllData, loadBackupFromDevice } from '../src/ui/backup';

describe('备份导出 utf8 直写防回归（方案 A / OOM 闪退）', () => {
  let writeFile: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;
  let btoaSpy: ReturnType<typeof vi.spyOn>;
  let atobSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeFile = vi.fn(async () => ({ uri: 'x' }));
    readFile = vi.fn(async () => ({ data: '{"questions":[],"tags":[],"question_tags":[]}' }));
    const fakeFilesystem = { writeFile, readFile, mkdir: vi.fn(async () => ({})) };
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Filesystem: fakeFilesystem },
    };
    // 确认是原生环境，且假 Filesystem 被捕获
    btoaSpy = vi.spyOn(globalThis, 'btoa');
    atobSpy = vi.spyOn(globalThis, 'atob');
    // loadBackupFromDevice 内部有 confirm 守卫，mock 成一律放行，避免 jsdom 未实现噪声
    (window as any).confirm = vi.fn(() => true);
  });

  afterEach(() => {
    btoaSpy.mockRestore();
    atobSpy.mockRestore();
    (window as any).Capacitor = undefined;
    (window as any).confirm = undefined;
  });

  it('exportAllData native 分片写出：每片 utf8 明文 JSON，绝不调用 btoa', async () => {
    await exportAllData();

    // 分片目录：manifest + 各 store 分片，写入次数 > 1（不再是单文件一次性写）
    expect(writeFile.mock.calls.length).toBeGreaterThan(1);

    // 防线 1：每次写入 encoding 都是 utf8
    for (const call of writeFile.mock.calls) {
      expect((call[0] as any).encoding).toBe('utf8');
    }

    // 防线 2：片内数据是明文 JSON（数组或 manifest 对象），不是 base64
    // base64 编码的 JSON 会以 eyJ 开头（"{" 的 base64 前 3 字符），明文绝不会
    const allData = writeFile.mock.calls.map((c) => (c[0] as any).data as string);
    for (const d of allData) {
      expect(typeof d).toBe('string');
      expect(d.startsWith('eyJ')).toBe(false);
      expect(() => JSON.parse(d)).not.toThrow();
    }

    // manifest 标记分片格式
    const manifestCall = writeFile.mock.calls.find((c) => (c[0] as any).path.endsWith('manifest.json'));
    expect(manifestCall).toBeTruthy();
    const manifest = JSON.parse(manifestCall![0].data as string);
    expect(manifest.format).toBe('sharded_v1');

    // 题目确实落到了某个分片里（plain 数组含 2 题）
    const qShard = allData.find((d) => d.startsWith('[') && d.includes('"id":"q1"'));
    expect(qShard).toBeTruthy();
    const parsed = JSON.parse(qShard!) as any[];
    expect(parsed.length).toBe(2);

    // 防线 3：根因直接防线——全程不得调用 btoa（4 份副本 → OOM 闪退）
    expect(btoaSpy).not.toHaveBeenCalled();
  });

  it('loadBackupFromDevice 的 native 读取：探测分片目录、逐片 utf8 直读明文、逐片导入，绝不调用 atob', async () => {
    // 构造一个最小分片备份：manifest + questions 一片
    const manifest = {
      format: 'sharded_v1',
      created_at: new Date().toISOString(),
      stores: [{ name: 'questions', shards: 1, count: 2 }],
      others: [],
    };
    readFile.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith('manifest.json')) return { data: JSON.stringify(manifest) };
      if (path.endsWith('questions-000.json')) return { data: JSON.stringify([{ id: 'q-r1' }, { id: 'q-r2' }]) };
      throw new Error('FileDoesNotExist: ' + path);
    });

    await loadBackupFromDevice();

    // 先读 manifest 再逐片读，故 >= 2 次
    expect(readFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    // 防线：native 读取必须 utf8 直读
    for (const call of readFile.mock.calls) {
      expect((call[0] as any).encoding).toBe('utf8');
    }

    // 证明明文 JSON 真的被逐片 JSON.parse 并正确解析出题目数：
    // importStoreRecords 会把每道题写入 dbQuestions.setItem，调用次数 === 题目数（2）
    expect(H.storeRegistry.dbQuestions.setItem).toHaveBeenCalledTimes(2);

    // 根因直接防线：native 读取不得走 atob 解密
    expect(atobSpy).not.toHaveBeenCalled();
  });
});
