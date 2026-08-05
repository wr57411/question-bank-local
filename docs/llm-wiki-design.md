# LLM Wiki 知识编译系统

## 概述

在现有题库之上构建"知识编译层"：利用视觉 LLM 将原始素材（题目图片、PDF 页面）编译为结构化的物理知识页面（概念页、方法页、模型页、误区页），形成可交互的知识网络。

核心理念：**Compile, don't retrieve** — LLM 不是临时检索工具，而是持续维护的知识编译器。

## 变更日期

2026-07-31

## 关联模块

服务端、客户端数据层、客户端服务层、客户端 UI 层、同步模块

---

## 一、架构设计

### 三层模型

```
┌─────────────────────────────────────────────────────────┐
│                      Wiki 层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 概念页    │  │ 方法页    │  │ 模型页    │  │ 误区页  │ │
│  │ Concept  │  │ Method   │  │ Model    │  │ Fallacy │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘ │
│       │              │              │             │      │
│       └──────────────┴──────────────┴─────────────┘      │
│                          双向链接                          │
├─────────────────────────────────────────────────────────┤
│                   Compiler 服务层                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ 视觉识别    │  │ 知识提取    │  │ 增量编译引擎        │ │
│  │ Vision OCR │→ │ Extract    │→ │ Incremental Compile│ │
│  └────────────┘  └────────────┘  └────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                      Raw 层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 题目图片  │  │ PDF 页面  │  │ 用户笔记  │  │ 标签    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 与现有项目模块的集成

```
现有:  题目管理 ──→ 标签体系 ──→ 章节分类 ──→ PDF 书库
              │
              ▼
新增:  ┌─────────────────────────────────────┐
       │  Raw: 题目图片 + PDF + 章节结构     │
       │           ↓                         │
       │  Compiler: vision.ts + compiler.ts  │
       │           ↓                         │
       │  Wiki: 概念/方法/模型/误区页面       │
       │           ↓                         │
       │  UI: wiki-panel + knowledge-graph   │
       └─────────────────────────────────────┘
```

---

## 二、数据模型

### 2.1 Wiki 页面类型

```typescript
// src/types/wiki.ts

/** Wiki 页面类型 */
export type WikiPageType = 'concept' | 'method' | 'model' | 'fallacy';

/** Wiki 页面 — 编译产出的核心实体 */
export interface WikiPage {
  id: string;
  type: WikiPageType;
  title: string;              // 如"牛顿第二定律"
  canonical_title: string;    // 标准名称（用于实体去重，如"牛顿第二定律"）
  aliases: string[];          // 别名列表（如["牛二","F=ma","牛顿第2定律"]）
  summary: string;            // 一句话概述
  content: string;            // Markdown 正文（含 LaTeX）
  latex_formulas: string[];   // 独立提取的公式列表
  key_conditions: string[];   // 适用条件/前提
  common_mistakes: string[];  // 常见误区
  related_page_ids: string[]; // 双向链接（其他 WikiPage ID）
  source_ids: string[];       // 来源 Raw ID（题目/PDF页）
  source_snippets: string[];  // 每道触发题的原文片段（用于溯源高亮）
  confidence: number;         // LLM 编译置信度 0-1
  review_status: 'auto' | 'human_verified' | 'rejected' | 'needs_merge'; // 审核状态
  generated_at: string;       // 首次编译时间
  updated_at: string;         // 最后更新时间
  version: number;            // 内容版本（每次编译 +1）
  deleted_at: string | null;
}

/** 编译任务 — 追踪 Raw → Wiki 的处理状态 */
export interface CompileJob {
  id: string;
  source_type: 'question_image' | 'pdf_page' | 'manual';
  source_id: string;          // 题目 ID 或 PDF 页 ID
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempt_count: number;
  error_message: string | null;
  result_page_ids: string[];  // 产出的 WikiPage ID
  created_at: string;
  completed_at: string | null;
}

