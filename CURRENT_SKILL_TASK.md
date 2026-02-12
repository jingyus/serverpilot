### [pending] Webhook 事件集成 — skill.completed/skill.failed 分发到 WebhookDispatcher

**ID**: skill-060
**优先级**: P0
**模块路径**: packages/server/src/core/skill/engine.ts, packages/server/src/db/schema.ts
**当前状态**: 功能缺失 — SkillEngine 执行完成后仅通过 `emitTriggerEvent()` 通知 TriggerManager 做链式触发，未调用 `getWebhookDispatcher().dispatch()` 分发到外部 Webhook 订阅者。同时 `WebhookEventType` 联合类型不包含 `skill.completed` 和 `skill.failed`。
**实现方案**: 
1. 在 `packages/server/src/db/schema.ts` 的 `WebhookEventType` 联合类型中添加 `'skill.completed' | 'skill.failed'`
2. 在 `engine.ts` 的 `execute()` 方法中，成功/失败后调用 `getWebhookDispatcher().dispatch({ type, userId, data })` — 放在 `emitTriggerEvent()` 之后
3. 在 `executeConfirmed()` 方法中同样添加 webhook 分发
4. 对应更新 `engine.test.ts` — mock `getWebhookDispatcher()` 并验证 dispatch 被调用
5. 更新 `skills.test.ts` 路由测试中的 webhook 相关断言
**验收标准**: 
- Skill 执行成功时发出 `skill.completed` webhook 事件
- Skill 执行失败时发出 `skill.failed` webhook 事件  
- 用户可以在 Webhook 配置页面订阅这两个事件类型
- `engine.test.ts` 中有至少 2 个测试验证 webhook dispatch
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
