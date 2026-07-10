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

### 2. 语法检查（必须先执行）

构建前必须检查 JS 语法，防止语法错误导致整个应用崩溃：

```bash
node -e "const c=require('fs').readFileSync('www/index.html','utf8'); const m=c.match(/<script[^>]*>([\\s\\S]*?)<\\/script>/gi); if(m){m.forEach((s,i)=>{const code=s.replace(/<\\/?script[^>]*>/gi,''); try{new Function(code)}catch(e){console.error('❌ JS语法错误: '+e.message); process.exit(2)}}); console.log('✅ 语法检查通过')} else { console.log('✅ 无script块') }"
```

如果检查失败，**立即修复错误，不要继续构建**。

### 3. 同步 Capacitor 资源

```bash
npx cap sync android
```

### 4. 修复 proguard 兼容性（AGP 9.x）

只在主项目构建时执行（worktree 的 node_modules 可能不同路径）：

```bash
find node_modules/@capacitor node_modules/@hotend -name "build.gradle" \
  -exec grep -l "proguard-android\.txt" {} \; | while read f; do
  sed -i '' 's/proguard-android\.txt/proguard-android-optimize.txt/g' "$f"
done
```

### 5. 构建 debug APK

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew assembleDebug
```

### 6. 复制 APK 到主项目目录

无论在哪个目录构建，APK 一律复制到主项目目录 `/Users/john/question-bank-local/`，方便统一管理和安装：

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp android/app/build/outputs/apk/debug/app-debug.apk "/Users/john/question-bank-local/question-bank-local_${TIMESTAMP}.apk"
```

## 输出

- APK 路径：`/Users/john/question-bank-local/question-bank-local_YYYYMMDD_HHMMSS.apk`
- 大小：约 18MB（debug 版本）

## 注意事项

- 构建的是 debug APK，可直接安装测试
- proguard 修复是临时的，`npm install` 后需要重新修复
- 如需 release APK，使用 `./gradlew assembleRelease`（需配置签名）
- 首次构建 Gradle Daemon 启动需要额外时间
- 两个项目共用同一个 android/ 构建目录，切换项目时需确保 www/ 已同步
