### [pending] skills.ts API 路由拆分 — 从 523 行降至 ≤500 行

**ID**: skill-105
**优先级**: P2
**模块路径**: packages/server/src/api/routes/
**当前状态**: `skills.ts` 当前 523 行，略超 500 行软限制。包含 15+ 端点，其中执行相关端点 (execute/dry-run/cancel/confirm/reject/stream) 和 export/import 端点占据大量代码。
**实现方案**: 
1. 提取 SSE streaming + cancel + confirm/reject 端点到 `skills-execution.ts` (~120 行)
2. 提取 export/import 端点到 `skills-archive-routes.ts` (~60 行)
3. `skills.ts` 通过 `app.route()` 合并子路由
4. 所有子路由复用相同的中间件链 (requireAuth + resolveRole + requirePermission)
**验收标准**: 
- skills.ts ≤ 450 行
- 每个新文件 ≤ 200 行
- 所有 API 测试继续通过
- 路由路径不变
**影响范围**: packages/server/src/api/routes/skills.ts (拆分), 新建 skills-execution.ts, skills-archive-routes.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
