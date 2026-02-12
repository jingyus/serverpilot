### [pending] chat.ts store 超 800 行硬限制 — 需拆分执行逻辑到独立模块

**ID**: chat-010
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: `chat.ts` 当前 915 行，超出项目约定的 500 行软限制和 800 行硬限制。文件承担了太多职责：消息管理、SSE 连接、计划确认/拒绝、执行跟踪、会话 CRUD、agentic 确认。`onStepStart` (chat.ts:302-316) 的 if/else 两个分支代码完全相同是复制粘贴遗留，`rejectPlan` (chat.ts:802-811) 连续两次 `set()` 可合并。
**改进方案**: 
1. 提取执行相关逻辑到 `stores/chat-execution.ts`（`confirmPlan`、`respondToStep`、`emergencyStop`、执行事件回调）
2. 提取会话 CRUD 到 `stores/chat-sessions.ts`（`fetchSessions`、`loadSession`、`deleteSession`）
3. 修复 `onStepStart` 的无意义分支（删除 else 分支）
4. 合并 `rejectPlan` 中的两次 `set()` 为一次调用
5. 主 store 保留消息发送和核心状态
**验收标准**: 
- `chat.ts` 降至 500 行以内
- 拆分后的模块各自不超过 400 行
- 所有现有 chat store 测试通过
- 无功能回归
**影响范围**: packages/dashboard/src/stores/chat.ts, packages/dashboard/src/stores/chat-execution.ts (新), packages/dashboard/src/stores/chat-sessions.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
