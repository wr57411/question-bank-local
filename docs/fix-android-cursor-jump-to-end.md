# 修复 Android 端输入框光标失效（文字总插入到末尾）

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-08-28
- **关联模块：** Capacitor 配置, Android WebView, 输入框, IME
- **影响文件：** capacitor.config.ts

## 问题现象

Android 原生 App 中，所有输入框（文字笔记 textarea、搜索框、评价输入框等）无法在文本中间插入内容：

1. 点击文本中间可以定位光标（视觉上光标出现在中间）
2. 但用中文输入法打字上屏后，文字总是追加到整段文本的**末尾**，而不是光标所在位置
3. 更换输入法（千问输入法 → 豆包输入法）现象完全一致
4. Web 浏览器端（桌面 Chrome）行为完全正常

## 根因分析

### 排查过程（证据链）

1. **Web 层代码排查**：TS 层与遗留 app.js 对这些输入框没有任何 input 事件绑定，value 写入只发生在提交成功后清空/弹窗打开时。全局层面无 user-select:none、无 touch preventDefault、无 input 委托监听。
2. **桌面实测取证**：给 form-text-note 的 value setter 装调用栈监控，桌面 Chrome 中真实点击定位光标（selStart 精确落在字中间）+ CDP Input.imeSetComposition 模拟中文输入法组合上屏，文字精确插入光标处，键入期间应用代码 0 次写 value → Web 层彻底排除。
3. **换输入法验证**：千问/豆包两个输入法现象一致 → 排除单一输入法缺陷，指向 WebView 环境层。

### 根因

capacitor.config.ts 中存在配置：

    android: {
      allowMixedContent: true,
      captureInput: true   // ← 元凶
    }

Capacitor Android 源码（CapacitorWebView.java）中：

    boolean captureInput = config.isInputCaptured();
    if (captureInput) {
        if (capInputConnection == null) {
            capInputConnection = new BaseInputConnection(this, false);
        }
        return capInputConnection;   // 返回假连接
    }
    return super.onCreateInputConnection(outAttrs);  // 正常路径：Chromium 真实连接

captureInput: true 使 WebView 的 onCreateInputConnection 返回 BaseInputConnection(this, false)（dummy 假输入连接），替换掉 Chromium 内核的真实输入连接。输入法通过假连接无法查询真实光标位置（getTextBeforeCursor/getExtractedText 等全部失效），组合输入上屏时只能把文字提交到它自己维护的假状态末尾——即整段文本的最后。

该配置自项目 init 首次提交就存在（模板带入），无任何文档说明或原生代码依赖（FloatingWindow/SmartCapture 等插件均不读取 isInputCaptured），移除安全。

## 修复方案

从 capacitor.config.ts 的 android 段删除 captureInput: true，恢复 Chromium 真实输入连接。

## 验证

- 本地 CI/CD（Qoder worktree）：typecheck / vitest（166 通过）/ vite build / Playwright ui-health（21 通过）全部通过
- 真机验证：安装新 APK 后，在文字笔记中间点击光标打字，文字应落在光标处

## 经验教训

1. captureInput: true 禁用：该配置把 Android WebView 输入法连接替换为 dummy BaseInputConnection，导致所有输入框光标失效、文字只能追加到末尾。本项目永不使用。
2. 输入类 bug 的排查路径：先桌面浏览器插桩取证（value setter 监控 + CDP Input.imeSetComposition 模拟 IME）排除 Web 层，再查 WebView 配置/原生层，最后换输入法做设备端二分——避免盲目改 JS。
3. 配置项审计：captureInput 这类「模板带入」配置要有警惕心，git 历史（init 即存在）+ 全库引用检索是判断其可否移除的依据。
