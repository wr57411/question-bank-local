# Plan: AI 生成标签时显示相似已有标签

## Summary

在 AI 生成标签后，用算法（Levenshtein 距离）将每个生成的标签与已有标签做相似度匹配，在标签按钮旁显示最相似的已有标签。精确匹配显示"存"字标记，用户可选择点击已有标签或新标签。

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Tag lookup | `index.html:5403` | `allTags.find(t => t.name === tagName)` 精确匹配 |
| Tag creation | `db.js:321-335` | `dbCreateTag(name, color)` 返回 TagRecord |
| Button 渲染 | `index.html:5380-5392` | 动态创建 `<button>` 并设置样式和 onclick |
| 表单/模态框对称 | `index.html:5357` vs `5225` | 两个函数结构几乎一致，新功能需同步应用 |

## Files to Change

| File | Action | Why |
|---|---|---|
| `www/index.html` | UPDATE | 添加相似度算法 + 修改两个标签生成函数的渲染逻辑 |

## Tasks

### Task 1: 添加 `findSimilarTag()` 相似度匹配函数

在 `generateFormTagsFromComment` 附近（约 line 5355）添加工具函数：

```js
// 计算两个字符串的 Levenshtein 距离
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = Math.min(
                dp[i-1][j] + 1,
                dp[i][j-1] + 1,
                dp[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0)
            );
    return dp[m][n];
}

// 找到最相似的已有标签，返回 { tag, distance, similarity } 或 null
function findSimilarTag(name) {
    const lower = name.toLowerCase();
    let best = null;
    for (const t of allTags) {
        const d = levenshtein(lower, t.name.toLowerCase());
        const maxLen = Math.max(lower.length, t.name.length);
        const similarity = maxLen === 0 ? 1 : 1 - d / maxLen;
        if (!best || d < best.distance) {
            best = { tag: t, distance: d, similarity };
        }
    }
    // 只返回相似度 >= 0.5 的结果
    return best && best.similarity >= 0.5 ? best : null;
}
```

### Task 2: 修改 `generateFormTagsFromComment()` 渲染逻辑

修改 tags.forEach 内的按钮创建逻辑（约 line 5380-5392），每个生成的标签按钮改为：

- 精确匹配已有标签 → 按钮文字加 `（存）` 标记，样式偏绿
- 相似匹配（相似度 ≥ 0.5）→ 按钮内显示 `标签名 (≈已有: 相似标签名)`
- 无匹配 → 保持原样

点击行为：
- 精确匹配 → 直接使用已有标签（调用 `addFormTagByName`，它内部已有精确查找逻辑）
- 相似匹配 → 点击按钮仍然创建新标签（用户自行判断）
- 用户也可以直接点击括号里的已有标签名来使用已有标签

### Task 3: 修改 `generateTagsFromComment()` 渲染逻辑

与 Task 2 对称修改模态框版本（约 line 5269-5277）。

### Task 4: 提取共用的按钮创建函数

由于两个函数的标签渲染逻辑高度重复，提取为：

```js
function createGeneratedTagButton(tagName, { onClickNew, onClickExisting, container })
```

两个生成函数都调用此共用函数，避免代码重复。

## UI 设计

每个生成的标签按钮区域：

```
[数学公式 (≈已有: 数学)]   ← 相似匹配，点击括号内文字使用已有标签
[几何证明（存）]           ← 精确匹配，"存" 表示已存在
[函数图像]                 ← 无匹配，正常创建新标签
```

按钮结构（HTML）：
```html
<button class="gen-tag-btn">
  <span class="gen-tag-name">数学公式</span>
  <span class="gen-tag-hint">(≈已有: 数学)</span>  <!-- 可选 -->
</button>
```

点击已有标签名时调用对应 add 函数（`addFormTagByName` 或 `addGeneratedTag`），直接使用已有标签而不创建新的。

## Validation

1. 在表单中输入评价 → 点击"AI 生成" → 验证：
   - 精确匹配的标签显示"存"
   - 相似标签显示括号提示
   - 点击已有标签名 → 使用已有标签
   - 点击新标签 → 创建新标签
2. 在题目详情模态框中同样测试
3. 验证无匹配时按钮行为与修改前一致

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Levenshtein 对中文效果一般 | 中 | 已用 `.toLowerCase()` 归一化；阈值 0.5 足够宽松 |
| allTags 很大时性能问题 | 低 | 标签数量通常 < 200，Levenshtein 是 O(mn)，可忽略 |
| 括号内文字过长影响布局 | 低 | 使用 `font-size:10px` + `opacity:0.7` 弱化显示 |

## Acceptance

- [ ] Levenshtein 相似度算法正确运行
- [ ] 精确匹配显示"存"标记
- [ ] 相似匹配显示已有标签名提示
- [ ] 点击已有标签名直接使用已有标签（不创建新的）
- [ ] 无匹配时行为与修改前一致
- [ ] 表单版和模态框版都正常工作
