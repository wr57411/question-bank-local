# 修复 PDF 书库同步、试读与下载问题

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-07-26
- **关联模块：** 服务端同步、PDF 书库 UI、PDF 云端服务
- **影响文件：** server/src/index.ts、server/src/routes/sync.ts、server/src/services/sync-upsert.ts、src/ui/pdf-library.ts、src/services/pdf-cloud.ts

## 问题现象

同步请求在服务端发生异常时返回 HTML 500 页面；浏览器中的 PDF 试读无法使用 Capacitor 本地缓存；PDF 操作菜单没有下载全文入口，浏览器下载也会因 Capacitor 文件系统不可用而失败。

## 根因分析

### 触发条件

- 同步路由内部的数据库操作抛出异常。
- 在浏览器而非原生 Capacitor 容器中试读或下载 PDF。
- 试读服务端页面渲染失败时需要用户改为下载全文。

### 根因

服务端入口没有全局 JSON 错误处理中间件，同步路由也没有捕获错误。PDF 同步的处理结果复用了 tags 字段。客户端在浏览器环境仍尝试调用 Capacitor Filesystem，并吞掉服务端试读失败；下载流程同样只实现了原生缓存路径。

## 修复方案

- 服务端为未捕获异常和同步 push/pull 路由返回结构化 JSON 错误。
- PDF 同步结果增加独立字段，避免混入标签结果。
- 浏览器试读直接调用服务端页面接口，失败时显示具体原因与下载入口。
- 浏览器使用 Blob 下载，原生端保留 Capacitor 缓存行为。

### 变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|-----|
| server/src/index.ts | 修改 | 增加全局 JSON 错误处理中间件 |
| server/src/routes/sync.ts | 修改 | 为 push/pull 增加错误处理并修正 PDF applied 字段 |
| server/src/services/sync-upsert.ts | 修改 | 补齐 PDF 同步结果类型与初始化 |
| src/ui/pdf-library.ts | 修改 | 浏览器试读走服务端、展示失败原因与下载入口 |
| src/services/pdf-cloud.ts | 修改 | 增加浏览器 Blob 下载回退 |

## 验证结果

- [x] 客户端 TypeScript 检查通过
- [x] Vite 生产构建通过
- [x] 服务端以 tsx 启动成功，`/api/health` 返回 JSON
- [x] 未认证的 `/api/sync/push` 与 `/api/sync/pull` 返回 JSON 401
- [ ] 已认证的同步异常和实际 PDF 页面渲染需要配置测试账号及已上传 PDF 后验证

服务端完整 TypeScript 检查仍被既有 TS 迁移问题阻塞，涉及未改动的多个路由、PDF 渲染类型定义及既有端口类型；本次改动未新增该类错误。

## 经验总结

服务端 API 入口和关键业务路由都应保证错误响应结构一致；跨平台功能需要在调用原生插件前明确区分浏览器与 Capacitor 环境，并为失败路径提供用户可执行的替代操作。
