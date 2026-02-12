### [pending] Server 标签系统 — 支持 server_scope: 'tagged' 真正按标签筛选

**ID**: skill-077
**优先级**: P2
**模块路径**: packages/server/src/db/schema.ts, packages/server/src/core/skill/batch-executor.ts
**当前状态**: 功能缺失 — `batch-executor.ts` 在 `server_scope: 'tagged'` 时优雅降级到单服务器执行（产生 warning），但实际的标签筛选功能从未实现。`servers` 表无 `tags` 列，Dashboard 无标签管理 UI。
**实现方案**: 
1. 在 `db/schema.ts` 的 `servers` 表添加 `tags: text('tags')` 列（JSON string array）
2. 创建 migration `0012_server_tags.sql`
3. 在 `ServerRepository` 添加 `findByTags(userId, tags[])` 方法
4. 在 `batch-executor.ts` 中，scope='tagged' 时调用 `findByTags()` 替代降级逻辑
5. Skill manifest 的 `constraints.server_scope` 为 `'tagged'` 时，需要配合 `constraints.server_tags: string[]` 字段
6. 更新 `shared/src/skill-schema.ts` 添加 `server_tags` 约束字段
7. Dashboard: Server 详情页添加标签编辑 UI
8. 测试: findByTags 查询、batch-executor tagged 筛选、schema 验证
**验收标准**: 
- servers 表支持 tags 字段
- `server_scope: 'tagged'` 按标签真正筛选服务器
- Dashboard 可以给服务器添加/删除标签
- 至少 10 个新测试
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/db/migrations/0012_server_tags.sql (新), packages/server/src/db/repositories/server-repository.ts, packages/server/src/core/skill/batch-executor.ts, packages/shared/src/skill-schema.ts, packages/dashboard/src/pages/ServerDetail.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
