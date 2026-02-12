# Chat/AI 对话系统改进任务队列

> 此队列专注于 Chat 和 AI 对话系统的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-13 02:16:02

## 📊 统计

- **总任务数**: 32
- **待完成** (pending): 8
- **进行中** (in_progress): 1
- **已完成** (completed): 23
- **失败** (failed): 0

## 📋 任务列表

### [completed] 聊天会话持久化到 SQLite — 消除服务器重启丢失对话的致命问题 ✅
### [completed] loadSession 未重置执行/Agentic 状态 — 切换会话后显示旧执行数据 ✅

**ID**: chat-021
**优先级**: P0
**模块路径**: packages/dashboard/src/stores/chat-sessions.ts
**发现的问题**: `chat-sessions.ts:41-47` 的 `createLoadSession` 函数在加载新会话时只重置了 `currentPlan` 和 `planStatus`，但没有重置 `execution`、`executionMode`、`pendingConfirm`、`agenticConfirm`、`toolCalls`、`isStreaming`、`isAgenticMode`、`streamingContent`、`sseParseErrors` 状态。对比 `chat.ts:125-143` 的 `newSession` 函数会完整重置所有状态。当用户从一个正在执行的会话 A 切换到会话 B 时，ExecutionLog 仍显示 A 的执行步骤，AgenticConfirmBar 可能还显示旧的确认请求，toolCalls 数组保留了旧数据。
**改进方案**: 
1. 在 `createLoadSession` 成功加载会话后，增加完整的状态重置
2. 重置字段应与 `newSession` 保持一致：`execution: INITIAL_EXECUTION`、`executionMode: 'none'`、`pendingConfirm: null`、`agenticConfirm: null`、`toolCalls: []`、`isAgenticMode: false`、`isStreaming: false`、`streamingContent: ''`、`sseParseErrors: 0`
3. 同时调用 `getActiveHandle()?.abort()` 中止当前 SSE 连接（避免旧连接继续写入新会话状态）
**验收标准**: 
- 从有执行进度的会话切换到另一个会话后，ExecutionLog 不显示
- AgenticConfirmBar 和 StepConfirmBar 不显示旧确认
- toolCalls 数组清空
- 活跃 SSE 连接被正确中止
- 新增测试：验证 loadSession 后所有执行状态已重置
**影响范围**: packages/dashboard/src/stores/chat-sessions.ts, packages/dashboard/src/stores/chat-sessions.test.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:07:09

---

### [completed] agentic-chat.ts 的 trimMessagesIfNeeded 算法有 token 估算累减偏差 ✅

**ID**: chat-022
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `agentic-chat.ts:748-765` 的 `trimMessagesIfNeeded()` 使用 `currentTokens -= removedTokens` 累减方式计算剩余 token 数。但 `estimateMessagesTokens()` 对不同消息类型（string content vs structured tool_use/tool_result blocks）的估算精度不同，累减多次后误差会放大。更关键的是：`agentic-chat.ts:37` 使用 `CHARS_PER_TOKEN = 4` 常量做 ASCII 估算，而项目已在 task-012 中修复了 `profile-context.ts:estimateTokens()` 支持 CJK 混合文本。此处是独立的实现，未复用已修复的 `estimateTokens`。当中文对话达到 20+ turns 时，150K token 预算（`agentic-chat.ts:34`）实际可能允许 600K+ 真实 token 进入 API，触发 Anthropic 的 `context_length_exceeded` 错误。
**改进方案**: 
1. 将 `estimateMessagesTokens()` 改为使用 `estimateTokens()` from `profile-context.ts`（已支持 CJK）
2. 对 structured content blocks（tool_use、tool_result），提取文本部分再调用 `estimateTokens()` 而非用 `JSON.stringify().length / 4`
3. 每次 `splice` 后使用 `estimateMessagesTokens(messages)` 重新计算（而非累减），避免误差放大
4. 添加中文对话场景的单元测试
**验收标准**: 
- 中文 20 轮 agentic 对话后不会触发 context_length_exceeded 错误
- `estimateMessagesTokens()` 对中文消息估算误差在 2x 以内
- 累减 vs 重算的差异 < 10%
- 测试覆盖：中文、英文、混合、structured content blocks
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:12:00

---

### [completed] 双 pendingConfirmations Map 导致 agentic 确认可能路由到错误系统 ✅

**ID**: chat-023
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts
**发现的问题**: 存在两个独立的 `pendingConfirmations` Map：`chat.ts:50-53` 和 `agentic-chat.ts:165-168`。`chat.ts` 中的 Map 由 `chat.ts:137-147` 的 `onConfirmRequired` 回调写入，由 `chat.ts:332-350` 的 `/confirm` 端点消费。而 `agentic-chat.ts:165-168` 的 Map 通过 `resolveConfirmation()` 导出但仅在测试中使用。前端统一调用 `/confirm` 端点（`chat-execution.ts:190-197`），该端点只查 `chat.ts` 的 Map。如果有代码直接调用 `agentic-chat.ts` 的 `resolveConfirmation()`，会因 confirmId 不在该 Map 中而返回 false。两套系统增加维护负担和 bug 风险。
**改进方案**: 
1. 删除 `agentic-chat.ts:165-168` 中的 `pendingConfirmations` Map 和 `resolveConfirmation()` 函数
2. Agentic engine 的确认完全通过 `opts.onConfirmRequired` 回调（定义在 `chat.ts:137-147`）与 `chat.ts` 的 Map 交互
3. 确保只有一个 `pendingConfirmations` 管理点（`chat.ts`），避免状态分裂
4. 更新相关测试，移除对 `resolveConfirmation` 的直接调用
**验收标准**: 
- 项目中只有一个 `pendingConfirmations` Map（在 chat.ts 中）
- 所有确认流程通过 `/confirm` 端点正确路由
- agentic-chat.ts 不再导出 `resolveConfirmation`
- 现有确认流程测试通过
**影响范围**: packages/server/src/ai/agentic-chat.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:15:30

