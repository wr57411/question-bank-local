# 快速导入栏「常见标签列表」

| 项 | 内容 |
|---|---|
| 创建日期 | 2026-09-04 |
| 设计稿 | `docs/plans/2026-09-03-quick-import-favorite-tags.md`（v3，经两轮推翻重设计） |
| 关联模块 | 快速导入, 标签, 用户设置同步, 服务端 |
| 状态 | 已实施，CI 全绿 |

## 一、功能

快速导入栏新增一条用户自管理的「常见标签」横向列表：位于标签搜索框与按钮行之间，点击 chip 即选中/取消该标签（写入已选标签区）；行尾「＋」展开栏内管理区，可搜索添加、移除、拖拽排序。多设备离线可改、不静默丢弃。

## 二、核心设计（v3）

整包 LWW 会静默丢数据（v1 已推翻），联网门禁阻断离线编辑（v2 已推翻）。v3 把数据拆成两层：

| 层 | 存什么 | 合并方式 | 冲突后果 |
|---|---|---|---|
| 成员资格 | 每标签一条 `{on, at}` | 逐项比时间戳 | 只影响那一个标签 |
| 顺序 | id 数组 + `at` | 整体 LWW | 最坏排列不同 |

`rev` 不再拒绝写入，只用来判「是否知情」：`本地.rev == 云端.rev` 时按时间戳直接生效；`本地.rev < 云端.rev` 且结论相反才算真冲突，弹窗按标签粒度让用户选「用云端 / 用本机」。选边后 `rev` 更新为 `serverRev`，重推必然命中「知情」分支，不会二次弹窗。

删除 = 写入 `on:false` 墓碑（带时间戳，可传播），90 天后清理。

## 三、变更清单

| 操作 | 路径 | 内容 |
|-----|------|------|
| Add | `src/services/quick-fav-tags.ts` | 逐项状态模型、增删排序、序列化容错、墓碑、pending 计算、in-flight 推送保护 |
| Add | `server/src/services/quick-fav-merge.ts` | 服务端逐项合并纯函数（合并逻辑全仓库仅此一份） |
| Add | `server/src/services/user-settings.ts` | settings 读取解析 + 整行替换修复所需的辅助 |
| Modify | `server/src/routes/sync.ts` | 新增 `GET /settings`、`POST /favorite-tags`；settings 合并改 `{ ...prev, ...settings }` 并删除硬编码保护分支 |
| Modify | `server/src/services/server-sync.ts` | 同上 `{ ...prev, ...data.settings }` 修复 |
| Modify | `src/index.html` | 常见标签行 + 管理面板 + `#qi-fav-conflict-modal`（内联 CSS） |
| Modify | `src/ui/quick-import.ts` | 渲染/toggle/面板/拖拽排序/推送/冲突弹窗；栏高补偿改 rAF 动态测量 |
| Modify | `src/data/sync.ts` | `dbApplyRemoteSnapshot` 回填 `settings.quickFavoriteTags`（仅本地无待同步改动时） |
| Modify | `src/main.ts` | 挂载新函数（`assignToWindow` 为显式清单，新导出必须手动登记——本次 E2E 首跑全红即因漏登记） |
| Modify | `src/services/index.ts` | 追加 `export * from './quick-fav-tags'` |
| Add | `unit-tests/services/quick-fav-tags.spec.ts`（25 用例）、`quick-fav-merge.spec.ts`（11）、`user-settings.spec.ts`（5） | 规则矩阵逐格覆盖 |
| Add | `tests/quick-import-fav-tags.spec.js` | 手机视口 E2E + 可见性断言 + 截图 + 复现演练 |

## 四、实施中发现并已处理的坑

