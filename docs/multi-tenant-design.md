# 多租户数据隔离架构设计

> **Task ID**: task-032
> **Phase**: Phase 4 — 云版核心基础
> **Priority**: P1
> **Status**: 设计完成
> **Created**: 2026-02-11

---

## 1. 背景与目标

ServerPilot 社区版采用单租户架构，每个用户通过 `userId` 外键隔离数据。云版需要支持 **团队/组织** 级别的多租户隔离，多个用户共享同一租户内的资源（服务器、任务、操作记录等）。

### 1.1 核心目标

- **数据隔离**: 租户间数据完全隔离，防止跨租户访问
- **向后兼容**: 社区版（单用户）无感升级，现有测试不受影响
- **渐进式迁移**: 支持从 `userId` 隔离平滑过渡到 `tenantId` 隔离
- **性能无损**: 利用索引和查询拦截，不影响现有查询性能

### 1.2 非目标（本阶段不包含）

- PostgreSQL Schema 级别隔离（Phase 4 后期）
- 租户管理 API（团队邀请/角色/权限）
- 资源配额限制（并发连接数、API 速率）
- 计费系统集成

---

## 2. 隔离方案选型

### 2.1 方案对比

| 方案 | 描述 | 优势 | 劣势 |
|------|------|------|------|
| **行级隔离 (Row-Level)** | 所有表添加 `tenant_id` 列，查询自动注入过滤 | 实现简单、兼容 SQLite、易于迁移 | 需要确保每条查询都带 tenant 过滤 |
| Schema 级隔离 | 每租户独立 PostgreSQL Schema | 完全物理隔离 | 需要 PostgreSQL、连接管理复杂 |
| 数据库级隔离 | 每租户独立数据库文件 | 最强隔离 | 运维复杂度高、跨租户查询困难 |

### 2.2 决策

**采用行级隔离 (Row-Level Isolation)**。

理由：
1. 当前数据库为 SQLite，行级隔离是唯一可行方案
2. Drizzle ORM 原生支持查询过滤注入
3. 与现有 `userId` 隔离模式一致，迁移成本最低
4. 未来迁移 PostgreSQL 后可叠加 RLS (Row-Level Security) 策略

---

## 3. 数据模型设计

### 3.1 新增 tenants 表

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,           -- URL 友好标识
  owner_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free',   -- free | pro | enterprise
  max_servers INTEGER NOT NULL DEFAULT 5,
  max_users INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX tenants_slug_idx ON tenants(slug);
CREATE INDEX tenants_owner_id_idx ON tenants(owner_id);
```

### 3.2 users 表扩展

```sql
ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX users_tenant_id_idx ON users(tenant_id);
```

### 3.3 核心表添加 tenant_id

以下表需要添加 `tenant_id` 字段：

| 表名 | 隔离依据 | 说明 |
|------|---------|------|
| `servers` | `tenant_id` (新增) | 服务器属于租户 |
| `sessions` | 通过 server 继承 | 会话关联到租户的服务器 |
| `operations` | `tenant_id` (新增) | 操作记录需独立过滤 |
| `tasks` | `tenant_id` (新增) | 定时任务属于租户 |
| `alert_rules` | 通过 server 继承 | 告警规则关联服务器 |
| `alerts` | 通过 server 继承 | 告警记录关联服务器 |
| `metrics` | 通过 server 继承 | 监控数据关联服务器 |
| `snapshots` | 通过 server 继承 | 快照关联服务器 |
| `audit_logs` | `tenant_id` (新增) | 审计日志需独立查询 |
| `user_settings` | 通过 user 继承 | 用户设置关联用户 |
| `doc_sources` | `tenant_id` (新增) | 知识库属于租户 |
| `knowledge_cache` | 无需 (全局共享) | 全局知识缓存 |

直接添加 `tenant_id` 的表（高频独立查询）：

```sql
ALTER TABLE servers ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX servers_tenant_id_idx ON servers(tenant_id);

ALTER TABLE operations ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX operations_tenant_id_idx ON operations(tenant_id);

ALTER TABLE tasks ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX tasks_tenant_id_idx ON tasks(tenant_id);

ALTER TABLE audit_logs ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX audit_logs_tenant_id_idx ON audit_logs(tenant_id);

