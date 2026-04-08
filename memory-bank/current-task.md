# 当前任务: 自定义备份文件夹功能重写

## 状态
- 阶段: 完成
- 开始时间: 2024-04-04

## 需求描述
修复 Android 自定义备份文件夹功能，实现：
1. 让用户选择任意目录（SAF）
2. 处理 Android 运行时存储权限
3. 实现自动备份功能
4. 保留百度网盘作为备选方案

## 完成内容

### 1. 安装插件
- `@hotend/capacitor-file-picker@6.0.101`

### 2. 代码变更 (www/index.html)

#### FilePicker 初始化
```javascript
const FilePicker = isNative && window.Capacitor?.Plugins?.FilePicker ? window.Capacitor.Plugins.FilePicker : null;
```

#### selectBackupPath() 重写
- 使用 `FilePicker.pickDirectory()` 打开系统目录选择器
- 检查并请求存储权限
- 保存选择的目录 URI 到 localStorage

#### backupPath 和 backupDir 逻辑更新
- `getBackupDir()`: 优先使用用户选择的 SAF URI
- `getBackupPath()`: 用户选择目录时返回 null

#### saveBackupToDevice() 和 doAutoBackup() 更新
- 支持 SAF URI 写入模式

### 3. 百度网盘
- 代码保持不变

## 待测试
- 在 Android 设备上测试目录选择功能
- 测试自动备份功能