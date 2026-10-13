# 移除"从书本添加"+ AI 组卷；导出 PDF 入册试卷管理（v2：试卷云端化）

日期：2026-09-04（v2 覆盖 v1；v1 的"pdf_path 本地不同步"方案废弃）
分支：`f640/main2` @ 23e551c
状态：**待确认，未动代码**

## 一、需求

1. **移除"从书本添加"模块**：纯文字记录 + 批量录入 + 书本信息（书名/页码/题号）——核心添加方式是图片
2. **移除**「用标签创建试卷」「AI 智能组卷」
3. **新增**：选题导出 PDF 后**手动勾选**（默认不勾）添加到试卷管理
4. **试卷 PDF 是云端数据**：生成即上传服务器；本地有缓存则本地打开，没有则从服务器下载后打开

## 二、数据模型（v2 核心变化）

```
Paper {
  ...现有字段,
  pdf_url: string | null        // 服务器路径 /uploads/xxx.pdf —— 随同步分发，跨设备有效
  pdf_local_path: string | null // 设备本地缓存路径 —— 仅本机，不同步
}
```

| 场景 | 行为 |
|---|---|
| 生成（勾选） | 本地已有 PDF 文件 → 上传服务器拿 pdf_url → 建卷（名字=导出文件名，关联选题，存 pdf_url + pdf_local_path）→ 随同步分发到其他设备 |
| 打开（本地有缓存） | FileOpener 直接打开 pdf_local_path |
| 打开（本地无缓存） | 下载 `serverUrl + pdf_url` → 写入 DOCUMENTS/papers-cache/ → 更新 pdf_local_path → FileOpener 打开 |
| 打开（Web 端） | window.open(serverUrl + pdf_url) |
| 离线导出（上传失败） | pdf_url 留空、pdf_local_path 有 → 建卷成功 + toast「仅本地可用」；不自动重试（YAGNI） |

## 三、移除清单（与 v1 相同，路径精确）

### 3.1 添加方式与书本信息
- `src/index.html` L207-209：删「纯文字记录」「批量录入」按钮；添加方式选择器整行删（只剩拍照）
- `src/index.html` L213-218 `#book-info-section`、L220-245 左右 `#batch-section`、L359 `#book-filter`、`#book-name-list` datalist 删
- `src/ui/question-core.ts`：switchAddMode/addBatchRow/removeBatchRow/getBatchEntries 删；提交逻辑 batch 分支与 bookName 读取删；photo 区默认可见（initQuestionForm 显式设置）
- `src/ui/question-detail.ts`：bookHtml 书本编辑段 + saveBookInfo 删
- `src/init-app.ts`：loadBookFilter 调用摘
- `src/ui/quick-import.ts` L282：`args.bookInfo` → `null`
- `src/main.ts`：对应导出摘除
- **数据层零改动**：questions 表列/类型字段/同步/备份全保留（旧数据兼容），仅断写入源

### 3.2 AI 组卷 + 建卷表单
- `src/index.html`：AI 推荐卡片、「创建试卷」表单卡（paper-form + paper-tag-select）、`#ai-recommend-modal` 删
- `src/ui/paper-manage.ts`：startAIPaperGeneration / renderAIRecommendations / closeAIRecommendModal / createPaperFromAI / initPaperForm 删
- `src/ui/test-god-mode.ts` L40-52：AI 组卷步骤删
- `src/main.ts`：对应导出摘除
- 试卷列表/详情/删除/导出试卷为 PDF/图片 **保留**

## 四、新增：云端试卷

### 4.1 服务端（3 处小改 + 1 个新路由）
- `server/src/db/schema.ts`：尾部追加 `ensureColumn('papers', 'pdf_url', 'TEXT');`（迁移模式已有先例）
- `server/src/services/sync-upsert.ts`：upsertPaper 的 UPDATE/INSERT SQL 列清单加 `pdf_url`（payload 构建时已剔除本地字段，见 4.2）
- pull 无需改（SELECT * 自然带出 pdf_url）
- **新路由 `server/src/routes/upload-pdf.ts`**：POST /api/upload-pdf，authMiddleware + multer（**limit 50MB**，现 /api/upload 的 10MB 装不下大卷 PDF），存 uploads/，返回 `{ url }`；`app.ts` 挂载。（不复用 /api/upload 是为避免放宽全局限制影响其他上传）

