# 同步功能全面审查与优化方案

| 项 | 内容 |
|---|---|
| 创建日期 | 2026-09-04 |
| 类型 | 审查报告 + 实施计划（**待王先生确认后才开始编码**） |
| 关联模块 | 同步（push/pull）、标签关联、试卷/专题、相似题链接、settings、服务端 |
| 审查方法 | 对抗性审查：通读客户端同步链路（`src/ui/sync-ui.ts`、`src/data/sync.ts`、`src/data/{questions,tags,similar-links}.ts`）与服务端（`server/src/routes/sync.ts`、`services/sync-upsert.ts`、`utils/helpers.ts`），逐项模拟网络中断、多端并发、时钟偏差、删除传播、拉取覆盖等异常场景 |
| 状态 | 待确认 |

## 〇、一句话结论

当前同步的**记录级 LWW 主干是通的**（题目/标签/试卷等记录的增改能跨设备到达），但**关联数据（标签↔题目、试卷↔题目、专题↔题目）和相似题链接的同步是断的或坏的**，且 pull 回写路径对一半的表没有竞争保护。多设备并发使用下，有 4 个会真实丢数据的场景和 2 个功能性失效场景。

---

## 一、薄弱环节清单（对抗性审查结果）

### 🔴 A1. 标签↔题目关联同步断裂（最严重，尚未被察觉）

**复现剧本**：
1. 设备 A 给题目 Q 打上标签 T → 只写本地 `dbQuestionTags`（`src/data/questions.ts:154`），**题目记录的 `updated_at` 不变，记录里也没有 `tag_ids`** → push 时服务端根本不知道这次打标签。
2. 设备 B 编辑 Q 的备注 → push 的 Q 记录里 `tag_ids` 是 B 上次 pull 的陈旧快照（或不存在）→ 服务端 `upsertQuestion` 执行 `replaceQuestionTags(id, tag_ids || [])`（`server/src/services/sync-upsert.ts:289`）→ **服务端 Q 的标签关联被抹掉或回退**。
3. 新装设备 C 首次 pull：服务端 pull 返回 `tag_ids`，但 `dbApplyRemoteSnapshot` **从不重建本地 `dbQuestionTags`**（`src/data/sync.ts:105-141` 只处理 8 类记录，无关联表）→ **C 上所有题目看不到任何标签**。

**根因（三处叠加）**：
- 客户端打标签不 bump 题目、不写 tag_ids（`questions.ts:122-124,154-162`）
- 服务端忽略 payload 里的 `question_tags` 数组，只认 `question.tag_ids`（`routes/sync.ts:24` 解构中没有 question_tags）
- pull 不落地关联数据

**同构问题**：试卷↔题目（`paper_questions`，`replacePaperQuestions` 同款盲写）、专题↔题目（`topic_questions`）——成员变动同样不传播、且会被陈旧快照回退。payload 里的 `paper_questions`/`topic_questions` 数组同样被服务端忽略。

**风险**：🔴 高。多设备并发使用必然触发；且「新设备无标签」属于功能性失效。

---

### 🔴 A2. 相似题链接 pull 写入 key 错误，链路等于坏掉

- 服务端 pull 的 `similar_links` 对象**没有 `id` 字段**（`routes/sync.ts:136-142`），客户端却用 `dbSimilarQuestionLinks.setItem(sl.id, sl)`（`src/data/sync.ts:133`）→ **所有拉取的链接全部写进 `"undefined"` 一个槽位互相覆盖**，最后一条幸存。
- 本地正确 key 是 `qId_simId` 复合键（`src/data/similar-links.ts:9-12`）。
- 后果：他端新增的链接能否出现在本机取决于它在响应数组里的位置（抽奖式）；**链接的删除墓碑永不落地**（墓碑也被写进 "undefined" 槽）；本地残留的 `"undefined"` 脏记录还会被全量 push 推回服务端。

**风险**：🔴 高（数据损坏 + 删除不传播）。

---

