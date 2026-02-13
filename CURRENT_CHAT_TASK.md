### [pending] Agentic 循环错误信息不区分类型 — 用户看到泛化的"执行过程中发生错误"

**ID**: chat-098
**优先级**: P2
**模块路径**: packages/server/src/ai/
**发现的问题**: `AgenticChatEngine.run()` 的 catch 块（agentic-chat.ts:226-239）将所有错误统一包装为 `执行过程中发生错误: ${errorMsg}` 返回给用户。无论是 API 认证失败 (401)、token 超限 (context_length_exceeded)、速率限制 (429)、网络超时还是工具执行内部错误，用户都看到相同的泛化消息。这导致用户无法自助排查：(1) API key 过期需要在设置中更新 (2) 429 需要等待后重试 (3) 上下文超限可能需要新建会话。
**改进方案**: 在 catch 块中解析错误类型（复用 `request-retry.ts` 的 `classifyError`），根据 `classification.category` 返回具体建议：认证错误 → "请检查 AI Provider API Key 设置"；速率限制 → "请稍后重试"；上下文超限 → "对话过长，建议新建会话"；网络错误 → "网络连接异常，请检查网络"。
**验收标准**: (1) 不同类型错误显示不同提示 (2) 提示包含可操作建议 (3) 仍然记录详细错误到日志
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
