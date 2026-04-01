# 本地题库 App

离线题库管理工具，支持 iOS / Android，数据完全存储在本地，无需联网即可使用。

## 功能

- 拍照/相册选题，支持裁剪和跨页拍摄（两张拼接）
- 标签管理，多标签筛选
- 排版适用性设置（单栏 / 双栏）
- 试卷创建，按标签选题
- 客户端生成 PDF 试卷
- 软删除回收站，可恢复或彻底删除
- 批量选择 & 试题篮
- 数据导入/导出（JSON 备份）
- 自动备份到本地（iOS iCloud / Android Download）
- 百度网盘备份（绑定账号后自动/手动上传）

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | HTML + JavaScript（无框架） |
| 本地存储 | IndexedDB（localForage） |
| 图片处理 | Cropper.js + Canvas |
| PDF 生成 | jsPDF |
| 原生打包 | Capacitor 6 |
| 相机 | @capacitor/camera |
| 文件系统 | @capacitor/filesystem |
| 浏览器 | @capacitor/browser |

## 构建

### 浏览器测试

```bash
npm install
npx serve www
```

### Android APK

```bash
npm install
npx cap open android
```

在 Android Studio 中：Build → Build APK(s)

### iOS

```bash
npm install
npx cap open ios
```

在 Xcode 中选择设备，点击运行。

## 项目结构

```
question-bank-local/
├── www/
│   ├── index.html       # 主界面 + 全部 JS
│   ├── db.js            # IndexedDB 数据层
│   ├── cropper.min.js   # 图片裁剪
│   ├── cropper.min.css
│   ├── localforage.min.js
│   └── jspdf.umd.min.js
├── android/             # Android 原生项目
├── capacitor.config.ts
└── package.json
```

## 截图

（待补充）
