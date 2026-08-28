# 本地 OCR 服务（ocr-server）

识别物理题图片：中文题干文字（PaddleOCR PP-OCRv5）+ 公式（UniMERNet → LaTeX），按阅读顺序输出混合文本，供客户端「本地OCR+纯文本LLM」模式使用。

## 环境要求

- Python 3.12（必须，paddlepaddle 不支持 3.13+；本机已有 `/opt/homebrew/bin/python3.12`）
- 磁盘：首次安装 + 模型下载约 3GB

## 启动

```bash
cd ocr-server
./start.sh
```

首次运行自动创建 `.venv` 并安装依赖（含模型下载，可能需要数分钟）。启动后服务监听 `http://localhost:8766`。

> 注意：默认端口为 8766（8765 已被本机其它服务占用）。

## UniMERNet 模型获取（公式识别必需）

首次启动前需下载公式模型（unimernet_base，约 1.3GB）到 `ocr-server/models/unimer/`：

```bash
cd ocr-server
mkdir -p models && cd models
# 方式一：git-lfs（需先安装 git-lfs）
git clone https://www.modelscope.cn/wanderkid/unimernet_base.git unimer
# 方式二：直接下载权重（无 git-lfs）
git clone https://www.modelscope.cn/wanderkid/unimernet_base.git unimer
curl -L -o unimer/unimernet_base.pth https://www.modelscope.cn/models/wanderkid/unimernet_base/resolve/master/unimernet_base.pth
```

模型目录需包含：`unimernet_base.pth`（权重）+ `tokenizer.json`/`tokenizer_config.json`/`config.json` 等配置。未下载时服务自动降级为纯文字 OCR（`engines.unimer=false`）。

卸载模型缓存可删除 `~/.paddleocr/` 与 `ocr-server/models/`。

## UniMERNet 模型获取（公式识别必需）

首次启动前需下载公式模型（unimernet_base，约 1.3GB）到 `ocr-server/models/unimer/`：

```bash
cd ocr-server
mkdir -p models
cd models
git clone https://www.modelscope.cn/wanderkid/unimernet_base.git unimer
cd unimer
curl -L -o unimernet_base.pth https://www.modelscope.cn/models/wanderkid/unimernet_base/resolve/master/unimernet_base.pth
```

模型目录需包含：`unimernet_base.pth`（权重）+ `tokenizer.json`/`tokenizer_config.json`/`config.json` 等配置。未下载时服务自动降级为纯文字 OCR（`engines.unimer=false`）。

## API

| 端点 | 说明 |
|------|------|
| `GET /health` | 引擎状态秒回：`{status: not_loaded\|loading\|ready\|error, engines: {paddle, unimer}}` |
| `POST /ocr` | `{"image_base64": "data:image/jpeg;base64,... 或裸 base64"}` → `{text, formulas: [LaTeX], markdown}` |

首次调用 `/ocr` 会触发模型懒加载（10~30 秒），后续调用正常。UniMERNet 未安装/加载失败时服务自动降级为纯文字 OCR（`formulas` 为空数组，`engines.unimer=false`），不影响文字识别。

## 局域网 / 真机访问

- 桌面浏览器（vite dev / Capacitor 桌面）直接用默认地址 `http://localhost:8766`
- Android 模拟器：`http://10.0.2.2:8766`
- Android/iOS 真机：填电脑局域网 IP，如 `http://192.168.x.x:8766`；iOS 系统 ATS 默认拦截明文 HTTP，本地 OCR 的 iOS 支持留待后续（桌面端优先）
- 客户端「📖 Wiki」面板 → 本地OCR模式 → 修改「OCR 服务地址」→ 测试连接

## 故障排查

- `health` 返回 `error`：查看 `errors` 字段中的具体原因（依赖缺失 / 模型文件缺失）
- 公式识别不准：确认 `engines.unimer` 为 true；公式区域检测目前采用文本框启发式，复杂版面可能漏检
- 首次加载慢属正常；模型常驻内存，服务重启后需重新加载
