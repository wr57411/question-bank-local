# 一键问题反馈与 GitHub Issues 自动提交

日期：2026-08-27 ｜ 关联模块：问题反馈、GitHub Issues、服务端、原生插件

## 功能

1. App 前台运行时，用户截取系统截图 → 底部弹出「📸 检测到截图，要反馈问题吗？」提示条（15s 自动消失，10s 冷却）。
2. 点击「反馈问题」打开弹窗：标题（必填）+ 描述 + 从相册选截图（可换/可删，前端压缩到宽 1080 / 质量 0.8）。
3. 客户端 multipart 提交到自有服务端 `POST /api/issues`（JWT 鉴权，30 次/15 分钟限流）。
4. 服务端用 `GITHUB_TOKEN`：先经 Git Data API 把图片 commit 到仓库 `feedback-assets` 分支，再创建 Issue，正文含 `raw.githubusercontent.com` 图片链接 + 设备信息表。
5. 失败（断网/502/未配置）自动入 IndexedDB 离线队列，App 启动与 `online` 事件时自动重试；4xx（非 401/403/429）视为永久失败丢弃，重试上限 5 次。
6. Web 端无截图检测，仅可通过「设置(☁️ 备份)弹窗 → 意见反馈」手动提交（Web 弹窗内用隐藏 file input 选图）。

## 智能体对接契约

- Issue 标题固定前缀 `[App反馈] `，默认 label `user-feedback`（可用 `GITHUB_ISSUE_LABELS` 追加，如 `agent-friendly`）。
- 图片 URL 形如 `https://raw.githubusercontent.com/{owner}/{repo}/feedback-assets/screenshots/YYYYMMDD/{ts}-{name}`，永久可抓取。
- 正文含 `<details>设备信息</details>`（版本、平台、页面、客户端时间、UA），智能体可用表格解析。
- 拉取方式：`GET /repos/{owner}/{repo}/issues?labels=user-feedback&state=open`（或 GitHub CLI `gh issue list --label user-feedback`）。

## 配置

服务端 `server/.env`：

```
GITHUB_TOKEN=<PAT，需仓库 Contents 读写权限>
GITHUB_REPO=owner/repo
GITHUB_FEEDBACK_BRANCH=feedback-assets   # 默认
GITHUB_BASE_BRANCH=main                  # 分支不存在时从它创建
GITHUB_ISSUE_LABELS=user-feedback        # 逗号分隔
```

## 关键实现位置

| 层 | 文件 | 说明 |
|---|---|---|
| Android 原生 | `ScreenshotListenerPlugin.java` | ContentObserver 监听 MediaStore.Images，RELATIVE_PATH/DATA 含 screenshot 才触发；3s 去抖（elapsedRealtime）；单线程 executor 处理查询；`check()` 返回权限状态 |
| iOS 原生 | `AppDelegate.swift` | `userDidTakeScreenshotNotification` → `bridge.eval(js:)` 转发 WebView `appScreenshotTaken` 事件（Capacitor 6.2.1 无 evalJS，实际 API 为 eval(js:)） |
| JS 事件 | `src/ui/issue-feedback.ts` | Android 插件事件 + iOS window 事件双通道汇合；初始化幂等守卫；投屏激活时不弹提示条 |
| 提交/队列 | `src/services/issue-feedback.ts`、`src/data/issue-queue.ts` | FormData 提交；localforage 独立库 `questionBankFeedback`/`feedback_queue`（避免与主库版本升级竞态）；metadata 保真重放 |
| 服务端 | `server/src/routes/issues.ts` | 限流+鉴权+multer 内存存储；`ensureAssetBranch/uploadImageToRepo/createIssue`；上传进程内串行化；multer 错误映射 413/400 |
| UI | `src/index.html`（提示条/弹窗/入口）| 复用 .modal 体系；反馈弹窗 z-index:1001 高于备份弹窗（修复遮挡） |

## 已知限制

- 系统不向第三方 App 提供截图内容，只能引导用户从相册选取（iOS 系统截图监听亦拿不到图）。
- App 在后台/其他 App 内截图不会提醒（设计边界）。
- iOS 原生编译需 Xcode，Android 编译以 ship 打包流程验证；CI 只覆盖 Web。
- PAT 存服务端 `.env`，不随 APK 分发；泄露风险等同服务器被入侵（与现有 JWT_SECRET 同级）。
- 路径含 "screenshot" 的非截图图片插入（如聊天 App 另存）也会触发提醒，属方案固有取舍。

## 测试

- 前端单测：`npx vitest run unit-tests/issue-feedback.spec.js`（10 用例）
- 服务端测试：`cd server && npx vitest run test/issues.test.ts`（9 用例，mock GitHub fetch）
- E2E：`npx playwright test tests/issue-feedback.spec.js`（3 用例）
- 真机验证清单：Android 截图→提示条→选图→提交；iOS 同流程；断网提交→草稿→恢复网络自动重试。
