### [pending] confirm_required 与 confirm_id 事件竞态 — 用户可能永远无法批准命令

**ID**: chat-008
**优先级**: P0
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: `chat.ts:537-561` 中 `onConfirmRequired` 事件处理器设置 `agenticConfirm.confirmId = ''`，依赖后续的 `onConfirmId` 事件填充真实 ID。`respondToAgenticConfirm`（chat.ts:753）在 `!agenticConfirm?.confirmId` 时直接 return，不发送 API 请求。如果网络延迟导致 `confirm_id` 事件丢失或晚到，用户点击 "Allow" 按钮无响应，命令在服务端 60 秒后自动拒绝。两个独立 SSE 事件的顺序依赖是脆弱设计。
**改进方案**: 
1. 服务端在 `confirm_required` 事件中直接包含 `confirmId` 字段，消除对独立 `confirm_id` 事件的依赖
2. 如果必须保持两事件设计，前端应在 `confirmId` 为空时禁用 Allow 按钮并显示加载状态
3. 添加 3 秒超时：若 `confirm_id` 未到达，显示错误提示而非静默失败
**验收标准**: 
- 用户总能看到可点击的 Allow/Reject 按钮（在 confirmId 就绪时）
- confirmId 未到达时有明确的 UI 反馈而非静默失败
- 测试覆盖：confirm_id 先于 confirm_required 到达的场景
**影响范围**: packages/dashboard/src/stores/chat.ts, packages/server/src/ai/agentic-chat.ts, packages/dashboard/src/components/chat/AgenticConfirmBar.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
