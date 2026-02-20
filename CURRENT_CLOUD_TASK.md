### [pending] 用户注册流程改造 — Cloud 注册

**ID**: cloud-012
**优先级**: P1
**模块路径**: packages/cloud/src/auth/
**功能需求**: 根据开发指南「P1 → 用户注册流程改造」章节，实现 Cloud 模式下的用户注册流程。与 Self-Hosted 的区别：注册时自动创建独立 Tenant，用户成为 Tenant owner，分配 Free 计划。包括邮箱唯一性验证、Tenant slug 生成（用于子域名）、欢迎邮件发送。
**实现方案**:
- 创建 `packages/cloud/src/auth/cloud-register.ts`：
  - `cloudRegister(data: { email, password, name?, companyName? })` → 验证邮箱唯一 → 创建 tenant（name, slug, plan:free） → 创建 user（tenantId, role:owner） → 更新 tenant.ownerId → 发送欢迎邮件 → 返回 { user, tenant, tokens }
  - `generateSlug(name)` → 转小写、去特殊字符、唯一性检查
  - `createDefaultTeamSettings(tenantId)` → 初始化默认设置
- 创建 `packages/cloud/src/auth/cloud-register.test.ts`：≥14 个测试
  - 正常注册 → 创建 user + tenant
  - 重复邮箱 → 400 错误
  - slug 唯一性保证（重名追加数字）
  - 返回 JWT tokens（含 tenantId）
  - companyName 作为 tenant name
  - 无 companyName 用 email 前缀
**验收标准**:
- 注册后自动创建 Tenant（plan: free, maxServers: 1, maxUsers: 1）
- Tenant slug 唯一且 URL 安全（小写字母+数字+短横线）
- 返回的 JWT 包含 tenantId
- 重复邮箱返回明确错误
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/auth/cloud-register.ts, packages/cloud/src/auth/cloud-register.test.ts
**依赖**: 无（使用现有 user/tenant 表）
**创建时间**: 2026-02-15
**完成时间**: -

---
