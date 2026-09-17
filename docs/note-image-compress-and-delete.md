# 笔记图片压缩统一 + 笔记版本删除（墓碑机制）

> 实施日期：2026-09-16
> 实施计划：`docs/plans/2026-09-16-note-compress-and-delete.md`
> 上游：`docs/quick-import-handwritten-note.md`（手写笔记照片功能）
> 关联：`docs/plans/2026-09-14-legacy-js-retirement.md`（本交付**提前实施了其中 E 批的"笔记墓碑"部分**）

## 一、本次交付的三件事

| # | 需求 | 做法 |
|---|---|---|
| 1 | 补上**未压缩**的笔记图路径 | 两条漏网路径接入 `compressNoteImage`（1600/0.85） |
| 2 | 题图/答图"压缩比率太高" | 在**真正的闸门** `public/db.js:427/429/431` 把 `compressImage(x)` 的默认 (800, 0.7) 显式改为 **(1600, 0.85)** |
| 3 | 笔记版本**无法删除** | 客户端墓碑机制：服务端加 `deleted_at` 列 + 活数据层写墓碑/过滤墓碑/透传墓碑 + 详情页「🗑 删除」按钮 |

## 二、变更清单

**服务端**
| 文件 | 改动 |
|---|---|
| `server/src/db/schema.ts` | `ensureColumn('question_notes', 'deleted_at', 'TEXT')`（幂等，启动时自动补列） |
| `server/src/services/sync-upsert.ts` | `NOTE_COLUMNS` 加 `deleted_at`；`upsertQuestionNote` `hasDeletedAt: true` + `serialize` 兜底：墓碑行强制 `note_image_url = null` |
| `server/test/sync.test.ts` | 追加 2 例：墓碑 push→pull 原样回传且图片为 null；不带 `deleted_at` 的旧格式原样保留图片 |
| `server/vitest.config.ts` | 已存在（`setupFiles: ['test/setup.ts']` → `DB_PATH=':memory:'`），本次未改 |

**客户端（活数据层 = 旧 `public/db.js`）**
| 文件 | 改动 |
|---|---|
| `public/db.js:895` | `dbGetQuestionNotes` 过滤墓碑：`if (note && !note.deleted_at && ...)` |
| `public/db.js:923` | `dbDeleteQuestionNote`：`removeItem` 硬删 → **写墓碑**（`note_image_url: null` + `deleted_at` + 推进 `updated_at`，行保留） |
| `public/db.js:1462` | `dbApplyRemoteSnapshot` 笔记分支透传 `deleted_at`（否则其它设备的墓碑拉回来会丢标记"复活"） |
| `public/db.js:427/429/431` | `dbCreateQuestion` 内三处 `compressImage(x)` → `compressImage(x, 1600, 0.85)`（题/答/空图的**真闸门**） |

**客户端（TS 层）**
| 文件 | 改动 |
|---|---|
| `src/services/image.ts` | 新增 `compressNoteImage`：`compressImage(img, 1600, 0.85)`；**null 原样放行**；**异常回退原图（绝不丢图）** |
| `src/ui/note-version.ts` | `confirmAddNoteVersion` 落库前压缩；新增 `deleteCurrentNoteVersion` |
| `src/ui/question-core.ts` | 表单「额外版本」落库前压缩 |
| `src/ui/quick-import.ts` | 题/答**撤销本地预压缩**（原图交给 ` dbCreateQuestion`，避免双代 JPEG 损失）；`compress` 默认参数回到 (1200, 0.8)（此后仅手写笔记显式调用） |
| `src/index.html` | 详情弹窗版本条新增 `#modal-note-version-delete`（danger 配色 + **显式 color**） |
| `src/main.ts` | `deleteCurrentNoteVersion` 挂到 `assignToWindow` |

**测试**：`unit-tests/note-tombstone.spec.ts`（5）、`unit-tests/note-image-compress.spec.ts`（4）、`unit-tests/note-version-order.spec.ts`（+5 删除接线）、`tests/quick-import-visibility.spec.js`（+2：题/答真尺寸、删除流程）

## 三、关键设计

### 3.1 墓碑协议（删除如何跨设备生效）

