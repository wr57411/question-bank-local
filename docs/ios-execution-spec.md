# iPad / iPhone (Universal) iOS 版本执行 Spec

> 基于既有方案 + 现状探查 生成。实施前需你（王先生）确认。
> 关联：AGENTS.md 工作流程（先出方案 → 等确认 → 再编码）。

---

## 0. 已确认的 4 点决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 设备范围 | **iPhone + iPad 通用 (Universal)** |
| 2 | 首版范围 | 按阶段 1–3 做"可日常用的题库版"（非空壳） |
| 3 | 端侧 AI | 首版**不做** Gemma4（iOS 上明确降级提示） |
| 4 | 本机环境 | 你愿意装完整 Xcode + CocoaPods |

---

## 1. 现状关键发现（决定改动细节）

- 工程根：`/Users/john/question-bank-local`，当前分支 `F640/main2`。
- `ios/` **已存在但是过时骨架**：里面 `App/App/public/` 是旧 `www` 拷贝，且含 `Gemma4Plugin.swift` 自定义原生插件（首版不移植）。`.gitignore` 整目录忽略 `ios/`（未纳入版本控制）。
- 本机：**无 Xcode、无 CocoaPods**（仅 Command Line Tools）。`node v22 / npm 10` 正常。
- **版本风险**：`@capacitor/clipboard@^8` 与核心 `Capacitor 6` 不兼容 —— `cap sync` 跑 `pod install` 时会因 clipboard v8 要求 Capacitor 7+ 而失败。iOS 上目前 `Clipboard` 插件也未进 Podfile，导致 `pasteTo()` 在 iOS 失效。
- 前端降级基础已具备：`isNative` 在 iOS 上也为 `true`；`FloatingWindow`/`Gemma4` 在 iOS 上是 `undefined`，现有代码用 `if (!isNative || !FloatingWindow) return;` 兜底（不崩，但按钮是"死按钮"）。
- 备份目录：iOS 已走 `DOCUMENTS`（代码 3373–3375 行用 `getPlatform()==='ios'` 兜底，无需 `@capacitor/device` 也能工作）。
- iPad 布局：已有 `@media(min-width:1024px)` 初步适配（容器加宽、题目网格多列），需增强横屏与弹层。
- 缺 `@capacitor/device`（代码已用 `getPlatform()` 兜底，可不补；保持最小改动）。

---

## 2. 阶段 1：搭 iOS 工程骨架（最小可运行）

### 2.1 清理旧骨架（gitignore 保护，非破坏性）
```bash
# 旧 ios/ 未纳入 git，先整体备份到 /tmp，再删除，避免 cap add 报 "already exists"
mv ~/question-bank-local/ios /tmp/question-bank-local-ios-old-$(date +%Y%m%d)
```
（保留备份以防需要参考旧 Info.plist 权限写法。）

### 2.2 依赖修正（必须先做，否则 sync 失败）
- `package.json`：`@capacitor/clipboard` 由 `^8.0.1` → `^6.0.1`（与 Capacitor 6 对齐，Web API 不变）。
- `npm install`（更新 lock + node_modules）。

### 2.3 生成 iOS 工程
```bash
cd ~/question-bank-local
npx cap add ios        # 生成 ios/App（无需 Xcode，仅文件生成）
```

### 2.4 配置 Info.plist（权限 + Universal/iPad 方向）
`cap add ios` 生成后，向 `ios/App/App/Info.plist` 确保以下 key（Capacitor 6 默认模板已含相机/相册权限描述，需核对；iPad 方向需补齐 `~ipad` 数组）：

- `NSCameraUsageDescription` = `需要使用相机拍摄题目照片`
- `NSPhotoLibraryUsageDescription` = `需要访问相册选择题目图片`
- `NSPhotoLibraryAddUsageDescription` = `需要保存图片到相册`
- `UISupportedInterfaceOrientations`（iPhone）：Portrait / LandscapeLeft / LandscapeRight
- `UISupportedInterfaceOrientations~ipad`（iPad）：Portrait / PortraitUpsideDown / LandscapeLeft / LandscapeRight
- `LSRequiresIPhoneOS` = `true`（Universal 标准，iPad 自动兼容）

> 为保证可重复、不被 `cap sync` 覆盖，Info.plist 修改封装进 `scripts/ios-plist-patch.sh`，在 `cap sync` 后执行。

### 2.5 Podfile 补齐 Clipboard
`ios/App/Podfile` 的 `capacitor_pods` 增加：
```ruby
pod 'CapacitorClipboard', :path => '../../node_modules/@capacitor/clipboard'
```
（CapacitorCamera/Filesystem/Browser/HotendCapacitorFilePicker 已存在。）

### 2.6 package.json 增加 iOS scripts
```json
"cap:add:ios":   "npx cap add ios",
"cap:sync:ios":  "npx cap sync ios && bash scripts/ios-plist-patch.sh",
"cap:open:ios":  "npx cap open ios",
"cap:run:ios":   "npx cap run ios"
```

### 2.7 .gitignore 变更（让 iOS 工程纳入版本控制）
移除整行 `ios/`，改为精确忽略构建产物：
```
# iOS 构建产物（保留工程源码）
ios/App/Pods/
ios/App/build/
ios/App/DerivedData/
ios/App/*.xcworkspace/xcuserdata/
ios/App/Podfile.lock
```
（Podfile.lock 是否提交可后续定；先忽略避免噪声。）