### 4.2 客户端数据层
- `src/types/paper.ts`：Paper 加 `pdf_url?: string | null`、`pdf_local_path?: string | null`
- `src/data/papers.ts` 新增：
  - `dbCreatePaperFromExport(name, questionIds, pdfUrl, pdfLocalPath)`：建卷 + 逐题写 paper_questions + 存双路径
  - `dbEnsurePaperPdfLocal(paper)`：下载缓存（fetch serverUrl+pdf_url → base64 → Filesystem.writeFile DOCUMENTS/papers-cache/ → 更新 pdf_local_path）
- `src/data/sync.ts`：dbBuildSyncPayload 的 papers iterate 后 **sanitize 剔除 pdf_local_path**（本地字段不进服务端）；dbApplyRemoteSnapshot 的 papers 段改 **merge 写入**（无条件 setItem 会把服务端记录覆盖本地 pdf_local_path —— 同步审查已知问题，此处必须合并保留本地字段）

### 4.3 客户端 UI
- `src/ui/export-pdf-ui.ts`：
  - 导出弹窗加 checkbox `#export-to-paper`（**默认不勾**，文案「完成后添加到试卷管理（云端）」）
  - doExportPDF：generatePDF 返回本地路径（4.4）→ 勾选时读文件 base64 → FormData POST /api/upload-pdf → 拿 url → `dbCreatePaperFromExport(...)` → toast；上传失败 → pdf_url 空 + toast「已加入试卷（仅本地）」
- 试卷详情（paper-manage showPaperDetail）：pdf 存在时显示「📂 打开 PDF」→ `openPaperPdf(paper)`：本地缓存有 → FileOpener（模式复用 export-pdf-ui L78-79）；无 → dbEnsurePaperPdfLocal 下载后再开；Web 端 window.open(serverUrl + pdf_url)
- `src/main.ts`：挂载新函数，摘除已删函数

### 4.4 `src/data/pdf.ts`
- L316-329：原生端 writeFile 成功后 `return filePath`（现 return undefined）；Web 返回 undefined（pdf_local_path 记 null，Web 靠 pdf_url 打开）

## 五、测试

| 项 | 内容 |
|---|---|
| ui-health.spec.js | 「创建试卷成功」改：断言建卷表单不存在 + 列表存在；book 相关断言全摘 |
| 新增 E2E（Web） | 导出勾选 → 试卷列表出现同名条目；详情页显示打开入口（Web 走 window.open 分支，mock window.open 断言） |
| 单测 | dbCreatePaperFromExport / sanitize（pdf_local_path 不入 payload）/ apply merge 保留本地字段 —— 纯函数直测 |
| 全量 | typecheck + 单测 + build + E2E + 截图评估（添加表单只剩拍照区/试卷页无表单/导出弹窗 checkbox 默认不勾）+ AI Read 截图 |

## 六、执行顺序

- Phase A：移除（3.1+3.2）→ typecheck+单测 → commit
- Phase B：服务端（4.1）→ tsc -p server（对比存量基线无新增）→ commit
- Phase C：客户端数据层（4.2+4.4）+ UI（4.3）→ typecheck → commit
- Phase D：测试（五）→ 单测+build → commit
- Phase E：E2E 全量 + 截图 → ship 打包验证（真机回归：拍照添加/导出/勾选建卷/打开 PDF/换设备下载打开）

## 七、风险自评（对抗性）

1. **10MB 上传限制**已识别并规避（专用路由 50MB）；更大文件（>50MB）导出会失败——现状导出本地不受影响，仅入册失败，toast 明示
2. **/uploads 静态服务无鉴权**（现状如此，反馈图片同路）：URL 含时间戳+原文件名不可枚举，泄露面小；如需鉴权属独立安全任务，本期不做但明示
3. **apply merge 只保护 pdf_local_path**：papers 其他字段仍以服务端为准（LWW 语义不变）
4. **换设备打开**：pdf_url 同步到位即可下载；若导出时离线（pdf_url 空）则换设备无法打开——toast 明示「该卷未上传云端」
5. **switchAddMode 删除后初始态**、**exportPaperAsPDF 返回值消费**（Phase A/C 时逐处确认）
6. 回退：每 Phase 独立 commit

## 八、待确认

1. 计划是否照此执行？
2. 云端 PDF 上限 50MB 是否合适？（可调）
