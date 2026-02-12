### [pending] requires_confirmation 执行确认流 — SSE 暂停/确认/恢复机制

**ID**: skill-026
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 147-150) 定义了 `requires_confirmation: boolean` 约束，建议 `risk_level_max >= red` 时设为 true。当前 engine.ts execute() 完全忽略此字段，直接进入 AI 循环执行。schema 已在 `@aiinstaller/shared` 中定义并验证，但后端和前端均无确认流实现
**实现方案**:
1. **engine.ts** — execute() 方法检测 `manifest.constraints.requires_confirmation`:
   - 如果为 true 且 triggerType !== 'manual'（cron/event/threshold 自动触发）: 创建 execution 记录但状态设为 `pending_confirmation`，通过 SkillEventBus 发送 `confirmation_required` 事件，等待确认
   - 如果为 true 且 triggerType === 'manual': 立即执行（手动触发已经是用户主动行为）
2. **新增 execution 状态**: `pending_confirmation` 加入 SkillExecutionStatus 枚举 (schema.ts + types)
3. **新增 API**: `POST /api/v1/skills/executions/:eid/confirm` — 确认执行，将 pending_confirmation → running
4. **新增 API**: `POST /api/v1/skills/executions/:eid/reject` — 拒绝执行，将 pending_confirmation → cancelled
5. **SkillEventBus** — 新增 `SkillConfirmationEvent` 类型
6. **Dashboard** — 待确认执行列表 + 确认/拒绝按钮 + SSE 实时通知
7. **测试**: engine 确认流 + API 端点 + Dashboard 交互
**验收标准**:
- `requires_confirmation: true` 的 Skill 自动触发时暂停等待确认
- Dashboard 显示待确认执行，用户可确认或拒绝
- 手动触发不受影响（直接执行）
- 过期未确认的执行自动取消 (可选: 30min TTL)
- 测试 ≥ 12 个
**影响范围**:
- `packages/server/src/db/schema.ts` (修改 — 新增 pending_confirmation 状态)
- `packages/server/src/core/skill/engine.ts` (修改 — 确认流逻辑)
- `packages/server/src/core/skill/skill-event-bus.ts` (修改 — 新增事件类型)
- `packages/server/src/api/routes/skills.ts` (修改 — 新增 confirm/reject 端点)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 确认 UI)
- `packages/dashboard/src/stores/skills.ts` (修改 — confirm/reject actions)
**创建时间**: (自动填充)
**完成时间**: -

---
