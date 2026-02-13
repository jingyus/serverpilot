### [pending] Skill 升级 REST API + RBAC 权限

**ID**: skill-073
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: 无 `PUT /api/v1/skills/:id/upgrade` 端点，前端无法触发升级操作。
**实现方案**: 
1. 在 `skills.ts` 添加 `PUT /skills/:id/upgrade` 端点:
   - 中间件链: requireAuth → resolveRole → requirePermission('skill:manage')
   - 调用 `getSkillEngine().upgrade(id, userId)`
   - 返回更新后的 InstalledSkill
2. 添加对应路由测试: 权限检查、升级成功、升级失败(skill 不存在/非 git 来源)
**验收标准**: 
- `PUT /skills/:id/upgrade` 端点可用
- RBAC 权限检查通过 (skill:manage)
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/api/routes/skills.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