### 🔴 A3. 标签删除永不传播（双端都删不掉）

- `dbDeleteTag` 只写 `deleted_at`，**不更新 `updated_at`**（`tags.ts:78-88`）→ push 时服务端 LWW 用 `updated_at || deleted_at || created_at` 判新，墓碑因「不够新」被拒 → 服务端保留幽灵标签。
- pull 侧 `if (!existing) setItem`（`sync.ts:114-119`）：已存在本地副本的标签**只插入不更新** → 他端的删除墓碑即使拉回来也不落地。
- 结果：删除的标签在其它设备和服务端**永远复活/常驻**。

**风险**：🔴 高（违背「零容忍静默不一致」；列表越用越脏）。

---

### 🟠 A4. papers / notes / topics / links 的 pull 无条件覆盖（in-flight 编辑丢失）

`dbApplyRemoteSnapshot` 中：questions 有 LWW 保护（`new Date(q.updated_at) > existing` 才覆盖），而 **papers、paper_questions、topics、topic_questions、similar_links、question_notes 全部无条件 `setItem`**（`src/data/sync.ts:120-137`）。

**复现剧本**：点同步 → push 完成（payload 已定格）→ 此时用户改了试卷名/笔记 → pull 返回 → **无条件覆盖 → 刚才的编辑静默丢失**。这正是「零容忍静默数据丢失」命中区。题目之所以没事，纯粹因为它有 LWW 比较。

**风险**：🟠 中高。窗口是毫秒~秒级，但自动同步 5 分钟一轮 + 高频编辑，长期使用必然碰到。

---

### 🟠 A5. teaching_* / pdf_* 「推得出去、拉不回来」

- push 全量包含 teaching_nodes/versions/node_questions、pdf_*（payload 里有）；但 pull 的 apply **完全忽略这 9 类 key** → 其它设备产生的教学节点、PDF 书结构永远拉不到本机。
- `dbClearAllData`（`sync.ts:152-161`）不清 `question_tags`/`topic_questions`/teaching_*/pdf_* → 「以服务器为准重建」（doSyncDown）之后这些表是**旧本地数据与服务器数据的混合体**，且 apply 又不填充它们 → 重建语义残缺。
- `question_notes`、`teaching_versions`、`node_questions` 无 `deleted_at` 墓碑列 → 删除无法传播；`node_questions` 服务端 insert-only（`sync-upsert.ts:311-318`），永不更新删除。

**风险**：🟠 中。教学/PDF 模块若只单设备用则暂不爆炸，多设备立刻出现「删不掉、拉不到」。

---

### 🟠 A6. LWW 判定不对称 + 设备时钟不可信

- 同一秒并发编辑：服务端 `>=` 接受 incoming（`helpers.ts isIncomingNewer`），客户端 pull 用 `>` 拒绝 remote（`sync.ts:109`）→ **两端各留不同内容，且都显示「已同步」**。
- `updated_at` 全部取自设备本地时钟，无服务端校准 → 时钟快 5 分钟的设备，它的每次修改都系统性赢下 LWW；未来若启用 `since` 增量拉取，时钟落后的设备写的数据会**被拉取过滤条件漏掉**（当前 pull 恒全量，暂未触发）。

**风险**：🟠 中（低频但属于「静默分叉」类）。

---

### 🟡 A7. 可靠性运维层薄弱

| 问题 | 位置 | 影响 |
|---|---|---|
| fetch 无超时 | `sync-ui.ts apiCall` | 弱网挂起，UI 永远「同步中」，syncInFlight 卡死 |
| 无重试/退避 | `runSync` | 失败只等下次事件或 5 分钟轮询；期间无「未推送改动」指示（`_dirty` 仅 questions 有且 UI 不显示） |
| JWT 30 天过期 | `server auth.ts:16` | 过期后所有同步 401，无重新登录引导，用户只看到「同步失败」 |
| 全量 push 含 base64 图片 | `dbBuildSyncPayload` + 图片以 dataURL 存记录 | 每次同步传输整库（每题几百 KB × 全部题目），5 分钟一轮；慢、耗流量、SQLite 膨胀 |
| `pending_link_list` 服务端整包盲写 | `routes/sync.ts:71` | 当前客户端不推它所以未触发；一旦恢复推送即互踩；pull 回来也被 apply 忽略 |
| 死代码 | `data/sync.ts remoteCall`（0 调用者，其 `initRemoteSync` 无人调用）+ `sync-ui.ts initRemoteSync` 空函数 | 误导后续维护（本次审查就被它干扰） |

