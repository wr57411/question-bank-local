# WeMM-Embedding-2B 模型指纹与跨运行时对齐清单

> 实测时间：2026-09-22
> 证据来源：本机 HF 缓存 snapshot `bbd6cd4bf52cfc6716f752a2df80b2706720bd95` + 运行中的编码服务 `127.0.0.1:3002`
> 用途：在另一台机器（如 Linux / LM Studio）复刻同一向量空间时，避免装错、配错
> 关联方案：`docs/plans/2026-09-22-semantic-module-abstraction.md`

---

## 1. 一句话结论

**"同一个模型" ≠ "同样的向量"。** 实测：同一份权重、同一个文本，仅因输入格式不同（套不套 chat template），余弦就从 **0.9976 掉到 0.8870**。这个偏移不会报错，只会让检索质量静默退化。

所以跨运行时复刻的关键不是"把模型装上"，而是**逐项对齐下面这份清单，并用黄金向量验证**。

---

## 2. 模型指纹（实测值）

| 项 | 值 | 证据 |
|---|---|---|
| HF repo | `tencent/WeMM-Embedding-2B` | README |
| 基座模型 | `Qwen/Qwen3.5-2B` | README `base_model` |
| 架构 | `Qwen3_5ForConditionalGeneration`；`model_type: qwen3_5`；GGUF 架构标记 **`qwen35`** | `config.json` |
| 参数量 | 2B | README |
| 权重精度 | `bfloat16` | `config.json: dtype` |
| **输出维度** | **2048**，**L2 归一化**（实测 L2 范数 = 1.000000） | 实测 |
| **池化方式** | **last-token**：取 `attention_mask` 最后一个有效位（即 `<embedding>` token 位）的 hidden state，再 `F.normalize` | `modeling_wemm_embedding.py:20-31` |
| 相似度口径 | `cosine` | `config_sentence_transformers.json: similarity_fn_name` |
| **文本输入格式** | **必须套 chat template** → `<\|im_start\|>user\n{text}<\|im_end\|><embedding>` | 实测，见 §3 |
| 是否需 instruction 前缀 | **不需要**（`prompts: {}`、`default_prompt_name: null`，`encode_query` 与 `encode_document` 等价） | `config_sentence_transformers.json` |
| 特殊 token | `<embedding>`=248077、`<\|im_start\|>`=248045、`<\|im_end\|>`=248046、`<\|image_pad\|>`=248056、`<\|video_pad\|>`=248057 | `config.json` + tokenizer |
| 支持模态 | text / image / video / image+text / text+video；**不支持音频** | `sentence_bert_config.json: modality_config`、README |
| 图像预处理 | `Qwen2VLImageProcessor`：patch_size=16、merge_size=2、mean/std=0.5、rescale=1/255、resample=3(bicubic)、do_convert_rgb | `processor_config.json` |
| Matryoshka 维度 | `[64, 128, 256, 512, 1024, 2048]`（截断后需重新归一化） | `config.json: matryoshka_dimensions` |
| 上下文长度 | `max_position_embeddings: 262144` | `config.json` |
| 自定义代码 | **`trust_remote_code=True` 必需**（`WeMMEmbedding` / `WeMMTransformer`） | `config.json: auto_map`、`modules.json` |
| 依赖版本 | `torch`、**`transformers==5.2.0`**、`sentence-transformers>=5.7.0`、`qwen-vl-utils==0.0.14`、`accelerate>=1.1.0` | README + `server/embed/requirements.txt` |
| 本机实际装到 | torch 2.14.0、sentence-transformers 6.0.1、transformers 5.2.0、qwen-vl-utils 0.0.14 | `pip list` |
| 体积 | BF16 ≈ 4.79GB；Q8_0 ≈ 2.55GB；Q6_K ≈ 1.97GB | GGUF 量化页 |

---

## 3. 决定性实测：输入模板不能省

同一条文本 `计算三角形的面积`，三种路径：

| 路径 | token 序列 | 与"服务黄金向量"的余弦 |
|---|---|---|
| **套 chat template**（服务实际路径） | `[248045, 846, 198, 97792, 137867, 98013, 248046, 248077]` | **0.9976** ✅ |
| **裸文本** | `[97792, 137867, 98013, 248077]` | **0.8870** ❌ |

解读要点（这里最容易误判）：