ALTER TABLE doc_sources ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX doc_sources_tenant_id_idx ON doc_sources(tenant_id);
```

### 3.4 继承隔离的表

以下表通过 `serverId` 或 `userId` 外键间接继承租户隔离，无需添加 `tenant_id`：

- `agents` — 通过 `serverId → servers.tenant_id`
- `profiles` — 通过 `serverId → servers.tenant_id`
- `sessions` — 通过 `serverId → servers.tenant_id`
- `alert_rules` — 通过 `serverId → servers.tenant_id`
- `alerts` — 通过 `serverId → servers.tenant_id`
- `metrics`, `metrics_hourly`, `metrics_daily` — 通过 `serverId`
- `snapshots` — 通过 `serverId`
- `user_settings` — 通过 `userId → users.tenant_id`
- `doc_source_history` — 通过 `sourceId → doc_sources.tenant_id`

---

## 4. 中间件设计

### 4.1 租户解析中间件 (`tenant.ts`)

```
请求 → requireAuth → requireTenant → 路由处理
```

中间件职责：
1. 从已认证的 `userId` 查询用户所属 `tenantId`
2. 将 `tenantId` 注入 Hono Context (`c.set('tenantId', ...)`)
3. 如果用户无租户关联，返回 403

### 4.2 Context 扩展

```typescript
// types.ts
export interface ApiEnv {
  Variables: {
    validatedBody: unknown;
    validatedQuery: unknown;
    userId: string;
    tenantId: string;  // 新增
  };
}
```

### 4.3 Repository 层过滤

所有 Repository 方法签名从：
```typescript
findAllByUserId(userId: string): Promise<Server[]>
```
扩展为：
```typescript
findAllByUserId(userId: string, tenantId?: string): Promise<Server[]>
```

`tenantId` 为可选参数，保证向后兼容：
- **云版**: 中间件注入 `tenantId`，所有查询带双重过滤
- **社区版**: 不注入 `tenantId`，保持现有 `userId` 隔离

---

## 5. 迁移策略

### 5.1 单租户到多租户迁移

对于现有单租户数据，迁移脚本：

1. 为每个现有用户创建一个 **默认租户** (1:1)
2. 将用户的 `tenant_id` 指向其默认租户
3. 将该用户拥有的所有 servers/tasks/operations 的 `tenant_id` 设为同一租户
4. `tenant_id` 列初始允许 NULL（兼容未迁移数据），后续版本设为 NOT NULL

### 5.2 迁移脚本伪代码

```sql
-- Step 1: 创建 tenants 表
CREATE TABLE tenants (...);

-- Step 2: 添加 tenant_id 列 (nullable)
ALTER TABLE users ADD COLUMN tenant_id TEXT;
ALTER TABLE servers ADD COLUMN tenant_id TEXT;
ALTER TABLE operations ADD COLUMN tenant_id TEXT;
ALTER TABLE tasks ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_logs ADD COLUMN tenant_id TEXT;
ALTER TABLE doc_sources ADD COLUMN tenant_id TEXT;

-- Step 3: 为每个用户创建默认租户并关联
-- (在应用层 TypeScript 执行)

-- Step 4: 创建索引
CREATE INDEX ...;
```

---

## 6. 安全保障

### 6.1 防止跨租户访问

- **查询层**: Repository 所有读写方法添加 `tenantId` 过滤条件
- **中间件层**: `requireTenant` 确保每个请求都携带 `tenantId`
- **测试覆盖**: 专门测试跨租户访问场景（必须返回空/403）

### 6.2 审计增强

- `audit_logs` 新增 `tenant_id` 字段，支持按租户筛选审计日志
- 跨租户访问尝试记录为安全事件

---

## 7. 实现清单

- [x] 架构设计文档
- [ ] `tenants` 表 Schema 定义 (schema.ts)
- [ ] `users` 表添加 `tenant_id` 字段
- [ ] 核心表添加 `tenant_id` 字段 (servers, operations, tasks, audit_logs, doc_sources)
- [ ] 迁移脚本 `0004_multi_tenant.sql`
- [ ] `connection.ts` 的 `createTables()` 同步更新
- [ ] `requireTenant` 中间件
- [ ] `ApiEnv.Variables` 添加 `tenantId`
- [ ] Repository 方法扩展 `tenantId` 参数
- [ ] `TenantRepository` (tenants 表 CRUD)
- [ ] 多租户隔离测试
- [ ] 现有测试兼容性验证