---

### [in_progress] activePlanExecutions 初始值为空字符串 — 取消执行可能失败

**ID**: chat-024
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `chat-execution.ts:259` 将 `activePlanExecutions.set(planId, '')` 设为空字符串，表示执行已开始但 executionId 尚未就绪。然后在 `chat-execution.ts:268`（progress listener 回调中）才更新为真实 executionId。如果用户在这两行之间发起取消请求，`chat.ts:412` 的 `getActiveExecution(body.planId)` 返回空字符串 `''`，传入 `executor.cancelExecution('')` 导致取消失败（因为没有 executionId 为空的执行）。虽然 `removeActiveExecution` 仍会清除 Map 条目使 step 循环在 `chat-execution.ts:277` break，但 `chat.ts:422` 的 `cancelled` 变量为 false，返回 `{ success: false }` 给前端——用户看到"取消失败"但实际已停止。
**改进方案**: 
1. 在 `executePlanSteps` 入口处生成 executionId（`randomUUID()`），直接 `activePlanExecutions.set(planId, executionId)` 
2. 将 executionId 传入 progress listener，listener 只用于路由 output
3. 或在 `getActiveExecution` 返回空字符串时返回 undefined（视为无活跃执行）
4. 在取消端点中，如果 `executionId` 为空则至少返回 `success: true`（因为 step 循环会 break）
**验收标准**: 
- 用户在执行刚开始时点击取消，前端收到 `{ success: true }`
- `activePlanExecutions` 不再出现空字符串值
- 新增测试：执行开始后立即取消的场景
**影响范围**: packages/server/src/api/routes/chat-execution.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] Plan 完成后未从 Session.plans Map 中清除 — 阻止缓存驱逐

**ID**: chat-025
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts, packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `manager.ts:174-176` 的 `isActive()` 判断 `session.plans.size > 0` 来保护活跃会话不被驱逐。但 plan 执行完成后，`chat-execution.ts:424` 只从 `activePlanExecutions` Map 中删除了 planId，**从未**调用 `sessionMgr.removePlan(sessionId, planId)` 或类似方法清除 `session.plans` Map 中的条目。这意味着任何执行过至少一个 plan 的会话的 `plans.size` 永远 > 0，`isActive()` 永远返回 true，该会话**永远不会被 LRU 驱逐或 TTL 过期**。长期运行的服务器会因此累积所有曾执行过 plan 的会话，内存持续增长。
**改进方案**: 
1. 在 `SessionManager` 中添加 `removePlan(sessionId: string, planId: string)` 方法
2. 在 `executePlanSteps` 完成后（`chat-execution.ts:424` 附近）调用 `sessionMgr.removePlan(sessionId, planId)` 
3. 在 `rejectAllPendingDecisions` 和取消流程中也清理对应 plan
4. 或改进 `isActive()` 逻辑，让它区分"有活跃执行的 plan"和"已完成的 plan"
**验收标准**: 
- Plan 执行完成后 `session.plans.size` 回到 0
- 执行完 plan 的不活跃会话可以被 LRU 驱逐和 TTL 过期
- 新增测试：plan 执行后验证 plans Map 被清理
**影响范围**: packages/server/src/core/session/manager.ts, packages/server/src/api/routes/chat-execution.ts
**创建时间**: (自动填充)
**完成时间**: -

---

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

### [pending] SSE 解析后 currentEvent 在空行处重置 — 多行 data 的事件类型丢失

