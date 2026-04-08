## 2024-04-04
- [question-bank-local] 自定义备份文件夹功能重写 - 完成

### 实现内容
1. 安装 @hotend/capacitor-file-picker 插件
2. 重写 selectBackupPath() 使用 FilePicker.pickDirectory()
3. 添加权限检查逻辑
4. 支持 SAF (Storage Access Framework) 保存目录 URI
5. 保留百度网盘代码不变

### 代码变更
- www/index.html: 重写目录选择逻辑
- AndroidManifest.xml: 已有存储权限