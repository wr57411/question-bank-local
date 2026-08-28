# Windows 备用服务器实现

## 概述

将题库服务端适配为 Windows 可运行版本，新增服务器间同步机制（备用服务器主动从主服务器拉取数据），保留 Supabase 云复制作为并行方案。两套机制共存，互不影响。

## 架构设计

### 数据流

```
Mac mini (主服务器)              Windows (备用服务器)
┌──────────────┐                ┌──────────────────┐
│ Express 5    │   HTTP pull    │ Express 5        │
│ SQLite (WAL) │ ◄──────────── │ SQLite (WAL)     │
│ Supabase复制  │   (定期拉取)   │ 服务器间同步模块   │
└──────────────┘                └──────────────────┘
        ▲                               ▲
        │ push/pull                     │ push/pull
        │                               │
┌──────────────┐                ┌──────────────────┐
│ Android 客户端 │ ──手动切换──► │ Android 客户端     │
│ (连接主服务器) │              │ (连接备用服务器)    │
└──────────────┘                └──────────────────┘
```

### 两套同步机制对比

| 维度 | Supabase 云复制 | 服务器间同步 |
|------|----------------|-------------|
| 触发方式 | push 后自动触发 | 备用服务器启动时拉取 + 定期增量 |
| 数据方向 | 主服务器 → Supabase 云 | 主服务器 → 备用服务器 |
| 依赖 | @supabase/supabase-js | 仅 fetch API |
| 配置 | SUPABASE_URL + SUPABASE_ANON_KEY | PRIMARY_SERVER_URL + SYNC_PHONE + SYNC_PASSWORD |
| 适用场景 | 云端容灾备份 | 局域网备用服务器 |
| 文件同步 | 不支持 | 不支持（PDF 二进制文件不同步） |

## 新增/修改文件

### 新建文件

| 文件 | 说明 |
|------|------|
| `server/src/services/server-sync.ts` | 服务器间同步核心模块 |
| `server/start.bat` | Windows 启动脚本 |
| `server/ecosystem.config.cjs` | PM2 常驻服务配置 |
| `server/.env.windows.example` | Windows 环境变量模板 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/src/routes/recovery.ts` | 新增 `/api/recovery/server-sync-status` 和 `/api/recovery/sync-from-primary` 端点 |
| `server/src/index.ts` | 新增 `initServerSync()` 和 `startPeriodicSync()` 调用 |
| `server/src/services/pdf-render.ts` | canvas 模块改为可选导入，未安装时禁用 PDF 预览 |
| `public/app.js` | 新增 `syncFromPrimaryServer()` 和 `updateServerSyncStatus()` 函数 |
| `src/index.html` | 容灾设置区域新增"服务器间同步"区块 |

### 未修改（保留 Supabase）

- `server/src/services/replicate.ts` — Supabase 复制模块完整保留
- `server/src/routes/sync.ts` — `replicateToSupabase()` 调用保留
- `server/package.json` — `@supabase/supabase-js` 依赖保留

## API 端点

### 服务器间同步（新增）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/recovery/server-sync-status` | 查询同步状态 |
| POST | `/api/recovery/sync-from-primary` | 触发从主服务器拉取 |

### Supabase 复制（保留不变）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/recovery/status` | 查询 Supabase 连接状态 |
| POST | `/api/recovery/sync-to-supabase` | 触发全量推送到 Supabase |

## 服务端环境变量

```
# Windows 服务端 .env 配置
PORT=3001
DB_PATH=./data.db

# 主服务器连接（仅备用服务器需要）
PRIMARY_SERVER_URL=http://MAC_MINI_IP:3001
SYNC_PHONE=your-phone
SYNC_PASSWORD=your-password
SERVER_SYNC_INTERVAL=300000  # 同步间隔（毫秒，默认 5 分钟）
```

## Windows 部署步骤

### 1. 安装 Node.js

从 https://nodejs.org 下载 LTS 版本安装。

### 2. 安装 PM2

```bash
npm install -g pm2
```

### 3. 复制服务端代码

将 `server/` 目录复制到 Windows 机器。

### 4. 安装依赖

```bash
cd server
npm install
```

> 注意：`canvas` 原生模块可能需要 Visual Studio Build Tools。若安装失败，PDF 预览功能不可用但不影响其他功能。

### 5. 配置环境变量

复制 `.env.windows.example` 为 `.env`，填入实际值。

### 6. 启动服务

```bash
# 方式一：直接运行
start.bat

# 方式二：PM2 常驻运行
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 设置开机自启
```

### 7. 防火墙放行

在 Windows 防火墙中放行 3001 端口。

## 已知限制

1. **PDF 文件不同步**：`server_path` 指向的 PDF 二进制文件不在同步范围内，备用服务器上 PDF 预览/下载不可用。
2. **canvas 可选化**：Windows 上 `canvas` 原生模块可能安装失败，PDF 预览功能将禁用，不影响其他功能。
3. **单向同步**：仅支持备用服务器从主服务器拉取，不支持反向同步。
4. **用户映射**：同步数据使用主服务器的 userId，备用服务器自动创建对应用户记录。
