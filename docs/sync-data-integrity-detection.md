# 同步数据丢弃检测与UI风险提醒机制

## 背景

用户在一台设备上为题目勾选"适用版本"后，同步到服务器时 `versions` 字段被丢弃。新设备安装后无法获取这些版本关联，导致题目在版本筛选下不可见。本方案在修复根因的基础上，增加了数据丢弃检测和用户提醒机制。

## 实施内容

### 第一部分：根因修复（`versions` 字段同步）

#### 1. `dbBuildSyncPayload()` — 上传 payload 补充 `versions`

**文件**：`www/db.js` 行 1175  
**变更**：在 `questionPayload.push({...})` 中增加 `versions` 字段

```js
questionPayload.push({
  id: question.id,
  question_image_url: question.question_image_url,
  answer_image_url: question.answer_image_url,
  layout_type: question.layout_type || 0,
  versions: question.versions || [],          // ← 新增
  created_at: question.created_at || question.updated_at || _nowIso(),
  // ...其余字段不变
});
```

#### 2. `dbApplyRemoteSnapshot()` — 下载恢复补充 `versions`

**文件**：`www/db.js` 行 1343-1345  
**变更**：在 `nextQuestion = {...}` 中增加 `versions` 恢复逻辑

```js
const nextQuestion = {
  id: question.id,
  question_image_url: qImg,
  answer_image_url: aImg,
  layout_type: question.layout_type || 0,
  versions: question.versions !== undefined
    ? question.versions
    : (localQuestion ? localQuestion.versions || [] : []),
  // ...其余字段不变
};
```

### 第二部分：数据丢弃检测 + 弹窗提醒

#### 3. 新增数据指纹采集函数 `collectDataFingerprint()`

**文件**：`www/db.js` 行 1089-1097  
**职责**：同步前后采集关键表的记录数

```js
async function collectDataFingerprint() {
  const fp = {};
  fp.questions = await _countStore(dbQuestions);
  fp.tags = await _countStore(dbTags);
  fp.questionTags = await _countStore(dbQuestionTags);
  fp.papers = await _countStore(dbPapers);
  fp.teachingNodes = await _countStore(dbTeachingNodes);
  return fp;
}
```

#### 4. 新增数据完整性校验函数 `checkSyncDataIntegrity()`

**文件**：`www/db.js` 行 1099-1119  
**职责**：比较 before/after 指纹，阈值 10% 减少或从有到无

```js
function checkSyncDataIntegrity(before, after) {
  const warnings = [];
  const tables = ['questions', 'tags', 'questionTags', 'papers', 'teachingNodes'];
  for (const table of tables) {
    const b = before[table] || 0;
    const a = after[table] || 0;
    if (b > 0 && a < b) {
      const ratio = (b - a) / b;
      if (ratio >= 0.1 || (b > 0 && a === 0)) {
        warnings.push({
          table,
          before: b,
          after: a,
          lost: b - a,
          severity: ratio >= 0.5 || a === 0 ? 'critical' : 'warning'
        });
      }
    }
  }
  return { passed: warnings.length === 0, warnings };
}
```

#### 5. 新增版本信息丢弃检测函数 `_checkVersionsDiscard()`

**文件**：`www/db.js` 行 1121-1135  
**职责**：检测本地有版本信息但远程为空的情况

```js
function _checkVersionsDiscard(localQ, remoteQ) {
  if (!localQ || !localQ.versions || localQ.versions.length === 0) return null;
  const remoteVersions = remoteQ.versions || [];
  if (remoteVersions.length === 0) {
    return {
      table: 'versions',
      before: localQ.versions.length,
      after: 0,
      lost: localQ.versions.length,
      severity: 'critical',
      detail: '题目 ' + localQ.id + ' 的版本信息丢失'
    };
  }
  return null;
}
```

#### 6. 集成检测到 `dbApplyRemoteSnapshot()`

**文件**：`www/db.js` 行 1313、1449-1455  
**变更**：在函数开始处采集 fpBefore，在结束处采集 fpAfter 并比较

```js
async function dbApplyRemoteSnapshot(snapshot) {
  const fpBefore = await collectDataFingerprint();  // 同步前指纹
  const syncWarnings = [];
  try {
    // ... 同步逻辑 ...
    
    // 版本信息丢弃检测
    const versionsWarning = _checkVersionsDiscard(localQuestion, nextQuestion);
    if (versionsWarning) syncWarnings.push(versionsWarning);
    
    // ... 同步逻辑 ...
    
    const fpAfter = await collectDataFingerprint();   // 同步后指纹
    const integrity = checkSyncDataIntegrity(fpBefore, fpAfter);
    if (!integrity.passed) syncWarnings.push(...integrity.warnings);
    if (syncWarnings.length > 0) {
      console.warn('[Sync] 数据完整性警告:', syncWarnings);
      if (typeof _onSyncDataWarning === 'function') _onSyncDataWarning(syncWarnings);
    }
    return { passed: syncWarnings.length === 0, warnings: syncWarnings };
  } finally {
    _invalidateQuestionsCache();
    _invalidateTagIndex();
  }
}
```

