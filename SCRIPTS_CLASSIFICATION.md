# 🔧 Scripts 脚本分类 - 开源 vs 内部

## ✅ 开源需要的脚本（仅 2 个）

- ✅ **install.sh** - Agent 安装脚本（用户需要）
- ✅ **dev-setup.sh** - 开发环境设置（贡献者需要）

**开源版本只保留 2 个用户/贡献者需要的脚本！**

---

## ❌ 内部开发脚本（不开源，共 61 个）

### 自动化开发脚本（8 个）
- ❌ autorun.sh - 主自动化脚本
- ❌ autorun_chat.sh - Chat 自动化
- ❌ autorun_cloud.sh - Cloud 自动化
- ❌ autorun_edition.sh - Edition 自动化
- ❌ autorun_skill.sh - Skill 自动化
- ❌ autorun_web.sh - Web 自动化
- ❌ autorun-common.sh - 自动化公共库
- ❌ autorun-new-prompts.sh - 自动化提示

### 任务队列工具（1 个）
- ❌ task-queue-helper.sh - 任务队列助手

### 云版本相关（1 个）
- ❌ start-cloud-dev.sh - 云版本开发启动

### 内部运维工具（10 个）
- ❌ run.sh - 内部运行脚本
- ❌ dev.sh - 内部开发模式
- ❌ logs.sh - 日志查看
- ❌ stop.sh - 停止服务
- ❌ watch.sh - 监控模式
- ❌ init-db.ts - 数据库初始化
- ❌ list-users.ts - 列出用户
- ❌ reset-admin-password.ts - 重置管理员密码
- ❌ git-push-initial.sh - Git 初始推送
- ❌ send-notification.py - 发送通知

### Fly.io 部署相关（16 个 = 8 脚本 + 8 测试）
- ❌ fly-app-init.ts + fly-app-init.test.ts
- ❌ fly-autoscale.ts + fly-autoscale.test.ts
- ❌ fly-cli-install.ts + fly-cli-install.test.ts
- ❌ fly-deploy.ts + fly-deploy.test.ts
- ❌ fly-secrets.ts + fly-secrets.test.ts
- ❌ fly-setup.ts + fly-setup.test.ts
- ❌ check-dns.sh - DNS 检查
- ❌ cdn-config.ts + cdn-config.test.ts

### 发布/构建工具（8 个 = 4 脚本 + 4 测试）
- ❌ release.ts + release.test.ts - 发布脚本
- ❌ github-releases.ts + github-releases.test.ts - GitHub 发布
- ❌ docs-publish.ts + docs-publish.test.ts - 文档发布
- ❌ build-binary.ts + build-binary.test.ts - 二进制构建

### 部署验证脚本（6 个）
- ❌ health-check.sh - 健康检查
- ❌ monitoring-config.ts + monitoring-config.test.ts - 监控配置
- ❌ pre-deploy-check.sh - 部署前检查
- ❌ smoke-test.sh - 冒烟测试
- ❌ verify-deployment.sh - 部署验证

### 服务器配置脚本（3 个）
- ❌ provision-server.sh - 服务器配置
- ❌ setup-nginx.sh - Nginx 设置
- ❌ setup-ssl.sh - SSL 设置

### 安装脚本测试（1 个）
- ❌ install-sh.test.ts - install.sh 的测试（测试可以不开源）

### 内部文档（4 个）
- ❌ README.md - scripts 内部说明
- ❌ SKILL_DEV_CONTEXT.md - Skill 开发上下文
- ❌ TIMEOUT-RETRY.md - 超时重试文档
- ❌ autorun用法.md - autorun 使用说明

### SQL 数据库文件（1 个）
- ❌ init-db.sql - 数据库初始化 SQL（如果包含测试数据）

### 临时文件（1 个）
- ❌ prepare-opensource.sh - 开源准备脚本（发布后删除）

---

## 📊 统计

| 类型 | 数量 |
|------|------|
| ✅ 开源脚本 | **2 个** |
| ❌ 内部脚本 | **61 个** |
| **总计** | **63 个** |

