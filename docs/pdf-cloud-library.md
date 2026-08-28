# PDF 云书库全栈实现

## 概述

实现 PDF 云书库功能，支持 PDF 上传到服务器（不随 APK 打包）、渐进式试读、手动下载缓存、双维度类目管理（书本章节树 + 专题）、复用现有标签体系。同时将服务端合并到主项目并完成 TypeScript 迁移 + 模块化重构。

## 变更日期

2026-07-25

## 关联模块

服务端（server/）、客户端数据层、客户端服务层、客户端 UI 层、同步模块

## 变更内容

### 阶段一：服务端合并

- 服务端项目（原 /Users/john/question-bank-server）合并到主项目 `server/` 目录
- `.gitignore` 新增 `server/data.db*`、`server/uploads/`、`server/node_modules/`
- 原项目已做保底 commit（31653cb）

### 阶段二：服务端 TS 迁移 + 模块化

原 JS 文件全部迁移为 TypeScript，结构如下：

```
server/src/
├── index.ts              ← 入口
├── db/
│   ├── connection.ts     ← SQLite 连接
│   └── schema.ts         ← 建表 DDL
├── middleware/
│   └── auth.ts           ← JWT 认证
├── utils/
│   └── helpers.ts        ← 共享工具函数
├── services/
│   ├── sync-upsert.ts    ← upsert 函数集
│   ├── replicate.ts      ← Supabase 复制
│   └── pdf-render.ts     ← PDF 页面渲染
└── routes/
    ├── questions.ts, tags.ts, papers.ts
    ├── sync.ts, version.ts, recovery.ts
    ├── pdfs.ts           ← PDF 上传/试读/下载
    ├── pdf-books.ts      ← 书本 + 章节 CRUD
    └── pdf-topics.ts     ← 专题 CRUD
```

运行方式：`npx tsx src/index.ts`（零编译）

### 阶段三：PDF 云书库功能

#### 服务端

- 新增 5 张表：pdf_books, pdf_chapters, pdf_topics, pdf_docs, pdf_doc_tags
- 新增依赖：pdfjs-dist, canvas
- API 端点：
  - POST `/api/pdfs/upload` — 上传 PDF（50MB 限制）
  - GET `/api/pdfs` — 列表
  - GET `/api/pdfs/:id/pages?from=&to=` — 渐进试读（渲染为 JPEG）
  - GET `/api/pdfs/:id/download` — 完整下载
  - PUT/DELETE `/api/pdfs/:id` — 更新/软删除
  - POST `/api/pdfs/:id/tags` — 设置标签
  - CRUD `/api/pdf-books` + `/api/pdf-chapters`
  - CRUD `/api/pdf-topics`
- sync push/pull 集成 5 类 PDF 数据

#### 客户端

- `src/types/pdf-doc.ts` — PdfBook, PdfChapter, PdfTopic, PdfDoc, PdfDocTag 接口
- `src/data/stores.ts` — +5 个 localForage 实例
- `src/data/pdf-docs.ts` — 书本/章节/专题/PDF CRUD
- `src/types/sync.ts` — SyncPayload +4 字段
- `src/data/sync.ts` — dbBuildSyncPayload 收集 PDF 数据
- `src/services/pdf-cloud.ts` — upload, fetchPages, download, delete, updateMeta, setTags
- `src/ui/pdf-library.ts` — 书库 UI（三视图、渐进试读、下载、管理）
- `src/index.html` — 书库 Tab + 操作弹窗 + 试读弹窗 + 管理弹窗
- `src/main.ts` — 导出新函数到 window

## 渐进试读交互

1. 点击 PDF → 试读弹窗 → 请求 page 1-3
2. 滚动到底 → 请求 4-6 → 追加（batch=3）
3. 显示「第 X-Y 页 / 共 Z 页」
4. 底部「下载全文」按钮
5. 已下载 → FileOpener 直接打开（参数名 filePath）

## 不涉及边界

- 未修改现有题目/标签/试卷/教学模块逻辑
- 未引入客户端 PDF.js
- 未做 PDF 编辑/标注/OCR/全文搜索
- Supabase 复制暂未扩展 PDF 表