#### 7. 新增警告弹窗 HTML 结构

**文件**：`www/index.html` 行 889-898  
**变更**：添加同步警告弹窗的 HTML 结构

```html
<div id="sync-warning-modal" class="modal" onclick="if(event.target===this)closeSyncWarning()">
    <div class="modal-content" style="max-width:480px;text-align:center;padding:32px 24px">
        <div style="font-size:48px;margin-bottom:12px">⚠️</div>
        <h2 style="margin:0 0 12px;font-size:17px;font-weight:700;color:var(--warning)">同步数据异常</h2>
        <p id="sync-warning-message" style="font-size:14px;color:var(--text);margin:0 0 16px;line-height:1.6">同步过程中检测到本地数据可能丢失。</p>
        <div id="sync-warning-details" style="background:var(--surface-dim);border-radius:var(--radius-md);padding:12px;font-size:12px;color:var(--text-secondary);text-align:left;margin-bottom:16px"></div>
        <p style="font-size:12px;color:var(--text-tertiary);margin:0 0 16px">建议立即执行本地备份，避免数据丢失。</p>
        <button onclick="closeSyncWarning()" style="background:var(--warning);color:#fff;padding:10px 32px;border:none;border-radius:var(--radius-md);font-size:14px;cursor:pointer">确认</button>
    </div>
</div>
```

#### 8. 新增弹窗控制函数

**文件**：`www/index.html` 行 6790-6808  
**变更**：添加 `showSyncWarning()` 和 `closeSyncWarning()` 函数

```js
function showSyncWarning(warnings) {
    const detailsEl = document.getElementById('sync-warning-details');
    detailsEl.innerHTML = warnings.map(w =>
        `<div style="margin-bottom:6px"><strong>${w.table}</strong>: ${w.before} → ${w.after} 条 (丢失 ${w.lost} 条)${w.detail ? '<br><span style="color:var(--text-tertiary)">' + w.detail + '</span>' : ''}</div>`
    ).join('');
    const msgEl = document.getElementById('sync-warning-message');
    const hasCritical = warnings.some(w => w.severity === 'critical');
    msgEl.textContent = hasCritical
        ? '同步过程中检测到严重数据丢失，部分题目可能未同步成功。'
        : '同步过程中检测到部分数据量减少，可能存在数据丢弃。';
    document.getElementById('sync-warning-modal').classList.add('active');
    console.warn('[Sync Warning]', warnings);
}

function closeSyncWarning() {
    document.getElementById('sync-warning-modal').classList.remove('active');
}
```

#### 9. 绑定回调

**文件**：`www/index.html` 行 1738-1740  
**变更**：在应用启动时绑定同步数据警告回调

```js
if (typeof setOnSyncDataWarning === 'function') {
    setOnSyncDataWarning(showSyncWarning);
}
```

## 测试覆盖

### 单元测试

新增测试文件 `unit-tests/sync-integrity.spec.js`，包含 6 个测试用例：

1. **collectDataFingerprint** 应该返回正确的数据结构
2. **checkSyncDataIntegrity** 应该正确检测数据减少（10% 阈值）
3. **checkSyncDataIntegrity** 应该通过正常数据
4. **checkSyncDataIntegrity** 应该检测严重数据丢失（50% 或完全丢失）
5. **_checkVersionsDiscard** 应该检测版本信息丢失
6. **_checkVersionsDiscard** 应该通过正常版本数据

### 测试结果

```
✓ unit-tests/sync-integrity.spec.js (6 tests) 6ms
  ✓ 同步数据完整性检测 (4)
    ✓ collectDataFingerprint 应该返回正确的数据结构 3ms
    ✓ checkSyncDataIntegrity 应该正确检测数据减少 1ms
    ✓ checkSyncDataIntegrity 应该通过正常数据 0ms
    ✓ checkSyncDataIntegrity 应该检测严重数据丢失 0ms
  ✓ 版本信息丢弃检测 (2)
    ✓ _checkVersionsDiscard 应该检测版本信息丢失 1ms
    ✓ _checkVersionsDiscard 应该通过正常版本数据 0ms
```

## 设计约束

1. **轻量非阻塞**：仅在同步入口/出口各调一次 `iterate` 计数，不影响正常同步性能
2. **不改变核心逻辑**：作为现有同步流程的补充，不改变根本修复逻辑
3. **弹窗非阻塞**：弹窗仅显示警告信息，不阻断用户操作
4. **事件日志**：通过 `console.warn` 记录事件，方便调试

## 影响范围

- **修改文件**：`www/db.js`（+66行）、`www/index.html`（+116行）
- **新增文件**：`unit-tests/sync-integrity.spec.js`（146行）
- **测试结果**：105 unit + 8 E2E = 113 tests, 0 failures（不含新增的6个同步测试）

## 验证步骤

1. 在一台设备上为题目勾选"适用版本"
2. 触发同步到服务器
3. 在另一台设备上登录并拉取数据
4. 检查题目是否保留了版本信息
5. 如果同步过程中检测到数据减少，应弹出警告弹窗