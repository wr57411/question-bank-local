workspace "本地题库 App 架构" "基于 Capacitor 的本地优先题库应用：当前状态证据化模型（2026-08）" {

    model {
        teacher = person "教师" "录入/管理题目、组卷、备课、拍摄导入、AI 辅助教学"

        app = softwareSystem "本地题库 App" "客户端应用：本地优先、可离线使用、可选云同步（Capacitor + TypeScript 四层模块化）" {
            web = container "Web 客户端" "TypeScript 模块化前端（src/data|services|ui|types 四层），main.ts 将 600+ 函数挂载到 window 供 app.js 调用；Vite 构建，运行在原生 WebView 或浏览器" "TypeScript / Vite / localForage"
            shell = container "原生外壳" "Capacitor 6 提供相机、相册、文件系统、分享、文件选择等原生能力" "Capacitor 6 / iOS / Android"
            localdb = container "本地 IndexedDB" "题目、标签、试卷、版本、笔记、PDF 文档库、Wiki 知识库、同步变更日志，全部本地持久化" "IndexedDB (localForage)"
        }

        server = softwareSystem "题库服务器" "REST API 服务端：账号认证、push/pull 全量对比同步、PDF 云书库、Wiki 页面存储" {
            api = container "API 服务" "Express 5 REST API：JWT 认证、multer 文件上传、限流；路由按资源拆分" "Express 5 / JWT / multer / rate-limit"
            sqlite = container "SQLite 数据库" "账号、题目快照、PDF 书库与类目、Wiki 页面、同步游标，WAL 模式" "better-sqlite3 (WAL)"
        }

        ocr = softwareSystem "本地 OCR 服务" "本地运行的 PaddleOCR + UniMERNet 文字/公式识别服务，与视觉模型模式并存" {
            ocrApi = container "OCR API" "FastAPI 服务：POST /ocr 接收 base64 图片，GET /health 健康检查" "FastAPI / Python"
        }

        openrouter = softwareSystem "OpenRouter" "云端 LLM：流式文本生成与视觉模型（知识原子化、Wiki 编译、标签推荐、组卷等）" {
            llm = container "LLM API" "HTTPS 流式接口（文本与多模态）" "HTTPS / SSE"
        }

        supabase = softwareSystem "Supabase" "可选云同步后端（客户端与服务端均可配置）"
        baidu = softwareSystem "百度网盘" "自动备份目标（客户端 OAuth 授权后上传备份）"
        backupServer = softwareSystem "备用服务器" "Windows 备用服务器：与主服务器做服务器间周期同步（inferred：配置存在但拓扑细节未验证）"

        teacher -> web "使用（录入/管理/组卷/导出）"
        web -> shell "调用原生能力（拍照/相册/文件/分享）"
        web -> localdb "读写（localForage）"
        shell -> localdb "原生侧文件导入经 Web 桥接写入"
        web -> server "HTTPS REST API（登录/同步/PDF 书库/Wiki/版本检查）"
        api -> sqlite "读写（better-sqlite3）"
        web -> ocr "HTTP /ocr（base64 图片，本地公式/文字识别）"
        web -> openrouter "HTTPS 流式 LLM（callCloudAIStream / 视觉模型）"
        server -> supabase "可选初始化与同步（initSupabase，配置缺失时跳过）"
        web -> baidu "备份上传（OAuth 授权后）"
        server -> backupServer "服务器间周期同步（server-sync，配置启用）"
    }

    views {
        systemcontext app "系统上下文视图：教师、本地题库 App、服务器、OCR 服务与外部依赖" {
            include *
            autolayout
        }

        container app "容器视图：客户端与服务端内部可部署单元" {
            include *
            autolayout
        }

        theme default {
            background #ffffff
        }
    }
}