**开源版本只保留 3% 的脚本（2/63），其余 97% 不开源！**

---

## 🎯 建议的 scripts/ 目录结构

### 开源版本（极简）
```
scripts/
├── install.sh          # Agent 安装脚本
└── dev-setup.sh        # 开发环境设置
```

### 内部版本（完整）
```
scripts/
├── install.sh          # ← 唯一开源的用户脚本
├── dev-setup.sh        # ← 唯一开源的开发脚本
├── autorun*.sh         # 自动化开发（7 个）
├── fly-*.ts            # Fly.io 部署（12 个）
├── release*.ts         # 发布工具（4 个）
├── *-check.sh          # 检查脚本（3 个）
├── setup-*.sh          # 配置脚本（3 个）
├── *.test.ts           # 测试文件（8 个）
└── ... (其他 25 个内部脚本)
```

---

## ⚙️ 实施方案

### 方案 1: .gitignore 排除（推荐）

在 `.gitignore.opensource-example` 中添加：

```gitignore
# ============================================================================
# Internal Scripts - NOT INCLUDED IN OPEN SOURCE
# ============================================================================

# Keep only install.sh and dev-setup.sh, exclude all others

# Automation scripts
scripts/autorun*.sh
scripts/task-queue-helper.sh

# Cloud development
scripts/start-cloud-dev.sh

# Internal tools
scripts/run.sh
scripts/dev.sh
scripts/logs.sh
scripts/stop.sh
scripts/watch.sh
scripts/init-db.ts
scripts/init-db.sql
scripts/list-users.ts
scripts/reset-admin-password.ts
scripts/git-push-initial.sh
scripts/send-notification.py

# Fly.io deployment
scripts/fly-*.ts
scripts/check-dns.sh
scripts/cdn-config.ts

# Release & build
scripts/release.ts
scripts/release.test.ts
scripts/github-releases.ts
scripts/github-releases.test.ts
scripts/docs-publish.ts
scripts/docs-publish.test.ts
scripts/build-binary.ts
scripts/build-binary.test.ts

# Deployment & verification
scripts/health-check.sh
scripts/monitoring-config.ts
scripts/monitoring-config.test.ts
scripts/pre-deploy-check.sh
scripts/smoke-test.sh
scripts/verify-deployment.sh
scripts/provision-server.sh
scripts/setup-nginx.sh
scripts/setup-ssl.sh

# Test files
scripts/install-sh.test.ts

# Internal documentation
scripts/README.md
scripts/SKILL_DEV_CONTEXT.md
scripts/TIMEOUT-RETRY.md
scripts/autorun用法.md

# Temporary
scripts/prepare-opensource.sh
```

### 方案 2: 白名单模式（更安全）

只保留需要的文件，排除整个目录：

```gitignore
# Exclude all scripts except whitelist
scripts/*

# Whitelist: scripts needed in open source
!scripts/install.sh
!scripts/dev-setup.sh
```

**推荐使用方案 2（白名单），更安全，不会漏掉新增的内部脚本！**

---

## 🚀 自动化清理

已在 `prepare-opensource.sh` 中添加清理逻辑：

```bash
# 删除 scripts/ 内部脚本（保留 install.sh 和 dev-setup.sh）
info "清理 scripts/ 内部脚本..."
find scripts/ -type f ! -name 'install.sh' ! -name 'dev-setup.sh' -delete
success "删除 scripts/ 内部脚本（保留 install.sh, dev-setup.sh）"
```

---

## ✅ 执行步骤

1. **更新 .gitignore**
   ```bash
   # 在 .gitignore.opensource-example 中使用白名单模式
   ```

2. **运行准备脚本**
   ```bash
   ./scripts/prepare-opensource.sh
   # 会自动删除 61 个内部脚本，只保留 2 个
   ```

3. **验证结果**
   ```bash
   ls scripts/
   # 应该只剩下: install.sh, dev-setup.sh
   ```

---

**开源版本的 scripts/ 将非常干净，只有 2 个必需脚本！** 🎉