**ID**: chat-027
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:198-211` 的 SSE 解析循环中，遇到空行时 `currentEvent = 'message'`（行 209）。按 SSE 规范，空行表示事件结束，应该 dispatch 当前事件并重置。但此处只重置 `currentEvent`，不 dispatch。如果服务端在 `event:` 和 `data:` 之间有空行（某些 SSE 库会这样做），`currentEvent` 会被错误重置为 `'message'`，导致 `tool_call`、`confirm_required` 等事件被路由到 `onMessage` 回调。同样的问题在 `createMetricsSSE`（行 341-354）、`createServerStatusSSE`（行 470-484）、`createSkillExecutionSSE`（行 593-623）中重复出现。4 处 SSE 解析逻辑完全重复（违反 DRY）。
**改进方案**: 
1. 提取一个 `parseSSEStream(reader: ReadableStreamDefaultReader, dispatch: (event: string, data: string) => void)` 通用函数
2. 所有 4 个 SSE 连接类型复用该函数
3. 修正空行处理：空行触发 `dispatch(currentEvent, accumulatedData)` 然后重置，而非仅重置 event name
4. 支持多行 `data:` 拼接（SSE 规范允许）
**验收标准**: 
- SSE 解析逻辑只有一份实现
- 空行后事件类型不会意外变为 'message'
- 多行 data 被正确拼接
- 所有现有 SSE 相关测试通过
**影响范围**: packages/dashboard/src/api/sse.ts
**创建时间**: (自动填充)
**完成时间**: -

---

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

### [pending] SSE 流关闭后服务端 executePlanSteps 继续执行 — 浪费资源

**ID**: chat-029
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `chat-execution.ts:271-272` 中 `stream.writeSSE().catch(() => {})` 静默吞没写入错误。当客户端断开连接（关闭浏览器、网络断开）后，SSE stream 的所有 write 都会失败，但 `executePlanSteps` 的 for 循环（行 276-421）仍继续执行每个 step：调用 `executor.executeCommand()`、`auditLogger.log()`、`autoDiagnoseStepFailure()` 等。一个 5 步 plan，每步 30 秒超时，可能在客户端断开后白白执行 2.5 分钟。同样，`agentic-chat.ts:330` 的 `writeSSE().catch(() => {})` 也有此问题——AI 循环继续调用 Anthropic API（每次约 $0.01-0.05），浪费 API 费用。
**改进方案**: 
1. 在 `writeSSE` catch 中设置一个 `streamClosed = true` 标志
2. 在 step 循环的每次迭代开头检查 `if (streamClosed) break`
3. 或使用 Hono 的 `stream.onAbort(() => { aborted = true })` 回调
4. 对 agentic engine 同理：writeSSE 失败后设置标志，在 turn 循环中检查
**验收标准**: 
- 客户端断开后服务端在当前 step 完成后停止执行后续步骤
- Agentic 循环在 stream 关闭后停止调用 Anthropic API
- 审计日志记录"execution aborted: client disconnected"
- 新增测试：模拟 stream 关闭后验证执行中止
**影响范围**: packages/server/src/api/routes/chat-execution.ts, packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] sse.ts 文件超 500 行且含 4 套重复 SSE 解析逻辑 — 需提取通用解析器

**ID**: chat-030
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts` 当前 700 行，超出 500 行软限制。文件中 4 个 SSE 连接函数（`createSSEConnection` 行 101-238、`createMetricsSSE` 行 269-382、`createServerStatusSSE` 行 402-509、`createSkillExecutionSSE` 行 531-635）各自独立实现了完全相同的 SSE 流解析逻辑：`decoder + buffer + split('\n') + lines.pop() + event:/data: 解析`。同样的 `cleanup` + `scheduleReconnect` + `connect` 三件套也重复了 3 次。任何解析 bug 的修复需要在 4 处同步更新。
**改进方案**: 
1. 提取 `parseSSEStream(reader, dispatch)` 通用解析函数处理 buffer/decode/line-split/event dispatch
2. 提取 `createReconnectableSSE(connectFn, maxAttempts, onReconnecting)` 通用重连包装器
3. 4 个 SSE 函数简化为：配置 URL + 事件类型映射 + 调用通用函数
4. 主文件降至 300 行以内
**验收标准**: 
- `sse.ts` 降至 500 行以内
- SSE 解析逻辑只有一份
- 重连逻辑只有一份
- 所有现有 SSE 测试通过
- 无功能回归
**影响范围**: packages/dashboard/src/api/sse.ts
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] SessionSidebar 日期分组使用硬编码英文 — 与项目 i18n 不一致

**ID**: chat-031
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: `Chat.tsx:501-514` 的 `getSessionDateGroup()` 函数和 `Chat.tsx:547` 的 `groupOrder` 数组使用硬编码英文字符串 `'Today'`、`'Yesterday'`、`'This Week'`、`'Older'`。项目使用 `react-i18next` 做国际化，其他所有 UI 文本都通过 `t()` 函数获取。SessionSidebar 中这些分组标题直接在 `Chat.tsx:584` 渲染为英文文本，与中文 UI 的其他部分不一致。
**改进方案**: 
1. 将日期分组文本移入 i18n 翻译文件（`chat.sessionGroupToday`、`chat.sessionGroupYesterday` 等）
2. `getSessionDateGroup` 返回 key（如 `'today'`），渲染时通过 `t(`chat.sessionGroup.${key}`)` 转换
3. 或在 `SessionSidebar` 组件中使用 `useTranslation` 翻译分组标题
**验收标准**: 
- 日期分组标题根据当前语言显示（中文环境显示"今天"、"昨天"等）
- 所有现有 Chat 页面测试通过
**影响范围**: packages/dashboard/src/pages/Chat.tsx, 国际化翻译文件
**创建时间**: (自动填充)
**完成时间**: -

---

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

### [completed] SSE 连接组件卸载时未清理 — Chat 页面离开后 SSE 连接泄漏 ✅

**ID**: chat-006
**优先级**: P0
**模块路径**: packages/dashboard/src/pages/Chat.tsx, packages/dashboard/src/stores/chat.ts
**发现的问题**: `Chat.tsx` 组件无 `useEffect` 清理函数来关闭活跃的 SSE 连接。模块级 `activeHandle`（chat.ts:117）在用户导航离开 Chat 页面时不会被 abort。SSE 连接持续存在，回调继续更新已卸载组件的 Zustand state，造成内存泄漏和无效的状态更新。Chat.tsx:78-85 的 `useEffect` 没有 return cleanup 函数。
**改进方案**: 
1. 在 `chat.ts` store 中新增 `cleanup()` action，调用 `activeHandle?.abort(); activeHandle = null;` 并重置流式状态
2. 在 `Chat.tsx` 中添加 `useEffect(() => { return () => cleanup(); }, []);` 组件卸载清理
3. 确保 `cleanup()` 也清除 `isStreaming`、`streamingContent`、`isReconnecting` 状态
**验收标准**: 
- 用户在流式输出中离开 Chat 页面时，SSE 连接立即关闭
- 不再有 "state update on unmounted component" 场景
- 新增测试覆盖组件卸载时的清理行为
**影响范围**: packages/dashboard/src/pages/Chat.tsx, packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-12 23:23:50

