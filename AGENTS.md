# 项目协作规则

## 工作流程

1. **先出方案**：收到需求后，先写计划（做什么、怎么做、影响范围），不做实现
2. **等用户确认**：用户同意方案后，再开始编码
3. **遇到问题及时沟通**：实施过程中发现新问题，先暂停并告知用户

## 项目信息

- **项目路径**: `/Users/john/question-bank-local`
- **类型**: 本地题库 App（iOS + Android，基于 Capacitor）
- **原项目参考**: `/Users/john/question-bank-app`

## 技术栈

- 前端：HTML + JavaScript（无框架）
- 本地存储：IndexedDB（localForage）
- 图片处理：Cropper.js + Canvas
- PDF 生成：jsPDF
- 原生打包：Capacitor 6
- 插件：@capacitor/camera, @capacitor/filesystem

## 适配清单

### iOS
- Info.plist 权限：Camera, PhotoLibrary, PhotoLibraryAdd
- 备份目录：Documents（iCloud 自动同步）
- CocoaPods 依赖管理

### Android
- AndroidManifest.xml 权限：Camera, Storage, Media
- 备份目录：EXTERNAL_STORAGE/Download（卸载不丢失）
- file_paths.xml 配置

## 代码规范

- 不添加注释（除非用户要求）
- CSS 内联到 HTML
- JS 内联到 HTML 底部
- 单文件结构，方便维护