/** 知识链接 — Wiki 页面间的关系 */
export interface WikiLink {
  id: string;
  source_page_id: string;
  target_page_id: string;
  relation: 'prerequisite' | 'related' | 'contradicts' | 'extends';
  description: string;        // 关系说明
  created_at: string;
  deleted_at: string | null;
}
```

### 2.2 各类型页面定义

| 类型 | 英文 | 内容要素 | 示例 |
|------|------|---------|------|
| 概念页 | concept | 定义、公式、单位、物理量说明、适用条件 | 牛顿第二定律、电场强度、电磁感应 |
| 方法页 | method | 解题步骤、适用场景、典型例题、注意事项 | 整体法与隔离法、等效电源法、图像法 |
| 模型页 | model | 图示、核心方程、变式、高考考情 | 滑块-木板模型、电磁感应棒模型 |
| 误区页 | fallacy | 错误表述、错因分析、正确理解、辨错题 | "速度大惯性大"、"电势高等于电场强" |

---

## 三、编译器服务设计

### 3.1 客户端服务层

```
src/services/
├── vision.ts        ← 视觉识别封装（OpenRouter 调用）
├── wiki-compiler.ts ← 知识编译引擎
└── wiki-sync.ts     ← Wiki 数据同步
```

**vision.ts** — 视觉 OCR 服务

```typescript
export interface VisionResult {
  raw_text: string;       // 原文文本
  formulas: string[];     // LaTeX 公式列表
  confidence: number;     // 整体置信度
  model_used: string;     // 实际使用的模型
  elapsed_ms: number;
}

export async function recognizePhysicsImage(
  imageDataUrl: string,
  options?: { signal?: AbortSignal }
): Promise<VisionResult>
```

**wiki-compiler.ts** — 知识编译引擎

```typescript
export interface CompileInput {
  text: string;           // OCR 识别的文本
  existing_tags: string[]; // 题目已有标签
  book_name?: string;     // 来源教辅名
  chapter?: string;       // 所属章节
}

export interface CompileOutput {
  pages: WikiPageDraft[];
  links: WikiLinkDraft[];
  new_tags: string[];      // 建议新增的标签
}

