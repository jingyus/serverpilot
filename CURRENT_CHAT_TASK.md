### [pending] ChatAIAgent.chat() 重试逻辑和 chatWithFallback() 零测试覆盖

**ID**: chat-045
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-ai.ts
**发现的问题**: `ChatAIAgent.chat()` 的重试循环（第 219-276 行）包含错误分类、退避延迟、`notifyRetry` 回调、`ChatRetryExhaustedError`，但**无任何测试**。`chatWithFallback()`（第 282-323 行）包含 fallback provider 解析、provider 切换、fallback 失败处理，也**无任何测试**。`resolveFallbackProvider()`（第 440-454 行）和 `resolveFallbackConfig()`（第 457-481 行）同样无测试。这是 AI 调用链的核心可靠性机制。
**改进方案**: 新增 `chat-ai.test.ts` 测试文件，覆盖：1) chat() 正常响应 2) chat() 重试（transient error → success） 3) chat() 重试耗尽 → ChatRetryExhaustedError 4) chatWithFallback() 成功切换 5) chatWithFallback() 无可用 fallback 6) extractPlan() 正规化 7) resolveFallbackProvider() 遍历优先级。
**验收标准**: 1) 新增 15+ 测试用例 2) chat-ai.ts 核心路径覆盖率 > 80% 3) 所有 retry/fallback 场景有测试 4) Mock AI provider 不实际调用 API
**影响范围**: 新文件 `packages/server/src/api/routes/chat-ai.test.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