- 两条路径的**末位 token 都是 `<embedding>`(248077)**，所以"池化取最后一个 token"这个动作两边都成立——**光看池化方式看不出问题**。
- 差别在于**上下文**：套模板版本多了 `<|im_start|>user\n` 前缀和 `<|im_end|>`。模型是在这个格式上训练的，裸文本属于分布外输入。
- **0.8870 看起来很"高"，但它是系统性方向偏移**：对比参照——本机同义改述（"计算三角形的面积" ↔ "三角形的面积怎么求"）的余弦是 **0.8206**。也就是说，裸文本路径产生的向量，其偏移量已经**超过了两个同义句之间的差距**。库向量是按模板路径建的，query 走裸路径 → 排序退化。

> **判定阈值**：对齐验证时，正确的复刻应当 **≥ 0.99**。落到 0.85–0.90 区间就是**模板没套**，不要当成"量化误差"放过。

---

## 4. 除模型特征外，还必须逐项匹配的 7 件事

按优先级排列。前 3 项不对，结果直接不可用；后 4 项不对，结果会静默劣化。

| # | 项 | 本机基准值 | 不对会怎样 | 怎么核对 |
|---|---|---|---|---|
| **1** | **输入模板** | `<\|im_start\|>user\n{text}<\|im_end\|><embedding>` | 余弦掉到 ~0.887，排序退化 | 黄金向量对齐（§5） |
| **2** | **池化位置** | `last`（最后一个有效 token） | 若服务端做 mean pooling → 空间完全不同 | 查服务端 pooling 配置；llama.cpp 用 `--pooling last` |
| **3** | **归一化** | L2（模长 = 1.0） | 未归一化时余弦排序仍对，但**阈值 τ 全错**（全滤或全放） | 取一个向量算模长 |
| **4** | **维度** | 2048 | 用 Matryoshka 截到 256 但另一端用 2048 → 维度不匹配 | 取向量算长度；截断必须两端一致 + **重新校准阈值** |
| **5** | **图像预处理** | patch 16 / merge 2 / mean·std 0.5 / rescale 1/255 / bicubic | 图片向量偏移（文本不受影响） | 图片探针对齐 |
| **6** | **注意力实现** | 本机实测：**"fast path is not available … Falling back to torch implementation"**（未装 `flash-linear-attention` / `causal-conv1d`） | 该模型是 Qwen3.5 混合线性注意力（24 层里 18 层是 `linear_attention`）。**Linux 上若装了这些库走 fast path，数值会与 macOS 不同** | 看服务端启动日志是否有 fast path 提示 |
| **7** | **量化** | 本机为 bfloat16 全精度 | 量化误差随位宽下降 | 见下方量化表 |

### 量化保真度参考（来自 GGUF 发布页实测）

| 量化 | 位/权重 | 体积 | STS-B Spearman ρ | Δρ vs BF16 | **Emb Cosine vs BF16** |
|---|---|---|---|---|---|
| BF16 | 16.00 | 4790.8 MB | 0.8360 | — | — |
| **Q8_0** | 8.00 | 2551.3 MB | 0.8357 | +0.03% | **0.9997** |
| Q6_K | 5.80 | 1972.8 MB | 0.8358 | +0.03% | 0.9987 |
| Q5_K_M | 5.17 | 1760.0 MB | 0.8361 | −0.01% | 0.9956 |
| Q4_K_M | 4.85 | 1559.8 MB | 0.8310 | +0.60% | 0.9854 |
| IQ4_XS | 4.33 | 1471.4 MB | 0.8360 | +0.00% | 0.9855 |
| IQ3_M | 3.76 | 1277.3 MB | 0.8286 | +0.89% | 0.9263 |

**建议选 Q8_0**（Emb Cosine 0.9997，2.55GB）；追体积用 Q6_K。**避开 Q4_K_M**（同尺寸下比 IQ4_XS 差）和 IQ3_M。

> ⚠️ **这张表有个陷阱，必须看明白**：它的基准是"**llama.cpp 里的 BF16**"，衡量的是**量化误差**，而不是"llama.cpp vs PyTorch"的差异。
> 你真正要验证的问题——**llama.cpp 的 BF16 是否等于 PyTorch 的 bfloat16**——这张表**没有回答**。必须自己跑 §5 的对齐验证。
> 第 6 项（注意力实现）正是这个差异最可能的来源。

---

## 5. 黄金向量与对齐验证

### 已产出的基准文件

| 文件 | 内容 |
|---|---|
| `tmp/golden_vectors.json` | macOS 服务的 3 条文本探针 + 1 张图片探针的 2048 维向量 |
| `tmp/probe-image.png` | 图片探针原图（512×512 三角形示意图），sha256 `7c887af93ff115e402d35409f0219cd02be333c6cadd024098f192621e485618` |
| `tmp/verify_space_alignment.py` | 对齐验证脚本（在目标机器上跑） |

