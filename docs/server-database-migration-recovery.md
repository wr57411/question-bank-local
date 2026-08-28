# 服务端数据库迁移恢复

## 基本信息

- **操作类型：** Bug修复
- **创建日期：** 2026-07-26
- **关联模块：** 服务端 SQLite、认证、PDF 书库
- **影响文件：** server/data.db、server/start.sh、.gitignore

## 问题现象

服务端迁移到统一仓库后，既有账号登录提示“用户不存在”，手机本地已有 PDF 在服务端返回“PDF 不存在”。

## 根因分析

统一仓库服务端使用 `server/data.db`，旧服务端数据仍保存在 `/Users/john/question-bank-server/data.db`。两库的用户 ID 完全不重叠，当前库只包含部分 PDF 元数据，导致原账号及其关联数据无法被查询。

## 修复方案

对两份数据库执行 SQLite 在线备份与完整性检查后，将旧库数据按原 user_id 追加合并进当前库。对新增字段做兼容映射：旧 users.settings 转入 user_settings，旧 pdf_topics 的 parent_id 与 sort_order 使用默认值。保留当前库已有数据，不做覆盖。

### 变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|-----|
| server/data.db | 数据修复 | 追加恢复旧服务端账号、题库、教学及 PDF 元数据 |
| server/.migration-backups/20260726-pdf-account-recovery | 新增备份 | 合并前冻结备份，已加入忽略规则 |
| server/start.sh | 修改 | 显式固定默认 SQLite 数据库路径 |
| .gitignore | 修改 | 忽略迁移备份目录 |

## 验证结果

- [x] 两份合并前备份均通过 `PRAGMA integrity_check`
- [x] 合并后数据库通过完整性和外键检查
- [x] 旧库的 4 个账号、66 道题、50 个标签、49 条笔记、40 个教学节点及 4 条 PDF 元数据均已导入
- [x] 当前库原有 4 个账号、2 条 PDF、分类及专题数据仍保留
- [x] 全部 6 条有效 PDF 元数据均有对应服务器文件
- [x] 3001 健康接口返回正常 JSON

## 经验总结

服务端代码迁移必须同时明确数据库与上传目录的迁移策略。启动脚本应固定默认数据库路径，数据目录应独立于源码与构建产物管理。
