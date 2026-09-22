# 微信小程序端（学生端）设计方案

> 状态：**待确认** —— 本文档只做设计，未改任何代码。
> 创建日期：2026-09-09

---

## 1. 目标

在现有「客户端 + 服务端」架构上新增**微信小程序端**，整体变为三端：

| 端 | 使用者 | 定位 | 技术栈 |
|---|---|---|---|
| 客户端（现有） | 你自己 | 读写自己的题库，全功能 | Capacitor + TypeScript |
| 服务端（现有，改造） | — | 统一后端，新增学生接口 | Express 5 + SQLite + JWT |
| **小程序端（新增）** | **在校学生** | **只读**：浏览题目、按标签搜索、导出 PDF | 原生小程序 + TypeScript |

学生端功能范围（你指定的四项）：登录、题目列表、标签搜索、导出 PDF。

---

## 2. 实测现状（决定设计的硬事实）

数据源：生产库只读统计（2026-09-09）。

| 项 | 实测值 |
|---|---|
| users | 9 个 |
| questions（未删） | 128 题：owner 69 / E2E 账号 59 / 其余 0 |
| tags（未删） | 134 个：owner 71（无重名）/ 全库含跨账号重名 |
| 题图存储格式 | **100% base64 data URL，`/uploads` 路径 0 条** |
| 图片字段体积 | 题图 12.9 MB + 答案图 11.2 MB ≈ 24 MB |
| 平均单题图 | ~100 KB |
| 无标签题目 | 16 题（owner 10 题） |
| 中文字体 | `public/fonts/NotoSansSC-Regular.ttf` 17 MB |

服务端现状关键点：

- `questions` / `tags` / `papers` 全部带 `user_id`，所有路由 `WHERE user_id = ?` —— **纯私人库模型，无共享概念**
- `users` 表：`id / phone / password / nickname / created_at`，**无 role、无 openid**
- `GET /api/questions` 全量返回、无分页、无搜索参数
- 服务端**零 PDF 生成能力**（无 jspdf / pdfkit / pdfmake）
- `phone TEXT UNIQUE NOT NULL` —— 微信用户无手机号，直接冲突

---

## 3. 已确认的三项决策

| # | 决策点 | 你的选择 |
|---|---|---|
| 1 | 学生看到哪些题 | **全库共享只读** |
| 2 | 答案可见性 | **按需展开 + 导出时学生自选含不含答案** |
| 3 | 登录方式 | **微信一键登录**（`wx.login` → code → openid → 自动建号） |

---

## 4. 对决策 1 的必要修正（请确认）

「全库共享」若**字面执行**，学生端会出现：

- **59 条 E2E 测试题**（账号昵称就叫「E2E专用-勿动」）
- 标签页出现**两个「较难」、两个「板块模型」、两个「电磁感应」**（两个账号各自建了同名标签）

**建议修正为「owner 全库共享」**：只有 `role='owner'` 账号（13320087034，69 题）的题对学生可见。

| 方案 | 学生可见题数 | 标签数 | 数据质量 |
|---|---|---|---|
| 字面全库 | 128 | 134（有重名） | 含 59 条测试题 |
| **owner 全库（建议）** | **69** | **71（无重名）** | 干净 |

实现方式：`users` 表加 `role` 列，你的账号标 `owner`，学生端所有查询固定读 `owner` 的题。既满足「你的题全给学生看」，又自动隔离测试数据，将来新增老师账号也有扩展位。

---

## 5. 目标架构

```
┌──────────────┐        ┌──────────────────────────────┐        ┌──────────────┐
│  客户端 App   │ 读写   │          服务端               │ 只读   │  学生小程序   │
│  (Capacitor) │───────▶│  /api/*        （现有，不动）   │◀───────│  (新增)      │
│  你本人       │ 同步   │  /api/student/* （新增，裁剪） │        │  微信登录     │
└──────────────┘        └──────────────────────────────┘        └──────────────┘
                                     │
                        ┌────────────┴────────────┐
                        │  SQLite（owner 数据）    │
                        │  uploads/（图片、PDF）   │
                        └─────────────────────────┘
```

**核心原则**：学生端走**独立的 `/api/student/*` 命名空间**，不复用现有 `/api/*` 路由。

