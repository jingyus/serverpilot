### [pending] 双 pendingConfirmations Map 导致 agentic 确认可能路由到错误系统

**ID**: chat-023
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts
**发现的问题**: 存在两个独立的 `pendingConfirmations` Map：`chat.ts:50-53` 和 `agentic-chat.ts:165-168`。`chat.ts` 中的 Map 由 `chat.ts:137-147` 的 `onConfirmRequired` 回调写入，由 `chat.ts:332-350` 的 `/confirm` 端点消费。而 `agentic-chat.ts:165-168` 的 Map 通过 `resolveConfirmation()` 导出但仅在测试中使用。前端统一调用 `/confirm` 端点（`chat-execution.ts:190-197`），该端点只查 `chat.ts` 的 Map。如果有代码直接调用 `agentic-chat.ts` 的 `resolveConfirmation()`，会因 confirmId 不在该 Map 中而返回 false。两套系统增加维护负担和 bug 风险。
**改进方案**: 
1. 删除 `agentic-chat.ts:165-168` 中的 `pendingConfirmations` Map 和 `resolveConfirmation()` 函数
2. Agentic engine 的确认完全通过 `opts.onConfirmRequired` 回调（定义在 `chat.ts:137-147`）与 `chat.ts` 的 Map 交互
3. 确保只有一个 `pendingConfirmations` 管理点（`chat.ts`），避免状态分裂
4. 更新相关测试，移除对 `resolveConfirmation` 的直接调用
**验收标准**: 
- 项目中只有一个 `pendingConfirmations` Map（在 chat.ts 中）
- 所有确认流程通过 `/confirm` 端点正确路由
- agentic-chat.ts 不再导出 `resolveConfirmation`
- 现有确认流程测试通过
**影响范围**: packages/server/src/ai/agentic-chat.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
