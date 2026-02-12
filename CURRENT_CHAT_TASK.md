### [pending] respondToStep/respondToAgenticConfirm 失败时无用户反馈 — 用户操作被静默吞没

**ID**: chat-026
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat-execution.ts
**发现的问题**: `chat-execution.ts:153-167` 的 `createRespondToStep` 在 `set({ pendingConfirm: null })` 之后才发送 API 请求。如果 API 调用失败（网络断开、500 错误），catch 块（165-167）空且注释"let server timeout auto-reject"。用户点击 Allow 后确认栏消失（看起来操作成功），但实际决策未到达服务端，5 分钟后服务端超时自动 reject。`createRespondToAgenticConfirm`（188-201）有完全相同的问题。对比 `emergencyStop`（204-236）虽然也吞没错误，但至少立即更新状态为 cancelled。
**改进方案**: 
1. 在 catch 块中恢复 `pendingConfirm`/`agenticConfirm` 状态（让用户可以重试）
2. 或在 catch 块中 `set({ error: 'Failed to send decision. Please try again.' })`
3. 显示短暂的 toast 通知"决策发送失败"
4. 将 `set({ pendingConfirm: null })` 移到 API 成功之后（乐观更新 → 悲观更新）
**验收标准**: 
- API 失败时 pendingConfirm/agenticConfirm 恢复，用户可以重试
- 或有明确的错误提示告知用户操作失败
- 新增测试：模拟 API 失败，验证状态恢复或错误提示
**影响范围**: packages/dashboard/src/stores/chat-execution.ts
**创建时间**: (自动填充)
**完成时间**: -

---
