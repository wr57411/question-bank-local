# 备份落盘改造（写入应用私有目录）实施计划

> **子技能要求**：执行本计划请用 `superpowers:executing-plans`（新会话批量）或
> `superpowers:subagent-driven-development`（本会话逐任务 + 复核）。

**目标**：让备份 / 导出 / 恢复在 Android 11+（本项目 targetSdk 34）上**不依赖「所有文件访问」权限**即可工作。

**做法**：落盘位置从**公共** `Directory.Documents` 改为 **`Directory.External`**（应用专属外部目录）；
同时修掉 ① `mkdir` 静默吞错 ② 导出目录名（带日期）与恢复读取目录名（固定）不一致。

### 目录映射（Capacitor 6 / Android，来自插件源码 `Filesystem.java:205-223`）

| `Directory` | 真实路径 | 是否需要权限 | 文件管理器可见 |
|---|---|---|---|
| `Documents` | `/storage/emulated/0/Documents` | **需要（targetSdk 34 下要「所有文件访问」）** | ✅ 直接可见 |
| `Data` / `Library` | `/data/data/<包名>/files` | 不需要 | ❌ **真私有，非 root 进不去** |
| **`External`（采用）** | **`/storage/emulated/0/Android/data/<包名>/files`** | **不需要**（不在 `isPublicDirectory` 的 `DOCUMENTS`/`EXTERNAL_STORAGE` 名单内） | ⚠️ 电脑 USB / 多数 OEM 自带文件管理器可见；被 Android 11+ 的第三方文件管理器与系统选择器屏蔽 |
| `ExternalStorage` | `/storage/emulated/0` | 需要 | ✅ |

> **为什么不用 `Data`**：它就是"访问不了"的那个（`/data/data/...`）。
> **为什么不继续用 `Documents`**：targetSdk 34 下写它需要用户去系统设置手动授「所有文件访问」，
> 而插件的权限判断在 API≥30 直接返回 true、**不会引导授权** → 写操作被系统拒绝（本次故障根因）。

**技术栈**：TypeScript / Capacitor 6 `@capacitor/filesystem` / vitest(jsdom) / Playwright。

---

## 根因（已实证，勿再重新推理）

| 环节 | 事实 |
|---|---|
| 目标目录 | `Directory.Documents` = `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOCUMENTS)` → **公共 `/storage/emulated/0/Documents/`** |
| 清单 | 声明了 `MANAGE_EXTERNAL_STORAGE`（须用户去系统设置手动开关）；`targetSdk = 34` |
| 插件判断 | `isStoragePermissionGranted()` 在 `SDK_INT >= R` **直接返回 true** → 插件**不会申请权限** |
| 现象 | 系统层 scoped storage 拒绝 → `IOException` → 插件回 `FILE_NOTCREATED` |

**另一条独立缺陷**：`exportAllData` 写 `question-bank-backup-<日期>/`，而 `loadBackupFromDevice`
只读 `question-bank-backup/` → **导出的备份恢复不了**。

---

### Task 1：落盘目录切到应用专属外部目录 `External`

**Files**（全部在 `src/ui/backup.ts`）
- Modify: `getBackupDir()`（约 `:131` 附近，现返回 `'DOCUMENTS'`）→ 返回 **`'EXTERNAL'`**
- Modify: `getShardedBackupDir()`（约 `:19-22`）、`getDatedBackupDir()`（约 `:25-29`）、`getBackupPath()`（约 `:131-134`）——它们都引用 `getBackupDir()` 或各自的 `custom` 分支，统一改为使用新目录的语义（保留 `custom` 覆盖能力）
- Test: `unit-tests/backup-private-dir.spec.ts`（新建）

**Step 1：写失败测试**

```ts
// 断言：native 读写时传给 Filesystem 的 directory 必须是 'EXTERNAL'
// —— 既不能是公共 'DOCUMENTS'（需权限、本项目故障根因），也不能是 'DATA'（真私有、用户取不出文件）
it('备份读写使用应用专属外部目录（EXTERNAL）', async () => {
  const fs = installFakeCapacitor();          // 捕获 writeFile/mkdir/readFile 的入参
  await exportAllData();
  const writeCall = fs.writeFile.mock.calls[0][0];
  expect(writeCall.directory).toBe('EXTERNAL');
  expect(writeCall.directory).not.toBe('DOCUMENTS');
  expect(writeCall.directory).not.toBe('DATA');
});
```

**Step 2：跑测试确认失败**

```bash
NODE_OPTIONS= npx vitest run unit-tests/backup-private-dir.spec.ts
```
预期 FAIL：`expected 'DOCUMENTS' to be 'DATA'`

**Step 3：改实现**（把默认目录从 `'DOCUMENTS'` 改为 `'DATA'`）

