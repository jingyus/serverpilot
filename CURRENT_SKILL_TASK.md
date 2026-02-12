### [pending] RBAC 权限修正 — skill:execute 应包含 member 角色

**ID**: skill-064
**优先级**: P1
**模块路径**: packages/shared/src/rbac.ts
**当前状态**: 开发规范定义 `skill:execute` 应授予 member+admin+owner，但实际代码中 `skill:execute` 仅在 `ADMIN_PERMISSIONS` 数组中（第 150 行），member 角色只有 `skill:view`。这意味着普通成员无法手动执行 Skill。
**实现方案**: 
1. 在 `packages/shared/src/rbac.ts` 的 `MEMBER_PERMISSIONS` 数组中添加 `'skill:execute'`（在 `'skill:view'` 之后）
2. 从 `ADMIN_PERMISSIONS` 中移除 `'skill:execute'`（因为 admin 已继承 member 权限）
3. 更新 `packages/shared/src/rbac.test.ts` — 添加显式测试验证 member 拥有 skill:execute
4. 重新构建 shared 包 (`pnpm --filter @aiinstaller/shared build`)
5. 验证 routes 测试中 member 用户可以执行 skill
**验收标准**: 
- member 角色拥有 `skill:view` + `skill:execute` 权限
- admin 角色拥有 `skill:view` + `skill:execute` + `skill:manage` 权限
- owner 继承所有权限
- rbac 测试验证三个角色的 skill 权限分配
**影响范围**: packages/shared/src/rbac.ts, packages/shared/src/rbac.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
