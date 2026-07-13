---
name: auto-ship-apk
enabled: true
event: stop
action: warn
pattern: .*
---

## 自动打包 APK 检查

代码修改已完成。根据 AGENTS.md 打包规则，改完代码后必须自动生成 APK：

1. **已执行 ship 打包** — 改完代码后自动调用 `npm run ship -- "功能描述"` 生成 APK
2. **APK 已输出** — APK 输出到 `/Users/john/question-bank-local/question-bank-local_YYYYMMDD_HHMM.apk`
3. **PROJECT_MEMORY.md 已更新** — ship 脚本自动追加打包记录
4. **UI 健康检测已通过** — ship 脚本自动运行 Playwright UI 检测

**执行命令**（在 worktree 目录下）：
```bash
npm run ship -- "功能描述"
```

代码修改后必须生成 APK 进行验证，不可跳过。
