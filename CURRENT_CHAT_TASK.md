### [pending] Agentic 初始消息数组未做 token 预检 — 超长历史可能导致首次 API 调用失败

**ID**: chat-057
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 205-216 行构建初始消息数组时，将完整的 conversationHistory 和当前 userMessage 追加到 messages 中，但没有在进入循环（第 222 行 `for (let turn = 0; turn < MAX_TURNS; turn++)`）之前调用 `trimMessagesIfNeeded()`。裁剪只在每轮结束后执行（第 280 行附近）。如果用户有很长的对话历史（数百条消息），初始消息可能就超过 MAX_MESSAGES_TOKENS（150K tokens），导致第一次 Anthropic API 调用因超出上下文窗口而失败。
**改进方案**: 在进入循环前增加一次 `trimMessagesIfNeeded(messages)` 调用，确保初始消息数组在 token 预算内。
**验收标准**: (1) 超长对话历史不会导致首次 API 调用失败; (2) 裁剪后保留最新消息和首条用户消息; (3) 测试覆盖超长历史场景
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
