### [pending] trimMessagesIfNeeded 在仅剩 3 条消息时不保证 token 预算 — 可能超出 maxTokens

**ID**: chat-067
**优先级**: P0
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-message-utils.ts:63-66` 的 while 循环在 `messages.length > 3` 时才继续裁剪。当裁剪到仅剩 3 条消息后，即使 `estimateMessagesTokens(messages) > maxTokens`，循环也会退出。例如：如果第一条 user 消息包含 50K tokens 的文件内容，加上最近一轮 assistant+user 共 110K tokens，总计 160K > 150K maxTokens，函数返回时消息仍超预算。这会导致后续 Anthropic API 调用因 token 超限而失败。
**改进方案**:
1. 在 while 循环退出后增加二次检查：如果剩余 3 条消息仍超预算，对最早的消息内容进行截断（保留末尾部分）
2. 截断策略：估算需要移除的 token 数，按字符比例截断第一条消息的 content，保留 `[Content truncated: ~{N}K tokens removed]` 标记
3. 如果第一条消息是 array content（tool results），移除最早的 content blocks 直到预算内
**验收标准**:
- 无论消息数量多少，函数返回时 `estimateMessagesTokens(messages) <= maxTokens` 始终成立
- 截断后注入通知让 AI 知道上下文被截断
- 现有 trim 测试通过 + 新增边界场景测试（3 条超大消息）
**影响范围**:
- `packages/server/src/ai/agentic-message-utils.ts` — 添加二次截断逻辑
- `packages/server/tests/ai/agentic-message-utils.test.ts` — 新增边界测试
**创建时间**: 2026-02-13
**完成时间**: -

---
