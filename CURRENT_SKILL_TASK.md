### [pending] Skill 执行取消 REST API 端点

**ID**: skill-075
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: 无 `POST /api/v1/skills/executions/:eid/cancel` 端点。
**实现方案**: 
1. 在 `skills.ts` 添加 `POST /skills/executions/:eid/cancel` 端点:
   - 中间件链: requireAuth → resolveRole → requirePermission('skill:execute')
   - 调用 `getSkillEngine().cancel(eid)`
   - 返回 `{ success: true }`
2. 添加对应路由测试: 权限检查、取消成功、取消失败(不存在/已完成)
**验收标准**: 
- `POST /skills/executions/:eid/cancel` 端点可用
- 非运行中的执行返回 400/404
- 测试覆盖: ≥5 个测试用例
**影响范围**: packages/server/src/api/routes/skills.ts, packages/server/src/api/routes/skills.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