**影响文件**：`package.json`、`ios/`(生成)、`scripts/ios-plist-patch.sh`(新增)、`.gitignore`、`capacitor.config.ts`(微调，见下)。
**Xcode 依赖**：本机无 Xcode → `cap sync` 的 `pod install` 步骤需你装完 CocoaPods 后执行；工程生成与 Web 适配我现在就能做。

---

## 3. 阶段 2：平台行为对齐（Web 层小改）

### 3.1 平台常量（index.html ~1178 行区域）
在 `isNative` 定义后增加：
```js
const isIOS   = isNative && window.Capacitor.getPlatform() === 'ios';
const isAndroid = isNative && window.Capacitor.getPlatform() === 'android';
```

### 3.2 Android 独占能力在 iOS 优雅降级
- **悬浮窗按钮** `#floating-toggle-btn`（259 行）：`if (!isAndroid) hideEl('floating-toggle-btn');`
- **待处理/待补拍 Tab** `#pending-photos-tab`、`#pending-blank-tab`（269 行附）：非 Android 隐藏（依赖 FloatingWindow/QuickCapture）。
- **AI 引擎管理卡片**（274–295 行）：非 Android 时，隐藏"加载模型/批量分析"按钮，显示提示 `iOS 版暂不支持端侧 AI（Gemma4），可使用云端 API 服务商`。保留"模型服务商管理"（云端 API 跨平台可用）。
- `toggleFloatingWindow()` / `db.js` 的 `Gemma4` 调用已有 `if (!FloatingWindow)` / `if (!Gemma4) return;` 兜底，无需改逻辑，仅 UI 入口下沉。

### 3.3 备份目录文案动态化
`showBackupModal()` 中"文件将保存在 `Download/question-bank-backup.json`"（969 行附近）改为按平台：
- iOS → `Documents/question-bank-backup.json`（iCloud 自动同步）
- Android → 维持 `Download/...`

### 3.4 安全区 / 键盘遮挡复核
- 已有 `viewport-fit=cover` + `env(safe-area-inset-*)`。
- 增加：FAB 与底部 Tab 在 iPad 横屏下额外 `padding-bottom: env(safe-area-inset-bottom)`；模态框 `max-height: 90dvh` 防 iPad 横屏顶到状态栏。

**影响文件**：`www/index.html`、`www/db.js`（Gemma4 调用已安全，仅确认）。

---

## 4. 阶段 3：iPad 布局适配（产品体验，渐进）

在 `www/index.html` `<style>` 内增强断点（现有 1024px 规则保留并扩展）：

- `min-width:768px`：`.container{max-width:900px}`；题目网格 2 列；标签页允许换行不挤。
- `min-width:1024px`：`.container{max-width:1100px}`；题目网格 `repeat(auto-fill,minmax(240px,1fr))`；弹层宽度上限放宽到 `720px`。
- 横屏（`orientation:landscape`）：弹层 `max-height:88dvh`；教学内容阅读区/Markdown 容器 `max-width:900px` 居中，避免超宽拉伸。
- 触控友好：可点区域最小 `44px`；`:hover` 依赖项（如 `.crop-icon:hover`）补充 `:active` 表现，iPad 指针/触摸通用。
- 可选二期：列表 | 详情分栏（首版不做）。

**影响文件**：`www/index.html`（内联 CSS/少量 JS）。

---

## 5. 阶段 4：打包与文档

- `docs/ipad-ios-adaptation.md`：开发/安装/Archive 流程（含"装 Xcode + CocoaPods → `npm i` → `npm run cap:sync:ios` → `cap open ios` → 选设备 Archive"）。
- `AGENTS.md` 索引追加 iOS 适配清单链接。
- `PROJECT_MEMORY.md` 追加本次 iOS 版本更新记录（日期 + 标签 + 简述）。
- `scripts/ship-feature.sh` 目前偏 APK；iOS 不强行自动化（签名因人而异），仅文档说明。

---

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| 本机无 Xcode/CocoaPods → 无法本地编 iOS | 我现在完成工程生成(无需Xcode)+Web适配；`pod install`/Archive 等你装完执行，文档写清步骤 |
| clipboard v8 与 Capacitor 6 不兼容 | 降级到 `^6.0.1`，Podfile 补 Clipboard |
| ios/ 被 gitignore 丢失工程 | 改为精确忽略 Pods/build，工程源码入库 |
| 旧 ios/ 含 Gemma4Plugin.swift 干扰 | 先备份到 /tmp 再 `cap add ios` 重新生成 |
| iPad 横屏布局错乱 | 阶段 3 断点 + dvh 弹层约束 |

---

## 7. 首版验收标准（你装完 Xcode 后执行）

- [ ] iPad/iPhone 模拟器能启动，首页可进
- [ ] 添加题目：相册选图 / 相机（模拟器可只测相册）
- [ ] 题库列表、详情、搜索正常
- [ ] 备份导出到 Documents，能再导入
- [ ] PDF 生成并能打开预览
- [ ] 教学内容 Markdown + 公式渲染正常
- [ ] 悬浮窗 / 端侧 AI 在 iOS 上不崩溃、有明确提示（入口已隐藏/降级）
- [ ] 横竖屏切换无严重布局错乱

---

## 8. 本次不改动（明确边界）

- Android 现有打包链路（APK scripts）不动
- Gemma4 / 悬浮窗 / 快捷拍摄的原生实现首版不移植
- 不换 UI 框架，不引入新前端依赖（除 clipboard 降级）
