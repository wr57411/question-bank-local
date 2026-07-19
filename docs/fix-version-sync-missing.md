# 修复版本同步缺陷 + 数据丢弃检测机制

## 第一部分：根因修复（`versions` 字段同步）

### 1.1 `dbBuildSyncPayload()` — 上传 payload 补充 `versions`

**文件**：`www/db.js` 行 1117
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

### 1.2 `dbApplyRemoteSnapshot()` — 下载恢复补充 `versions`

**文件**：`www/db.js` 行 1282
**变更**：在 `nextQuestion = {...}` 中增加 `versions` 恢复逻辑

```js
const nextQuestion = {
  id: question.id,
  question_image_url: qImg,
  answer_image_url: aImg,
  layout_type: question.layout_type || 0,
  versions: question.versions !== undefined
    ? question.versions
    : (localQuestion ? localQuestion.versions || [] : []),  // ← 新增
  created_at: question.created_at || question.updated_at || _nowIso(),
  // ...其余字段不变
};
```

### 1.3 同步日志扩展 — 同步 payload 增加 `versions` 字段计数

在 `dbBuildSyncPayload()` 返回前，统计含版本关联的题目数量并记入日志（可选）。

---

## 第二部分：数据丢弃检测机制

### 2.1 检测时机与策略

**检测函数**：`checkSyncDataIntegrity(beforeCounts, afterCounts)`

**检测点**：在 `dbApplyRemoteSnapshot()` 执行前后各采集一次数据快照（关键表记录数），执行后对比。

**检测指标**（轻量，仅记录数字）：
- `questions` 记录数
- `tags` 记录数
- `question_tags` 记录数
- `papers` 记录数
- `teaching_nodes` 记录数

**判定规则**：
- 任何关键表记录数减少超过 **10%** 且减少绝对值 >= **1** 条 → 标记为"潜在数据丢弃"
- `questions` 表记录数从 >0 降为 0 → 标记为"严重数据丢弃"
- `versions` 字段在同步前后有值变为空数组 → 标记为"版本信息丢失"（即使记录数未减）

### 2.2 实现方案

#### 2.2.1 新增函数：`collectDataFingerprint()`

**文件**：`www/db.js`

```js
async function collectDataFingerprint() {
  let questions = 0, tags = 0, questionTags = 0, papers = 0, teachingNodes = 0;
  await dbQuestions.iterate(() => questions++);
  await dbTags.iterate(() => tags++);
  await dbQuestionTags.iterate(() => questionTags++);
  await dbPapers.iterate(() => papers++);
  await dbTeachingNodes.iterate(() => teachingNodes++);
  return { questions, tags, questionTags, papers, teachingNodes };
}
```

#### 2.2.2 新增函数：`checkSyncDataIntegrity(before, after)`

**文件**：`www/db.js`

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

#### 2.2.3 集成到 `dbApplyRemoteSnapshot()`

**文件**：`www/db.js`

在函数入口处采集 before 指纹，出口处采集 after 指纹并调用检测：

```js
async function dbApplyRemoteSnapshot(snapshot) {
  const fpBefore = await collectDataFingerprint();
  // ... 原有逻辑不变 ...
  const fpAfter = await collectDataFingerprint();
  const integrity = checkSyncDataIntegrity(fpBefore, fpAfter);
  if (!integrity.passed) {
    console.warn('[Sync] 数据完整性警告:', integrity.warnings);
    if (typeof _onSyncDataWarning === 'function') {
      _onSyncDataWarning(integrity.warnings);
    }
  }
  return integrity;
}
```

#### 2.2.4 回调机制：`_onSyncDataWarning`

**文件**：`www/db.js`

定义一个全局回调变量，由 `index.html` 在页面加载时设置：

```js
let _onSyncDataWarning = null;
function setOnSyncDataWarning(fn) { _onSyncDataWarning = fn; }
```

### 2.3 UI 层：数据同步警告弹窗

#### 2.3.1 HTML 结构

**文件**：`www/index.html`，在投屏覆盖层之前新增：

