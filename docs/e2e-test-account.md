# E2E 隔离测试账号

日期：2026-08-28 ｜ 关联模块：测试基建, 服务端, 数据隔离

## 背景

历史上 E2E/AI 测试套件曾以真实账号（13320087034）在服务端执行创建操作，
导致「测试标签」「流程测试标签」「XSS 危险标签」等测试数据同步到用户手机（2026-08-28 已清理 12 个）。

## 方案

- E2E 专用测试账号：phone 见根目录 `.env` 的 `E2E_TEST_PHONE`（默认 19000000001），与主账号完全隔离。
- 数据快照：`server/scripts/e2e-account-reset.mjs` 把主账号的活跃标签/题目（含题目图片，data:URL 内嵌）
  复制到测试账号（生成全新 id），幂等可重复执行——每次运行都重置为主账号最新快照。
- 测试产生的任何数据都只会落在测试账号名下，主账号永不被触碰。
- 脚本内置防护：`E2E_TEST_PHONE` 与主账号手机号相同时直接退出；`.env` 凭据丢失时自动重置测试账号密码并回写。

## 用法

```bash
# 重置/刷新测试账号数据（主账号最新快照）
cd server && node scripts/e2e-account-reset.mjs

# 用测试账号登录（冒烟）
curl -s -X POST http://localhost:3001/api/login -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$E2E_TEST_PHONE\",\"password\":\"$E2E_TEST_PASSWORD\"}"
```

`.env` 相关键：`MAIN_ACCOUNT_PHONE`（主账号手机号，快照来源）、`E2E_TEST_PHONE` / `E2E_TEST_PASSWORD`（隔离测试账号凭据）。

## 规则

1. 任何测试（E2E/AI harness/手动验证）一律使用 `E2E_TEST_PHONE` 账号，禁止使用真实账号。
2. 测试账号数据可随时用脚本重置，无需清理。
3. `MAIN_ACCOUNT_PHONE` / `E2E_TEST_PHONE` / `E2E_TEST_PASSWORD` 只放根目录 `.env`（已 git 忽略）。
