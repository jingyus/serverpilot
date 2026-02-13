### [pending] Skill 健康检查 API 端点

**ID**: skill-097
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**当前状态**: 依赖 skill-096 健康检查核心逻辑完成后，需暴露 REST API 端点。
**实现方案**: 
1. `api/routes/skills.ts` 添加 `GET /skills/health` 端点
2. 权限: `skill:manage` (admin/owner only)
3. 调用 `getSkillEngine().healthCheck()` 返回结果
4. 包含每个 skill 的: name, status, lastCheck, issues[]
**验收标准**: 
- GET /skills/health 返回所有已安装 skill 的健康状态
- 仅 admin/owner 可访问
- 测试覆盖: ≥4 个 API 测试
**影响范围**: packages/server/src/api/routes/skills.ts (增加 <30 行)
**创建时间**: 2026-02-13
**完成时间**: -

---