---

### [completed] 全局 setProgressCallback 竞态条件 — 并发用户执行命令时输出串台 ✅

**ID**: chat-007
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts
**发现的问题**: `chat.ts:149` 和 `agentic-chat.ts:491` 都通过 `executor.setProgressCallback()` 设置全局回调。TaskExecutor 是单例，若两个用户同时执行命令，第二个用户的回调会覆盖第一个用户的，导致第一个用户的 SSE 停止接收实时输出，或输出被路由到错误用户的流。此外 `agentic-chat.ts:491` 的回调设置后从不调用 `executor.setProgressCallback(null)` 清理（而 `chat.ts:317` 会清理），造成闭包引用 SSE stream 无法被 GC。
**改进方案**: 
1. 将 `setProgressCallback` 改为基于执行 ID 的回调注册：`executor.onProgress(executionId, callback)` / `executor.offProgress(executionId)`
2. 或者为每次执行创建独立的 progress channel（EventEmitter 模式），避免全局覆盖
3. `agentic-chat.ts` 中 `toolExecuteCommand` 完成后必须清理回调
4. 添加并发执行的集成测试验证输出不串台
**验收标准**: 
- 两个用户同时执行命令时各自 SSE 收到正确的实时输出
- Agentic 模式执行完成后 progress callback 被清理
- 无 SSE stream 闭包泄漏
**影响范围**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts, packages/server/src/core/task/executor.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-12 23:41:52

---

### [completed] confirm_required 与 confirm_id 事件竞态 — 用户可能永远无法批准命令 ✅

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
**完成时间**: 2026-02-12 23:52:46

---

### [completed] 会话消息持久化静默失败 — DB 写入错误被吞没无日志 ✅

**ID**: chat-009
**优先级**: P0
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `manager.ts:165-168` 的 `addMessage()` 使用 fire-and-forget 模式写入 SQLite，`.catch(() => {})` 完全吞没错误且注释 "log silently handled" 是误导——实际无任何日志记录。磁盘满、SQLite 锁冲突等场景下消息仅存于内存缓存，服务器重启即永久丢失。用户无感知数据丢失是最危险的静默故障。
**改进方案**: 
1. `.catch()` 中添加 `logger.error('Failed to persist message', { sessionId, error })` 日志
2. 添加简单的重试机制（1 次重试，间隔 500ms）
3. 可选：在连续 N 次持久化失败后通过 SSE 发送 `warning` 事件通知前端
4. 确保不阻塞 SSE 流式响应（保持异步）
**验收标准**: 
- DB 写入失败时控制台有 error 级别日志，包含 sessionId 和错误详情
- 至少 1 次重试后失败才放弃
- SSE 流式响应不被持久化操作阻塞
- 新增测试：模拟 repo.addMessage 抛异常，验证日志记录和重试
**影响范围**: packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-12 23:57:43

---

### [completed] chat.ts store 超 800 行硬限制 — 需拆分执行逻辑到独立模块 ✅

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
**完成时间**: 2026-02-13 00:07:16

---

### [completed] SSE 事件 JSON 解析错误全部静默吞没 — 开发调试和生产排错极其困难 ✅

**ID**: chat-011
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: `chat.ts` 中所有 SSE 回调（onAutoExecute:246, onStepStart:316, onStepComplete:382, onOutput:370, onConfirmRequired:550, onConfirmId:561, onToolCall:520, onToolResult:534 等）统一使用 `catch { /* ignore */ }` 吞没 JSON 解析错误。如果服务端发送格式变更或损坏的数据，前端完全无感知，用户看到的是莫名的 UI 停滞（按钮不出现、输出不更新）而不是错误信息。
**改进方案**: 
1. 将 `catch { /* ignore */ }` 替换为 `catch (e) { console.warn('[SSE] Failed to parse event:', eventName, e); }`
2. 生产环境保持不抛异常（保证 SSE 流继续），但记录到 console.warn
3. 可选：添加 SSE 事件解析错误计数器，超过阈值时在 UI 显示 "部分数据解析失败" 提示
**验收标准**: 
- 浏览器控制台能看到 SSE 解析失败的 warn 日志，包含事件名和原始数据
- SSE 流不因解析错误中断
- 不影响正常流程的行为
**影响范围**: packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:13:56

---

### [completed] Token 估算对中文内容偏差 4 倍 — 可能导致上下文溢出或 AI 请求失败 ✅

**ID**: chat-012
**优先级**: P1
**模块路径**: packages/server/src/ai/profile-context.ts, packages/server/src/core/session/manager.ts
**发现的问题**: `profile-context.ts:54` 使用 `CHARS_PER_TOKEN = 4` 作为全局 token 估算比率。这对英文文本合理（约 4 字符/token），但本项目 AI 系统提示要求用中文回复（agentic-chat.ts:672），中文文本实际约 1-2 字符/token。这意味着 `buildContextWithLimit(sessionId, 8000)` 实际可能放入 32000 真实 token；`buildHistoryWithLimit(sessionId, 40000)` 可能放入 160000 真实 token，远超模型限制。`estimateTokens()` 在 `manager.ts:260` 和 `manager.ts:322` 被用于上下文裁剪决策。
**改进方案**: 
1. 改进 `estimateTokens()` 函数，检测文本中的非 ASCII 字符比例
2. 对于高 CJK 比例文本使用 `CHARS_PER_TOKEN = 1.5`；纯英文使用 `CHARS_PER_TOKEN = 4`；混合文本加权平均
3. 或引入轻量级 tokenizer 库（如 `tiktoken` 的 WASM 版本）做精确计算
4. 保持 `estimateTokens()` 的接口不变，仅改进内部实现
**验收标准**: 
- 中文对话 100 轮后不会因 token 溢出导致 AI 请求 400 错误
- `estimateTokens('你好世界')` 返回值在 3-5 之间（而非当前的 1）
- 英文估算精度不变
- 新增测试覆盖中文、英文、混合文本场景
**影响范围**: packages/server/src/ai/profile-context.ts, packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:20:32