export async function compileToWiki(input: CompileInput): Promise<CompileOutput>
```

### 3.2 编译流程

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ 新题目录入   │ 或  │ PDF 新书上传  │ 或  │ 用户手动触发     │
└──────┬──────┘     └──────┬───────┘     └────────┬────────┘
       │                   │                      │
       ▼                   ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│ Step 1: 视觉识别（vision.ts）                            │
│   - 图片 → OpenRouter Qwen3 VL → 文本 + LaTeX 公式       │
│   - 写入 CompileJob（status=processing）                 │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Step 2: 知识提取（wiki-compiler.ts）                      │
│   - 分析文本，识别考查的概念/方法/模型                      │
│   - 生成页面草稿                                           │
│                                                          │
│ Step 2.5: 实体去重与合并                                    │
│   - 标题 Embedding 余弦相似度 > 0.85 → 调用 LLM 判断是否   │
│     同一概念                                               │
│   - 是同一概念 → 合并到现有页面（追加 source_ids +         │
│     aliases + snippets）                                   │
│   - 不是同一概念 → 创建新页面                              │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Step 3: 增量编译                                          │
│   - 已有页面：追加 source_ids，更新 related_page_ids,     │
│     source_snippets                                       │
│   - 新页面：创建 WikiPage 记录                            │
│   - 检测矛盾：同一概念不同说法 → 标 conflict +            │
│     review_status=needs_merge                            │
│   - 创建 WikiLink 关系                                   │
│   - 生成 Diff：向用户展示"旧内容 vs 新增内容"供确认      │
└────────────────────────┬────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Step 4: 确认入库                                          │
│   - 低置信度 → 草稿箱，用户手动确认                       │
│   - 高置信度 → 直接入库                                  │
│   - 更新 CompileJob（status=completed）                   │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Prompt 设计

### 3.4 Schema + Index + Lint 闭环

**wiki-schema.md**（系统约定文档，人类与 LLM 共享）

编译器行为约定：
- 每种页面类型必须包含的最小字段集
- 命名规范：`canonical_title` 使用教科书标准用语
- 去重阈值：Embedding 余弦相似度 < 0.85 则创建新页面
- 矛盾判定：同一概念在公式/条件上存在本质差异才算矛盾
- 引用完整性：WikiPage.related_page_ids 必须双向对称

**wiki-index**（自动生成的目录页）

按 concept/method/model/fallacy 分类，每页面一行摘要 + 关联题数 + 更新频率。每次编译后自动更新。

**wiki-log**（编译历史日志）

按时间记录：哪道题触发了编译、创建了哪些页面、更新了哪些页面、标记了哪些冲突。用于追溯和影响分析。

typescript
// src/services/wiki-lint.ts
export interface LintResult {
  orphan_pages: string[];        // 没有任何 inbound link 的页面
  conflict_pages: string[];      // 标记 conflict 超过 7 天未处理
  missing_concepts: string[];    // 标签存在但缺少对应 Wiki 页面
  broken_links: string[];        // related_page_ids 指向已删除页面
}

export async function lintWiki(): Promise<LintResult>

定期（每周或每次编译后）运行 lintWiki()，在 UI 显示"待处理问题"徽章。

### 3.5 成本预算控制

```typescript
// src/services/wiki-budget.ts
export interface BudgetConfig {
  daily_compile_limit: number;    // 每日编译题目上限（默认 50）
  monthly_token_budget: number;   // 月度 token 上限（默认 500K）
  prefer_local_model: boolean;    // 优先使用本地模型（未来 Ollama 扩展）
}

export interface BudgetStatus {
  today_compiled: number;
  today_tokens: number;
  monthly_tokens: number;
  remaining_daily: number;
  remaining_monthly: number;
}
```

降级策略：
1. 额度充足 → 调用云端 VL 模型识别 + 编译
2. 当日额度用尽 → Raw 队列等待，明日自动编译
3. API 不可用 → 队列标记 pending_network，后台监听网络恢复

### 3.6 离线编译队列

CompileJob 作为持久化队列：
- 无网络时仍可录入题目（Raw 数据已入库）
- 当天网络恢复后自动执行 pending 状态的编译
- 批量导入时按速率限制排队（指数退避重试）

编译 Prompt 针对高中物理领域优化：

```
你是一位经验丰富的高中物理教研员。请分析以下物理题目文本，提取其中的知识要素。

## 题目文本
{text}

## 题目来源
- 教辅: {book_name}
- 章节: {chapter}

请输出 JSON 格式的知识分析结果：

