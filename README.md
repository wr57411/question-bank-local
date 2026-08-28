# 本地题库 App

离线题库管理工具，支持 iOS / Android / Web，数据完全存储在本地，可选服务端同步。

## 功能

- 拍照/相册选题，支持裁剪和跨页拍摄（两张拼接）
- 标签管理，多标签筛选
- 排版适用性设置（单栏 / 双栏）
- 试卷创建，按标签选题
- 教学内容管理（知识节点 + AI 生成）
- PDF 书库（上传/试读/下载/分类）
- 客户端生成 PDF 试卷
- 软删除回收站，可恢复或彻底删除
- 数据导入/导出（增量备份）
- 服务端同步（可选，支持主从架构）
- AI 题目分析（云端 OpenRouter / 本地模型）

## 技术栈

### 客户端

| 组件 | 技术 |
|------|------|
| 语言 | TypeScript（全盘迁移，无 JS 源码） |
| 架构 | 模块化（data / services / ui / types 四层） |
| 构建 | Vite 8 |
| 本地存储 | IndexedDB（localForage） |
| 图片处理 | Cropper.js + Canvas |
| PDF 生成 | jsPDF |
| PDF 预览 | pdfjs-dist |
| 原生打包 | Capacitor 6 |
| 测试 | Vitest（单元）+ Playwright（E2E） |

### 服务端

| 组件 | 技术 |
|------|------|
| 语言 | TypeScript（tsx 运行时） |
| 框架 | Express 5 |
| 数据库 | better-sqlite3（WAL 模式） |
| 认证 | JWT（Bearer Token） |
| 文件上传 | multer |

## 项目结构

```
question-bank-local/
├── src/                      # 客户端源码（Vite root）
│   ├── index.html            # 入口 HTML
│   ├── main.ts               # 入口 — 挂载到 window
│   ├── data/                 # 数据层（localForage CRUD）
│   ├── services/             # 服务层（AI/图片/同步）
│   ├── ui/                   # UI 层（渲染函数）
│   └── types/                # 类型定义层
├── server/                   # 服务端源码
│   ├── src/
│   │   ├── app.ts            # Express 应用配置
│   │   ├── index.ts          # 入口
│   │   ├── routes/           # 路由
│   │   ├── services/         # 业务逻辑
│   │   ├── db/               # 数据库连接 + Schema
│   │   └── middleware/       # 认证中间件
│   └── test/                 # 服务端测试
├── tests/                    # E2E 测试（Playwright）
├── unit-tests/               # 客户端单元测试（Vitest）
├── android/                  # Android 原生项目
├── ios/                      # iOS 原生项目
├── scripts/                  # 构建/部署脚本
├── docs/                     # 开发文档
├── capacitor.config.ts       # Capacitor 配置
└── vite.config.ts            # Vite 配置
```

## 开发

### 浏览器开发

```bash
npm install
npm run dev          # 前端 http://localhost:3000
cd server && npm run dev  # 服务端 http://localhost:3001
```

### 代码质量

```bash
npm run typecheck    # TypeScript 类型检查
npm run test         # 单元测试
npm run lint         # ESLint 检查
npm run format       # Prettier 格式化
```

### 打包

```bash
npm run build        # 前端构建
npm run ship "描述"   # 完整打包 APK
```

### Android

```bash
npm run build
npx cap sync android
npx cap open android
```

### iOS

```bash
npm run build
npx cap sync ios
npx cap open ios
```

## 文档索引

见 `docs/` 目录和 `AGENTS.md` 中的开发文档索引。
