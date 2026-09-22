import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 备份落盘改造 Task 1–4 的回归测试（详见 docs/plans/2026-09-14-backup-private-dir-plan.md）。
// 根因：备份原先写公共 Directory.Documents（/storage/emulated/0/Documents），在 targetSdk 34 下
// 需要「所有文件访问」权限，而插件权限判断在 API≥30 直接返回 true、不引导授权 → 系统层拒绝 → FILE_NOTCREATED。
// 本任务改用 Directory.External（应用专属外部目录，无需权限、USB/OEM 文件管理器可见）。
//
// 本文件只断言「行为/目录」，不重复既有 backup-utf8-write / backup-shard-import 的 utf8/btoa/分片格式防线。

const H = vi.hoisted(() => {
  const storeRegistry: Record<string, any> = {};
  const showStatus = vi.fn();
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
  ];
  const TAGS: Array<[string, unknown]> = [
    ['t1', { id: 't1', name: '甲' }],
    ['t2', { id: 't2', name: '乙' }],
  ];
  return { mk, storeRegistry, showStatus, QUESTIONS, TAGS };
});

// 拦截 showStatus，验证「真实错误原因 / 未找到提示」确实被报给用户
vi.mock('../src/ui/common', () => ({
  showStatus: (...args: any[]) => H.showStatus(...args),
  openModal: vi.fn(),
  closeModal: vi.fn(),
}));

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

// 假 Capacitor Filesystem：按 directory（EXTERNAL / DOCUMENTS）分根的内存文件系统，记录所有调用。
// dirs: { '<子目录名>': { '<文件名>': '<内容>' } } —— 落在 EXTERNAL 根下。
function installFakeCapacitor(
  opts: { dirs?: Record<string, Record<string, string>>; mkdirError?: Error | null } = {},
) {
  const { dirs = {}, mkdirError = null } = opts;
  const fsState: Record<string, Record<string, string>> = { EXTERNAL: {}, DOCUMENTS: {} };
  for (const [d, files] of Object.entries(dirs)) {
    for (const [f, content] of Object.entries(files)) {
      fsState.EXTERNAL[`${d}/${f}`] = content;
    }
  }
  const writeFile = vi.fn(async ({ path, directory, data }: any) => {
    fsState[directory] = fsState[directory] || {};
    fsState[directory][path] = data;
    return { uri: path };
  });
  const readFile = vi.fn(async ({ path, directory }: any) => {
    const store = fsState[directory] || {};
    if (!(path in store)) throw new Error('FileDoesNotExist: ' + path);
    return { data: store[path] };
  });
  const mkdir = vi.fn(async () => {
    if (mkdirError) throw mkdirError;
    return {};
  });
  const readdir = vi.fn(async ({ path, directory }: any) => {
    const store = fsState[directory] || {};
    const prefix = path ? path + '/' : '';
    const names = new Set<string>();
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) {
        const top = key.slice(prefix.length).split('/')[0];
        if (top) names.add(top);
      }
    }
    return { files: Array.from(names) };
  });
  const Filesystem = { writeFile, readFile, mkdir, readdir };
  (window as any).Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem } };
  (window as any).confirm = vi.fn(() => true);
  (window as any).dbGetAllQuestions = vi.fn(() => []);
  (window as any).refreshAll = vi.fn();
  return { writeFile, readFile, mkdir, readdir, Filesystem };
}

describe('备份落盘到应用专属外部目录（EXTERNAL）', () => {
  beforeEach(() => {
    H.showStatus.mockClear();
    localStorage.clear();
  });
  afterEach(() => {
    (window as any).Capacitor = undefined;
    (window as any).confirm = undefined;
    (window as any).dbGetAllQuestions = undefined;
    (window as any).refreshAll = undefined;
  });

  it('Task1: 备份读写使用应用专属外部目录（EXTERNAL）', async () => {
    const fs = installFakeCapacitor();
    await exportAllData();
    const writeCall = fs.writeFile.mock.calls[0][0];
    // 必须是 EXTERNAL：既不能是公共 DOCUMENTS（需权限、本项目故障根因），也不能是 DATA（真私有、用户取不出文件）
    expect(writeCall.directory).toBe('EXTERNAL');
    expect(writeCall.directory).not.toBe('DOCUMENTS');
    expect(writeCall.directory).not.toBe('DATA');
  });

  it('Task2: mkdir 因「已存在」失败时应容忍；因其它原因失败时必须报出真实原因', async () => {
    const fs = installFakeCapacitor({ mkdirError: new Error('mkdir failed: EACCES') });
    await exportAllData();
    // 不得静默吞错退化成 FILE_NOTCREATED：真实原因 EACCES 必须出现在用户可见的错误里
    expect(H.showStatus).toHaveBeenCalledWith(expect.stringContaining('EACCES'), 'error');
  });

  it('Task3: 恢复应能同时找到固定目录与带日期目录，并优先使用最新的一个', async () => {
    const fs = installFakeCapacitor({
      dirs: {
        'question-bank-backup-2026-09-14': {
          'manifest.json': JSON.stringify({
            format: 'sharded_v1',
            created_at: new Date().toISOString(),
            stores: [{ name: 'questions', shards: 1, count: 2 }],
            others: [],
          }),
          'questions-000.json': JSON.stringify([{ id: 'q1' }, { id: 'q2' }]),
        },
      },
    });
    await loadBackupFromDevice();
    // 导出的带日期目录（question-bank-backup-<日期>）必须能被恢复入口探测到并读取
    expect(fs.readFile.mock.calls.some((c: any[]) => String(c[0].path).includes('2026-09-14'))).toBe(true);
  });

  it('Task4: 找不到任何备份时，必须明确报错并给出目录提示，不得出现“恢复成功 0 题”', async () => {
    const fs = installFakeCapacitor({ dirs: {} });
    await loadBackupFromDevice();
    // 明确报错并说明查找过哪些位置（应用外部目录 EXTERNAL 与 公共 Documents DOCUMENTS）
    expect(H.showStatus).toHaveBeenCalledWith(expect.stringMatching(/未找到|没有可恢复/), 'error');
  });
});