{
  "concepts": [{                 // 考查的物理概念
    "name": "牛顿第二定律",
    "definition": "...",
    "formula": "F=ma",
    "conditions": "宏观、低速、惯性参考系"
  }],
  "methods": [{                  // 涉及的解题方法
    "name": "整体法与隔离法",
    "steps": ["...", "..."],
    "applicable_when": "连接体问题"
  }],
  "models": [{                   // 物理模型
    "name": "弹簧连接体模型",
    "core_equation": "...",
    "variants": ["水平型", "竖直型"]
  }],
  "fallacies": [{                // 相关易错点
    "misconception": "...",
    "correct_view": "..."
  }],
  "related_concepts": ["..."],   // 前置/关联概念
  "keywords": ["..."]            // 建议标签
}
```

---

## 四、UI 设计

### 4.1 Wiki 面板

在现有 Tab 栏增加「知识」Tab：

```
┌──────────────────────────────────────────────────┐
│ [题目] [试卷] [专题] [教学] [书库] [知识] [同步]    │  ← 新增 [知识] Tab
└──────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────┐
│  📖 物理知识库                      [编译进度 2/50] │
│  ┌──────────────────────────────────────────────┐ │
│  │ 🔍 搜索概念/方法/公式...                      │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  视图: [概念网络] [章节树] [最近编译] [草稿箱3]    │  ← 草稿箱显示待审数量
│                                                    │
│  ┌─ 概念网络视图（局部展开）──────────────────┐   │
│  │                                              │  │
│  │  默认: 只显示当前选中章节的知识子图            │  │
│  │  点击节点 → 展开其一度邻居                    │  │
│  │                                              │  │
│  │         [牛顿定律]  ← 选中                   │  │
│  │         /    |    \                         │  │
│  │   [整体法] [F=ma] [惯性]  ← 一度邻居         │  │
│  │     /                                      │  │
│  │   [连接体问题]  ← 点击展开更多               │  │
│  │                                              │  │
│  │  节点大小: 关联题目数量                       │  │
│  │  节点颜色: 概念=蓝 / 方法=绿 / 模型=橙 / 误区=红│ │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌─ 状态栏 ────────────────────────────────────┐  │
│  │ 📊 Wiki 页面: 47 | 链接: 89 | 待审: 3        │  │
│  │ 💰 今日Token: 12K / 200K | 编译: 5/50 题     │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**局部视图策略**（避免一次性全量渲染）：
- 默认按当前章节过滤，只渲染该章节关联的知识子图
- 点击节点展开其一度邻居（前置概念、关联方法）
- 搜索时高亮匹配节点并自动聚焦
- 使用 d3-force 做力导向布局（不要完全手写物理引擎）

### 4.2 Wiki 页面详情

点击某个概念节点后：

```
┌──────────────────────────────────────────────────┐
│  ← 返回知识网络                                    │
│  ╔══════════════════════════════════════════════╗ │
│  ║ 📌 牛顿第二定律                                ║ │
│  ║ type: concept | v3 | ✅ 已审 | 🔗 12题         ║ │
│  ╚══════════════════════════════════════════════╝ │
│                                                    │
│  ## 定义                                           │
│  物体加速度的大小跟作用力成正比，跟质量成反比...      │
│                                                    │
│  ## 公式                                           │
│  $$\vec{F} = m\vec{a}$$                           │
│                                                    │
│  ## 适用条件                                        │
│  - 宏观、低速（远低于光速）                          │
│  - 惯性参考系                                       │
│                                                    │
│  ┌─ 关联题目 (12) ─────────────────────────────┐  │
│  │ [山东2021] 弹簧连接体  ┌─────────────────┐   │  │
│  │   "当速度为零时..."    │ 高亮: 原文触发片段│   │  │  ← 点击题目标题可看原文片段
│  │ [广东2024] 电磁缓冲器  └─────────────────┘   │  │
│  │ ... 查看全部 →                               │  │
│  └─────────────────────────────────────────────┘ │
│                                                    │
│  ┌─ 前置知识 ─────────────────────────────────┐  │
│  │ → 运动学基础 → 牛顿第一定律                  │  │
│  └─────────────────────────────────────────────┘ │
│  ┌─ 关联方法 ─────────────────────────────────┐  │
│  │ → 整体法与隔离法 → 正交分解法                 │  │
│  └─────────────────────────────────────────────┘ │
│                                                    │
│  ┌─ 常见误区 ─────────────────────────────────┐  │
│  │ ⚠ "速度大的物体惯性大" — 惯性只与质量有关    │  │
│  └─────────────────────────────────────────────┘ │
│                                                    │
│  [编辑] [更新Wiki] [删除]                          │
└──────────────────────────────────────────────────┘
```

**来源追溯（source_snippets）**：
- 点击关联题目时，显示触发该 Wiki 页的原始题目文本片段
- 用户可对照原文验证 LLM 是否正确理解了题意

### 4.3 编译触发点

