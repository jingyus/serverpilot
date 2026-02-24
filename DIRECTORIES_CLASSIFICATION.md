# 📂 目录分类 - 开源 vs 内部

## ✅ 开源的目录（保留）

### 核心代码目录
- ✅ **packages/** - 所有核心包（server, agent, dashboard, shared）
- ✅ **.github/** - GitHub 配置（workflows, issue templates, PR template）

### 功能相关目录
- ✅ **web/** - 官方网站（Astro 项目，公开网站）
- ✅ **skills/** - Skills 功能（community + official）
- ✅ **knowledge-base/** - 知识库（nginx, mysql, docker, nodejs, python, redis等）
- ✅ **nginx/** - Nginx 配置示例（用户部署需要）

### 开发相关目录
- ✅ **.husky/** - Git hooks（pre-commit，开发者需要）
- ✅ **tests/** - 大部分测试文件（见下方排除列表）

---

## ❌ 不开源的目录（排除）

### 临时/生成目录
- ❌ **.history/** - VSCode 编辑历史
- ❌ **coverage/** - 测试覆盖率报告
- ❌ **data/** - 数据目录
- ❌ **playwright-report/** - Playwright E2E 测试报告
- ❌ **test-results/** - 测试结果输出
- ❌ **dist/** - 构建输出（各个包都有）
- ❌ **node_modules/** - 依赖包（已在 .gitignore）

### 云版本相关
- ❌ **packages/cloud/** - Cloud Edition 代码（已在前面处理）

---

## 🔍 tests/ 目录 - 部分排除

### ✅ 保留的测试（开源版功能测试）

**核心功能测试**：
- ✅ agent-*.test.ts - Agent 相关测试
- ✅ ai-agent.test.ts - AI 功能测试
- ✅ ai-prompts.test.ts - AI 提示测试
- ✅ ai-streaming.test.ts - AI 流式响应
- ✅ protocol-*.test.ts - 协议测试
- ✅ websocket-*.test.ts - WebSocket 测试
- ✅ execute-*.test.ts - 命令执行测试
- ✅ knowledge-*.test.ts - 知识库测试
- ✅ server-*.test.ts - 服务器测试
- ✅ shared-*.test.ts - 共享代码测试

**配置/部署测试**：
- ✅ docker-compose-ce.test.ts - CE 版本 Docker Compose 测试
- ✅ docker-compose-production.test.ts - 生产环境配置测试
- ✅ ci-config.test.ts - CI/CD 配置测试
- ✅ gitignore.test.ts - .gitignore 测试
- ✅ env-example.test.ts - .env.example 测试

**E2E 测试**：
- ✅ e2e-install-flow.test.ts - 安装流程
- ✅ e2e-chat-ops-flow.test.ts - Chat 操作流程
- ✅ e2e-websocket-comm.test.ts - WebSocket 通信
- ✅ e2e-network-errors.test.ts - 网络错误处理
- ✅ e2e-error-recovery.test.ts - 错误恢复
- ✅ e2e-skill-flow.test.ts - Skill 流程

**网站测试**（如果 web/ 开源）：
- ✅ website-*.test.ts - 网站测试

**其他测试**：
- ✅ one-click-install.test.ts - 一键安装
- ✅ functional-validation.test.ts - 功能验证
- ✅ performance-validation.test.ts - 性能验证
- ✅ stress-*.test.ts - 压力测试
- ✅ nginx-config.test.ts - Nginx 配置测试

### ❌ 不开源的测试（EE/Cloud/内部）

**EE/Cloud 版本测试**：
- ❌ docker-compose-ee.test.ts - EE 版本 Docker Compose
- ❌ e2e-ce-to-ee-upgrade.test.ts - CE→EE 升级测试
- ❌ e2e-ce-edition.test.ts - CE 版本特定测试
- ❌ quota-enforcement-acceptance.test.ts - 配额强制（Cloud 功能）

**内部开发测试**：
- ❌ debug-chat-error.test.ts - 调试文件
- ❌ licensing-compliance.test.ts - License 合规测试
- ❌ database-deployment.test.ts - 数据库部署（可能包含内部信息）
- ❌ deployment-verification.test.ts - 部署验证（可能包含内部配置）

**备份文件**：
- ❌ *.test.ts.bak - 所有备份文件

**Smoke 测试**（可能包含内部环境）：
- ❌ tests/smoke/ - Smoke 测试目录

---

## 📊 统计

### 目录统计

| 类型 | 开源 | 不开源 |
|------|------|--------|
| **核心目录** | packages/, .github/ | - |
| **功能目录** | web/, skills/, knowledge-base/, nginx/ | - |
| **开发目录** | .husky/, tests/ (大部分) | .history/ |
| **临时目录** | - | coverage/, data/, playwright-report/, test-results/ |
| **云版本** | - | packages/cloud/ |

### tests/ 统计

| 类型 | 数量 |
|------|------|
| **总测试文件** | ~85 个 |
| **保留（开源）** | ~75 个 |
| **排除（内部）** | ~10 个 |

---

## ⚙️ 实施方案

### 更新 .gitignore.opensource-example

```gitignore
# ============================================================================
# Temporary & Generated Directories - NOT INCLUDED IN OPEN SOURCE
# ============================================================================

# Editor history
.history/

# Coverage reports
coverage/

# Data directory
data/

# Test artifacts
playwright-report/
test-results/

# ============================================================================
# Tests - Exclude EE/Cloud/Internal Tests
# ============================================================================

# EE/Cloud version tests
tests/docker-compose-ee.test.ts
tests/e2e-ce-to-ee-upgrade.test.ts
tests/e2e-ce-edition.test.ts
tests/quota-enforcement-acceptance.test.ts

# Internal/Debug tests
tests/debug-chat-error.test.ts
tests/licensing-compliance.test.ts
tests/database-deployment.test.ts
tests/deployment-verification.test.ts
tests/smoke/

# Backup files
tests/*.bak
```

### 更新 prepare-opensource.sh

```bash
# 删除临时/生成目录
rm -rf .history/ coverage/ data/ playwright-report/ test-results/

# 删除 EE/Cloud 相关测试
rm -f tests/docker-compose-ee.test.ts
rm -f tests/e2e-ce-to-ee-upgrade.test.ts
rm -f tests/e2e-ce-edition.test.ts
rm -f tests/quota-enforcement-acceptance.test.ts
rm -f tests/debug-chat-error.test.ts
rm -f tests/licensing-compliance.test.ts
rm -f tests/database-deployment.test.ts
rm -f tests/deployment-verification.test.ts
rm -rf tests/smoke/
rm -f tests/*.bak
```

---

## ✅ 开源版本最终目录结构

```
ServerPilot/
├── packages/               # ✅ 核心代码
│   ├── server/
│   ├── agent/
│   ├── dashboard/
│   └── shared/
├── web/                    # ✅ 官方网站
├── skills/                 # ✅ Skills 功能
├── knowledge-base/         # ✅ 知识库
├── nginx/                  # ✅ Nginx 配置
├── tests/                  # ✅ 测试（排除 EE/Cloud 相关）
├── scripts/                # ✅ 2 个脚本（install.sh, dev-setup.sh）
├── docs/                   # ✅ 3 个文档
├── .github/                # ✅ GitHub 配置
├── .husky/                 # ✅ Git hooks
├── README.md               # ✅ 6 个根文档
└── ...
```

**不包含**：
- ❌ packages/cloud/
- ❌ .history/
- ❌ coverage/
- ❌ data/
- ❌ playwright-report/
- ❌ test-results/
- ❌ tests/smoke/
- ❌ 10 个 EE/Cloud 测试文件
- ❌ 61 个内部脚本
- ❌ 64 个内部文档

---

## 🎯 开源版本清洁度

| 项目 | 原始 | 开源 | 删除 |
|------|------|------|------|
| 文档 | 73 | 9 | 64 ⬇️ |
| 脚本 | 63 | 2 | 61 ⬇️ |
| 测试 | ~85 | ~75 | ~10 ⬇️ |
| 目录 | 15 | 10 | 5 ⬇️ |
| **总计** | **~236** | **~96** | **~140 ⬇️** |

**开源版本减少 59% 的非必需文件！**