**Step 4：跑测试确认通过**（同上命令，预期 PASS）

**Step 5：不提交**（本项目规则：AI 不 commit，等王先生统一提交）

---

### Task 2：`mkdir` 失败不再被静默吞掉

**Files**
- Modify: `src/ui/backup.ts` `writeShardedBackup()` 中 `Filesystem.mkdir(...)` 的 `catch`

**Step 1：写失败测试**

```ts
it('mkdir 因「已存在」失败时应容忍；因其它原因失败时必须报出真实原因', async () => {
  const fs = installFakeCapacitor({ mkdirError: new Error('mkdir failed: EACCES') });
  await expect(exportAllData()).rejects.toThrow(/EACCES|无法创建目录/);   // 不得退化成 FILE_NOTCREATED
});
```

**Step 2：跑测试确认失败** — 当前实现会吞掉该错误，测试拿不到 `EACCES`

**Step 3：改实现**：catch 中判断错误信息是否表示"已存在"（含 `exists` / `EXISTS` 等），
是则忽略；**否则重新抛出并带上原始信息**（文案如 `无法创建备份目录：<原始信息>`）

**Step 4：跑测试确认通过**

**Step 5：不提交**

---

### Task 3：恢复入口与导出目录对齐（修掉"导出恢复不了"）

**Files**
- Modify: `src/ui/backup.ts` `loadBackupFromDevice()`（约 `:340`）

**Step 1：写失败测试**

```ts
it('恢复应能同时找到固定目录与带日期目录，并优先使用最新的一个', async () => {
  const fs = installFakeCapacitor({ dirs: {
    'question-bank-backup-2026-09-14': { 'manifest.json': okManifest(2) },
  }});
  await loadBackupFromDevice();
  expect(fs.readFile.mock.calls.some(c => String(c[0].path).includes('2026-09-14'))).toBe(true);
});
```

**Step 2：跑测试确认失败** — 当前只读固定名目录

**Step 3：改实现**：探测顺序 = 固定目录 → 若不存在，列 DOCUMENTS/DATA 下所有 `question-bank-backup*`
目录，取**名称里日期最新**的一个；**并把最终使用的目录名显示给用户**（避免"我到底恢复了哪一份"的模糊）

**Step 4：跑测试确认通过**

**Step 5：不提交**

---

### Task 4：旧备份兼容 + 失败文案

**Files**
- Modify: `src/ui/backup.ts` `loadBackupFromDevice()` 的旧单文件回退分支
- Modify: 提示文案（`showStatus`）

**Step 1：写失败测试**

```ts
it('找不到任何备份时，必须明确报错并给出目录提示，不得出现"恢复成功 0 题"', async () => {
  const fs = installFakeCapacitor({ dirs: {} });
  await expect(loadBackupFromDevice()).rejects.toThrow(/未找到备份|没有可恢复/);
});
```

**Step 2：跑测试确认失败**

**Step 3：改实现**：旧单文件路径保留（历史备份仍可恢复），但"找不到"时报明确错误并说明
查找过哪些位置（例如 `应用私有目录/…`）

**Step 4：跑测试确认通过**

**Step 5：不提交**

---

### Task 5：更新既有测试 + 全量验证循环（AGENTS.md 强制）

**Files**
- Modify: `unit-tests/backup-utf8-write.spec.ts`、`unit-tests/backup-shard-import.spec.ts`
  （它们此前断言 `directory: 'DOCUMENTS'`，需改为 `'DATA'`）
- Modify: `tests/backup-status-visibility.spec.js`（若涉及路径文案）

**Step 1**：更新上述测试中的目录断言（**不得削弱任何既有防线**：`btoa`/`atob` 调用数必须仍为 0、
`encoding` 必须仍为 `utf8`、分片格式断言保留）

**Step 2：复现性演练**：把目录改回 `'DOCUMENTS'` → 确认 `backup-private-dir.spec.ts` **变红** → 改回

**Step 3**：
```bash
npm run typecheck
npm run test 2>&1 | tail -20
npm run build
NODE_OPTIONS= npx playwright test --reporter=list --output=tmp/test-results-private-dir
```

**Step 4：不提交**

---

### Task 6：真机验证（王先生执行，AI 不得代宣布）

在**平板**上依次验证：
1. 「💾 保存备份到设备」→ 不再报 `FILE_NOTCREATED`
2. 「📤 导出」→ 同上
3. 「☁️ 备份 → 📂 加载备份」→ 恢复成功后题数/标签/关联正确
4. 手机上（已授过权限）回归一次，确认没被改坏