基准环境：macOS / MPS / bfloat16 / sentence-transformers 6.0.1 + transformers 5.2.0 / torch 2.14.0

### 参考余弦（这把尺子决定了你怎么判读验证结果）

| 对比 | 余弦 | 含义 |
|---|---|---|
| 同义改述：「计算三角形的面积」↔「三角形的面积怎么求」 | **0.8206** | 两个**同义句**之间的差距 |
| 中英跨语言：「计算三角形的面积」↔「what is the area of a triangle」 | 0.7516 | 跨语言同义 |
| 探针图 ↔「计算三角形的面积」文本 | **0.5952** | 跨模态对齐强度 |

**判读标准**：
- 目标机 vs 黄金向量 **≥ 0.99** → 对齐成功，可放心接入
- **0.85 – 0.95** → **系统性偏移**，最可能是模板没套（第 1 项）
- **< 0.85** → 空间不对，池化或维度问题（第 2/4 项）
- 文本对得上但图片对不上 → 图像预处理或 mmproj 问题（第 5 项）

### 验证步骤（在 Linux 机器上执行）

```bash
# 1. 把探针文件拷过去（连同 golden_vectors.json）
scp tmp/golden_vectors.json tmp/probe-image.png tmp/verify_space_alignment.py <linux>:/tmp/

# 2. 看服务暴露了哪些模型 id
curl -s http://localhost:1234/v1/models | python3 -m json.tool

# 3. 跑对齐验证（脚本会自动对比，并在裸文本失败时重试套模板形式）
python3 /tmp/verify_space_alignment.py \
  --base-url http://localhost:1234/v1 \
  --model <上一步看到的 model id> \
  --golden /tmp/golden_vectors.json
```

---

## 6. LM Studio 的关键限制（必须提前知道）

### 6.1 好消息：GGUF 确实存在

| 仓库 | 说明 |
|---|---|
| `Weidows/WeMM-Embedding-2B-GGUF` | 量化最全（BF16/Q8_0/Q6_K/Q5_K_M/Q4_K_M/IQ4_XS/IQ3_M），附 STS-B 保真度实测 |
| `seamon67/WeMM-Embedding-2B-GGUF` | 另一份转换 |
| `DreamBlooms/WeMM-Embedding-2B-GGUF` | Q8_0/Q4_K_M/BF16 的源头 |

架构标记 `qwen35`，可在 llama.cpp 上跑（`llama-embedding --pooling last`）。

### 6.2 坏消息：LM Studio 的 embeddings 端点只吃文本

LM Studio 官方文档对 `/v1/embeddings` 的原话是 **"Generate embedding vectors from input text"**，请求体沿用 OpenAI schema（`input` 为字符串或字符串数组）。

**直接后果**：
- ✅ **文字语义搜** → 可以走 LM Studio
- ❌ **以图搜题** → **走不通 LM Studio 的 embeddings 端点**
- ✅ **找相似题** → 不需要服务（向量已在本地语料里）

图片这条路有两个替代：
1. llama.cpp 的 `llama-server --mmproj mmproj-WeMM-Embedding-2B-BF16.gguf --embedding`（需要额外下载视觉投影器）
2. 保留 macOS 上的 Python 服务专管图片编码

> 这正是设计里"**同一空间、不同能力**"的由来：text 可以路由到 LM Studio，image 不行。路由必须**按模态做能力过滤**，不能按来源整体选。

### 6.3 其他两个要盯的点

- **LM Studio 是 llama.cpp + GGUF**（Linux 上无 MLX 后端）。它自动从 GGUF 元数据推断 pooling——**若推断成 mean 而非 last，结果会错**。用 §5 的脚本验证。
- **`trust_remote_code` 在 llama.cpp 上不存在**。原版依赖 Python 自定义代码（`WeMMEmbedding.embedding()` 做 last-token 池化）。GGUF 转换时必须已把该逻辑烘焙进 `pooling_type` 元数据——**这正是要对齐验证的首要原因**。

---

## 7. 待验证清单（交给 Linux 机器回答）

- [ ] llama.cpp BF16 的向量是否等于 PyTorch bfloat16 的向量（**最关键，无现成答案**）
- [ ] LM Studio 推断出的 pooling 是否为 `last`
- [ ] LM Studio 能否加载 `qwen35` 架构的 embedding 模型（若不能，需直接用 `llama-server`）
- [ ] 若走 llama.cpp 图片路径，`mmproj` 是否与语言模型同一转换批次（跨批次混用可能不匹配）
- [ ] Linux 上是否装了 `flash-linear-attention` / `causal-conv1d`（影响第 6 项）
