import { describe, it, expect, beforeEach, vi } from 'vitest'

// 每个 store 一个独立内存 Map，模拟 localforage 的 iterate/get/set/remove/clear
vi.stubGlobal('localforage', {
  createInstance: () => {
    const m = new Map()
    return {
      getItem: async (k) => (m.has(k) ? m.get(k) : null),
      setItem: async (k, v) => { m.set(k, v); return v },
      removeItem: async (k) => { m.delete(k) },
      iterate: async (cb) => { for (const [k, v] of [...m]) await cb(v, k) },
      clear: async () => { m.clear() },
    }
  }
})

const sync = await import('../src/data/sync')
const stores = await import('../src/data/stores')

const localGroup = () => ({ id: 'local-g', kind: 'chapter', name: '本地章节', expr: { op: 'or', children: [] }, member_tag_id: null, order: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null })
const remoteGroup = () => ({ id: 'remote-g', kind: 'topic', name: '远端专题', expr: { op: 'or', children: [] }, member_tag_id: 'rt', order: 0, created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z', deleted_at: null })

async function hasGroup(id) {
  return (await stores.dbGroups.getItem(id)) !== null
}

describe('2.13 配置同步（groups / tag_categories / app_settings）', () => {
  beforeEach(async () => {
    await stores.dbGroups.clear()
    await stores.dbTagCategories.clear()
    await stores.dbAppSettings.clear()
    localStorage.clear()
  })

  it('dbBuildSyncPayload 把三者序列化进 settings 通道（app_settings 保留键）', async () => {
    await stores.dbGroups.setItem('local-g', localGroup())
    await stores.dbTagCategories.setItem('c1', { id: 'c1', name: '知识点/模型', order: 0, is_system: false })
    await stores.dbAppSettings.setItem('chapterVisibleCategories', { ids: ['c1'], unclassified: false })

    const payload = await sync.dbBuildSyncPayload()
    expect(Array.isArray(payload.settings.groups)).toBe(true)
    expect(payload.settings.groups.map((g) => g.id)).toEqual(['local-g'])
    expect(payload.settings.tag_categories.map((c) => c.id)).toEqual(['c1'])
    expect(payload.settings.app_settings).toEqual({ chapterVisibleCategories: { ids: ['c1'], unclassified: false } })
  })

  it('本机有未推送改动时不采用远端配置（避免覆盖本地）', async () => {
    await stores.dbGroups.setItem('local-g', localGroup()) // 未推送：无 configPushedHash

    await sync.dbApplyRemoteSnapshot({ settings: { groups: [remoteGroup()] } })

    expect(await hasGroup('local-g')).toBe(true)
    expect(await hasGroup('remote-g')).toBe(false)
  })

  it('推送成功后（hash 已记录）才采用远端配置', async () => {
    await stores.dbGroups.setItem('local-g', localGroup())
    await sync.dbFinalizeSuccessfulSync({}) // 记录当前内容为已推送

    await sync.dbApplyRemoteSnapshot({
      settings: {
        groups: [remoteGroup()],
        tag_categories: [{ id: 'rc', name: '远端类别', order: 0, is_system: false }],
        app_settings: { topicVisibleCategories: { ids: [], unclassified: true } },
      },
    })

    expect(await hasGroup('remote-g')).toBe(true)
    expect(await stores.dbTagCategories.getItem('rc')).not.toBeNull()
    expect(await stores.dbAppSettings.getItem('topicVisibleCategories')).toEqual({ ids: [], unclassified: true })
  })

  it('dbReplaceWithRemoteSnapshot（强制以远端为准）无视本地未推送改动', async () => {
    await stores.dbGroups.setItem('local-g', localGroup())

    await sync.dbReplaceWithRemoteSnapshot({ settings: { groups: [remoteGroup()] } })

    expect(await hasGroup('remote-g')).toBe(true)
  })

  it('configSnapshotHash 对键顺序不敏感（稳定哈希）', async () => {
    await stores.dbGroups.setItem('local-g', localGroup())
    const h1 = await sync.configSnapshotHash()
    await stores.dbGroups.setItem('local-g', { ...localGroup() })
    const h2 = await sync.configSnapshotHash()
    expect(h1).toBe(h2)
  })
})