理由：现有路由全部绑定 `req.userId`，要改成读 owner 数据就得动它们，而客户端还在用——风险高。新命名空间是**独立的读模型**，字段裁剪、权限判定集中在一处，现有客户端零影响。

---

## 6. 内容可见性规则（两端差异）

### 6.1 字段级

**裁剪必须在 SQL 层完成，不靠前端隐藏**（学生抓包就能看到返回的 JSON）。

| 字段 | 客户端 | 小程序 | 说明 |
|---|---|---|---|
| `id` | ✅ | ✅ | |
| `question_image_url` | ✅ | ✅ | 转为 `/uploads/...` URL 后返回 |
| `answer_image_url` | ✅ | ⚠️ **独立接口按需** | 列表接口不返回，防批量抄答案 |
| `question_tags` | ✅ | ✅ | 含 `id / name / color` |
| `book_name` | ✅ | ❌ | 来源出处属私人整理信息 |
| `page_number` / `question_number` | ✅ | ❌ | 同上 |
| `user_comment` | ✅ | ❌ | 私人备注 |
| `semantic_summary` | ✅ | ❌ | AI 摘要，未审校 |
| `ai_metadata` | ✅ | ❌ | 内部数据 |
| `versions` | ✅ | ❌ | 版本管理 |
| `layout_type` | ✅ | ❌ | 排版内部标记 |
| `created_at` | ✅ | ⚠️ 仅年份月份 | 减少信息暴露 |
| `updated_at` / `deleted_at` / `purged_at` | ✅ | ❌ | 内部字段 |
| `question_image_blank_url` | ✅ | ❌ | 服务端本就无此列 |

### 6.2 功能级

| 功能 | 客户端 | 小程序 |
|---|---|---|
| 浏览题目列表 | ✅ | ✅ 分页 |
| 按标签筛选 | ✅ | ✅ |
| 查看题目图 | ✅ | ✅ |
| 查看答案图 | ✅ | ✅ 按需（单独请求） |
| 导出 PDF | ✅ | ✅ 服务端生成 |
| 新建/编辑/删除题目 | ✅ | ❌ |
| 标签管理（增删改） | ✅ | ❌ |
| 同步 push | ✅ | ❌ |
| 试卷 / 专题 / AI / Wiki / 反馈 / 版本发布 | ✅ | ❌ |

---

## 7. 服务端改造清单

### 7.1 数据库（`server/src/db/schema.ts`，复用现有 `ensureColumn` 模式）

```sql
ALTER TABLE users ADD COLUMN role   TEXT DEFAULT 'student';  -- 'owner' | 'student'
ALTER TABLE users ADD COLUMN openid TEXT;                    -- 微信 openid
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid);
```

一次性数据迁移（手工执行，不写进启动逻辑）：

```sql
UPDATE users SET role='owner' WHERE phone='13320087034';
```

**关于 `phone TEXT UNIQUE NOT NULL` 的处理**（关键取舍）：

SQLite 无法直接改列约束，改 `NOT NULL` 需重建整表（外键 + 索引都得重建，风险高）。
因此采用：微信用户注册时 `phone = 'wx_' || openid`。

- 满足 `UNIQUE`（openid 唯一）与 `NOT NULL`
- 现有登录/注册代码路径零改动
- 代价：`phone` 列语义被复用；将来若要真手机号，需新增迁移把 `wx_` 前缀替换为真实号码

### 7.2 新增文件

| 文件 | 职责 |
|---|---|
| `server/src/routes/wx-auth.ts` | `POST /api/wx/login`：code 换 openid → 建号 → 下发 JWT |
| `server/src/routes/student.ts` | 学生端全部只读接口 |
| `server/src/middleware/student.ts` | 校验登录态 + role，按 token 查库确认身份 |
| `server/src/services/image-store.ts` | base64 → 落盘 `uploads/` → 返回 URL（懒转换 + 幂等） |
| `server/src/services/pdf-export.ts` | pdfkit 生成题目 PDF（含字体子集化） |
| `server/scripts/migrate-images.ts` | 一次性批量迁移存量 base64（可离线跑） |

### 7.3 修改文件

| 文件 | 改动 |
|---|---|
| `server/src/app.ts` | 注册 2 个新路由；`uploads/exports` 静态托管 |
| `server/src/db/schema.ts` | 加 2 列 + 1 索引 |
| `server/.env.example` | 新增 `WX_APPID` / `WX_SECRET` / `OWNER_ID`（可选） |

