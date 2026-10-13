import { describe, it, expect, vi } from 'vitest';

// 守护 2026-09-17 的问题：embeddings.ts 曾在模块顶层调 localforage.createInstance，
// 任何 import 本模块的测试都得先装 localforage 桩（另一会话实测踩坑）。
// 本文件必须自己装桩——import 链（embeddings → sync → stores.ts）在模块顶层
// 会调 localforage.createInstance，这是 data 层既有模式。
const createInstanceCalls = [];
vi.stubGlobal('localforage', {
  createInstance: (...args) => {
    createInstanceCalls.push(args);
    return { clear: vi.fn(), setItem: vi.fn(), getItem: vi.fn(), iterate: vi.fn() };
  },
});

describe('embeddings 模块惰性初始化', () => {
  it('import 零自身副作用；首次使用才创建实例并保持单例', async () => {
    const mod = await import('../src/data/embeddings.js');
    const afterImport = createInstanceCalls.length;
    // stores.ts 的顶层 createInstance 会计入 afterImport（import 链噪音），
    // 但 embeddings.ts 自身惰性化后 import 时不应再添一次；
    // 首次 getAllVectors 触发 embeddings 自己的 createInstance（+1）
    await mod.getAllVectors();
    expect(createInstanceCalls.length).toBe(afterImport + 1);
    // 再次调用复用单例，不重复创建
    await mod.getAllVectors();
    expect(createInstanceCalls.length).toBe(afterImport + 1);
    const arg = createInstanceCalls[createInstanceCalls.length - 1][0];
    expect(arg.storeName).toBe('embeddings');
  });
});
