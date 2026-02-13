### [pending] buildHistoryWithLimit 截断无通知 — AI 不知道早期上下文被移除导致幻觉

**ID**: chat-072
**优先级**: P1
**模块路径**: packages/server/src/core/session/
**发现的问题**: `manager.ts:389-434` 的 `buildHistoryWithLimit` 在 token 超预算时从最旧消息开始丢弃（行 421-431），但与 `buildContextWithLimit`（行 364-374，添加了 `[Earlier conversation summarized]` 标记）和 `trimMessagesIfNeeded`（行 75-89，注入了 context-loss notice）不同，此方法**不注入任何截断通知**。Agentic 引擎使用此方法构建对话历史（`chat.ts:178`），AI 模型收到的历史看起来像是完整的——但实际上丢失了早期的工具调用结果和文件内容。这会导致 AI 重复执行已完成的命令或引用不存在的上下文。
**改进方案**:
1. 当历史被截断时（`selected.length < eligible.length`），在返回数组的第一条消息前插入一条 system-like user 消息
2. 通知内容：`[System: Earlier conversation context was truncated. {N} messages removed. If you need information from earlier steps, re-read the relevant files.]`
3. 保持与 `trimMessagesIfNeeded` 的通知格式一致
**验收标准**:
- 历史截断时 AI 收到的消息数组首条包含截断通知
- 未截断时不插入任何通知
- 现有 session manager 测试通过 + 新增截断通知测试
**影响范围**:
- `packages/server/src/core/session/manager.ts` — `buildHistoryWithLimit` 方法
- `packages/server/tests/core/session/manager.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