**现有 `/api/*` 路由一行不改**，客户端零影响。

---

## 8. 接口契约（新增）

统一前缀 `/api/student`，除登录外均需 `Authorization: Bearer <token>`。

### 8.1 登录

```
POST /api/wx/login
→ { code: "0x1abc..." }
← { token, role: "student", nickname, isNew: true }
```

服务端：用 `WX_APPID` + `WX_SECRET` + code 调微信 `jscode2session` 换 openid → 查 `users.openid` → 无则建号（`phone='wx_'+openid`，`role='student'`）→ 签发 30 天 JWT。

### 8.2 标签列表

```
GET /api/student/tags
← { items: [{ id, name, color, question_count }] }
```

只读 owner 的标签，按 `question_count DESC` 排序。**不含 0 题标签**（减少噪音）。

### 8.3 题目列表（分页 + 标签筛选）

```
GET /api/student/questions?tag_id=xxx&page=1&page_size=20
← {
    items: [{ id, question_image_url, tags: [{id,name,color}], created_at }],
    total, page, page_size
  }
```

- 固定 `WHERE user_id = <owner_id> AND deleted_at IS NULL`
- **SELECT 不含 `answer_image_url` / `user_comment` / `semantic_summary` 等**（见 6.1）
- `tag_id` 为空 = 全部；多标签暂不做（YAGNI）
- `page_size` 上限 50

### 8.4 答案（按需）

```
GET /api/student/questions/:id/answer
← { answer_image_url: "/uploads/xxx.png" }
```

单独接口的意义：列表拿不到答案，学生必须逐题主动请求，提高抄答案成本，也便于后续加限流/埋点。

### 8.5 导出 PDF

```
POST /api/student/export-pdf
→ { tag_id?: string, question_ids?: string[], include_answer: boolean }
← { url: "/uploads/exports/xxx.pdf", page_count, question_count }
```

- 生成上限 **30 题**，超出返回 `400` 并提示缩小筛选范围
- 中文字体走**子集化**，避免 17 MB 字体打进每个 PDF
- 生成物落 `uploads/exports/`，需配清理策略（见风险 4）
- 加限流：10 次/小时/用户

小程序侧消费方式：`wx.downloadFile` → `wx.openDocument`（微信内置 PDF 预览）→ 可 `wx.shareFileMessage` 转发或保存。

---

## 9. 图片处理方案（关键路径）

**问题**：128 题的图全是 base64（24 MB），`GET /api/student/questions` 若直接返回，分页 20 题也有 ~4 MB，小程序渲染会卡死；且小程序 `<image>` 对超大 base64 支持差。

**方案**：base64 落盘为文件，接口返回 URL。

1. **存量迁移**：`server/scripts/migrate-images.ts` 遍历 questions，把 `data:image/...;base64,xxx` 解码写入 `server/uploads/questions/<id>.jpg`，字段改写为 `/uploads/questions/<id>.jpg`。128 题约 24 MB，几分钟可完成，**需停机或只读窗口执行**。
2. **增量兜底（懒转换）**：接口读取时若发现仍是 base64，即时落盘并回写字段后再返回。保证迁移遗漏或客户端新同步上来的 base64 也能正常显示，且**幂等**（同一 id 重复转换结果一致）。
3. **客户端同步路径不变**：现有客户端 push base64 的行为不动，由服务端兜底转换。

> 需要你确认：存量迁移是否接受短暂停机？若否，则只做懒转换（首次加载慢，之后正常）。

---

## 10. PDF 导出方案

| 决策 | 选择 | 理由 |
|---|---|---|
| 生成位置 | **服务端** | 小程序无用户可访问文件系统，前端生成的 PDF 学生拿不到 |
| 库 | **pdfkit** | 纯 JS、可嵌入 JPEG/PNG buffer、支持 TTF 子集化 |
| 中文字体 | `NotoSansSC-Regular.ttf` + **子集化** | 原字体 17 MB，不子集化会导致每个 PDF ≥17 MB |
| 内容 | 题图序列 + 题号；`include_answer=true` 时答案图紧跟每题 | 与「按需展开」决策一致 |
| 规模 | 单次 ≤30 题，同步生成 | 30 题约 3 MB 图，生成耗时预计 <15 s，在小程序 60 s 超时内 |
| 超量 | 返回 400 + 明确文案 | 异步任务队列留作后续优化（YAGNI） |

