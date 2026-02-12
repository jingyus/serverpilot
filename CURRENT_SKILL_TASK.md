### [pending] Webhook 事件集成 — 系统事件自动触发 Skill

**ID**: skill-020
**优先级**: P2
**模块路径**: packages/server/src/core/skill/trigger-manager.ts + packages/server/src/core/webhook/dispatcher.ts
**当前状态**: 功能缺失 — TriggerManager 的 event trigger 注册了事件类型 (如 `alert.triggered`, `server.offline`)，但 `handleEvent()` 方法仅被 SkillEngine 在 `skill.completed`/`skill.failed` 时调用。WebhookDispatcher 分发 5 种系统事件 (`task.completed`, `alert.triggered`, `server.offline`, `operation.failed`, `agent.disconnected`) 时不通知 TriggerManager。系统事件无法触发 Skill 执行
**实现方案**:

1. **集成方式** (低耦合):
   - 在 `index.ts` 的 `startServer()` 中注册事件桥接:
     - `getWebhookDispatcher().onDispatch((event) => getTriggerManager().handleEvent(event.type, event.data))`
   - 或在 TriggerManager.start() 中订阅 WebhookDispatcher 的 EventEmitter
   - 推荐方案: WebhookDispatcher 已有 `dispatch()` 方法 → 在 dispatch 成功后 emit 一个本地事件 → TriggerManager 订阅
2. **WebhookDispatcher** — 新增 EventEmitter 或回调:
   - 在 `dispatch()` 方法末尾发布事件: `this.emitter.emit('dispatched', { type, data })`
   - 或添加 `onDispatch(callback)` 注册方法
3. **TriggerManager** — 在 `start()` 中订阅 dispatcher 事件
4. **测试**:
   - WebhookDispatcher dispatch → TriggerManager handleEvent 被调用
   - `alert.triggered` 事件 → 匹配 event trigger 的 Skill 被执行
   - 不匹配的事件类型不触发

**验收标准**:
- `alert.triggered` 等系统事件能自动触发配置了对应 event trigger 的 Skill
- WebhookDispatcher 无需知道 SkillEngine/TriggerManager 的存在 (反转依赖)
- 测试 ≥ 6 个

**影响范围**:
- `packages/server/src/core/webhook/dispatcher.ts` (修改 — 新增事件发射)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 订阅 dispatcher)
- `packages/server/src/index.ts` (修改 — 注册桥接)
- 测试文件 (新增/修改)

**创建时间**: (自动填充)
**完成时间**: -

---
