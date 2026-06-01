# Build APK Skill

构建 question-bank-local 项目的 debug APK，并复制到项目根目录，文件名包含时间戳。

## 触发条件

当用户说「打包 APK」「构建 APK」「build APK」「生成 APK」时使用此技能。

## 使用流程

### 1. 询问打包来源

先问用户从哪个项目打包：

- **主项目** `/Users/john/question-bank-local` — 只有单配置 API，无多服务商
- **Worktree** `/Users/john/.codex/worktrees/f640/question-bank-local` — 有多服务商管理 + 相似题目关联 + 待关联功能

选择后切换到对应目录再执行后续步骤。

### 2. 同步 Capacitor 资源

```bash
npx cap sync android
```

### 3. 修复 proguard 兼容性（AGP 9.x）

只在主项目构建时执行（worktree 的 node_modules 可能不同路径）：

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
- 两个项目共用同一个 android/ 构建目录，切换项目时需确保 www/ 已同步