---

### 已知盲区（v3 常用标签，文档已承认，不重复展开）

- 双端从同一 rev 离线改同一标签 → 都判「知情」→ 时间戳裁决绕过弹窗（`quick-import-favorite-tags.md` 第七节）。可用「上次同步时间」加固，随 P1 一起做。
- questions/papers/notes 完全没有冲突 UX（记录级 LWW 静默裁决）。全部弹窗不现实，建议仅对「服务端内容与本地 pending 内容语义不同」的高价值字段（题目备注、笔记文本）提示，P2 再议。

---

## 二、配置数据盘点：哪些只存本地、没同步

### 2.1 localStorage（全部**不随服务器同步**；备份文件仅覆盖部分）

| 键 | 内容与形式 | 纳入同步的必要性 | 优先级建议 |
|---|---|---|---|
| `cloud_providers` + `current_provider_id` | AI 供应商配置（**含 API Key**，JSON 数组 + 当前选中 id） | 高——每台新设备都要手动重配 AI 才能用视觉 OCR/出题 | **P1 高** |
| `appVersions` | 版本列表定义（版本皮肤，JSON） | 高——版本筛选/组合/导入的基础数据，新设备缺失则版本体系不完整 | **P1 高** |
| 版本组合 `COMBOS_KEY`/`ACTIVE_COMBO_KEY`（version-combo.ts） | 快速导入版本组合 + 当前组合（JSON） | 中高——与 appVersions 同族，组合引用版本名 | **P1** |
| `pendingLinkList` / `pendingBlankList` | 待链接/待挖空题目 id 数组 | 中——数据性质，跨设备有意义；服务端 `users.pending_link_list` 表已存在（当前盲写、客户端不推） | P2 |
| `wiki_mvp_mode` / `wiki_budget_config` | Wiki 编译模式与预算配置 | 中低 | P2 |
| `tabOrder` | 标签页顺序 | 低 | P3 或不做 |
| `exportImgMode` / `lastBookName` / `pdf_tree_expanded` / `filterTagsExpanded` | UI 记忆类 | 低（各设备各自习惯反而合理） | 不建议同步 |
| `systemPassword` | 版本管理密码（**明文存储**） | 安全敏感，**不建议明文上服务器**；单列提醒改哈希存储 | 特殊（安全项） |
| `baidu_token` / `autoBaidu` / `lastBaiduBackup` | 百度备份集成状态 | 设备相关 | 不同步 |
| `serverUrl` / `apiToken` / `currentUser` / `lastPhone` | 连接与身份凭据 | **必须本地**（安全边界） | 不同步 |
| `lastSyncTime` / `syncCursor` / `syncEnabled` / `autoSync` / `syncWarningLog` | 同步状态 | 设备状态 | 不同步 |
| `lastBackupTime` / `backupPath` / `autoBackup` / `lastSnapshotTime` / `lastSnapshotId` | 备份状态 | 设备状态 | 不同步 |
| `skip_version_code` / `appVersion` | 应用更新状态 | 设备状态 | 不同步 |
| `questionNotesMigratedV1` | 一次性迁移标记 | 无 | 不同步 |

### 2.2 IndexedDB（localForage）不在同步闭环内的 store

