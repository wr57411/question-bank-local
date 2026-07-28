# PROJECT_MEMORY.md


## 2026-06-02
- **20260602_111154** - 补跑 ship-feature skill 打包 (预览放大 + 从待关联选取) (question-bank-local_20260602_111154.apk)

## 2026-07-19
- **20260719_ios-v1** - 新增 iPad/iPhone(Universal) iOS 版本骨架：清理旧 ios/ 备份到 /tmp 后 npx cap add ios 重新生成；clipboard 由 ^8 降级到 ^6.0.1（与 Capacitor 6 对齐，修复 pod install 兼容性）；增加 cap:add:ios/sync:ios/open:ios/run:ios 脚本与 scripts/ios-plist-patch.sh（自动补相机/相册权限与 iPad 四向方向）；.gitignore 改为仅忽略 ios Pods/build；Web 层 applyPlatformUI() 在 iOS 隐藏悬浮窗/待补拍/待处理/端侧AI入口并提示用云端 API；修 pasteTo 的 text.value bug；新增 iPad 断点布局(768/1024 + 横屏约束)；文档 docs/ipad-ios-adaptation.md + AGENTS.md 索引更新（注：pod install/Archive 需装好 Xcode+CocoaPods 后执行）。同日主仓还原到干净 HEAD(e310ac3)=Codex 状态，iOS 工作作为独立改动叠回，4 个主仓独有遗留(CLAUDE.md/.claude/settings.local.json/.codex/environments/supabase-schema.sql)移至 /tmp/legacy-main-backup/ 未删。