| 坑 | 处理 |
|---|---|
| `main.ts` 挂载是显式清单，新 UI 函数不登记则 `onclick` 静默失效（E2E 首跑 4/4 全红） | 补登记；此坑值得写进 AGENTS 编码检查清单 |
| 栏高 `312px/196px` 硬编码债 | 改 `requestAnimationFrame` 内测 `bar().offsetHeight`，测试需 `expect.poll`（rAF 下一帧才写入） |
| 溢出 chip 断言矛盾 | 横向滚出视口的 chip 先 `scrollIntoViewIfNeeded` 再 `assertVisiblyRendered` |
| 全量 `vitest run` 在本机 worker 启动超时（18 errors，均为 forks worker 起不来，非断言失败） | 用 `--maxWorkers=1` 跑通；资源受限环境注意事项 |
| 冲突必须 HTTP 200 + `conflict:true` | `apiCall` 在 `!resp.ok` 时 throw，4xx 会连云端副本都拿不回来 |

## 五、既有风险修复（随本功能一并落地，王先生已确认）

`routes/sync.ts` 与 `server-sync.ts` 的 settings 写入由 `{ ...settings }`（请求体缺的字段被整行抹掉，含 API key 风险）改为 `{ ...prev, ...settings }`，并删除两条硬编码保护分支。副带修好「用户清空 `cloud_providers` 永远清不掉」的既有 bug。单测覆盖：缺字段保留、显式 `[]` 清空生效。

## 六、验证记录（2026-09-04）

- `npm run typecheck` 通过
- `npm run test`（279 用例）通过——同期根治了 vitest worker 崩溃（见下）
- `npm run build` 通过
- `npx playwright test` 全量 **80/80 通过（10.8 分钟）**
- `tests/quick-import-fav-tags.spec.js` 4/4 通过（截图人工复核通过）
- 复现演练：临时把 chip 改白字白底 → 测试以「对比度 1.00」失败 → 还原后通过

### 同期根治：vitest 多 worker 崩溃（环境问题，非代码问题）

WorkBuddy 会话给所有 node 进程注入 `NODE_OPTIONS=--require=.../node-language-shim.cjs`（safe-delete
文件代理 shim），每次 fs 操作 = 一次同步 IPC（~15ms）；jsdom 依赖树数千次文件操作 → 每进程首载
jsdom 54s → vitest 多 worker 起不来、单 worker 22 分钟。排查链：threads 池同样崩（排除 spawn）→
node 环境对照（锁定 jsdom）→ 裸 require 54s / `new JSDOM` 37ms（锁定模块加载）→ 同进程二次 require
42ms（排除编译与执行）→ `--cpu-prof` 显示 52.7s 全在 `tryBrokerFileTokenSync`。

**修复**：`test`/`test:unit`/`test:all` 已清空 `NODE_OPTIONS`（279 用例 2.5s，118 倍提速）；
E2E 会话内手动加 `NODE_OPTIONS=` 前缀（单 spec ~2min → 8.3s）。详见 AGENTS.md「Node 进程性能警告」。

### 同期修复：手机端「有 N 项改动待同步」永不消失（2026-09-04 15:10 报告）

**因果链（全部实测）**：手机 serverUrl 默认 `http://100.94.79.16:3001`（本机 Tailscale IP）→ 3001 部署在
`/Users/john/question-bank-server/`（独立目录）→ 截图时该进程还是旧代码（tsx 无热重载）→ 推送 404 →
客户端 catch 静默吞错 → 状态条一律显示「联网后会自动合并」（在线失败时文案错误）→ 且失败后从不重试
（只有再次改动标签才触发 push）→ 永远挂起。

**修复**：
- 状态条按 catch 错误分类显示真实原因（404→「服务端版本过旧，请升级服务端」；token/登录→「登录已过期」；未配置服务器→「未登录」；其余→「无法连接服务器」）
- 打开管理面板时若仍有待同步改动，自动重试推送（服务端修复后无需再改动标签即可收敛）
- 新增 404 场景 E2E；截图复核通过

**教训**：catch 分支吞掉错误后展示的「友好文案」若与真实原因无关，就是在制造新的故障排查盲区——失败路径的提示必须可区分。

## 七、失效边界（对抗性评审结论，详见设计稿第十五节）

- 两台设备从同一 rev 离线修改同一标签 → 都判「知情」，按时间戳裁决，绕过弹窗（已知盲区，可日后用「上次同步时间」加固）
- 顺序冲突是全方案唯一自动裁决点（排列不丢信息）
- 前提：常见标签总数约十几个、名称 ≤6 汉字
