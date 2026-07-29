import { describe, it, expect, beforeEach } from 'vitest'
import { loadDbFunctions } from './helpers/load-db.js'

let funcs

beforeEach(() => {
  const loaded = loadDbFunctions()
  funcs = loaded.funcs
})

describe('同步数据完整性检测', () => {
  it('collectDataFingerprint 应该返回正确的数据结构', async () => {
    const fingerprint = await funcs.collectDataFingerprint()
    
    expect(fingerprint).toBeDefined()
    expect(fingerprint).toHaveProperty('questions')
    expect(fingerprint).toHaveProperty('tags')
    expect(fingerprint).toHaveProperty('questionTags')
    expect(fingerprint).toHaveProperty('papers')
    expect(fingerprint).toHaveProperty('teachingNodes')
    
    expect(typeof fingerprint.questions).toBe('number')
    expect(typeof fingerprint.tags).toBe('number')
    expect(typeof fingerprint.questionTags).toBe('number')
    expect(typeof fingerprint.papers).toBe('number')
    expect(typeof fingerprint.teachingNodes).toBe('number')
  })

  it('checkSyncDataIntegrity 应该正确检测数据减少', () => {
    const before = {
      questions: 100,
      tags: 20,
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const after = {
      questions: 90, // 减少10%
      tags: 20,
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const result = funcs.checkSyncDataIntegrity(before, after)
    
    expect(result.passed).toBe(false)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].table).toBe('questions')
    expect(result.warnings[0].before).toBe(100)
    expect(result.warnings[0].after).toBe(90)
    expect(result.warnings[0].lost).toBe(10)
  })

  it('checkSyncDataIntegrity 应该通过正常数据', () => {
    const before = {
      questions: 100,
      tags: 20,
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const after = {
      questions: 100,
      tags: 20,
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const result = funcs.checkSyncDataIntegrity(before, after)
    
    expect(result.passed).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('checkSyncDataIntegrity 应该检测严重数据丢失', () => {
    const before = {
      questions: 100,
      tags: 20,
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const after = {
      questions: 50, // 减少50%
      tags: 0, // 完全丢失
      questionTags: 300,
      papers: 5,
      teachingNodes: 10
    }
    
    const result = funcs.checkSyncDataIntegrity(before, after)
    
    expect(result.passed).toBe(false)
    expect(result.warnings).toHaveLength(2)
    
    const questionsWarning = result.warnings.find(w => w.table === 'questions')
    expect(questionsWarning.severity).toBe('critical')
    
    const tagsWarning = result.warnings.find(w => w.table === 'tags')
    expect(tagsWarning.severity).toBe('critical')
  })
})

describe('版本信息丢弃检测', () => {
  it('_checkVersionsDiscard 应该检测版本信息丢失', () => {
    const localQ = {
      id: 'q1',
      versions: ['v1', 'v2', 'v3']
    }
    
    const remoteQ = {
      id: 'q1',
      versions: []
    }
    
    const result = funcs._checkVersionsDiscard(localQ, remoteQ)
    
    expect(result).not.toBeNull()
    expect(result.table).toBe('versions')
    expect(result.before).toBe(3)
    expect(result.after).toBe(0)
    expect(result.lost).toBe(3)
    expect(result.severity).toBe('critical')
  })

  it('_checkVersionsDiscard 应该通过正常版本数据', () => {
    const localQ = {
      id: 'q1',
      versions: ['v1', 'v2', 'v3']
    }
    
    const remoteQ = {
      id: 'q1',
      versions: ['v1', 'v2', 'v3']
    }
    
    const result = funcs._checkVersionsDiscard(localQ, remoteQ)
    
    expect(result).toBeNull()
  })
})