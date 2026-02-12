### [pending] TokenUsage 类型不一致 — token-tracker 和 token-counting 使用不同的字段定义

**ID**: chat-049
**优先级**: P2
**模块路径**: packages/server/src/ai/token-tracker.ts, packages/server/src/ai/token-counting.ts
**发现的问题**: `token-tracker.ts` 第 18-27 行定义的 `TokenUsage` 包含 `cacheCreationInputTokens` 和 `cacheReadInputTokens` 字段，而 `token-counting.ts` 的 extract 函数返回的 `TokenUsage` 只有 `inputTokens` 和 `outputTokens`。使用 `extractClaudeTokens()` 的结果去调用 `tokenTracker.record()` 时，cache 相关字段为 undefined，导致成本估算可能不准确（Claude API 的 cache tokens 按不同价格计费）。
**改进方案**: 1) 统一 TokenUsage 定义到一个文件（如 `token-tracker.ts` 或新的 `ai/types.ts`） 2) 所有 extract 函数返回完整 TokenUsage（含 cache 字段，默认 0） 3) `extractClaudeTokens` 读取 `usage.cache_creation_input_tokens` 和 `usage.cache_read_input_tokens`。
**验收标准**: 1) 全局唯一 TokenUsage 类型定义 2) Claude cache tokens 被正确提取 3) 成本估算包含 cache token 费用 4) 现有测试全部通过
**影响范围**: `packages/server/src/ai/token-tracker.ts`, `packages/server/src/ai/token-counting.ts`
**创建时间**: (自动填充)
**完成时间**: -
