### [pending] Dashboard — 前端类型 + Zustand Store + API 集成

**ID**: skill-008
**优先级**: P3
**模块路径**: packages/dashboard/src/
**当前状态**: 全部不存在 — `pages/Skills.tsx`, `stores/skills.ts`, `types/skill.ts` 均未创建；`App.tsx` 和侧边栏无 Skill 相关路由或导航项
**实现方案**:

1. **types/skill.ts** (~60 行):
   - `InstalledSkill`: id, userId, name, displayName, version, source, status, config, createdAt, updatedAt
   - `SkillExecution`: id, skillId, serverId, triggerType, status, startedAt, completedAt, result, stepsExecuted, duration
   - `AvailableSkill`: name, displayName, version, description, author, tags, source, installed
   - `SkillConfig`: Record<string, unknown>
   - `SkillStatus`: 'installed' | 'configured' | 'enabled' | 'paused' | 'error'
2. **stores/skills.ts** (~180 行):
   - Zustand store: `useSkillStore`
   - 状态: `skills: InstalledSkill[]`, `available: AvailableSkill[]`, `executions: SkillExecution[]`, `loading: boolean`, `error: string | null`
   - Actions:
     - `fetchSkills()` → `GET /api/v1/skills`
     - `fetchAvailable()` → `GET /api/v1/skills/available`
     - `installSkill(name, source)` → `POST /api/v1/skills/install`
     - `uninstallSkill(id)` → `DELETE /api/v1/skills/:id`
     - `configureSkill(id, config)` → `PUT /api/v1/skills/:id/config`
     - `updateStatus(id, status)` → `PUT /api/v1/skills/:id/status`
     - `executeSkill(id, serverId)` → `POST /api/v1/skills/:id/execute`
     - `fetchExecutions(id)` → `GET /api/v1/skills/:id/executions`
   - 使用 `apiRequest()` 统一 HTTP 调用 (自动 401 刷新)
3. **更新 App.tsx** — 添加 `/skills` 路由
4. **更新 Sidebar** — 添加 Skills 导航项 (Puzzle 图标，位于 Webhooks 和 Settings 之间)
5. **stores/skills.test.ts** (~120 行):
   - Mock `apiRequest`，测试所有 8 个 actions 的成功/失败路径
   - 测试 loading 状态变化
   - 测试 error 处理
   - 测试 ≥ 10 个

**验收标准**:
- TypeScript 类型完整覆盖 API 响应结构
- Store 所有 actions 调用正确的 API 端点
- 侧边栏出现 Skills 导航项，点击跳转 `/skills`
- `pnpm --filter @aiinstaller/dashboard build` 无类型错误
- 测试 ≥ 10 个

**影响范围**:
- `packages/dashboard/src/types/skill.ts` (新建)
- `packages/dashboard/src/stores/skills.ts` (新建)
- `packages/dashboard/src/stores/skills.test.ts` (新建)
- `packages/dashboard/src/App.tsx` (修改 — 添加路由)
- `packages/dashboard/src/components/Sidebar.tsx` 或类似 (修改 — 添加导航)

**创建时间**: (自动填充)
**完成时间**: -

---
