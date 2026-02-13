### [pending] 知识库 token 估算使用简单 4 chars/token — 中文知识库内容 token 严重低估

**ID**: chat-086
**优先级**: P1
**模块路径**: packages/server/src/knowledge/
**发现的问题**: `context-enhancer.ts:267-270` 和 `context-window-manager.ts` 中的 `estimateTokenCount()` 使用固定 `Math.ceil(text.length / 4)` 估算 token，不区分中英文。而 `profile-context.ts:81-103` 已有 CJK 感知的 `estimateTokens()` 函数（中文 1.5 chars/token、ASCII 4 chars/token）。context-window-manager 将知识库 token 预算设为 `remainingBudget * 0.4`（行 244），但对中文知识库结果低估约 2.7 倍（4/1.5），实际注入的 token 可能远超预算，挤压对话历史空间甚至导致上下文溢出。
**改进方案**: 将 `context-enhancer.ts` 和 `context-window-manager.ts` 中的 `estimateTokenCount` 替换为 `profile-context.ts` 导出的 `estimateTokens`（CJK 感知版本）。删除 `context-enhancer.ts` 中的重复函数。
**验收标准**: (1) 只保留一个 token 估算函数（CJK 感知版） (2) context-window-manager 使用统一的估算 (3) 现有 context-window-manager 测试更新适配 (4) 中文内容的 token 估算偏差小于 50%
**影响范围**: `packages/server/src/knowledge/context-enhancer.ts`, `packages/server/src/knowledge/context-window-manager.ts`, `packages/server/src/knowledge/context-window-manager.test.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