> **取备份文件的可用性**：落盘在 `/storage/emulated/0/Android/data/com.questionbank.local/files/…`。
> - **连电脑（USB/MTP）通常可以直接看到并拷走** ✓
> - **vivo/小米/OPPO 等 OEM 自带文件管理器通常也能进 `Android/data/`** ✓（王先生已观察到自己能访问应用内部目录）
> - ❌ 被 Android 11+ 的**第三方**文件管理器与系统文件选择器屏蔽
> - 兜底：百度网盘上传 / 应用内"分享"（后续可加）
>
> 相比 `Documents` 的唯一损失是"路径深了一点、部分工具进不去"；换来的是**不需要任何权限就必然可写**。

---

### Task 7：预览临时文件在公共目录反复出现（王先生 2026-09-14 要求列入）

**现象**：手机上每次做 PDF 预览后，文件管理器里会出现
`手机存储/我的文档/vivo文档/preview_temp.pdf`（实测 21:35 生成，633KB，**不会被清掉**）。

**已核实的事实**：
- 全仓只有两处写 `preview_temp.pdf`：`src/ui/export-pdf-ui.ts:184`（**`directory:'CACHE'`**，活代码）
  与 `public/app.js:3817`（**死代码**，`src/index.html` 不加载 `app.js`）
- **打包产物（手机上真正运行的）里写的是 `CACHE`** → 应用自身没有往公共目录写该文件
- `Directory.CACHE` = `getCacheDir()` = `/data/data/<包名>/cache`（**内部存储，文件管理器不可见**）
- 打开方式是 `FileOpener.open({ filePath: uri })` → **把文件交给系统/OEM 文档服务打开**

**主假设**：文件由 **vivo 文档服务在打开时复制** 到自己的文档工作区（`我的文档/vivo文档/`），
我们的 30 秒自删只删得到内部缓存里的原件，删不到这份副本。

**Step 1：定位结论（王先生已确认，无需再做实验）**

> 王先生原话：「它只要是在预览，就马上会生成，而且会连续生成好几个：预览一个，就生成一个。」

即：**触发点是"预览"这个动作**，每次预览产生一个，且**会累积（多个）**。

**这条与"文件名固定"的矛盾值得注意**：我们的代码用固定名 `preview_temp.pdf` 写入，
若由我们写、且同名，则只会有一份（覆盖）。**现实中会累积成好几个** → 更支持
"由 OEM 文档服务在打开时复制、并按它的规则避免覆盖"这一判断。
但无论成因是"我们写到了公共目录"还是"OEM 复制"，**修法相同**，故不再纠缠成因。

**Step 2（修法）：改为应用内预览，不再交给外部文档服务**

- **可行性已确认**：`pdfjs-dist@^6.1.200` **已在依赖中**，且 `src/types/pdfjs.d.ts` 已声明
  `getViewport` / `render`(canvasContext) → 具备在应用内渲染 PDF 到 canvas 的能力，**不需要引新库**
- 做法：预览时不写文件、不走 `FileOpener`，改为把 `doc.output('arraybuffer')` 交给 pdfjs 渲染到
  `<canvas>`，显示在应用内弹窗（复用现有 modal 体系，注意 `modal-anchor` / 层级规范）
- 保留「导出 PDF」按钮走原来的写文件路径（**王先生裁决：导出继续落公共目录，不动**）
- 说明：**已经存在于公共目录的旧副本不在我们控制范围内**，需王先生手动删一次

**Step 3：验证**
- 复现性：修复后连续做 3 次预览，文件管理器里**不再出现新文件**
- 应用内预览可见性：按 AGENTS.md 的 UI 改动要求**截图 + `assertVisiblyRendered`**（新增的是 canvas 弹窗）
- 既有测试回归：类型检查 + 单测 + 全量 E2E
- 不提交（项目规则）

> **注意**：Task 7 与 Task 1–6 相互独立（前者是"应用产物的落点与清理"，后者是"备份落盘位置"），
> 但同属"应用文件不该污染公共目录"这一主题，**可一并打包，减少打包次数**。

---

## 不做（边界）

1. 不申请 / 不引导「所有文件访问」权限
2. 不改数据模型、不做存量数据迁移
3. 不动同步链路、不动百度网盘路径
4. 不动 Web 分支（Blob 下载不受此问题影响）
5. 不自动 commit

## 风险

| 风险 | 对策 |
|---|---|
| 部分第三方工具进不去 `Android/data/` | 已知限制；USB 连电脑与 OEM 自带文件管理器通常可用；兜底走百度网盘/分享 |
| 既有测试因目录名变更而失败 | Task 5 显式更新，且**只改目录断言、不削弱其它防线** |
| 老设备（Android ≤10）行为差异 | `getExternalFilesDir` 在旧版本同样可写，风险低 |
| 用户在「所有文件访问」已授权的设备上（如手机）切到 `External` 后旧备份找不到 | Task 3/4 的探测顺序需**同时覆盖旧位置**（`Documents`）与新位置，保证旧备份仍可恢复 |
