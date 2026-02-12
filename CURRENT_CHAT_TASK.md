### [pending] onComplete 未清理 agenticConfirm 状态 — 执行成功后仍显示确认栏

**ID**: chat-028
**优先级**: P2
**模块路径**: packages/dashboard/src/stores/chat-execution.ts
**发现的问题**: `chat-execution.ts:405-481` 的 `onComplete` 回调在执行完成时设置了 `pendingConfirm: null` 但**没有**设置 `agenticConfirm: null`。对比 `onError`（行 583-613）正确清理了 `agenticConfirm: null`。如果 agentic 模式的最后一个 tool call 需要确认，用户批准后命令执行完成，`complete` 事件到达——但 `agenticConfirm` 仍保留着旧值，`AgenticConfirmBar` 继续渲染。用户看到一个已无意义的确认栏。另外 `chat-execution.ts:608` 的 `executionMode: 'none'` 缺少 `as const`，在 TypeScript 严格模式下可能产生类型宽化为 `string`。
**改进方案**: 
1. 在 `onComplete` 的所有分支中添加 `agenticConfirm: null`、`isAgenticMode: false`、`toolCalls: []`
2. 修复 `chat-execution.ts:608` 添加 `as const`
3. 验证 `onComplete` 和 `onError` 的状态重置保持一致
**验收标准**: 
- Agentic 执行完成后 AgenticConfirmBar 不显示
- TypeScript 编译无类型宽化警告
- 新增测试：agentic 模式 complete 后验证 agenticConfirm 为 null
**影响范围**: packages/dashboard/src/stores/chat-execution.ts
**创建时间**: (自动填充)
**完成时间**: -

---