| store | 现状 | 结论 |
|---|---|---|
| `question_tags` / `paper_questions` / `topic_questions` | **在 push payload 里，但服务端忽略**；pull 不落地 | 即 A1，须修 |
| `wiki_pages` / `wiki_links` | 走 `/api/wiki` 独立端点按需同步（机制独立于 push/pull） | 已有通道，健壮性另评（fix-llm-wiki-pipeline 已记录服务端无合并） |
| `compile_jobs` / `wiki_log` | 本地过程数据 | 不需要同步 |
| `pending_photos` | 本地上传队列 | 不需要同步 |
| `changelog` | 增量备份日志 | 不需要同步 |
| `pdf_doc_tags` | 本地冗余（服务端从 `pdf_docs.tag_ids` 派生） | 保持本地 |

### 2.3 服务端 `user_settings` 的陈旧副本

旧版本客户端曾整包 push settings（含 cloud_providers），服务端留有**各设备不同代的陈旧副本**；当前客户端已不再走这条路径（push payload 无 settings 字段），只剩 `quickFavoriteTags` 专用端点在写。纳入新同步项时以此为落点即可（shallow merge `{...prev, ...settings}` 已于 2026-09-04 修复）。

---

## 三、优化建议清单（风险等级 + 推荐做法）

> 原则对齐 2026-09-03 决策：零容忍静默丢失；冲突能拿到对端副本；合并逻辑服务端一份纯函数；沿用 v3 已验证的「逐项状态 + rev 知情判定 + 按粒度弹窗」模式。

### P0 —— 正确性修复（丢数据/功能失效，建议最先做）

| # | 项 | 推荐做法 | 风险 |
|---|---|---|---|
| 1 | similar_links key 修复 | apply 改用 `sl.question_id + '_' + sl.similar_question_id` 做 key；墓碑落地（LWW 比较）；一次性迁移删除本地 `"undefined"` 脏记录 | 🔴 |
| 2 | 标签关联同步链路 | 见「四、关键设计决策」，推荐 v3 式逐项墓碑合并 | 🔴 |
| 3 | 试卷/专题成员同步 | 同 #2 模式（paper_questions / topic_questions 逐条 `{on, at}` + 墓碑，服务端纯函数合并） | 🔴 |
| 4 | pull 无条件覆盖加防护 | papers/notes/topics/links 的 apply 与 questions 对齐（LWW 比较）+ **in-flight 防护**：runSync 开始时刻记 `syncStartedAt`，apply 时 `existing.updated_at > syncStartedAt` 的记录跳过覆盖 | 🟠 |
| 5 | `dbDeleteTag` 补 `updated_at` | 一行修复；同时服务端 upsertTag 判新逻辑已兼容 | 🔴（低成本高收益） |
| 6 | 标签 apply 改 LWW | `if (!existing) setItem` → 与 questions 相同的时间戳比较，让墓碑和改名能落地 | 🟠 |

### P1 —— 一致性加固

| # | 项 | 推荐做法 | 风险 |
|---|---|---|---|
| 7 | teaching/pdf 拉取补齐 | apply 补 9 类 key 的 LWW 落地；`dbClearAllData` 补清 question_tags/topic_questions/teaching_*/pdf_*；doSyncDown 语义才完整 | 🟠 |
| 8 | LWW 对齐 + 时钟防御 | 客户端 pull 改 `>=` 与服务端一致；`nowIso()` 改为取服务端时间偏移校准（登录/pull 响应里带 `now`，计算 offset） | 🟠 |
| 9 | 笔记/教学版本墓碑 | question_notes、teaching_versions 加 deleted_at（服务端 ALTER + 客户端删除改墓碑） | 🟠 |
| 10 | fetch 超时 + 重试 | apiCall 加 AbortController 超时（如 20s）；runSync 失败指数退避重试（最多 3 次）；失败状态栏显示「有改动待同步」 | 🟡 |
| 11 | settings 同步扩展 | `cloud_providers`/`appVersions`/版本组合 → 服务端 user_settings（shallow merge 已修好）；API Key 上服务器需口头确认（服务端已有旧副本先例；建议后续 HTTPS） | 🟠（含安全确认） |
| 12 | v3 盲区加固 | 常用标签知情判定加「上次同步时间」辅助条件 | 🟡 |

