# 本地 CI/CD 测试体系方案：Push 前快速拦截代码错误

## 第一性原理分析

### 问题定义

当前工作流程：代码修改 → APK 打包（3-5 分钟）→ Playwright E2E 检测（额外 1-2 分钟 + 可能超时）→ 推送到远程。

核心矛盾：**反馈周期太长**。发现问题时，已经消耗了 5-7 分钟，且部分错误本应在更早阶段被发现。

### 错误分层模型

代码错误按"发现成本"从低到高分为四层：

| 层级 | 错误类型 | 发现手段 | 反馈时间 |
|------|---------|---------|---------|
| L1: 静态错误 | 类型错误、语法错误、引用不存在 | TypeScript 编译器 | < 5s |
| L2: 单元逻辑错误 | 函数返回值错误、边界条件、算法错误 | Vitest 单元测试 | < 10s |
| L3: 集成/交互错误 | DOM 事件不响应、状态不同步、跨模块调用错误 | Playwright E2E | 30-120s |
| L4: 运行时/原生错误 | Capacitor 原生插件、文件系统、相机 | 真机安装测试 | 分钟级 |

当前流程：跳过 L1-L2，直接在 ship 脚本中做 L3（Playwright），导致"用昂贵手段发现便宜错误"。

### 设计目标

**Push 前跑完 L1 + L2，作为 pre-push gate**。目标：
- 总耗时 < 30 秒
- 拦截 80% 以上的常见错误（类型错误、逻辑回归）
- 不阻塞 ship 流程（ship 仍负责 L3 + APK 构建）

## 实施方案

### Phase 1: Pre-push Hook（零依赖，立即生效）

在 `.agents/hooks/` 或 `package.json` 中注册 Git pre-push hook：

```bash
#!/bin/bash
# scripts/pre-push.sh
# 在 git push 之前运行，失败则阻止 push

set -e

echo ">>> [pre-push] 运行快速检查..."

# L1: TypeScript 类型检查（~3s）
echo ">>> [1/2] TypeScript 类型检查"
npx tsc --noEmit

# L2: Vitest 单元测试（~10s）
echo ">>> [2/2] 单元测试"
npx vitest run

echo ">>> ✅ 快速检查通过，允许 push"
```

**安装方式**（无需 husky，直接用 git hooksPath 或手动 link）：

```bash
# 方案 A：本地 git hook（不影响远程仓库）
ln -sf ../../scripts/pre-push.sh .git/hooks/pre-push
chmod +x .git/hooks/pre-push

# 方案 B：配置 git 使用项目 hooks 目录
git config core.hooksPath .agents/hooks
```

### Phase 2: 扩展 Unit Test 覆盖

当前 `unit-tests/` 仅覆盖 review、tag-similarity、db-utils 等模块，缺少以下关键路径的测试：

| 模块 | 现有测试 | 建议新增 |
|------|---------|---------|
| `src/services/pdf-cloud.ts` | 无 | fetchPdfPages / downloadPdfToLocal 的 mock 测试 |
| `src/ui/pdf-library.ts` | 无 | base64ToBlob、renderPdfPreviewFromCache 的 blob 转换逻辑 |
| `src/data/sync.ts` | sync-integrity.spec.js | dbBuildSyncPayload 数据完整性 |
| `src/services/ai.ts` | 无 | safeParseJSON、API 调用异常处理 |

### Phase 3: Ship 脚本优化

将 ship 脚本的 E2E 检测改为"快速模式"：

```
ship-feature.sh 流程（优化后）：
1. TypeScript 类型检查（不变）
2. Vite 构建（不变）
3. Capacitor 同步（不变）
4. APK 构建（不变）
5. 更新 PROJECT_MEMORY.md（不变）
6. 运行单元测试（新增，快速反馈）
7. 运行 Playwright E2E（保留，但超时增加到 120s）
8. 显示手动验证清单（不变）
```

## 当前进度

- [x] 修复 Playwright webServer timeout（30s → 120s）
- [x] 新增 base64ToBlob 单元测试
- [ ] 创建 pre-push hook 脚本
- [ ] 创建 base64ToBlob 单元测试
- [ ] 扩展 pdf-cloud / pdf-library 的单元测试覆盖
- [ ] 更新 ship-feature.sh 加入单元测试步骤

## 风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| 单元测试覆盖不足 | 部分错误漏过 | 随 bug 修复逐步补充回归测试 |
| pre-push hook 影响 push 速度 | 每次 push 多 10-15s | 可接受；或改为仅在 push 到 origin 时触发 |
| hook 在 worktree 中不生效 | worktree 的 .git 是文件而非目录 | 使用 `git config core.hooksPath` 全局配置 |

## 不涉及边界

- 不改变远程 CI/CD 流程（GitHub Actions 等）
- 不改变 APK 打包流程
- 不改变手动验证清单
- 不引入新的测试框架（使用现有 vitest + playwright）