| 场景 | 触发方式 |  UX |
|------|---------|-----|
| 拍照录入新题 | 可选 "AI 录入 + 编译知识" 模式 | 拍完题自动识别文本 + 提取概念 |
| 题目详情页 | "AI 分析知识点" 按钮 | 点击后识别图片，生成/更新关联 wiki 页 |
| PDF 书库 | 长按某页 → "提取本页知识" | 渲染页 → 视觉识别 → 编译 wiki |
| 批量编译 | Wiki 面板 → "同步编译所有题目" | 后台队列，逐个处理，显示进度 |

---

## 五、存储层扩展

### 5.1 本地 IndexedDB

```typescript
// src/data/stores.ts 新增：
export const dbWikiPages = localforage.createInstance({ name: 'questionBank', storeName: 'wiki_pages' });
export const dbWikiLinks = localforage.createInstance({ name: 'questionBank', storeName: 'wiki_links' });
export const dbCompileJobs = localforage.createInstance({ name: 'questionBank', storeName: 'compile_jobs' });
```

### 5.2 服务端数据库

```sql
-- Wiki 页面表
CREATE TABLE wiki_pages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('concept','method','model','fallacy')),
  title TEXT NOT NULL,
  canonical_title TEXT NOT NULL,             -- 标准名称，用于实体去重
  aliases TEXT DEFAULT '[]',                 -- 别名列表 JSON
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  latex_formulas TEXT DEFAULT '[]',
  key_conditions TEXT DEFAULT '[]',
  common_mistakes TEXT DEFAULT '[]',
  related_page_ids TEXT DEFAULT '[]',
  source_ids TEXT DEFAULT '[]',
  source_snippets TEXT DEFAULT '[]',         -- 原文片段 JSON，用于溯源
  confidence REAL DEFAULT 0,
  review_status TEXT DEFAULT 'auto' CHECK(review_status IN ('auto','human_verified','rejected','needs_merge')),
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  deleted_at TEXT DEFAULT NULL
);

-- Wiki 链接表
CREATE TABLE wiki_links (
  id TEXT PRIMARY KEY,
  source_page_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  deleted_at TEXT DEFAULT NULL
);

-- 编译任务表
CREATE TABLE compile_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  error_message TEXT,
  result_page_ids TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_wiki_pages_type ON wiki_pages(type);
CREATE INDEX idx_wiki_pages_title ON wiki_pages(title);
CREATE INDEX idx_wiki_pages_canonical ON wiki_pages(canonical_title);
CREATE INDEX idx_wiki_pages_review ON wiki_pages(review_status);
CREATE INDEX idx_wiki_links_source ON wiki_links(source_page_id);
CREATE INDEX idx_compile_jobs_status ON compile_jobs(status);
```

### 5.3 同步集成

在 `SyncPayload` 中新增三个字段：

```typescript
export interface SyncPayload {
  // ... 现有字段
  wiki_pages: WikiPage[];
  wiki_links: WikiLink[];
  compile_jobs: CompileJob[];
}
```

同步规则：
- WikiPage 由服务端合并，冲突时：
  - 如果只是追加 source_ids / source_snippets，自动 CRDT 合并
  - 如果 content / summary 冲突，version 高者胜 + 标记 `review_status = needs_merge`
- WikiLink 由服务端 CRDT 合并
- CompileJob 客户端主导，服务端只做镜像备份

---

## 六、服务端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/wiki/pages` | 获取全部 Wiki 页面 |
| GET | `/api/wiki/pages/:id` | 获取单个页面详情 |
| POST | `/api/wiki/pages` | 创建/更新页面（客户端编译后上传） |
| DELETE | `/api/wiki/pages/:id` | 软删除 |
| GET | `/api/wiki/links` | 获取链接关系 |
| POST | `/api/wiki/links` | 创建链接 |
| GET | `/api/wiki/graph` | 获取知识图谱数据（节点 + 边） |
| POST | `/api/wiki/compile-request` | 请求服务端辅助编译（可选，重度任务放到服务端） |