```
本地删除 = 把该行改写为 { note_image_url: null, deleted_at: <now>, updated_at: <now> }
  → 全量 push 带上墓碑
  → 服务端存 deleted_at 列（serialize 兜底：墓碑行图片强制 null）
  → pull 原样下发墓碑行（**服务端不过滤**）
  → 各设备 apply 透传 deleted_at → dbGetQuestionNotes 过滤 → UI 消失
```

- **为什么 pull 不过滤**：若在服务端过滤，曾同步过该笔记的设备会**永远保留本地副本**（pull 不下发"缺失"信号，客户端无从得知被删）
- **为什么服务端强制清空图片**：删除的隐私承诺是"图片从云端消失"，不应依赖每个客户端都自觉；活行（无 `deleted_at`）原样通过，不误伤
- **删光自愈**：某题 0 条活笔记时，详情页既有分支会用题图自动重建「笔记 v1」（删除确认文案已告知用户）
- **不可恢复**：服务端与所有设备上的该图都被清空

### 3.2 压缩参数（统一 1600/0.85）

| 路径 | 参数 | 说明 |
|---|---|---|
| 题图/答图/空图 | **1600/0.85** | 闸门在 `public/db.js:427/429/431`（`dbCreateQuestion` 内），**不是**快速导入层 |
| 手写笔记（快速导入附加区） | 1600/0.85 | 客户端压缩后落库 |
| 笔记版本图（详情页添加版本 / 表单额外版本） | 1600/0.85 | 本次补上（原本原图直传） |
| 添加题目表单裁剪 | 裁剪 `toDataURL('image/jpeg', 0.9)` → 再经 db.js 1600/0.85 | 裁剪本身必须经 canvas 重编码，"不压缩"的可操作含义是**不缩放、不额外降质量** |
| 同步开启时的题/答上传 | 经 `_uploadImage` POST `/api/upload` 存为**服务器文件**，题目行存 URL | "题/答文件化"基础设施早已存在 |

**压缩失败一律回退原图**（`compressNoteImage` 的 try/catch）——压缩环节出错绝不导致丢图。

### 3.3 部署顺序（**硬前提，违反即功能失效**）

**先看清事实（2026-09-16 实测）**：运行中的服务进程 cwd = `/Users/john/.codex/worktrees/f640/question-bank-local/server`，即**它加载的代码来自那条 Codex worktree**；它打开的数据库是主仓的 `/Users/john/question-bank-local/server/data.db`（经 `DB_PATH` 引用）——**代码与数据分离**，主仓只提供数据文件。

因此服务端改动的落地要求是：**把新代码放到那个进程重启时会加载的目录**（不是"合并进主仓"），然后重启进程：

1. 把服务端改动（`server/src/db/schema.ts` 的 `ensureColumn` 行 + `server/src/services/sync-upsert.ts`）落到 `.codex/worktrees/f640/question-bank-local`（该 worktree 与我们的 worktree 共享同一个 `.git`，可用 fetch/merge 或 cherry-pick）
   - ⚠️ 该 worktree 当前**有未提交改动**（`server/src/app.ts`、`server/src/db/schema.ts`）——落地前需先处理它，避免冲突/覆盖
   - 替代方案：改从本 worktree（或专用服务 worktree）启动服务，`DB_PATH` 仍指向同一个 `data.db`
2. **重启该服务进程**：`launchctl kickstart -k gui/501/com.questionbank.ts-server`（服务由 LaunchAgent `~/Library/LaunchAgents/com.questionbank.ts-server.plist` 托管，其 `WorkingDirectory` 即上条代码目录、`DB_PATH` 指向主仓 `data.db`）。Node 不会热加载；`ensureColumn` 只在启动时执行一次——重启后 `data.db` 会自动补上 `deleted_at` 列
3. **然后**安装新 APK

| 服务端 | 新 APK | 结果 |
|---|---|---|
| 新 | 新 | ✅ 删除全设备生效 |
| 旧（未重启/未落地） | 新 | ❌ 服务端不认识 `deleted_at` → 下一次 pull 把原行发回 → **删除被"复活"** |
| 新 | 旧 | ⚠️ 删除在删除方生效；**其它未升级设备**上该版本残留为"空图条目"（旧客户端不识别也不过滤墓碑），升级后消失 |

