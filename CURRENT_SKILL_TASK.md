### [pending] RBAC 权限 + REST API 路由 + 服务注册

**ID**: skill-004
**优先级**: P0
**模块路径**: packages/shared/src/rbac.ts + packages/server/src/api/routes/
**当前状态**: `rbac.ts` 中无任何 skill 权限 (当前 32 权限，0 个 skill:*)；`api/routes/skills.ts` 不存在；`index.ts` 和 `routes/index.ts` 中无 skill 引用
**实现方案**:

1. **shared/src/rbac.ts** — 新增 3 个权限:
   - `'skill:view'` → MEMBER_PERMISSIONS (查看列表和历史)
   - `'skill:execute'` → ADMIN_PERMISSIONS (手动执行, admin+owner)
   - `'skill:manage'` → ADMIN_PERMISSIONS (安装/卸载/配置, admin+owner)
   - 更新 PERMISSIONS 数组 (保持按模块分组)
2. **rebuild shared**: `pnpm --filter @aiinstaller/shared build`
3. **api/routes/skills.ts** (~300 行):
   - `GET /` — 列出已安装 Skills (requirePermission('skill:view'))
   - `POST /install` — 安装 Skill (requirePermission('skill:manage'))
   - `DELETE /:id` — 卸载 (requirePermission('skill:manage'))
   - `PUT /:id/config` — 配置 inputs (requirePermission('skill:manage'))
   - `PUT /:id/status` — 启用/暂停 (requirePermission('skill:manage'))
   - `POST /:id/execute` — 手动执行 (requirePermission('skill:execute'))，接收 `{ serverId }` body
   - `GET /:id/executions` — 执行历史 (requirePermission('skill:view'))
   - `GET /:id/executions/:eid` — 执行详情 (requirePermission('skill:view'))
   - `GET /available` — 可安装列表 (requirePermission('skill:view'))
   - 所有写入端点使用 Zod 验证请求体
   - 全链路中间件: requireAuth → resolveRole → requirePermission
4. **api/routes/index.ts** — 挂载 `v1.route('/skills', skills)`
5. **index.ts** — 在 `createServer()` 中初始化 `getSkillEngine(server)`；在 `startServer()` 中调用 `getSkillEngine().start()`
6. **api/routes/skills.test.ts** (~300 行):
   - 使用 InMemory repositories + mock auth
   - 测试所有 9 个端点: 正常响应 + 输入验证
   - 测试 RBAC: member 只能 view，不能 manage/execute
   - 测试错误: 404 skillId, 400 缺参数

**验收标准**:
- 所有 9 个 API 端点返回正确状态码和格式
- RBAC 权限正确隔离 (member/admin/owner)
- `pnpm --filter @aiinstaller/shared build` + `pnpm typecheck` 全部通过
- 测试 ≥ 25 个 (路由 + RBAC)

**影响范围**:
- `packages/shared/src/rbac.ts` (修改 — 新增 3 权限)
- `packages/server/src/api/routes/skills.ts` (新建)
- `packages/server/src/api/routes/skills.test.ts` (新建)
- `packages/server/src/api/routes/index.ts` (修改 — 挂载路由)
- `packages/server/src/api/routes/schemas.ts` (修改 — 新增请求体 Zod schemas)
- `packages/server/src/index.ts` (修改 — SkillEngine 初始化 + 启动)

**创建时间**: 2026-02-12
**完成时间**: -

---