```html
<div id="sync-warning-modal" class="modal" onclick="if(event.target===this)closeSyncWarning()">
  <div class="modal-content" style="max-width:480px;text-align:center;padding:32px 24px">
    <div style="font-size:48px;margin-bottom:12px">⚠️</div>
    <h2 style="margin:0 0 12px;font-size:17px;font-weight:700;color:var(--warning)">同步数据异常</h2>
    <p id="sync-warning-message" style="font-size:14px;color:var(--text);margin:0 0 16px;line-height:1.6">
      同步过程中检测到本地数据可能丢失。
    </p>
    <div id="sync-warning-details" style="background:var(--surface-dim);border-radius:var(--radius-md);padding:12px;font-size:12px;color:var(--text-secondary);text-align:left;margin-bottom:16px"></div>
    <p style="font-size:12px;color:var(--text-tertiary);margin:0 0 16px">
      建议：请勿切换设备，建议立即执行本地备份。
    </p>
    <button onclick="closeSyncWarning()" style="background:var(--warning);color:#fff;padding:10px 32px;border:none;border-radius:var(--radius-md);font-size:14px;cursor:pointer">确认</button>
  </div>
</div>
```

#### 2.3.2 JS 函数

**文件**：`www/index.html`

```js
function showSyncWarning(warnings) {
  const detailsEl = document.getElementById('sync-warning-details');
  detailsEl.innerHTML = warnings.map(w =>
    `<div style="margin-bottom:6px"><strong>${w.table}</strong>: ${w.before} → ${w.after} 条 (丢失 ${w.lost} 条)</div>`
  ).join('');
  const msgEl = document.getElementById('sync-warning-message');
  const hasCritical = warnings.some(w => w.severity === 'critical');
  msgEl.textContent = hasCritical
    ? '同步过程中检测到严重数据丢失，部分题目可能未同步成功。'
    : '同步过程中检测到部分数据量减少，可能存在数据丢弃。';
  document.getElementById('sync-warning-modal').classList.add('active');
  // 记录到 localStorage 日志
  const log = JSON.parse(localStorage.getItem('syncWarningLog') || '[]');
  log.push({ time: new Date().toISOString(), warnings });
  if (log.length > 50) log.splice(0, log.length - 50);
  localStorage.setItem('syncWarningLog', JSON.stringify(log));
}

function closeSyncWarning() {
  document.getElementById('sync-warning-modal').classList.remove('active');
}
```

#### 2.3.3 回调绑定

**文件**：`www/index.html`，在 `initRemoteSync` 调用后设置回调：

```js
if (typeof setOnSyncDataWarning === 'function') {
  setOnSyncDataWarning(showSyncWarning);
}
```

---

## 第三部分：版本关联检测增强

### 3.1 `versions` 字段丢弃专项检测

在 `dbApplyRemoteSnapshot()` 中，对每个 question 做如下检查：

```js
// 在 nextQuestion 构建后、写入 DB 前
if (localQuestion && localQuestion.versions && localQuestion.versions.length > 0
    && (!nextQuestion.versions || nextQuestion.versions.length === 0)) {
  warnings.push({
    table: 'versions',
    before: localQuestion.versions.length,
    after: 0,
    lost: localQuestion.versions.length,
    severity: 'critical',
    detail: `题目 ${question.id} 的版本信息丢失`
  });
}
```

---

## 文件变更清单

| 文件 | 操作 | 变更说明 |
|------|------|---------|
| `www/db.js` | 修改 | `dbBuildSyncPayload` 补充 versions + `dbApplyRemoteSnapshot` 补充 versions + 新增 `collectDataFingerprint` + `checkSyncDataIntegrity` + `_onSyncDataWarning` 回调 |
| `www/index.html` | 修改 | 新增 sync-warning-modal HTML + `showSyncWarning` / `closeSyncWarning` JS + 绑定回调 |
| `docs/fix-version-sync-missing.md` | 修改 | 追加检测机制说明 |

## 实施顺序

1. 修复 `dbBuildSyncPayload` 的 `versions` 字段
2. 修复 `dbApplyRemoteSnapshot` 的 `versions` 字段
3. 新增 `collectDataFingerprint` + `checkSyncDataIntegrity` 函数
4. 在 `dbApplyRemoteSnapshot` 中集成检测
5. 在 index.html 新增警告弹窗 UI + JS
6. 绑定回调 + 运行验证
