### [pending] skills.test.ts (routes) 拆分 — 1031 行超出 800 行硬限制

**ID**: skill-072
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**当前状态**: `skills.test.ts` 1031 行，超出硬限制 29%。包含 14 个 describe 块覆盖所有 REST 端点: GET /skills、GET /skills/available、POST /skills/install、DELETE /:id、PUT /:id/config、PUT /:id/status、POST /:id/execute、GET /:id/executions、GET /:id/executions/:eid、RBAC integration、GET /pending-confirmations、POST /confirm、POST /reject、GET /stream。
**实现方案**: 
1. 创建 `skills-confirmation.test.ts` — 提取 `GET /pending-confirmations` (L806) + `POST /confirm` (L843) + `POST /reject` (L915) + `GET /stream` (L966) ≈ 250 行
2. 创建 `skills-rbac.test.ts` — 提取 `RBAC integration` (L704-805) ≈ 120 行，加入更多角色细分测试
3. 原 `skills.test.ts` 保留 CRUD + execute + executions 查询 ≈ 700 行
**验收标准**: 
- `skills.test.ts` ≤ 750 行
- 2 个新测试文件各 ≤ 400 行
- 所有 61 个路由测试仍通过
**影响范围**: packages/server/src/api/routes/skills.test.ts, packages/server/src/api/routes/skills-confirmation.test.ts (新), packages/server/src/api/routes/skills-rbac.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
