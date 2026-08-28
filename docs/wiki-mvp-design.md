# Wiki 最小 MVP：选题目 → 视觉模型 → 结构化知识

## 背景与目标

旧 LLM Wiki 功能（编译流水线、实体去重、服务端合并等）存在结构性缺陷，用户决定暂不修复。本 MVP 重新构建最小闭环，验证核心价值：

**选一道或几道题目 → 连接 OpenRouter 支持图片识别的模型 → 按卡帕西 LLM Wiki 原则提取知识点 → 构建结构化、互相链接的知识。**

卡帕西 LLM Wiki 原则（gist 442a6bf555914893e9891c11519de94f）落地为：

1. **一个概念一个页面**：每个知识点一个独立概念，不合并、不重复建页
2. **交叉引用**：概念间必须互相链接（cross-reference），链接表示真实知识关系
3. **来源证据**：每个概念引用题目原文片段（quotes）
4. **辅助理解**：一句话定义 + 详细解释 + 生活化类比

## 影响模块

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/types/wiki-mvp.ts` | 新增 | WikiConcept / WikiMvpSession / WikiExtractResult 类型 |
| `src/data/wiki-mvp.ts` | 新增 | IndexedDB（localForage）存取提取记录，storeName `wiki_mvp_sessions` |
| `src/services/wiki-mvp.ts` | 新增 | 卡帕西 system prompt + OpenRouter 视觉调用 + 严格 JSON 解析 + 多模型 fallback |
| `src/ui/wiki-mvp.ts` | 新增 | 题目多选网格 + 模型选择 + 提取状态 + 概念卡片视图 + 历史记录 |
| `src/index.html` | 修改 1 行 | 「📖 Wiki」tab 入口指向 `showWikiTabMvp` |
| `src/main.ts` | 修改 | 挂载 13 个 wikiMvp 函数到 window |
| 各层 `index.ts` | 修改 | 导出新模块 |

**不涉及**：旧 wiki 代码（ui/wiki.ts、data/wiki.ts、wiki-* 服务、服务端 wiki 路由）全部保留未动；同步、备份、PDF 等其它模块零改动。

## 关键设计

### 调用链

```
选中题目 → buildUserContent(题目文本元信息 + 题目图片 data URL)
        → OpenRouter chat/completions（复用现有 AI 设置中的 provider/key）
        → 严格 JSON 解析（剥 markdown 代码块、找首个 { }、字段归一化）
        → 概念卡片渲染 + IndexedDB 保存
```

- 视觉模型默认 `qwen/qwen-2.5-vl-72b-instruct`（免费），备选 `google/gemini-2.5-flash`、`openai/gpt-4o-mini`，支持自定义模型 ID；失败自动按序 fallback
- 90s 超时 + AbortSignal；部分模型不支持 `response_format` 时 400 自动降级重试
- 未配置 API Key 时提示去「设置」配置（复用 `window.getVisionProvider`）

### UI 三步骤

1. **选题目**：搜索过滤 + 缩略图网格多选（含图片题目自动传图给模型）
2. **提取**：模型下拉/自定义 + 提取按钮 + 状态条
3. **知识结构**：概念卡片（标题 + 一句话定义 + 链接 chips），点击展开详解/类比/题目依据，点击链接跳转目标概念；每次结果自动保存，顶栏可查看/删除历史记录

### 隐私与安全

- 模型输出、题目字段渲染前统一 HTML 转义
- 图片加载失败走安全 DOM 替换（无 innerHTML 拼接）

## 验证

- `npm run typecheck` ✅
- `npm run build` ✅
- `npx playwright test tests/ui-health.spec.js` 16/16 ✅（含 Tab 切换回归）
- `npm run test`：7/8 文件通过；`real-api.spec.js` 为既有外部 API 依赖测试（180s 超时），与本次改动无关联

## 已知限制（MVP 边界）

- 概念间链接只在本批次内解析跳转；跨批次累积合并、index/log、图谱视图均未做
- 公式未做 KaTeX 渲染（以文本 $...$ 呈现）
- 无单元测试（待验证核心价值后补充）