---

### [completed] SSE token 刷新无去重保护 — 并发 401 可能引发 token 轮换冲突 ✅

**ID**: chat-013
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:28-47` 的 `tryRefreshToken()` 独立于 `client.ts:52-82` 的 `refreshAccessToken()`，后者有 `refreshPromise` 去重机制防止并发刷新，但 SSE 版本没有。如果 Chat SSE 和 Metrics SSE 同时遇到 401，两者各自调用 `tryRefreshToken()`，向服务端发送两次 refresh 请求。如果服务端实现了 refresh token 轮换（首次使用后失效），第二次请求会失败，导致用户被强制登出。
**改进方案**: 
1. 将 `sse.ts` 的 `tryRefreshToken()` 替换为调用 `client.ts` 的 `refreshAccessToken()` + 去重逻辑
2. 或将 token 刷新逻辑提取到独立的 `auth.ts` 模块，SSE 和 API 客户端共用
3. 确保任意时刻只有一个 refresh 请求在 flight
**验收标准**: 
- 多个 SSE 连接同时 401 时只发送一次 refresh 请求
- refresh 成功后所有等待者拿到新 token
- refresh 失败后所有等待者收到 null
- 新增测试覆盖并发 refresh 场景
**影响范围**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/api/client.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:25:44

---

### [completed] scrollToBottom 在流式输出中每个 chunk 触发 — 造成滚动卡顿 ✅

**ID**: chat-014
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: `Chat.tsx:93-95` 的 `useEffect` 依赖 `streamingContent` 变化触发 `scrollToBottom()`。流式输出时 `streamingContent` 每秒更新几十次（每个 SSE token chunk），每次都调用 `scrollIntoView({ behavior: 'smooth' })`。平滑滚动动画会堆叠，在长消息渲染时造成明显的视觉卡顿和 CPU 浪费。
**改进方案**: 
1. 流式输出中使用 `behavior: 'auto'`（瞬时滚动）而非 `'smooth'`
2. 或对 `scrollToBottom` 添加 `throttle`（如 100ms），避免高频触发
3. 仅在 `messages.length` 变化时使用 `'smooth'`（新消息到达），`streamingContent` 变化时使用 `'auto'`
**验收标准**: 
- 流式输出时页面滚动流畅无卡顿
- 新消息到达时仍有平滑滚动效果
- 长消息（>2000 字符）流式输出时 CPU 使用率明显降低
**影响范围**: packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:29:20

---

### [completed] AgenticConfirmBar 组件质量低于其他 Chat 组件 — 缺测试、缺 testid、风格不一致 ✅

**ID**: chat-015
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/AgenticConfirmBar.tsx
**发现的问题**: 
1. 无测试文件 — 其他所有 Chat 组件（ChatMessage、MessageInput、PlanPreview、ExecutionLog、MarkdownRenderer）都有对应 `.test.tsx`，唯独 `AgenticConfirmBar` 没有
2. 无 `data-testid` 属性 — `StepConfirmBar` 有 `data-testid="step-confirm-bar"`、`step-allow-btn` 等，`AgenticConfirmBar` 一个都没有
3. 使用原生 `<button>` 而非项目通用 `<Button>` 组件（其他组件均使用 `@/components/ui/button`）
4. 使用字符串拼接 `${colorClass}` 而非 `cn()` 工具函数（AgenticConfirmBar.tsx:28）
5. 使用 HTML 实体 `&#9888;` 而非 Lucide 图标（其他组件均使用 lucide-react 图标）
**改进方案**: 
1. 创建 `AgenticConfirmBar.test.tsx`，覆盖渲染、Allow 点击、Reject 点击、不同风险等级样式
2. 添加 `data-testid="agentic-confirm-bar"`、`agentic-allow-btn`、`agentic-reject-btn`
3. 替换原生 `<button>` 为 `<Button>` 组件
4. 使用 `cn()` 替换字符串拼接
5. 使用 `AlertTriangle` 图标替换 `&#9888;`
**验收标准**: 
- `AgenticConfirmBar.test.tsx` 至少 8 个测试用例
- 所有 `data-testid` 与 StepConfirmBar 命名风格一致
- 视觉风格与其他 Chat 组件统一
**影响范围**: packages/dashboard/src/components/chat/AgenticConfirmBar.tsx, packages/dashboard/src/components/chat/AgenticConfirmBar.test.tsx (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:33:09

---

### [completed] MarkdownRenderer 复制按钮 Promise 未处理 + setTimeout 泄漏 ✅

**ID**: chat-016
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/MarkdownRenderer.tsx
**发现的问题**: 
1. `MarkdownRenderer.tsx:18` — `navigator.clipboard.writeText(code).then(...)` 无 `.catch()` 处理。非 HTTPS 环境、iframe 限制、或文档失焦时 Clipboard API 会 reject，产生 unhandled promise rejection
2. `MarkdownRenderer.tsx:20` — `setTimeout(() => setCopied(false), 2000)` 未在组件卸载时清理。如果用户在 2 秒内切换页面，会触发 "Can't perform a React state update on an unmounted component"
**改进方案**: 
1. 添加 `.catch(() => {})` 或使用 try/catch + async/await，失败时可选显示 fallback（如 "复制失败"）
2. 使用 `useEffect` 返回清理函数或 `useRef` 存储 timer ID，组件卸载时 `clearTimeout`
**验收标准**: 
- 非 HTTPS 环境下点击复制不产生控制台错误
- 快速切换页面不产生 React 卸载状态更新警告
- 现有 MarkdownRenderer 测试继续通过
**影响范围**: packages/dashboard/src/components/chat/MarkdownRenderer.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:36:28

---

### [completed] /confirm 端点缺少 Zod 请求体验证 — 可能接受畸形数据 ✅

**ID**: chat-017
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: `chat.ts:677` 使用 `c.req.json<{ confirmId: string; approved: boolean }>()` 读取请求体，仅有 TypeScript 类型断言无运行时验证。项目中其他所有 POST 端点都使用 `validateBody(ZodSchema)` 中间件。如果客户端发送 `{ confirmId: 123 }`（number 而非 string）或缺少 `approved` 字段，不会被拦截。`c.req.json()` 本身在非 JSON body 时会抛出未处理异常导致 500 错误（而非 400）。
**改进方案**: 
1. 定义 `ConfirmBodySchema = z.object({ confirmId: z.string(), approved: z.boolean() })`
2. 使用 `validateBody(ConfirmBodySchema)` 中间件替换手动 `c.req.json()`
3. 与项目其他端点保持一致的验证模式
**验收标准**: 
- 畸形 JSON 返回 400 而非 500
- 缺失字段返回具体的验证错误信息
- 类型不匹配（如 confirmId 为 number）被正确拒绝
- 新增测试覆盖验证失败场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:42:27

---

### [completed] 会话内存缓存无驱逐机制 — 长期运行服务器内存持续增长 ✅

**ID**: chat-018
**优先级**: P2
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `manager.ts:103` 的 `private cache = new Map<string, Session>()` 在 `getOrCreate()` 和 `getSession()` 时填充，但除了 `deleteSession()` 外无任何驱逐机制。每个 Session 对象包含完整的 `messages[]` 数组和 `plans: Map`。服务器持续运行时，所有曾被访问的会话永久驻留内存。100 个用户各 10 个会话，每个会话 50 条消息，可能消耗数百 MB 内存。
**改进方案**: 
1. 添加 LRU 驱逐策略：最多缓存 100 个会话（可配置），超限时淘汰最久未访问的
2. 或添加 TTL：会话 30 分钟未访问从缓存移除（DB 中仍保留）
3. 使用 `updatedAt` 时间戳排序，驱逐时将 dirty 数据刷回 DB
4. 保留 `plans` 在缓存驱逐时的处理（plans 是纯内存的，驱逐后丢失——需记录警告或拒绝驱逐活跃执行的会话）
**验收标准**: 
- 缓存大小有上限，超限时自动驱逐
- 驱逐后的会话再次访问时从 DB 重新加载
- 活跃执行中的会话不被驱逐
- 新增测试覆盖缓存驱逐和重新加载
**影响范围**: packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:26:44

---

### [completed] SSE 重连复用原始请求体 — 可能导致服务端重复处理用户消息 ✅

**ID**: chat-019
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:172` 重连时复用创建连接时的 `body` 闭包（包含原始 `message` 字段）。Chat SSE 是 POST 请求，重连会再次发送 `{ message: "用户的问题", sessionId: "xxx" }`。如果服务端的 `/chat/:serverId` 路由不是幂等的（每次都创建新 assistant 消息和 AI 调用），重连会导致用户消息被重复处理、AI 重复回答。
**改进方案**: 
1. 重连时移除 `message` 字段，只发送 `{ sessionId, reconnect: true }`
2. 服务端识别 `reconnect: true` 后恢复现有 SSE 流（而非开始新对话）
3. 或改为 GET 请求 + EventSource 标准协议（可利用浏览器原生重连的 `Last-Event-Id`）
4. 至少：在重连时添加 `X-Reconnect: true` 头部让服务端判断
**验收标准**: 
- 网络断开重连后不产生重复的 AI 回复
- 重连后 SSE 流从断点恢复（或至少不重复已发送的内容）
- 新增测试覆盖重连幂等性
**影响范围**: packages/dashboard/src/api/sse.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:36:35

---

### [completed] server 端 chat.ts 路由文件超 800 行硬限制 — `any` 类型逃逸需修复 ✅

**ID**: chat-020
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: 
1. `chat.ts` 当前 873 行，超出 800 行硬限制
2. `chat.ts:101-104` 定义了 `type StoredPlan = any` 和 `type ServerProfile = any`（带 eslint-disable），完全绕过 TypeScript 类型检查。`executePlanSteps` 函数（114-369，共 255 行）内所有 `plan.steps`、`step.id`、`step.command` 等访问都无类型安全
3. `executePlanSteps` 单独就有 255 行，应提取为独立模块
**改进方案**: 
1. 将 `executePlanSteps` 提取到 `api/routes/chat-execution.ts`
2. 为 `StoredPlan` 和 `ServerProfile` 定义真正的 TypeScript 接口（参考 shared 中已有的 PlanStep schema）
3. 消除所有 `any` 类型逃逸
4. 主 `chat.ts` 只保留路由注册和请求处理
**验收标准**: 
- `chat.ts` 降至 500 行以内
- 不再有 `any` 类型别名
- `executePlanSteps` 中所有属性访问有类型检查
- TypeScript 编译无 `@ts-ignore` 或 `eslint-disable`
**影响范围**: packages/server/src/api/routes/chat.ts, packages/server/src/api/routes/chat-execution.ts (新)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:49:15


**ID**: chat-001
**优先级**: P0
**模块路径**: packages/server/src/core/session/manager.ts, packages/server/src/db/
**发现的问题**:
`SessionManager` 类 (manager.ts:70-176) 使用纯内存 `Map<string, Session>` 存储所有会话数据。服务器重启、进程崩溃或 OOM kill 后，所有聊天记录永久丢失。这是生产环境中最严重的数据丢失风险。

具体问题：
1. `manager.ts:72` — `private sessions = new Map<string, Session>()` 纯内存存储
2. `manager.ts:98-113` — `addMessage()` 只写入 Map，无任何持久化
3. `manager.ts:116-123` — `storePlan()` 同样纯内存
4. 随着对话累积，内存持续增长无上限（无 TTL、无 LRU 淘汰），可能导致 OOM

**改进方案**:
1. 新建 `chat_sessions` 和 `chat_messages` 两张 SQLite 表（Drizzle schema）
2. 创建 `DrizzleSessionRepository` 实现，使用与项目现有模式一致的 Repository + singleton 模式
3. `addMessage()` 同步写入 SQLite；`getSession()` 先查内存缓存再查 DB
4. 保留 `InMemorySessionRepository` 供测试使用
5. 添加迁移脚本 `0009_chat_sessions.sql`
6. 可选：添加 TTL / max-sessions-per-server 限制以防无限增长

**验收标准**:
- 服务器重启后，之前的聊天会话和消息仍可通过 API 查询
- Dashboard 加载历史会话列表正常
- 现有 chat.test.ts 和 session manager 测试全部通过
- 新增 DrizzleSessionRepository 测试覆盖 CRUD + 边界场景
- 无 N+1 查询问题

**影响范围**:
- `packages/server/src/core/session/manager.ts` — 重构为 Repository 接口
- `packages/server/src/db/schema.ts` — 新增表定义
- `packages/server/src/db/repositories/` — 新增 session-repository.ts
- `packages/server/src/db/migrations/` — 新增迁移文件
- `packages/server/src/api/routes/chat.ts` — 使用新的 Repository
- `packages/server/src/core/session/manager.test.ts` — 适配新接口

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:04:06

---

### [completed] 对话上下文窗口管理 — 长对话超出 token 限制导致 AI 请求失败 ✅

**ID**: chat-002
**优先级**: P0
**模块路径**: packages/server/src/core/session/manager.ts, packages/server/src/api/routes/chat-ai.ts
**发现的问题**:
长对话的上下文管理存在严重缺陷，可能导致 AI 请求直接失败：

1. **Legacy mode**: `manager.ts:166-175` 的 `buildContext()` 将**所有消息**无截断地拼接成字符串，传入 `chat-ai.ts:188-189` 作为 `conversationHistory`。一个 50 轮对话（每轮含命令输出）可能生成 50K+ token 的上下文，超出 `maxTokens: 4096`（chat-ai.ts:196）的回复空间，甚至超过模型输入限制。

2. **Agentic mode**: `agentic-chat.ts:216-219` 将全部 `conversationHistory` 直接传入 Anthropic messages，加上 `MAX_TURNS=25`（agentic-chat.ts:31）的循环，每轮都会累积更多消息，在长会话中极易超出 200K context window。

3. 两种模式都没有 token 计数、上下文压缩或消息裁剪机制。项目已有 `knowledge/context-window-manager.ts` 做 token 分配，但 chat 流程完全没有使用它。

**改进方案**:
1. 在 `SessionManager` 中添加 `buildContextWithLimit(sessionId, maxTokens)` 方法
2. 策略：保留最近 N 条消息 + 最早的系统消息 + 中间消息的摘要
3. Legacy mode: 在 `chat.ts:515` 调用时传入 token 上限（如 8K）
4. Agentic mode: 在 `agentic-chat.ts:216-219` 对 history 做滑动窗口裁剪
5. 复用已有的 `estimateTokens()` 函数（profile-context.ts）进行 token 计数
6. 当上下文被截断时，在开头添加 `[Earlier conversation summarized]` 标记

**验收标准**:
- 100 轮对话后 AI 请求不会因 token 超限而失败
- 最近的消息始终被保留
- 裁剪后上下文 token 数不超过预设限制
- 添加单元测试覆盖：空会话、短会话（不裁剪）、长会话（裁剪）、含系统消息的会话

**影响范围**:
- `packages/server/src/core/session/manager.ts` — 新增方法
- `packages/server/src/api/routes/chat.ts` — 调用新方法
- `packages/server/src/ai/agentic-chat.ts` — 添加 history 裁剪
- `packages/server/src/api/routes/chat-ai.ts` — 可选：调整 maxTokens
- `packages/server/src/core/session/manager.test.ts` — 新增测试

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:20:39

---

### [completed] ChatMessage 组件缺少 Markdown 渲染 — AI 回复丢失格式和代码高亮 ✅

**ID**: chat-003
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/ChatMessage.tsx
**发现的问题**:
`ChatMessage.tsx:69` 使用纯 `<p className="whitespace-pre-wrap break-words">{message.content}</p>` 渲染消息内容。AI 回复通常包含大量 Markdown 格式（标题、列表、代码块、加粗等），全部以纯文本展示，严重影响可读性。

具体表现：
1. 代码块 (\`\`\`bash...\`\`\`) 没有语法高亮，没有复制按钮
2. 列表、标题、粗体等 Markdown 语法直接显示为原始字符
3. Agentic 模式中，streaming content（Chat.tsx:192）同样是 `<pre>` 纯文本
4. 对比 ChatGPT / Claude.ai，Markdown 渲染是 AI 聊天应用的基本要求

**改进方案**:
1. 安装 `react-markdown` + `remark-gfm`（GFM 表格/删除线支持）
2. 安装 `react-syntax-highlighter` 或使用 Shiki 进行代码高亮
3. 在 `ChatMessage.tsx` 中将 assistant 消息通过 `<ReactMarkdown>` 渲染
4. 为代码块添加复制按钮（Copy to clipboard）
5. 用户消息保持纯文本（用户输入通常不含 Markdown）
6. 流式内容（streaming）也需要支持 Markdown 实时渲染

**验收标准**:
- AI 回复中的代码块有语法高亮和复制按钮
- 标题、列表、粗体、链接正确渲染
- 流式输出过程中 Markdown 能逐步渲染（不等到完成）
- 不影响用户消息的展示
- ChatMessage.test.tsx 更新覆盖 Markdown 渲染场景

**影响范围**:
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 主要修改
- `packages/dashboard/src/pages/Chat.tsx` — streaming 内容的渲染
- `packages/dashboard/package.json` — 新增依赖
- `packages/dashboard/src/components/chat/ChatMessage.test.tsx` — 更新测试

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:32:08

---

### [completed] SSE 连接无自动重连 — 网络抖动导致 Chat 流式响应永久中断 ✅

**ID**: chat-004
**优先级**: P1
**模块路径**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/stores/chat.ts
**发现的问题**:
Chat SSE 连接 (`createSSEConnection()` at sse.ts:82-137) 没有任何重连机制。对比同文件中的 `createMetricsSSE()` (sse.ts:158-271) 和 `createServerStatusSSE()` (sse.ts:291-398) 都有完整的自动重连（指数退避、`scheduleReconnect()`），但 Chat SSE 完全没有。

具体问题：
1. `sse.ts:128` — `while (true)` reader 循环结束后直接返回，不尝试重连
2. `sse.ts:129-134` — catch 块只调用 `callbacks.onError?.(error)`，然后结束
3. `chat.ts:560-569` — `onError` 回调直接设置 `isStreaming: false`，丢弃所有已接收的流式内容
4. 如果网络短暂断开（WiFi 切换、VPN 重连），正在进行的 AI 回复直接丢失，用户需要重新发送消息
5. 更严重的是：如果在执行阶段断开，SSE 断了但服务器端命令仍在执行，用户无法看到结果也无法取消

**改进方案**:
1. 为 `createSSEConnection()` 添加重连逻辑（参考同文件的 Metrics SSE 实现）
2. 重连时携带 sessionId，服务端支持从断点续传（或至少返回错过的事件）
3. `onError` 回调区分可重连错误（网络）和不可重连错误（401、404）
4. 添加 `onReconnecting` / `onReconnected` 回调，让 UI 显示重连状态
5. 在 chat store 中，网络中断时保留已收到的 `streamingContent`，重连后继续追加

**验收标准**:
- 网络短暂中断（<30s）后 SSE 自动恢复
- 重连过程中 UI 显示 "重连中" 提示
- 已收到的流式内容不丢失
- 401 错误不无限重连（走 token 刷新流程）
- 新增测试覆盖：重连成功、重连失败、401 不重连

**影响范围**:
- `packages/dashboard/src/api/sse.ts` — 核心修改
- `packages/dashboard/src/stores/chat.ts` — 错误处理调整
- `packages/dashboard/src/pages/Chat.tsx` — 可选：显示重连状态

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:01:07

---

### [completed] Chat 建议点击功能缺失 — EmptyState 建议卡片无法触发发送消息 ✅

**ID**: chat-005
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**:
`Chat.tsx:363-379` 的 `EmptyState` 组件展示了 4 个建议卡片（"Install nginx and configure it"、"Check disk usage and clean up" 等），但这些卡片只有 `hover:bg-muted/50` 的悬浮效果和 `cursor-default` 样式，**点击没有任何响应**。

具体代码：
```tsx
// Chat.tsx:370-371
<Card
  key={suggestion}
  className="cursor-default transition-colors hover:bg-muted/50"  // cursor-default, no onClick!
>
```

对比 ChatGPT 和 Claude.ai，空状态的建议卡片点击后应该自动将建议文本填入输入框并发送。当前实现：
1. `EmptyState` 不接受 `onSend` 回调
2. 卡片没有 `onClick` 事件处理
3. `cursor-default` 暗示不可点击，但 `hover` 效果又暗示可交互——UX 矛盾

**改进方案**:
1. 给 `EmptyState` 添加 `onSuggestionClick: (text: string) => void` prop
2. 卡片改为 `cursor-pointer`，添加 `onClick={() => onSuggestionClick(suggestion)}`
3. 在 `Chat` 组件中将 `handleSend` 传入 `EmptyState`
4. 点击建议后直接发送消息（而非只填入输入框）

**验收标准**:
- 点击建议卡片触发 `sendMessage(suggestionText)`
- 卡片有 `cursor-pointer` 样式
- 添加 `data-testid="suggestion-card-{index}"` 便于测试
- Chat.test.tsx 新增测试：点击建议卡片后消息出现在消息列表中

**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — EmptyState 组件修改
- `packages/dashboard/src/pages/Chat.test.tsx` — 新增测试

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:08:38

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
