### [pending] StepConfirmBar 类型安全 — PendingConfirm 使用 `as` 断言无运行时验证

**ID**: chat-032
**优先级**: P2
**模块路径**: packages/dashboard/src/stores/chat-execution.ts
**发现的问题**: `chat-execution.ts:101` 使用 `JSON.parse(data) as PendingConfirm` 类型断言，`chat-execution.ts:396` 同样如此。`PendingConfirm` 要求 `stepId`、`command`、`description`、`riskLevel` 四个字段（定义在 `chat-types.ts:20-25`）。如果服务端发送的 JSON 缺少任何字段（如 `description` 为 undefined），前端不会报错，但 `StepConfirmBar` 组件会渲染 `undefined` 文本。同理 `chat-execution.ts:531` 的 `parsed.status as ToolCallEntry['status']` 不验证 status 是否是合法联合类型值。`chat-execution.ts:549-551` 的 `confirmId` 可能为 undefined，被 `?? ''` 默认为空字符串，导致 `respondToAgenticConfirm`（行 186）因 `!agenticConfirm?.confirmId` 为 true 而直接 return。
**改进方案**: 
1. 为 `PendingConfirm`、`ToolCallEntry` 状态更新和 `AgenticConfirm` 创建 Zod schema
2. 替换 `as` 断言为 `schema.parse(JSON.parse(data))`，解析失败走 `warnParseFail`
3. 或至少添加必填字段检查：`if (!parsed.stepId || !parsed.command) return`
**验收标准**: 
- 畸形 SSE 数据不会导致 UI 渲染 undefined
- 缺失 confirmId 时有明确的 console.warn 而非静默失败
- 新增测试：验证畸形数据被正确拒绝
**影响范围**: packages/dashboard/src/stores/chat-execution.ts, packages/dashboard/src/stores/chat-types.ts
**创建时间**: (自动填充)
**完成时间**: -
