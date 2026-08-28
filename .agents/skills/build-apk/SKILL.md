---
name: build-apk
description: 构建 question-bank-local 项目的 debug APK 并复制到项目根目录（文件名含时间戳），当用户说「打包 APK」「构建 APK」「build APK」「生成 APK」时使用。
---

# Build APK Skill

构建 question-bank-local 项目的 debug APK，并复制到项目根目录，文件名包含时间戳。

## 触发条件

当用户说「打包 APK」「构建 APK」「build APK」「生成 APK」时使用此技能。

## 使用流程

### 1. 确认构建来源

打包默认从当前 worktree 构建（源码所在位置）：

- **Worktree** `/Users/john/.codex/worktrees/f640/question-bank-local` — 唯一源码位置（src/、server/）
- **主项目** `/Users/john/question-bank-local` — 仅保留 APK 输出与原生工程（android/、ios/），无前端源码

APK 产物固定输出到主项目根目录，记录写入主项目的 PROJECT_MEMORY.md。

### 2. 同步 Capacitor 资源

```bash
npx cap sync android
```

### 3. 修复 proguard 兼容性（AGP 9.x）

在构建目录（worktree）的 node_modules 内执行：

```bash
find node_modules/@capacitor node_modules/@hotend -name "build.gradle" \
  -exec grep -l "proguard-android\.txt" {} \; | while read f; do
  sed -i '' 's/proguard-android\.txt/proguard-android-optimize.txt/g' "$f"
done
```

### 4. 构建 debug APK

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew assembleDebug
```

### 5. 复制 APK 到项目根目录

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp android/app/build/outputs/apk/debug/app-debug.apk "question-bank-local_${TIMESTAMP}.apk"
```

## 输出

- APK 路径：`<项目根目录>/question-bank-local_YYYYMMDD_HHMMSS.apk`
- 大小：约 18MB（debug 版本）

## 注意事项

- 构建的是 debug APK，可直接安装测试
- proguard 修复是临时的，`npm install` 后需要重新修复
- 如需 release APK，使用 `./gradlew assembleRelease`（需配置签名）
- 首次构建 Gradle Daemon 启动需要额外时间
- worktree 与主项目各有独立 android/ 原生工程，worktree 构建产物复制到主项目根目录
