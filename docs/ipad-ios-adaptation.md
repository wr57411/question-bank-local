# iPad / iPhone (Universal) iOS 版本 开发文档

> 基于 Capacitor 6 在现有 Android 同源 `www/` 上新建 iOS 版本。
> 关联执行 spec：`docs/ios-execution-spec.md`（已落地的实施方案）。

---

## 1. 环境要求（阻塞项）

- **完整 Xcode**（不是仅 Command Line Tools）：`xcodebuild -version` 可见版本号
- **CocoaPods**：`sudo gem install cocoapods` 或 `brew install cocoapods`
- Apple 开发者账号（真机运行 / 分发需要签名）
- Node 22 + npm 10（已满足）

本机当前状态（2026-07-18）：仅有 CLT，无 Xcode / 无 CocoaPods →
工程骨架已生成，但 `pod install` 与模拟器/Archive 需装好 Xcode 后执行。

---

## 2. 首次构建与运行

```bash
cd ~/question-bank-local

# 1) 依赖已对齐（clipboard 已降到 ^6.0.1，与 Capacitor 6 一致）
npm install

# 2) 生成/同步 iOS 原生工程 + 补 Info.plist 权限与方向
npm run cap:sync:ios
#   等价于：npx cap sync ios && bash scripts/ios-plist-patch.sh
#   注意：cap sync 会在内部跑 pod install —— 需先装好 CocoaPods

# 3) 打开 Xcode
npm run cap:open:ios

# 4) 在 Xcode 中选择模拟器（iPhone / iPad）或真机，点运行
#    或命令行：npm run cap:run:ios
```

### Info.plist 自动补丁
`scripts/ios-plist-patch.sh` 在每个 `cap sync` 后执行，向
`ios/App/App/Info.plist` 注入：
- `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`
- `UISupportedInterfaceOrientations~ipad`（iPad 四向，含 UpsideDown）

> 为什么需要脚本：Capacitor 6 的 `cap sync` 可能覆盖手动改的 Info.plist，
> 脚本保证权限/方向每次都还在。

---

## 3. iOS 与 Android 的能力差集（首版）

| 能力 | Android | iOS（首版） |
|------|---------|-------------|
| 题库 CRUD / 搜索 | ✅ | ✅ |
| 相册选图 / 相机拍照 | ✅ | ✅ |
| 裁剪 / PDF 生成预览 | ✅ | ✅ |
| 备份导出 / 导入（Documents） | ✅ (Download) | ✅ (Documents, iCloud) |
| 云端 API 服务商（评价生成标签） | ✅ | ✅ |
| 悬浮窗 FloatingWindow | ✅ | ❌ 隐藏入口 |
| 待补拍 / 待处理（QuickCapture） | ✅ | ❌ 隐藏 Tab |
| 端侧 AI Gemma4 | ✅ | ❌ 隐藏入口，提示用云端 API |
| 横竖屏（含 iPad UpsideDown） | ✅ | ✅ |

降级逻辑在 `www/index.html` 的 `applyPlatformUI()`：
非 Android 时隐藏 `#floating-toggle-btn` / `#pending-blank-tab` /
`#pending-photos-tab` / `#ai-load-btn` / `#ai-batch-btn`，
并将 AI 卡片文案改为"iOS 版暂不支持端侧 AI，可使用云端 API"。

---

## 4. iPad 布局适配（阶段 3）

在 `www/index.html` 内联 CSS 中：
- `min-width:768px`：容器 900px、题目网格多列、Tab 换行
- `min-width:1024px`：容器 1100px、题目网格 `minmax(240px,1fr)`、弹层上限 720px
- 横屏（`orientation:landscape` + 768px）：弹层 `max-height:88dvh`、阅读区/Markdown 居中且限宽 900px
- 触控友好：`.tab` / `.btn-group button` 最小高度 44px

> 首版未做"列表 | 详情分栏"，列为二期。

---

## 5. 版本与依赖说明

- 主体：`@capacitor/*` 全部 `^6`（core / android / ios / camera / filesystem / browser / cli）
- `@capacitor/clipboard` 从 `^8.0.1` **降级到 `^6.0.1`**：
  v8 要求 `@capacitor/core >=8`，与本项目核心 v6 冲突，会导致 `pod install` 失败；
  v6 与 v8 的 API 完全一致（`read()`/`write()`），调用点无需改动。
  这是修复孤立的版本错配，不是整体降级。
- `@hotend/capacitor-file-picker` `^6.0.101`：用于备份导入的文件选择。

---

## 6. 各平台构建/验收

### 模拟器验收（装好 Xcode 后）
- [ ] iPad/iPhone 模拟器启动，首页可进
- [ ] 添加题目：相册选图（模拟器相机受限，至少测相册）
- [ ] 题库列表 / 详情 / 搜索正常
- [ ] 备份导出到 Documents，能再导入
- [ ] PDF 生成并能预览
- [ ] 教学内容 Markdown + 公式渲染正常
- [ ] 悬浮窗 / 端侧 AI 入口已隐藏，无空点 / 不崩溃
- [ ] 横竖屏切换无严重布局错乱

### 真机 / 分发
- 真机需 Apple 开发者签名（Xcode 自动管理或手动证书）
- IPA 签名因人而异，本工程不强行自动化；流程见 Xcode Archive。

---

## 7. 已知风险与对策

| 风险 | 对策 |
|------|------|
| 本机无 Xcode/CocoaPods → 无法本地编 iOS | 工程生成 + Web 适配已完成；`pod install`/Archive 等装好后执行 |
| clipboard v8 与 Capacitor 6 冲突 | 降级到 `^6.0.1`，Podfile 由 Capacitor 自动补 Clipboard |
| ios/ 曾被 gitignore 丢失工程 | 改为精确忽略 Pods/build，工程源码入库 |
| 旧 ios/ 含 Gemma4Plugin.swift | 已备份到 /tmp 后 `cap add ios` 重新生成干净工程 |
