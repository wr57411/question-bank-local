# 修复 PDF 预览 "Invalid PDF structure" 错误

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-07-26
- **关联模块：** 客户端 PDF 预览、Capacitor 文件系统
- **影响文件：** `src/ui/pdf-library.ts`

## 问题现象

PDF 试读时，前 3 页能正常预览，但界面上方残留错误信息 `PDF 预览不可用 Invalid PDF structure`。

## 根因分析

### 调用链

1. 用户打开试读 → `loadMorePreviewPages()`
2. 先尝试 `renderPdfPreviewFromCache()`（Capacitor 本地缓存预览）
3. 读取缓存文件并转为 Blob → **此处为 bug 根源**
4. `renderPdfPreviewOnCanvas()` 解析 Blob → 抛出 `Invalid PDF structure`
5. 错误信息写入 container，函数返回 0
6. 降级到 `fetchPdfPages()`（服务端渲染），图片追加到 container
7. **container 未被清空**，错误信息残留

### 根因

`Filesystem.readFile()` 返回的 `result.data` 是 **base64 编码字符串**（Capacitor 6 API 规范），但代码将其强转成 `ArrayBuffer`：

```ts
const blob = new Blob([result.data as unknown as ArrayBuffer], { type: 'application/pdf' });
```

实际创建的是包含 base64 ASCII 文本的 Blob，而非 PDF 二进制数据。pdfjs-dist 解析时检测到非 PDF 文件结构，抛出 `Invalid PDF structure`。

## 修复方案

1. 新增 `base64ToBlob()` 辅助函数，正确将 base64 字符串解码为二进制 Blob
2. 替换 `renderPdfPreviewFromCache()` 中两处错误的 Blob 创建
3. `fetchPdfPages()` 追加图片前清空 container，防止残留错误信息

## 变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/ui/pdf-library.ts` | 新增函数 | `base64ToBlob()` — base64 → Blob 正确转换 |
| `src/ui/pdf-library.ts` | 修改 | 两处 `new Blob([result.data as unknown as ArrayBuffer])` → `base64ToBlob(result.data as string, 'application/pdf')` |
| `src/ui/pdf-library.ts` | 修改 | `fetchPdfPages()` 分支追加图片前增加 `container.innerHTML = ''` |

## 验证结果

- [x] TypeScript 检查通过
- [x] Vite 生产构建通过
- [ ] 真机验证需要用户连接 Tailscale 后测试

## 经验总结

Capacitor Filesystem API 读写二进制文件时，`readFile` 返回 base64 字符串而非 ArrayBuffer。转换时必须显式解码（`atob` + `Uint8Array`），不能依赖类型强转。服务端渲染与客户端缓存并存时，追加内容前应清空容器，避免残留错误信息干扰用户。