---

## 七、实现阶段

### Phase 1: 基础设施（1-2 天）

- [ ] `src/types/wiki.ts` — 类型定义（含 aliases, canonical_title, source_snippets, review_status）
- [ ] `docs/wiki-schema.md` — Schema 约定文档（编译规则、页面命名规范）
- [ ] `src/data/stores.ts` — +3 个 localForage 实例
- [ ] `src/data/wiki.ts` — CRUD 操作
- [ ] `server/src/db/schema.ts` — +3 张表 DDL（含新字段和索引）
- [ ] `server/src/routes/wiki.ts` — API 路由
- [ ] `src/types/sync.ts` + `src/data/sync.ts` — 同步扩展 + 冲突合并策略

### Phase 2: 视觉服务（1 天）

- [ ] `src/services/vision.ts` — 封装 OpenRouter 调用
- [ ] 图片预处理（压缩、格式转换）
- [ ] 超时和重试机制（45s 超时 + 3 级备选）
- [ ] 模型备选策略（免费路由 → 低价备选列表）

### Phase 3: 编译引擎（3-4 天）

- [ ] `src/services/wiki-compiler.ts` — 核心编译逻辑
- [ ] `src/services/wiki-entity.ts` — 实体去重与合并（Embedding + LLM 判断）
- [ ] Prompt 工程（针对高中物理优化）
- [ ] JSON 输出解析与校验
- [ ] 增量编译逻辑（已有页面更新 vs 新页面创建）
- [ ] Diff 生成（旧内容 vs 新内容）
- [ ] 来源片段提取（source_snippets）
- [ ] 链接关系生成
- [ ] 矛盾检测 + needs_merge 标记

### Phase 3.5: 质量保障 + 预算控制（1 天）

- [ ] `src/services/wiki-lint.ts` — 孤立页、冲突页、断链检测
- [ ] `src/services/wiki-budget.ts` — 每日限额 + Token 预算 + 降级策略
- [ ] `src/services/wiki-index.ts` — 自动索引生成 + 日志记录
- [ ] wiki-index/wiki-log 特殊页面逻辑
- [ ] 离线队列（pending_network 状态 + 后台恢复）

### Phase 4: UI 层（3-4 天）

- [ ] `src/ui/wiki.ts` — Wiki 面板主逻辑
- [ ] `src/ui/wiki-graph.ts` — 知识图谱可视化（d3-force）
- [ ] 局部视图策略（按章节过滤 + 一度邻居展开）
- [ ] 节点颜色编码（类型）+ 大小（关联题数）
- [ ] `src/ui/wiki-page.ts` — 页面详情视图 + 来源片段
- [ ] `src/ui/wiki-diff.ts` — 更新 Diff 对比视图
- [ ] `src/ui/wiki-editor.ts` — 手动编辑/补充
- [ ] 状态栏（页面数、待审数、预算用量）
- [ ] `src/index.html` — Wiki Tab + 面板 DOM
- [ ] `src/main.ts` — 导出函数到 window

### Phase 5: 集成与优化（1-2 天）

- [ ] 题目录入流程集成（"AI 录入+编译"模式）
- [ ] PDF 书库集成（长按页面编译）
- [ ] 离线支持（编译任务排队，有网时执行）
- [ ] 回归测试：20 道标准题验证编译质量不退化
- [ ] 性能优化（图片缓存、增量更新）
- [ ] CI/CD 通过验证

---

## 八、性能与成本估算

### 单题处理成本

| 步骤 | 模型 | Token 消耗 | 成本（免费路由） | 成本（付费最坏） |
|------|------|-----------|-----------------|-----------------|
| 视觉识别 | openrouter/free → Gemma 4 VL | ~2K prompt + 1K completion | $0 | ~$0.001 |
| 知识编译 | openrouter/free → Gemma 4 | ~1K prompt + 0.5K completion | $0 | ~$0.0003 |
| **单题合计** |  | ~4.5K tokens | **$0 ~ $0.001** |