---

## 11. 小程序端设计

**技术栈**：原生小程序 + TypeScript。理由：只有 4 个页面，Taro/uni-app 引入的构建链不划算；用 TS 与项目其他两端保持一致。

```
miniprogram/
├── app.ts / app.json / project.config.json
├── services/api.ts        # 请求封装：自动带 token、401 跳登录
├── utils/auth.ts          # wx.login + token 存储
└── pages/
    ├── index/             # 题目列表：标签 chips + 图片列表 + 上拉加载
    ├── detail/            # 单题大图 + 「查看答案」按钮
    └── export/            # 选择「含答案/不含答案」→ 生成 → 预览
```

**登录页不做独立页面**：`app.ts` 启动时静默 `wx.login` 换 token，失败才显示重试按钮。学生点开即用，零注册摩擦。

**标签过多（71 个）的 UI 处理**：顶部横向滚动 chips + 「全部」入口；提供标签名搜索框。

**无标签题（10 题）**：归入「全部」，不单独建入口。

---

## 12. 不涉及边界（明确不做）

- 不修改现有 `/api/*` 路由与客户端行为
- 学生端无任何写操作（增删改题目、标签、同步 push）
- 不做试卷、专题、AI 教学、Wiki、悬浮窗、相似题
- 不做支付、订阅、消息推送
- 不做多标签联合筛选、关键词搜索（题目无文字内容，只有图片）
- 不做 PDF 异步任务队列
- 不做错题本、收藏、练习记录

---

## 13. 风险与阻塞项

| # | 风险 | 等级 | 应对 |
|---|---|---|---|
| 1 | **微信要求 HTTPS 域名**，且需在小程序后台配「合法域名」白名单 | 🔴 阻塞 | 现有部署是 PM2 + Tailscale IP，**小程序生产不可用**。需域名 + SSL（nginx 反代 + Let's Encrypt）。开发期可勾选「不校验合法域名」 |
| 2 | 存量图片迁移需停机窗口 | 🟡 中 | 或改用纯懒转换，首次加载慢 |
| 3 | 生产库有 3 个候选（`f640 worktree` 128 题 / `question-bank-local` 85 题 / `question-bank-server` 80 题），**需确认哪个是生产库** | 🟡 中 | 由你指定 `DB_PATH` |
| 4 | 导出的 PDF 会堆积占用磁盘 | 🟢 低 | 定时清理 `uploads/exports/` 下超过 24h 的文件 |
| 5 | 学生可能未成年，收集 openid 涉及合规 | 🟡 中 | 小程序类目选「教育」，配隐私政策；不收集手机号 |
| 6 | `role='owner'` 判定依赖一次性 SQL 迁移 | 🟢 低 | 迁移后校验 `SELECT count(*) FROM users WHERE role='owner'` 必须为 1 |

---

## 14. 实施步骤（建议顺序）

| 阶段 | 内容 | 产出 |
|---|---|---|
| 1 | 服务端：`users` 加列 + role 迁移 + owner 校验 | 数据库可区分角色 |
| 2 | 服务端：`image-store` + 迁移脚本 | 图片变 URL |
| 3 | 服务端：`student.ts` 三个只读接口（tags / questions / answer） | 接口可用（先用 curl/postman 验证） |
| 4 | 服务端：`wx-auth.ts` | 可用微信开发者工具调通登录 |
| 5 | 小程序：3 个页面 + 请求封装 | 可浏览、可搜索、可看答案 |
| 6 | 服务端：`pdf-export` + 小程序导出页 | 端到端跑通 |
| 7 | 全量验证：typecheck + 单元测试 + 构建 + E2E（含截图可见性评估） | 符合 AGENTS.md CI 要求 |

---

## 15. 需要你拍板的问题

1. **决策 1 的修正**：接受「owner 全库共享」（69 题，排除 59 条 E2E 测试题）吗？
2. **图片迁移**：接受停机窗口做批量迁移，还是只做懒转换（首次慢）？
3. **生产库**：三个 `data.db` 中哪个是生产库？
4. **域名**：是否已有可用于小程序的 HTTPS 域名与 SSL 证书？
