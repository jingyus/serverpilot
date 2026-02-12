# AI 开发约束 — 必读文档

> **本文档是 autorun.sh 自循环开发的强制约束**，AI 在每次任务生成和执行前必须阅读并遵守。
> 违反以下约束的代码变更将被视为无效。

---

## 1. 版本分离原则

### 1.1 开源版 vs 云版

ServerPilot 采用 **开源核心 + 云版增值** 的商业模式：

| 维度 | 开源社区版 (v0.x / v1.0-oss) | 云版 (v1.0-cloud) |
|------|------|------|
| **数据库** | SQLite (better-sqlite3) | PostgreSQL |
| **部署** | docker-compose.yml 自部署 | Fly.io / 托管集群 |
| **计费** | 无 | Stripe 订阅 |
| **多租户** | 单租户（owner 即管理员） | 多租户隔离 |
| **认证** | 本地账号 + GitHub OAuth | SSO / SAML |
| **高可用** | 单实例 | 多副本 + 负载均衡 |

### 1.2 代码隔离规则

**必须遵守**：

1. **云版专属功能全部在 `packages/cloud/` 包中**，不得混入开源核心代码：
   - PostgreSQL 适配器 → `packages/cloud/src/db/`
   - Stripe 计费 → `packages/cloud/src/billing/`
   - 多副本/集群 → `packages/cloud/src/cluster/`
   - SSO/SAML → `packages/cloud/src/sso/`
   - 高级分析 → `packages/cloud/src/analytics/`
   - 云版许可证: BUSL-1.1（非开源），`private: true`（不发布到 npm）

2. **开源核心代码不得静态依赖云版模块**：
   - `packages/server/src/` 的核心文件不能静态 `import` 云版专属模块
   - 仅允许在 `DB_TYPE=postgres` 时通过 `await import('@aiinstaller/cloud')` 动态加载
   - 默认行为（无环境变量时）必须是开源版行为（SQLite）

3. **数据库 schema 分离**：
   - `packages/server/src/db/schema.ts` → 开源版 SQLite schema（只能新增开源功能的表）
   - `packages/cloud/src/db/pg-schema.ts` → 云版 PostgreSQL schema
   - 不得在 SQLite schema 文件中添加云版专属表（如 subscriptions, billing 等）
   - cloud 包通过 `@aiinstaller/server/schema` 子路径导出引用 SQLite 类型

4. **Docker 配置分离**：
   - `docker-compose.yml` → 开源版（只含 server + agent，SQLite）
   - `docker-compose.cloud.yml` → 云版（含 PostgreSQL, `CLOUD_MODE=true`）

### 1.3 允许共用的部分

以下模块云版和开源版可以共用：

- `packages/shared/` — 协议定义、Zod schema、安全规则
- `packages/agent/` — Agent 不区分版本
- `packages/dashboard/` — 前端可共用（通过 feature flag 控制 UI 差异）
- Repository 接口层 — 统一 interface，不同 implementation

---

## 2. 当前开发阶段与优先级

### 2.1 当前阶段：开源版 MVP 完善

**重点**：完善开源社区版的核心功能和稳定性，为开源发布做准备。

**优先级排序**：

| 优先级 | 方向 | 说明 |
|--------|------|------|
| **P0** | 核心功能补全 | AI 对话、服务器管理、任务执行的核心闭环 |
| **P0** | Bug 修复 | 现有功能的稳定性、测试覆盖 |
| **P1** | 开源发布准备 | LICENSE、README、贡献指南、文档完善 |
| **P1** | 用户体验 | Dashboard 交互优化、错误提示改善 |
| **P2** | 开源增值功能 | 知识库增强、服务器档案深化、批量操作 |
| **P3** | 云版功能 | PostgreSQL、Stripe、多租户增强（当前不开发） |

### 2.2 暂缓开发的功能

以下功能**暂不开发**，除非明确指示：

- PostgreSQL 适配器（task-043 暂缓）
- Stripe 计费系统
- 多副本部署 / 集群模式
- SSO / SAML 认证
- Kubernetes 部署配置

---

## 3. 代码质量约束

### 3.1 Commit 规范

- Commit message 必须**准确描述实际变更内容**
- 禁止虚假 commit message（如标题写 "Stripe 集成" 但实际只改了测试文件）
- 格式：`feat|fix|refactor|test|docs|chore: 简短描述`

### 3.2 不得破坏已有功能

- 新功能开发不得删除或修改已通过测试的现有代码（除非是 bug 修复）
- 修改公共接口（shared/）时必须确保所有依赖方兼容
- 修改 schema 时必须提供 migration 脚本

### 3.3 测试要求

- 新增功能必须附带测试
- 修改现有功能后必须确保原有测试通过
- 不得通过删除或跳过测试来解决测试失败

---

## 4. 架构边界

### 4.1 包职责

| 包 | 职责 | 禁止 |
|----|------|------|
| `packages/server` | 后端 API + AI 引擎 + WebSocket (SQLite) | 不得包含前端代码，不得静态依赖 cloud |
| `packages/cloud` | 云版增值：PostgreSQL、计费、SSO、集群 | 不得修改 server 核心逻辑 |
| `packages/agent` | 远程执行 Agent | 不得直接访问数据库 |
| `packages/dashboard` | Web 前端 | 不得包含后端逻辑 |
| `packages/shared` | 共享类型和校验 | 不得有运行时副作用 |

### 4.2 依赖方向

```
dashboard → shared ← server ← cloud (动态加载)
                     ↑
                   agent
```

- `shared` 不得依赖其他任何包
- `agent` 不得依赖 `server` 或 `dashboard`
- `dashboard` 不得依赖 `server` 或 `agent`
- `cloud` 可以依赖 `server`（通过子路径导出引用 schema 类型）和 `shared`
- `server` 仅通过动态 `import()` 加载 `cloud`，不得静态依赖

---

## 5. 文件组织

- 新增文件必须放在对应模块目录下，不得随意创建根级目录
- 云版专属代码必须有明确的目录隔离（见 1.2）
- 配置文件放在项目根目录或对应包的根目录
- 测试文件与源码同目录（`*.test.ts`）或在 `tests/` 目录下

---

*最后更新: 2026-02-12*
