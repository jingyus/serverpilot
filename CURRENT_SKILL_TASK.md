### [pending] Skill Dry-Run API 端点 + Dashboard 支持

**ID**: skill-094
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**当前状态**: 后端 dry-run 功能实现后 (依赖 skill-093)，需要在 API 和 Dashboard 暴露此功能。
**实现方案**: 
1. `api/routes/skills.ts` 的 `POST /:id/execute` 端点解析 body 中 `dryRun: boolean` 字段
2. 将 dryRun 参数传递给 `engine.execute()`
3. 响应中标记 `{ dryRun: true }` 以便前端区分
**验收标准**: 
- API 支持 `POST /skills/:id/execute { dryRun: true }`
- 返回 dry-run 结果而非真实执行结果
- RBAC 权限与普通执行相同 (`skill:execute`)
- 测试覆盖: ≥5 个 API 测试
**影响范围**: packages/server/src/api/routes/skills.ts (改 <30 行)
**创建时间**: 2026-02-13
**完成时间**: -

---
