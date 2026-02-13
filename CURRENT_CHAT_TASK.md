### [pending] Legacy 模式 conversationContext 不扣除 knowledge/profile token — 总 prompt 可能超出上下文窗口

**ID**: chat-091
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**发现的问题**: Legacy 模式（chat.ts:319-377）中，`buildContextWithLimit(session.id, 8000)` (行 322) 固定使用 8000 token 预算，与 `profileCtx` 和 `knowledgeContext` 的大小完全独立。最终 `userPrompt` 包含 `serverLabel + conversationContext + message`，`systemPrompt` 包含 `BASE_SYSTEM_PROMPT + profileContext + caveats + knowledgeContext`。如果 profile 占 5000 token、knowledge 占 3000 token、base prompt 占 2000 token，加上 conversation 8000 token，总计 ~18000 token。虽然大多数模型有 128K+ 上下文窗口所以不会溢出，但 ollama 本地模型可能只有 4K-8K 上下文，此时必定溢出。且 8000 token 的固定预算对短对话浪费、对长对话不够。
**改进方案**: `buildContextWithLimit` 的 `maxTokens` 参数应根据模型的上下文窗口和已分配的 system prompt + knowledge token 动态计算：`availableTokens = modelContextWindow - systemPromptTokens - knowledgeTokens - reservedOutputTokens`。可从 provider 接口获取 `contextWindowSize`。
**验收标准**: (1) conversation history 预算动态计算 (2) 不超过模型上下文窗口 (3) 对 ollama 等小上下文模型安全 (4) 默认行为向后兼容
**影响范围**: `packages/server/src/api/routes/chat.ts`, `packages/server/src/core/session/manager.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