## 四、过程中的两次前提纠正（记录，避免重犯）

1. **我把题/答的压缩改错了层**：起初改快速导入层的 1200/0.8 → 1600/0.85，但评审发现真正的闸门是 `dbCreateQuestion` 内部的 `compressImage(x)`（无参 = 800/0.7），下游会**再压一次**把上游参数完全抵消。**教训：改参数前先确认哪一层是最终落库点。**
2. **"题/答原图化必撞 200MB pull 上限"的测算不成立**（同步开启时题/答是服务器文件 + URL，不占 pull 载荷）。**教训：先确认数据形态（dataURL 内联 vs 文件 URL）再算量级。**

另一处自测缺陷（同样值得记住）：题/答尺寸断言最初写成 `≤1600`，撤掉修正后**仍然通过**（旧的 800 也满足上界）——改为 `toBe(1600)` 后才具备区分力。**断言必须能区分"正确值"与"旧值"，否则等于没测。**

## 五、验证记录（2026-09-16）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test` | **374 passed / 4 skipped**（唯一失败 `real-api.spec.js` = 真实 API 网络超时，环境性） |
| `cd server && npx vitest run` | **29 passed** |
| 全量 E2E（主配置 3000） | **101 passed / 0 failed**（42.1s，含新增 2 例） |
| 相关 spec（自有端口 3100） | `quick-import-visibility` + `modal-anchor-overlap` = **34 passed** |
| 真实数字（题/答闸门） | 注入 3000×2000 → 落库后 `naturalWidth = 1600`、dataURL 268KB |
| 复现性演练 | ① 撤 `db.js` 压缩参数 → 尺寸用例 FAIL（`expected 800 to be 1600`）② 撤 `!note.deleted_at` 过滤 → 删除用例 FAIL ③ 撤 `NOTE_COLUMNS` 的 `deleted_at` → 服务端墓碑用例 FAIL ④ 旁路 `compressNoteImage` → 接线用例 FAIL；全部还原后 PASS |
| 服务端迁移幂等 | `ensureColumn` 对"列已存在"连续两次执行无异常 |

## 六、已知非阻塞项

| 项 | 说明 | 处置 |
|---|---|---|
| 旧客户端"复活"删除 | 旧 APK 在删除后又编辑同一条笔记（updated_at 更新）→ 推送会覆盖墓碑 | LWW 模型固有；概率极低；再删一次即可 |
| 旧 APK 上删除不生效 | 收到墓碑行不认识 `deleted_at` → 残留"空图条目" | 两台设备都升级后消失（见 §3.3 矩阵） |
| 存量图片不追溯 | 存量题/答仍是 800/0.7、存量笔记图不变；未压缩的老图（如那条 1.2MB）留在库里 | 用户已确认：没有原图可重压，不追溯 |
| `www/db.js` 与 `public/db.js` 已分叉 | `www/` 是陈旧死拷贝（webDir 已是 `dist`，不参与打包）；`unit-tests/helpers/load-db.js` 默认仍加载它 | 新测试已参数化指向 `public/db.js`；建议后续清理 `www/` |
| 两份 `compressImage` 副本 | `public/db.js:41` 与 `src/services/image.ts` 各一份，运行时逐字节等价 | 后续可把 quick-import 也切到 services 版（列入旧 JS 退场批次） |
| 「+ 添加版本」备注 | 删除按钮只有一层 confirm；文案已明确"图片版本 / 同步所有设备 / 不可恢复 / 删光自动重建" | 若日后要更稳，可加撤销 |

## 七、不涉及边界

- 不改 `www/`、`dist/`、`android/` 下的 db.js 拷贝（构建产物由 `npm run build` + `cap sync` 再生）
- 不改服务端表结构以外的任何路由/鉴权
- 不做笔记删除的"回收站/撤销"
- 不做存量图片的批量重压
- 不改复习链路（不读笔记）
- 服务端测试仍不进 CI（`.github/workflows/ci.yml` 只跑客户端 vitest）——列入待办