### P2 —— 体验/性能（可后置）

| # | 项 | 推荐做法 | 风险 |
|---|---|---|---|
| 13 | 增量 push | 只推 `_dirty` 记录（扩展 dirty 标记到全部表），图片 base64 是大头；中期项 | 🟡 |
| 14 | JWT 过期引导 | 401 时提示重新登录而非笼统「同步失败」 | 🟡 |
| 15 | 死代码清理 | 删 `data/sync.ts remoteCall/initRemoteSync`；`sync-ui.ts initRemoteSync` 填真或删 | 🟡 |
| 16 | systemPassword 明文 | 改哈希存储（本地安全项，与同步无关） | 🟡 |
| 17 | 高价值字段冲突提示 | 题目备注/笔记文本检测「服务端与本地 pending 语义不同」时提示（成本高，后议） | 🟡 |

### 明确不做的（YAGNI）

- 不引入 CRDT/OT 全量框架——数据规模（个人题库）不需要，v3 逐项状态模式已够用。
- 不做冲突自动三方合并（题目备注等自由文本没有可自动合并的结构）。
- 不同步 UI 记忆类键（见 2.1 表）。
- 不动 `/api/wiki` 独立通道（另有文档跟踪）。

---

## 四、关键设计决策（待王先生确认后才实施）

### 决策点：标签/试卷/专题「关联」的合并策略

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A. v3 式逐项墓碑合并（推荐）** | 关联记录带 `{on, at}`（add=on:true，remove=on:false 墓碑），key 为 `qId_tagId`；服务端逐条时间戳合并 + rev 知情判定，冲突按条弹窗（复用 quick-fav 模式与服务端纯函数结构） | 与已验证模式严格对齐；删除可传播；并发互不静默覆盖；符合零容忍原则 | 服务端 question_tags 等表加 `updated_at/deleted_at` 列（SQLite ALTER + 兼容旧数据）；push 聚合逻辑 + pull 落地逻辑；改动面中等 |
| B. 集合级 LWW + 丢弃检测 | 保持整包替换，push 前把 dbQuestionTags 聚合进 tag_ids，pull 落地；冲突靠指纹检测弹警告 | 改动小（1-2 天） | 双端同时改同一题的标签仍整包互踩（只剩事后警告，**仍有静默丢失窗口**） |
| C. 只做 push 聚合 + pull 落地（不解决并发） | 最小改动打通「能用」 | 新设备有标签了 | 并发丢数据问题原样保留 |

**我的推荐是 A**，理由：B/C 都保留「后推的赢」的静默丢失，正是 2026-09-03 被推翻的方向；A 的模式（逐项状态+rev+弹窗）刚在常用标签上全链路验证过，服务端合并纯函数、E2E、复现演练的套路全部可复制。

### 不涉及边界

- 不改登录/注册/认证流程（JWT 时长维持 30d，仅加过期提示）
- 不动备份/恢复（backup.ts）与 Supabase 容灾复制链路
- 不动 wiki 独立同步通道
- 不改 E2E 测试账号与隔离方案
- `systemPassword` 哈希化作为独立小项单独确认

---

## 五、实施顺序建议（确认后执行）

1. **第一批（纯正确性，互相独立）**：#1 similar_links、#5 删标签时间戳、#4 pull 防护、#6 标签 apply LWW——每项先写复现性测试（TDD），含截图可见性要求的照常执行
2. **第二批（关联同步，需先定决策点）**：#2 + #3 按 v3 模式实施（服务端 ALTER + 纯函数 + 客户端聚合/落地 + 冲突弹窗复用）
3. **第三批（加固）**：#7 teaching/pdf、#8 时钟校准、#9 墓碑、#10 重试
4. **第四批（settings 扩展）**：#11、#12 及 P2 项

每批完成走完整 CI/CD 循环（typecheck → test → build → E2E 全量 → 截图评估），分批提交由王先生确认。