**保守假设**（免费模型不可用，走付费）：
- Qwen3-VL-8B 视觉识别: $0.117/M input + $0.455/M output
- 文本模型: $0.03-0.15/M tokens
- 200 题全库编译约 $0.5-1.0（一次性成本）
- 日常 10 题/天约 $0.02-0.05/天

预算保护：`wiki-budget.ts` 强制每日限额 50 题、月度 500K tokens，超限自动降级。

### 规模估算

| 场景 | 题目数 | API 调用 | 日成本（免费） | 日成本（付费最坏） |
|------|--------|---------|--------------|------------------|
| 日常使用 | 5-10 题/天 | 10-20 次 | $0 | $0.01-0.05 |
| 集中录入 | 50 题 | 100 次 | $0（限额内） | $0.05-0.10 |
| 全库编译 | 200 题 | 400 次 | 2 天分摊 | $0.20-0.40 |

### 存储开销

每个 WikiPage 约 2-5KB，200 道题编译产生约 50-80 个 WikiPage（去重后），总存储约 0.5-1MB。

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 免费 API 限额（1000次/天） | 无法一天编译大量题目 | 每日限额 + 预算控制 + 低峰期编译 |
| 免费 API 响应不稳定 | 超时、排队 | 45s 超时 + 3 级备选模型 + 离线队列 |
| LLM 编译质量不稳定 | 产出错误知识 | 置信度 + review_status + 草稿箱 + lint |
| 实体对齐失败 | 知识库膨胀出现大量重复页 | canonical_title + aliases + Embedding 去重 + 合并 UI |
| 知识图谱全量渲染 | 节点过多时性能崩溃 | 局部视图策略（按章节 + 一度邻居展开） |
| 跨设备编辑冲突 | 同一页面内容不一致 | CRDT 自动合并 source_ids + needs_merge 标记 |
| 免费模型下线 | 无法免费调用 | 低价付费备选（Qwen3-VL-8B ~$0.12/M） |
| IndexedDB 空间不足 | 无法存储更多 Wiki | Wiki 是纯文本，200 题约 1MB 可忽略 |

---

## 十、不涉及边界

- 不做全文搜索（现有标签体系够用）
- 不做实时协作（单人项目）
- 不做复杂的可视化图谱引擎（Canvas 手绘节点链接即可）
- 不替代现有题目管理（Wiki 是附加知识层）
- 不做 AI 自动出题（该功能由现有 Gemma4 AI 集成承担）

---

## 十一、验证标准

### Phase 2 完成后（视觉 + 实体）

1. 10 张不同难度的物理题图片，OCR 识别率（文字 + 公式）≥ 85%
2. 单张图片端到端处理（识别 + 编译）≤ 30 秒
3. 实体去重正确率：给 5 对等价概念（如"牛顿第二定律" vs "F=ma原理"），正确合并 ≥ 4 对
4. 来源片段提取：关联题目时能正确回溯到原文片段

### Phase 3.5 完成后（质量保障）

1. lintWiki() 能检测出模拟注入的孤立页、冲突页、断链
2. 预算超限时正确降级（不超支、队列暂停、用户提示清晰）
3. 离线录入后，网络恢复自动编译（无需用户干预）

### Phase 5 完成后（全量）

1. 录入新题时可在 30 秒内看到关联的知识页面
2. 知识图谱渲染 50+ 节点无明显卡顿（d3-force 布局）
3. 局部视图策略：选中节点展开一度邻居 ≤ 200ms
4. Sync push/pull 正确同步 Wiki 数据（含冲突标记）
5. 回归测试：20 道人工标注的标准题，提取准确率不低於初版
6. CRDT 合并测试：双设备同时追加同一概念页，source_ids 正确合并
