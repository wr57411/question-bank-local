# 架构约束原则详解

类似文生图场景的负面提示词，从底层架构层面避免AI跨模块乱改代码的跑偏行为。

---

## 1. 禁止兜底

**含义：** 不写兼容旧逻辑的fallback。旧逻辑该删就删，不要在新代码中保留对旧逻辑的兜底处理。

**反面案例：**
```javascript
// 禁止：为新接口写旧逻辑兜底
function getUser(id) {
    if (newAPIAvailable) {
        return fetchUserFromAPI(id);
    } else {
        return fetchUserFromOldStorage(id); // 兜底旧逻辑
    }
}
```

**正确做法：**
```javascript
// 直接使用新逻辑，旧逻辑删除
function getUser(id) {
    return fetchUserFromAPI(id);
}
```

**核心原因：** 兜底代码会让架构越来越复杂，维护成本指数增长。旧逻辑如果确实需要保留，应该通过版本管理而非运行时兜底。

---

## 2. 禁止兼容

**含义：** 不为旧接口保留兼容层。接口变更时直接修改所有调用方，不留兼容层。

**反面案例：**
```javascript
// 禁止：为新接口保留旧接口兼容层
function oldGetQuestions(params) {
    // 兼容层：转换参数后调用新接口
    const newParams = transformParams(params);
    return newGetQuestions(newParams);
}
```

**正确做法：**
```javascript
// 直接修改所有调用方使用新接口
// 删除旧接口，全局搜索替换调用方
```

**核心原因：** 兼容层是技术债的温床。每次接口变更都留兼容层，最终会有N层兼容逻辑叠加，无人能理清。

---

## 3. 高内聚低耦合

**含义：** 模块边界清晰，模块内功能内聚，模块间依赖最小。

**判定规则：**
- 一个模块只负责一个业务领域
- 模块间通过明确接口通信，不直接访问对方内部实现
- 修改一个模块不需要同时修改其他模块（除接口变更外）

**反面案例：**
```javascript
// 禁止：在题库模块中直接操作用户模块的存储
function saveQuestion(question) {
    questionDB.set(question);
    userDB.update(user.lastActivity); // 跨模块直接访问
}
```

**正确做法：**
```javascript
// 通过事件或接口通信
function saveQuestion(question) {
    questionDB.set(question);
    eventBus.emit('question:saved', question.id); // 通过事件通知
}
```

---

## 4. 不入侵业务

**含义：** 不跨模块改其他模块的代码。需要协作时通过接口或事件通信。

**判定规则：**
- 修改A模块时，不应直接改动B模块的代码
- 如需B模块配合，应先与B模块负责人沟通（或通过文档记录）
- 跨模块的公共逻辑应抽取为独立模块

**反面案例：**
```
需求：给题库添加搜索功能
错误做法：直接在 user 模块的全局函数中添加搜索逻辑（因为"那里已有现成的工具函数"）
```

**正确做法：**
```
正确做法：在 question 模块内创建搜索逻辑，或抽取为独立的 search 模块
```

---

## 5. 单一职责

**含义：** 一个文件/函数只做一件事，禁止混入无关逻辑。

**判定规则：**
- 一个函数名能准确描述它做什么（如果需要"和"字连接，说明职责过多）
- 一个文件内的所有函数都服务于同一目标
- 删除一个功能时，只需改动一个文件

**反面案例：**
```javascript
// 禁止：在一个函数中混入多个职责
function handleQuestionAndExportPDF(question) {
    // 保存题目
    questionDB.set(question);
    // 又做了PDF导出
    const pdf = new jsPDF();
    pdf.text(question.content, 10, 10);
    pdf.save('export.pdf');
    // 还更新了用户统计
    userStats.increment('questionsCreated');
}
```

**正确做法：**
```javascript
// 拆分为三个独立函数
function saveQuestion(question) { questionDB.set(question); }
function exportQuestionPDF(question) { /* PDF逻辑 */ }
function updateUserStats(action) { /* 统计逻辑 */ }
```

---

## 负面提示词清单（可直接粘贴到AI对话中）

```
架构约束（必须遵守）：
- 禁止兜底：不要写兼容旧逻辑的fallback，旧逻辑该删就删
- 禁止兼容：不要为旧接口保留兼容层，接口变更直接改调用方
- 高内聚低耦合：模块边界清晰，模块内功能内聚，模块间依赖最小
- 不入侵业务：不跨模块改其他模块代码，需要协作时通过接口或事件通信
- 单一职责：一个文件/函数只做一件事，禁止混入无关逻辑
- 不要随意创建新文件，优先在已有文件中扩展
- 不要随意引入新依赖，优先用项目已有的库
- 修改前先理解上下文，不要在不了解整体架构的情况下改动
```

---

## 模块边界判定规则

当不确定某改动是否跨模块时，按以下规则判定：

1. **看目录结构** — 项目的目录划分通常反映模块边界
2. **看数据流** — 如果改动涉及多个数据实体，可能跨模块
3. **看依赖方向** — 如果需要import/require其他模块的内部实现，说明在跨边界
4. **看影响范围** — 如果改动后需要测试多个不相关功能，说明跨模块了

**原则：** 宁可多拆一个模块，也不要在一个模块中混入其他模块的逻辑。
