### [pending] Agentic 循环 MAX_TURNS=25 时无用户感知 — AI 静默停止不解释原因

**ID**: chat-092
**优先级**: P2
**模块路径**: packages/server/src/ai/
**发现的问题**: `AgenticChatEngine.run()` (agentic-chat.ts:162) 中 `for (let turn = 0; turn < MAX_TURNS; turn++)` 循环达到 25 轮上限后直接 break 并发送 `complete` 事件（行 222-224），AI 的最后输出可能是一个工具调用结果，用户看到的是 AI 突然停止而没有总结性回复。前端也没有显示"已达到最大轮次"的提示。用户可能误以为任务已完成或连接断开。
**改进方案**: 达到 MAX_TURNS 时在 `complete` 事件中增加 `reason: 'max_turns_reached'` 字段，并在最后一轮结束后发送一条消息提示用户："已达到最大执行轮次（25 轮）。如需继续，请发送新消息。"前端在 `onComplete` 中检查 reason 并显示提示。
**验收标准**: (1) 达到 MAX_TURNS 时用户看到明确提示 (2) complete 事件包含 reason 字段 (3) 前端显示友好提示
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
