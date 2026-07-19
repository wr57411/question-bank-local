import { readFileSync } from 'fs'
import { resolve } from 'path'

export function loadDbFunctions() {
  const dbPath = resolve(process.cwd(), 'www/db.js')
  const dbCode = readFileSync(dbPath, 'utf8')

  const mockStores = new Map()
  const mockLocalforage = {
    createInstance: ({ storeName }) => {
      const store = new Map()
      mockStores.set(storeName, store)
      return {
        getItem: (key) => Promise.resolve(store.get(key) || null),
        setItem: (key, value) => { store.set(key, value); return Promise.resolve(value) },
        removeItem: (key) => { store.delete(key); return Promise.resolve() },
        iterate: async (cb) => { for (const [k, v] of store) await cb(v, k) },
        clear: () => { store.clear(); return Promise.resolve() },
        keys: () => Promise.resolve([...mockStores.keys()]),
      }
    }
  }

  const ctx = {
    window: { Capacitor: { Plugins: {} }, dispatchEvent: () => {} },
    document: { createElement: () => ({}) },
    Image: class { set src(v) {} },
    FileReader: class {},
    fetch: globalThis.fetch,
    console: console,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    CustomEvent: class CustomEvent {},
    alert: () => {},
    atob: (str) => Buffer.from(str, 'base64').toString('binary'),
  }

  const script = new Function(
    'localforage', 'window', 'document', 'Image', 'FileReader',
    'fetch', 'console', 'URL', 'localStorage', 'CustomEvent', 'alert', 'atob',
    `${dbCode}\nreturn { generateId, _toMillis, _normalizeTagRecord, _normalizeQuestionRecord, _normalizePaperRecord, _normalizeSimilarLinkPair, _similarLinkKey, _normalizeSimilarLinkRecord, _needsNormalization, _isRemoteNewer, dataURLtoBlob, _isDataUrl, _isRemoteUrl, _isServerAssetPath, _needsAssetUpload, _normalizeServerAssetUrl, initRemoteSync, dbGetAllTags, dbCreateTag, dbDeleteTag, dbGetAllQuestions, dbCreateQuestion, dbSoftDeleteQuestion, dbRestoreQuestion, dbPermanentDeleteQuestion, dbGetTrashedQuestions, dbAddTagToQuestion, dbRemoveTagFromQuestion, dbGetAllPapers, dbCreatePaper, dbDeletePaper, dbGetPaperQuestions, dbGetAllSimilarLinks, dbAddSimilarQuestionLinks, dbRemoveSimilarQuestionLink, dbGetSimilarQuestionIds, dbExportAllData: exportAllData, dbImportAllData: importAllData, dbBuildSyncPayload, dbApplyRemoteSnapshot, dbFinalizeSuccessfulSync, dbReplaceWithRemoteSnapshot, dbClearAllData, generatePDF, generatePaperPDF, collectDataFingerprint, checkSyncDataIntegrity, _checkVersionsDiscard }`
  )

  const funcs = script(
    mockLocalforage,
    ctx.window,
    ctx.document,
    ctx.Image,
    ctx.FileReader,
    ctx.fetch,
    ctx.console,
    ctx.URL,
    ctx.localStorage,
    ctx.CustomEvent,
    ctx.alert,
    ctx.atob
  )

  return { funcs, mockStores, mockLocalforage }
}
