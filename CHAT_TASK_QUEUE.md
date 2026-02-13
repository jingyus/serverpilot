# Chat/AI 对话系统改进任务队列

> 此队列专注于 Chat 和 AI 对话系统的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-13 09:53:20

## 📊 统计

- **总任务数**: 80
- **待完成** (pending): 10
- **进行中** (in_progress): 0
- **已完成** (completed): 70
- **失败** (failed): 0

## 📋 任务列表

### [completed] 聊天会话持久化到 SQLite — 消除服务器重启丢失对话的致命问题 ✅
### [completed] awaitAbort 轮询模式浪费 CPU — 200ms setInterval 未在 Promise.race 解决后清理 ✅

**ID**: chat-066
**优先级**: P0
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-chat.ts:587-601` 的 `awaitAbort()` 方法使用 `setInterval(200ms)` 轮询 `abort.aborted` 状态。当 `Promise.race([confirmation.approved, awaitAbort()])` 中 `confirmation.approved` 先解决时（用户批准命令），`awaitAbort` 的 interval 仍然继续运行直到 `abort.aborted` 最终变为 true 或进程退出。每个确认请求最多泄漏一个 200ms interval 长达 5 分钟。在高频使用场景下（agentic 模式频繁触发 YELLOW/RED 命令确认），可累积数十个空转 interval。虽然 `.unref()` 避免了进程挂起，但 CPU 仍被无意义唤醒。
**改进方案**:
1. 将 `awaitAbort` 改为基于回调/事件的模式，而非轮询：
   - 给 `AbortState` 增加 `onAbort(callback)` 方法和内部 listener 列表
   - `awaitAbort` 返回的 Promise 注册 listener，abort 时触发 resolve
2. 或者更简单：让 `awaitAbort` 返回 `{ promise, cancel }` 元组，在 `Promise.race` 解决后调用 `cancel()` 清理 interval
3. 在 `toolExecuteCommand`（行 450-453）的 `Promise.race` 之后添加清理逻辑
**验收标准**:
- `awaitAbort` 不再使用 `setInterval` 轮询
- `Promise.race` 解决后所有 timer/listener 被立即清理
- 现有 agentic-chat 测试全部通过
- 新增单元测试验证：confirmation 解决后 abort interval 不再运行
**影响范围**:
- `packages/server/src/ai/agentic-chat.ts` — `awaitAbort` 方法重构 + `toolExecuteCommand` 调用处
- `packages/server/tests/ai/agentic-chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:29:44

---

### [completed] trimMessagesIfNeeded 在仅剩 3 条消息时不保证 token 预算 — 可能超出 maxTokens ✅

**ID**: chat-067
**优先级**: P0
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-message-utils.ts:63-66` 的 while 循环在 `messages.length > 3` 时才继续裁剪。当裁剪到仅剩 3 条消息后，即使 `estimateMessagesTokens(messages) > maxTokens`，循环也会退出。例如：如果第一条 user 消息包含 50K tokens 的文件内容，加上最近一轮 assistant+user 共 110K tokens，总计 160K > 150K maxTokens，函数返回时消息仍超预算。这会导致后续 Anthropic API 调用因 token 超限而失败。
**改进方案**:
1. 在 while 循环退出后增加二次检查：如果剩余 3 条消息仍超预算，对最早的消息内容进行截断（保留末尾部分）
2. 截断策略：估算需要移除的 token 数，按字符比例截断第一条消息的 content，保留 `[Content truncated: ~{N}K tokens removed]` 标记
3. 如果第一条消息是 array content（tool results），移除最早的 content blocks 直到预算内
**验收标准**:
- 无论消息数量多少，函数返回时 `estimateMessagesTokens(messages) <= maxTokens` 始终成立
- 截断后注入通知让 AI 知道上下文被截断
- 现有 trim 测试通过 + 新增边界场景测试（3 条超大消息）
**影响范围**:
- `packages/server/src/ai/agentic-message-utils.ts` — 添加二次截断逻辑
- `packages/server/tests/ai/agentic-message-utils.test.ts` — 新增边界测试
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:39:28

---

### [completed] chat 路由 profileMgr.getProfile 在 SSE 流创建前调用 — 异常导致 HTTP 500 而非 SSE 错误事件 ✅

**ID**: chat-068
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:162-163` 在 `streamSSE(c, ...)` 之前调用 `profileMgr.getProfile(serverId, userId)`。如果 getProfile 抛出异常（数据库错误、profile 损坏等），异常发生在 SSE 流创建之前，Hono 框架会返回 HTTP 500 响应。前端 SSE 客户端收到的是标准 HTTP 错误响应而非 SSE 事件，无法触发 `onError` 回调——用户看到静默失败或浏览器控制台报错。注意：execute 路由（行 441-455）已经在 SSE 流内部正确处理了 getProfile 异常，说明这是一个遗漏，而非设计选择。
**改进方案**:
1. 将 `profileMgr.getProfile` 调用移到 `streamSSE` 回调内部（行 165 之后）
2. 用 try/catch 包裹，失败时通过 `safeWriteSSE` 发送错误事件给前端
3. profile 加载失败后仍可选择无 profile 模式继续对话（降级而非终止）
**验收标准**:
- `getProfile` 异常时前端收到 SSE error 事件（非 HTTP 500）
- 用户看到友好错误消息而非空白/断连
- 现有 chat route 测试通过
- 新增测试：mock getProfile 抛异常，验证 SSE 流仍正确关闭
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — POST `/:serverId` 路由重构
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:44:40

---

### [completed] 前端 ChatMessage 组件无消息复制和重新生成操作 — 对话交互体验远低于同类产品 ✅

**ID**: chat-069
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `ChatMessage.tsx:35-93` 是纯展示组件，无任何交互功能。对比 ChatGPT/Claude.ai：(1) 无"复制消息"按钮——用户只能手动选择文本复制，assistant 消息含 Markdown 时选择困难；(2) 无"重新生成"按钮——AI 回复不满意时无法重试，必须重新输入相同问题；(3) 无消息 hover 操作栏——现代 AI Chat 产品都有消息 hover 时显示的操作按钮组。MarkdownRenderer（行 14-58）仅支持代码块复制，不支持整条消息复制。
**改进方案**:
1. 添加消息 hover 操作栏组件 `MessageActions`：
   - 复制按钮（assistant 消息：复制原始 markdown；user 消息：复制纯文本）
   - 重新生成按钮（仅 assistant 消息最后一条）
2. 操作栏样式：absolute 定位在消息右上角，hover 时显示
3. 复制使用 `navigator.clipboard.writeText()`，成功后显示 Toast 通知
4. 重新生成：调用 `chatStore.regenerateLastResponse()` → 删除最后一条 assistant 消息 → 重新发送最后一条 user 消息
**验收标准**:
- 消息 hover 时显示操作栏（包含复制和重新生成按钮）
- 点击复制后 Toast 提示"已复制"
- 重新生成删除旧回复并触发新的 AI 请求
- 移动端长按触发操作栏
- 添加 data-testid + 单元测试
**影响范围**:
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 添加操作栏
- `packages/dashboard/src/components/chat/ChatMessage.test.tsx` — 新增测试
- `packages/dashboard/src/stores/chat.ts` — 添加 `regenerateLastResponse` action
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:50:12

---

### [completed] SessionSidebar 在移动端完全隐藏且无替代入口 — 手机用户无法管理会话 ✅

**ID**: chat-070
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx:68` 使用 `hidden lg:block` 类名，在 `<1024px` 屏幕宽度下完全隐藏。移动端和平板用户完全无法：(1) 查看历史会话列表；(2) 切换到旧会话；(3) 删除会话。Chat.tsx 中也无任何替代入口（汉堡菜单、底部 sheet、侧滑手势）。这意味着移动端用户每次进入 Chat 页面只能使用新会话，无法访问任何历史对话。
**改进方案**:
1. 在 Chat header（`ChatHeader.tsx`）添加移动端"会话列表"按钮（仅在 `lg:` 以下显示）
2. 点击后展示 Drawer/Sheet 组件包裹 `SessionSidebar`
3. Drawer 从左侧滑入，背景半透明遮罩
4. 选择会话或点击遮罩后自动关闭 Drawer
5. 使用 `@headlessui/react` Dialog 或自定义 Drawer 组件
**验收标准**:
- 移动端显示"会话列表"图标按钮
- 点击后左侧 Drawer 展示完整 SessionSidebar
- 选择会话后 Drawer 自动关闭
- 遮罩点击关闭 Drawer
- 响应式：`lg:` 以上仍使用原有内联 sidebar
- 添加 data-testid + 测试
**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — 添加 Drawer 逻辑
- `packages/dashboard/src/components/chat/ChatHeader.tsx` — 添加移动端按钮
- `packages/dashboard/src/pages/Chat.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: 2026-02-13 09:53:20

---

### [pending] 前端执行输出 outputs 字符串拼接无上限 — 大量输出可能冻结浏览器

**ID**: chat-071
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/
**发现的问题**: `chat-execution.ts:83` 和 `chat-execution.ts:368` 中 `onOutput` 回调将新内容拼接到 `execution.outputs[stepId]`：`(s.execution.outputs[parsed.stepId] ?? '') + parsed.content`。此字符串无任何长度限制。如果 agent 执行的命令产生大量输出（如 `find /` 或日志 tail），outputs 字符串可增长到数 MB 甚至更多。问题链：(1) 字符串拼接 O(n) 复杂度，每次 onOutput 都复制整个字符串；(2) `ExecutionLog.tsx:175` 将完整字符串传入 `parseAnsi()` 重新解析；(3) React 因 state 变化频繁 re-render 整个输出 DOM。100K+ 行输出时浏览器将明显卡顿或冻结。
**改进方案**:
1. 添加输出上限常量 `MAX_OUTPUT_CHARS = 500_000`（约 500KB）
2. 当 `outputs[stepId].length > MAX_OUTPUT_CHARS` 时，截断头部保留尾部
3. 截断时在输出开头插入 `[... 早期输出已截断，共 {N} 字符 ...]\n`
4. 优化 `parseAnsi` 调用：缓存已解析的部分，只解析新增内容（增量解析）
**验收标准**:
- 输出字符串不超过 MAX_OUTPUT_CHARS
- 截断时有用户可见提示
- 高频 onOutput（100次/秒）不导致 UI 卡顿
- 现有 execution 测试通过 + 新增截断测试
**影响范围**:
- `packages/dashboard/src/stores/chat-execution.ts` — onOutput 回调添加截断逻辑
- `packages/dashboard/src/stores/chat-execution.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---

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

### [pending] chat 路由并发请求同 session 无互斥 — 消息顺序错乱和重复 AI 处理

**ID**: chat-073
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:112-364` POST `/:serverId` 路由无任何并发控制。当两个请求携带相同 `sessionId` 同时到达时：(1) 两者都调用 `getOrCreate`（行 153）获得同一 session；(2) 两者都调用 `addMessage`（行 156）添加 user 消息——消息顺序取决于 event loop 调度；(3) 两者都启动 AI 处理（行 180 或 290）——AI 收到两个不同用户消息的上下文；(4) 两者都写回 assistant 消息（行 203 或 309）——对话历史变为 user-user-assistant-assistant 交错。前端虽有重入保护（chat-010 已修复），但网络延迟或浏览器多 tab 场景仍可能触发。
**改进方案**:
1. 添加 per-session 锁机制：`sessionLocks: Map<sessionId, Promise<void>>`
2. 每个 chat 请求先 await 当前 session 的锁 Promise，然后设置新锁
3. 锁在 SSE 流完成（finally 块）后释放
4. 实现为简单的串行队列：后到的请求等前一个完成后再处理
5. 添加超时保护（30s），避免死锁
**验收标准**:
- 同一 session 的 chat 请求串行处理
- 不同 session 的请求不受影响（并行）
- 锁超时后自动释放（不死锁）
- 现有 chat route 测试通过 + 新增并发测试
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — 添加 session 锁
- `packages/server/tests/api/routes/chat.test.ts` — 新增并发测试
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] SessionSidebar 无会话重命名功能 — 只能依赖 lastMessage 预览识别会话

**ID**: chat-074
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx:112-113` 显示 `session.lastMessage ?? t('chat.newSession')` 作为会话标题。用户无法重命名会话，只能通过最后一条消息的截断预览区分不同会话。当多个会话讨论类似主题时（如"安装 nginx"和"配置 nginx"），预览文本几乎相同，难以区分。对比 ChatGPT/Claude.ai 都支持会话重命名（双击标题或编辑图标）。`SessionItem` 接口（行 9-14）也无 `title` 字段。
**改进方案**:
1. 给 `SessionItem` 接口添加 `title?: string` 字段
2. 在 session 项添加"编辑"图标按钮（与删除按钮并列，hover 时显示）
3. 点击后切换为内联编辑模式（input 替换 p 标签）
4. Enter 确认，Escape 取消
5. 调用 `PATCH /chat/:serverId/sessions/:sessionId` API 更新标题
**验收标准**:
- 会话项 hover 显示编辑图标
- 点击进入内联编辑模式
- Enter 保存，Escape 取消
- 保存后标题持久化（刷新后仍显示）
- data-testid + 测试覆盖
**影响范围**:
- `packages/dashboard/src/components/chat/SessionSidebar.tsx` — 编辑 UI
- `packages/dashboard/src/stores/chat-sessions.ts` — renameSession action
- `packages/dashboard/src/components/chat/SessionSidebar.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] 后端 session API 无重命名端点 — 缺少 PATCH /sessions/:id 支持前端会话重命名

**ID**: chat-075
**优先级**: P2
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:511-560` 定义了 sessions 的 GET（列表）、GET（详情）、DELETE 端点，但缺少 PATCH/PUT 端点用于更新会话元数据（标题/名称）。`SessionManager` 和底层 `SessionRepository` 也无 `updateSession` 或 `renameSession` 方法。sessions 数据库表（`chat_sessions`）是否有 `title` 列需确认。此为前端会话重命名功能（chat-074）的后端依赖。
**改进方案**:
1. 数据库层：确认 `chat_sessions` 表有 `title` 列，如无则添加 migration
2. `SessionRepository` 添加 `updateTitle(sessionId, userId, title)` 方法
3. `SessionManager` 添加 `renameSession(sessionId, userId, title)` 方法
4. 添加 `PATCH /chat/:serverId/sessions/:sessionId` 路由，body: `{ title: string }`
5. Zod schema 验证 title 长度（1-100 字符）
**验收标准**:
- PATCH 端点正常工作，返回 `{ success: true }`
- 标题持久化到数据库
- 权限检查：只能重命名自己的会话
- listSessions 返回值包含 title 字段
- 路由测试覆盖
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — 新增 PATCH 路由
- `packages/server/src/core/session/manager.ts` — 新增 renameSession
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] 前端长消息列表无虚拟滚动 — 500+ 条消息时滚动性能严重下降

**ID**: chat-076
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/
**发现的问题**: `Chat.tsx` 消息列表使用简单的 `messages.map()` 渲染所有消息到 DOM。每条消息包含 `ChatMessage` 组件，assistant 消息还会触发 `MarkdownRenderer`（react-markdown + syntax highlighter）。当会话有 200+ 条消息时：(1) 初始渲染时间线性增长；(2) 每次新消息触发整个列表 re-render；(3) 所有代码块的 syntax highlighting 同时计算。`chat-sessions.ts:42-44` 的 `loadSession` 也一次性加载全部消息无分页。参考 ChatGPT：使用虚拟滚动只渲染可视区域 + 上下缓冲区的消息。
**改进方案**:
1. 引入 `react-virtuoso` 库实现虚拟滚动（专为 chat UI 设计，支持反向滚动和动态高度）
2. 替换 `messages.map()` 为 `<Virtuoso data={messages} itemContent={renderMessage} />`
3. 保留现有自动滚动逻辑（Virtuoso 内置 `followOutput` prop）
4. ChatMessage 组件添加 `React.memo` 避免不必要的 re-render
**验收标准**:
- 500 条消息的会话加载和滚动流畅（FPS > 30）
- 自动滚动到底部行为不变
- 流式消息输出时滚动平滑
- 现有 Chat.test.tsx 测试通过
**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — 消息列表虚拟化
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 添加 React.memo
- `packages/dashboard/package.json` — 添加 react-virtuoso 依赖
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] MessageInput 无 Escape 取消流式和 Ctrl+K 搜索快捷键 — 键盘操作效率低

**ID**: chat-077
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `MessageInput.tsx:40-48` 仅处理 `Enter`/`Shift+Enter` 键盘事件。缺少：(1) `Escape` 键取消流式输出——当前必须用鼠标点击"停止"按钮（行 95-107），频繁使用 Chat 时效率低下；(2) 无任何全局快捷键支持。对比 Claude.ai：Escape 取消生成，`/` 聚焦输入框。当前 `onCancel` prop 已存在（行 13），只需在 keydown 事件中调用即可。
**改进方案**:
1. 在 `handleKeyDown` 中添加 `Escape` 处理：当 `isStreaming` 时调用 `onCancel()`
2. 添加全局 keydown listener（在 Chat.tsx 中）：
   - `Escape`：取消流式 / 关闭确认对话框
   - `/`：聚焦输入框（当前无焦点在输入框时）
3. 添加 `aria-keyshortcuts` 属性提升可访问性
**验收标准**:
- 按 Escape 可取消正在进行的流式输出
- 快捷键不与系统/浏览器快捷键冲突
- 添加 testid + 键盘事件测试
**影响范围**:
- `packages/dashboard/src/components/chat/MessageInput.tsx` — Escape 键处理
- `packages/dashboard/src/pages/Chat.tsx` — 全局快捷键 listener
- `packages/dashboard/src/components/chat/MessageInput.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] chat-execution.ts 超过 500 行软限制（652 行）— SSE 回调构建器可提取

**ID**: chat-078
**优先级**: P3
**模块路径**: packages/dashboard/src/stores/
**发现的问题**: `chat-execution.ts` 当前 652 行，超过项目 500 行软限制。主要体积来自 `buildStreamingCallbacks` 函数（约 300 行），其中包含 14+ 个 SSE 事件处理器。每个处理器逻辑独立（JSON.parse → Zod validate → set state），适合提取到独立模块。此外 `createConfirmPlan` 和 `createEmergencyStop` 也各约 80 行，与 streaming 回调逻辑无关。
**改进方案**:
1. 提取 `buildStreamingCallbacks` 到新文件 `chat-sse-handlers.ts`
2. 每个 SSE 事件处理器作为独立的命名函数导出
3. `chat-execution.ts` 只保留 `createConfirmPlan`、`createRespondToStep`、`createEmergencyStop` 等高层流程
4. 保持 `get()`/`set()` 通过参数注入（避免循环依赖）
**验收标准**:
- `chat-execution.ts` 降到 400 行以下
- `chat-sse-handlers.ts` < 350 行
- 所有现有 chat-execution 测试通过
- 无循环依赖
**影响范围**:
- `packages/dashboard/src/stores/chat-execution.ts` — 拆分
- `packages/dashboard/src/stores/chat-sse-handlers.ts` — 新文件
- `packages/dashboard/src/stores/chat-execution.test.ts` — 调整 import
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] SessionSidebar 无历史会话搜索 — 会话多时无法快速定位目标对话

**ID**: chat-079
**优先级**: P3
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx` 整个组件无搜索/过滤功能。会话列表按日期分组（today/yesterday/thisWeek/older），但当用户积累 50+ 会话后，只能逐个展开分组查找。每个 session 仅显示 `lastMessage` 截断预览（行 112-113），无法按消息内容、命令、服务器等维度搜索。对比 ChatGPT 和 Claude.ai 的侧边栏都有搜索框支持全文搜索。
**改进方案**:
1. 在 SessionSidebar 顶部（行 71 后）添加搜索输入框
2. 搜索逻辑：客户端过滤 `sessions` 数组，匹配 `lastMessage` 和 `title`（如果有）
3. 搜索使用 debounce（300ms）避免频繁过滤
4. 匹配结果高亮显示关键词
5. 无匹配时显示空状态提示
**验收标准**:
- 搜索框输入后实时过滤会话列表
- 支持中英文搜索
- 清空搜索恢复完整列表
- data-testid + 测试覆盖
**影响范围**:
- `packages/dashboard/src/components/chat/SessionSidebar.tsx` — 添加搜索 UI + 过滤逻辑
- `packages/dashboard/src/components/chat/SessionSidebar.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---

### [pending] Agentic 确认超时 resolve(false) 与用户 confirm 请求的 TOCTOU 竞态 — 用户批准被忽略

**ID**: chat-080
**优先级**: P3
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:192-198` 的确认超时回调和 `chat.ts:387-394` 的用户确认端点之间存在 TOCTOU（Time-of-Check-Time-of-Use）竞态：(1) 超时定时器触发（行 193），执行 `pendingConfirmations.delete(confirmId)` + `resolve(false)`；(2) 几乎同时，用户点击"批准"，confirm 端点检查 `pendingConfirmations.get(body.confirmId)`（行 387）；(3) 如果 delete 在 get 之前执行，用户收到 404 "No pending confirmation found"——但超时已 resolve(false) 导致命令被拒绝。由于 Promise 只 resolve 一次，如果 get 在 delete 之前执行（取到了 entry），clearTimeout 和 resolve(true) 都正常。但第一种时序下用户体验很差——刚好在超时边界点击批准被拒绝且收到错误。
**改进方案**:
1. 在 confirm 端点增加一个短暂的宽限期检查：如果 confirmId 不在 Map 中，检查是否在 1 秒内刚被超时清除（用一个 `recentlyExpired: Set<confirmId>` 追踪）
2. 如果是刚过期的确认，返回 `{ success: false, message: 'Confirmation expired', expired: true }` 而非 404
3. 前端根据 `expired: true` 显示"确认已超时"而非"未找到确认"
**验收标准**:
- 超时边界点击确认返回友好的过期提示（非 404）
- recentlyExpired 条目 10 秒后自动清理
- 正常流程不受影响
- 新增测试覆盖竞态场景
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — confirm 端点 + recentlyExpired 追踪
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

### [completed] pendingConfirmations 在 SSE 断连时未清理 — 定时器和 Promise 泄漏 ✅

**ID**: chat-050
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 51-54 行声明的 `pendingConfirmations` Map，在第 142-152 行创建 confirmation 时设置了 5 分钟超时定时器，但当 SSE 流断连（客户端关闭页面）时，没有任何清理机制。定时器继续运行直到 5 分钟后才自然过期。同时 agentic-chat.ts 第 502 行 `await confirmation.approved` 会无限挂起，直到超时 resolve(false)。问题链路：(1) 用户关闭页面 → (2) stream.onAbort 在 agentic-chat.ts:196 设置 abort.aborted=true → (3) 但 chat.ts 中的 pendingConfirmations 定时器仍在运行 → (4) Promise 挂起最多 5 分钟 → (5) 内存泄漏。
**改进方案**: 在 chat.ts 的 agentic 模式 SSE handler 中注册 `stream.onAbort()` 回调，遍历当前 session 关联的 pendingConfirmations，调用 `clearTimeout(timer)` 并 `resolve(false)`，然后从 Map 中删除。可以通过 confirmId 的前缀 `${session.id}:` 来过滤当前 session 的 confirmations。
**验收标准**: (1) SSE 断连后 5 秒内相关 pendingConfirmations 条目被清除; (2) 无 5 分钟定时器残留; (3) agentic 循环不再挂起等待已断连客户端的确认; (4) 测试覆盖断连清理场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:33:19

---

### [completed] Legacy 模式 SSE 错误处理器中 writeSSE 可能二次抛出 — 流已关闭时写入无 try/catch ✅

**ID**: chat-051
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 301-314 行的 legacy 模式 catch 块中，`await stream.writeSSE({ event: 'message', ... })` 和 `await stream.writeSSE({ event: 'complete', ... })` 没有 try/catch 保护。如果客户端已断连（流已关闭），这两个 await 会抛出异常，导致错误从 catch 块逃逸到全局错误处理器，SSE 流非正常关闭。同样的问题也存在于 agentic 模式的 catch 块（第 174-181 行）。对比 agentic-chat.ts 内部的 `writeSSE` 方法（第 684-696 行）有 try/catch 保护，但 chat.ts 路由层没有使用该封装。
**改进方案**: 将 catch 块中的 SSE 写入包裹在 try/catch 中，或提取为 `safeWriteSSE()` 辅助函数。失败时仅记录日志，不再重新抛出。同时为 agentic 模式的 catch 块（第 174-181 行）应用相同修复。
**验收标准**: (1) 客户端断连后 catch 块中的 SSE 写入不会抛出未捕获异常; (2) 错误日志正确记录; (3) 两个模式（agentic/legacy）的 catch 块都有保护
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:39:44

---

### [completed] Legacy 模式 RAG 搜索异常未捕获 — ragPipeline.search() 可能抛出未处理错误 ✅

**ID**: chat-052
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 208-216 行的 RAG 搜索逻辑没有 try/catch 包裹。`ragPipeline.search(body.message!)` 如果抛出异常（如向量存储损坏、内存不足），错误会直接传播到上层 try/catch（第 202-314 行），导致整个 AI 对话请求失败，用户看到通用错误消息而非优雅降级。对比 agentic-chat.ts 第 656-669 行有完整的 try/catch 包裹 RAG 搜索，这里是遗漏。
**改进方案**: 为 RAG 搜索添加 try/catch，失败时记录 warn 日志并继续执行（knowledgeContext 保持 undefined），实现与 agentic 模式一致的优雅降级。
**验收标准**: (1) RAG 搜索失败不阻断 AI 对话; (2) 失败时有 warn 级别日志; (3) 对话正常继续（无知识库上下文）; (4) 单元测试覆盖 RAG 异常场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:48:07

---

### [completed] agentic-chat.ts 超出 800 行硬限制 — 844 行需要拆分 ✅

**ID**: chat-053
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 当前 844 行，超出 800 行硬限制 44 行。文件包含：(1) 工具定义和 Schema（第 30-119 行，约 90 行）; (2) AgenticChatEngine 类（第 163-702 行，约 540 行）; (3) buildAgenticSystemPrompt 函数（第 704-734 行，约 30 行）; (4) 消息裁剪工具函数（第 736-826 行，约 90 行）; (5) 单例管理（第 828-843 行）。
**改进方案**: 将以下部分提取到独立文件：(1) `agentic-tools.ts` — 工具定义、输入 Schema（ExecuteCommandInputSchema 等）; (2) `agentic-prompts.ts` — buildAgenticSystemPrompt 函数; (3) `agentic-message-utils.ts` — extractBlockText、estimateMessageTokens、trimMessagesIfNeeded。主文件保留 AgenticChatEngine 类和单例管理，约 550 行。
**验收标准**: (1) agentic-chat.ts 降至 600 行以内; (2) 拆分后的文件各不超过 200 行; (3) 所有现有测试通过; (4) 导入路径正确
**影响范围**: packages/server/src/ai/agentic-chat.ts, 新文件 agentic-tools.ts, agentic-prompts.ts, agentic-message-utils.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:12:01

---

### [completed] common-errors.ts 超出 800 行硬限制 — 853 行需要拆分 ✅

**ID**: chat-054
**优先级**: P0
**模块路径**: packages/server/src/ai/common-errors.ts
**发现的问题**: common-errors.ts 当前 853 行，超出 800 行硬限制 53 行。文件主要由 ERROR_RULES 纯数据数组（约 600 行）和匹配函数（约 150 行）组成。虽然 MEMORY.md 提到"pure data, exceeds 500 soft limit but acceptable"，但现在已经超过 800 行硬限制，不再 acceptable。
**改进方案**: 按错误类别拆分 ERROR_RULES 数据：(1) `error-rules-permission.ts` — 权限类规则; (2) `error-rules-network.ts` — 网络类规则; (3) `error-rules-dependency.ts` — 依赖和构建类规则; (4) `common-errors.ts` 保留类型定义、匹配函数、以及合并后的 ERROR_RULES 导出。或者更简洁地：将整个 ERROR_RULES 数组提取到 `error-rules-data.ts`，主文件只保留函数。
**验收标准**: (1) common-errors.ts 降至 300 行以内; (2) 数据文件可超 500 行但不超 800 行; (3) `matchCommonErrors()`、`getBestMatch()` 等函数行为不变; (4) 所有测试通过
**影响范围**: packages/server/src/ai/common-errors.ts, 新文件(s)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:17:25

---

### [completed] Agentic 流式 SSE 写入失败被静默吞没 — .catch(() => {}) 未设置 abort 状态 ✅

**ID**: chat-055
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 335 行 `this.writeSSE(...).catch(() => {})` 和第 346 行 `}, abort).catch(() => {})` 在 `response.on('text')` 和 `response.on('contentBlock')` 事件处理器中，SSE 写入失败被完全静默吞没。然而第 684-696 行的 `writeSSE()` 方法在内部 catch 中会设置 `abort.aborted = true`。这里的外层 `.catch(() => {})` 实际上永远不会触发（因为 writeSSE 内部已 catch），但如果 writeSSE 内部逻辑变更，外层 catch 会隐藏真正的错误。更重要的是，这种模式掩盖了意图 — 读者不清楚失败是否应该导致 abort。
**改进方案**: 移除多余的 `.catch(() => {})` 包裹，因为 `writeSSE()` 内部已经 catch 并设置了 abort 状态。如果确实需要处理 writeSSE 本身的异常（比如 JSON.stringify 失败），添加明确的日志而非空 catch。
**验收标准**: (1) 移除冗余的 `.catch(() => {})`; (2) SSE 写入失败时 abort 状态被正确设置（由 writeSSE 内部处理）; (3) 无静默错误吞没
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:35:25

---

### [completed] Agentic 确认流在客户端断连后仍继续等待 — confirmation.approved 未与 abort 联动 ✅

**ID**: chat-056
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 491-514 行的确认流程中，第 502 行 `const approved = await confirmation.approved` 会无条件等待用户确认。如果客户端已断连（abort.aborted=true），这个 await 仍然会挂起最多 5 分钟（由 chat.ts 的 CONFIRM_TIMEOUT_MS 控制）。虽然第 517-520 行有 abort 检查，但只在确认 resolve 后才到达。这意味着一个已断连的客户端会让服务端的 agentic 循环挂起 5 分钟，占用内存和协程资源。
**改进方案**: 使用 `Promise.race()` 将 `confirmation.approved` 与一个 abort 感知的 Promise 竞争。当 abort.aborted 为 true 时立即 resolve(false)。可以实现为：`const approved = await Promise.race([confirmation.approved, this.waitForAbort(abort)])` 其中 waitForAbort 定期检查 abort 状态或监听 abort 事件。
**验收标准**: (1) 客户端断连后确认等待在 1 秒内结束; (2) 不再有 5 分钟挂起; (3) abort 后工具执行不会继续; (4) 测试覆盖断连+确认竞态场景
**影响范围**: packages/server/src/ai/agentic-chat.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:39:10

---

### [completed] Agentic 初始消息数组未做 token 预检 — 超长历史可能导致首次 API 调用失败 ✅

**ID**: chat-057
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 205-216 行构建初始消息数组时，将完整的 conversationHistory 和当前 userMessage 追加到 messages 中，但没有在进入循环（第 222 行 `for (let turn = 0; turn < MAX_TURNS; turn++)`）之前调用 `trimMessagesIfNeeded()`。裁剪只在每轮结束后执行（第 280 行附近）。如果用户有很长的对话历史（数百条消息），初始消息可能就超过 MAX_MESSAGES_TOKENS（150K tokens），导致第一次 Anthropic API 调用因超出上下文窗口而失败。
**改进方案**: 在进入循环前增加一次 `trimMessagesIfNeeded(messages)` 调用，确保初始消息数组在 token 预算内。
**验收标准**: (1) 超长对话历史不会导致首次 API 调用失败; (2) 裁剪后保留最新消息和首条用户消息; (3) 测试覆盖超长历史场景
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:41:51

---

### [completed] 前端 sendMessage 无重入保护 — 快速连续发送导致重复消息 ✅

**ID**: chat-058
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: chat.ts（store）第 60-97 行的 `sendMessage()` 没有重入保护。虽然第 90 行会 `getActiveHandle()?.abort()` 中止前一个 SSE 连接，但第 74-88 行的 `set()` 调用会立即将新的 userMsg 追加到 messages 数组。如果用户快速点击两次发送（在 isStreaming 状态更新导致按钮禁用之前），两条用户消息都会被添加到 messages 中，并且第一个 SSE 连接被中止后，第二个连接的 onMessage 回调仍可能收到来自第一个请求的响应（因为服务端可能在 abort 信号到达前已开始流式输出）。
**改进方案**: 在 `sendMessage` 开头检查 `if (get().isStreaming) return;` 防止重入。或者在 MessageInput 组件层面在 isStreaming 为 true 时禁用发送（Chat.tsx 第 434-445 行的 suggestion cards 也需要同样处理）。
**验收标准**: (1) 快速连续点击不会发送重复消息; (2) isStreaming 期间发送操作被阻止; (3) suggestion cards 点击也受保护; (4) 测试覆盖快速连续发送场景
**影响范围**: packages/dashboard/src/stores/chat.ts, packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:44:51

---

### [completed] Chat.tsx EmptyState suggestion cards 无防重复点击 — 快速点击发送多条消息 ✅

**ID**: chat-059
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: Chat.tsx 第 433-445 行的 EmptyState 组件中，suggestion cards 的 `onClick={() => onSuggestionClick(suggestion)}` 没有任何防抖或禁用逻辑。点击后 `onSuggestionClick` 调用 `sendMessage()`，但在 isStreaming 状态更新并触发重渲染之前（React 批量更新机制），用户可以再次点击另一个 card，导致发送第二条消息并立即 abort 第一个 SSE 连接。
**改进方案**: (1) 在 EmptyState 组件中接收 `isStreaming` prop，当 `isStreaming` 为 true 时给 cards 添加 `pointer-events-none opacity-50` 样式; (2) 或在 sendMessage 中增加重入保护（与 chat-058 合并处理）。
**验收标准**: (1) 点击 suggestion card 后其他 cards 立即变为不可点击状态; (2) 不会发送重复消息
**影响范围**: packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:54:17

---

### [completed] session/manager.ts 超过 500 行软限制 — 715 行可提取缓存和重试队列逻辑 ✅

**ID**: chat-060
**优先级**: P2
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: manager.ts 当前 715 行，超出 500 行软限制 215 行。文件包含：(1) 类型定义（第 30-80 行）; (2) 缓存配置和 CacheEntry（第 82-130 行）; (3) SessionManager 类（第 132-700 行，含 LRU 缓存管理、重试队列、上下文构建、持久化等多个职责）; (4) 单例管理（第 702-715 行）。SessionManager 类承担了过多职责，违反单一职责原则。
**改进方案**: 提取以下独立模块：(1) `session-cache.ts` — LRU 缓存逻辑（get/set/evict/sweep/protect），约 150 行; (2) `session-retry-queue.ts` — 重试队列处理逻辑（processRetryQueue/markMessagePersisted），约 80 行。主文件保留 SessionManager 公共 API 和编排逻辑，约 480 行。
**验收标准**: (1) manager.ts 降至 500 行以内; (2) 拆分后模块独立可测试; (3) 所有现有测试通过; (4) SessionManager 公共 API 不变
**影响范围**: packages/server/src/core/session/manager.ts, 新文件 session-cache.ts, session-retry-queue.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 07:58:22

---

### [completed] Chat.tsx 超过 500 行软限制 — 631 行应提取子组件 ✅

**ID**: chat-061
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: Chat.tsx 当前 631 行，超出 500 行软限制 131 行。文件在同一个文件中定义了 4 个组件：(1) ChatPage 主组件（第 1-356 行）; (2) ChatHeader（第 357-401 行，45 行）; (3) EmptyState（第 403-449 行，47 行）; (4) ServerSelector（第 451-499 行，49 行）; (5) SessionSidebar（第 516-631 行，115 行）。以及一个工具函数 getSessionDateGroup（第 501-514 行）。
**改进方案**: 将以下组件提取到 `packages/dashboard/src/components/chat/` 目录：(1) `ChatHeader.tsx`; (2) `ChatEmptyState.tsx`; (3) `ServerSelector.tsx`; (4) `SessionSidebar.tsx`（含 getSessionDateGroup 工具函数）。主文件只保留 ChatPage 主组件和路由逻辑。
**验收标准**: (1) Chat.tsx 降至 400 行以内; (2) 各子组件文件不超过 150 行; (3) 所有现有测试通过; (4) UI 行为和渲染不变
**影响范围**: packages/dashboard/src/pages/Chat.tsx, 新文件 ChatHeader.tsx, ChatEmptyState.tsx, ServerSelector.tsx, SessionSidebar.tsx
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 08:05:32

---

### [completed] SSE 连接无并发上限 — 快速切换服务器/会话可能耗尽浏览器连接数 ✅

**ID**: chat-062
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: sse.ts 第 102-220 行的 `createSSEConnection()` 每次调用创建新的 SSE 连接（AbortController + fetch），没有并发连接数限制。虽然 chat store 的 `sendMessage`（第 90 行）会在创建新连接前 abort 旧连接，但 abort 是异步的 — 旧连接可能尚未关闭时新连接已建立。加上 `createGetSSE`（第 244 行）用于 metrics/status 流，浏览器对同一域名的并发连接限制通常为 6 个（HTTP/1.1），可能被耗尽。
**改进方案**: 在 sse.ts 模块级维护一个活跃连接 Set，`createSSEConnection` 创建前检查上限（如最大 3 个 POST SSE），超出时先同步关闭最旧的连接。或在 chat store 层面确保 abort 完成后才创建新连接。
**验收标准**: (1) 任意时刻最多 N 个活跃 SSE 连接; (2) 旧连接在新连接创建前被完全关闭; (3) 不影响 metrics SSE 流; (4) 测试覆盖连接数限制场景
**影响范围**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 08:07:45

---

### [completed] chat store clearError 未重置 isReconnecting 标志 — 关闭错误后可能显示过时的重连状态 ✅

**ID**: chat-063
**优先级**: P2
**模块路径**: packages/dashboard/src/stores/chat.ts
**发现的问题**: chat.ts（store）第 180 行 `clearError: () => set({ error: null })` 只清除 error 状态，不重置 `isReconnecting`。如果 SSE 连接在重连过程中触发错误（如达到最大重连次数），UI 会同时显示错误提示和 "Reconnecting..." 状态栏。用户点击 dismiss 关闭错误提示后，isReconnecting 仍为 true，重连状态栏继续显示。
**改进方案**: `clearError` 中同时重置 `isReconnecting: false`。
**验收标准**: (1) 关闭错误提示后不再显示重连状态; (2) 测试验证 clearError 后 isReconnecting 为 false
**影响范围**: packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 08:12:21

---

### [completed] Agentic 工具输入验证失败时前端无感知 — 只返回错误给 AI 不发 SSE ✅

**ID**: chat-064
**优先级**: P2
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 398-430 行的 `executeToolCall()` 中，当 `ExecuteCommandInputSchema.safeParse(input)` 等 Zod 验证失败时，只返回错误字符串给 AI（如 `"Error: Invalid tool input for execute_command: ..."`），但不发送任何 SSE 事件通知前端。前端无法知道 AI 生成了无效的工具调用。这可能导致 AI 反复重试无效输入，用户只看到 AI 在"思考"但没有任何进展反馈。
**改进方案**: 在验证失败时发送 `tool_result` SSE 事件（status: 'validation_error'），让前端展示具体的验证错误信息。同时记录 warn 日志帮助调试。
**验收标准**: (1) 工具输入验证失败时前端收到 tool_result 事件; (2) 前端可展示验证错误信息; (3) 日志记录验证失败详情
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 08:17:08

---

### [completed] Execute 路由 profileMgr.getProfile 异常未被 SSE 流捕获 — 抛出时流未初始化 ✅

**ID**: chat-065
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 394-395 行 `const serverProfile = await profileMgr.getProfile(serverId, userId)` 在 `streamSSE()` 回调内部但在 `executePlanSteps()` 之前调用。如果 profile 加载失败（如数据库连接断开），异常会从 streamSSE 回调中抛出，Hono 的 streamSSE 会将其作为 500 错误返回，但此时客户端可能已经建立了 SSE 连接并在等待事件。客户端会看到连接突然关闭而非收到明确的错误事件。
**改进方案**: 将 profile 加载包裹在 try/catch 中，失败时通过 SSE 发送 complete 事件（success: false, error: 'profile load failed'），然后正常结束流。
**验收标准**: (1) profile 加载失败时客户端收到明确的 SSE 错误事件; (2) 不再看到无提示的连接断开; (3) 测试覆盖 profile 加载失败场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 08:19:33

### [completed] Agentic tool_use input 缺少运行时验证 — AI 返回畸形输入可导致命令注入 ✅

**ID**: chat-033
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `executeToolCall()` 在第 394、401、407 行对 AI 返回的 tool `input` 直接使用 `as` 类型断言，无任何运行时验证。例如第 394 行 `input as { command: string; description: string; timeout_seconds?: number }` — 如果 Claude 返回 `{ command: 123 }` (number 而非 string)，后续 `toolExecuteCommand` 会将 `123` 传入 shell 执行。更严重的是，如果 `command` 字段缺失，`undefined` 会被传入命令调度器。
**改进方案**: 为每个 tool 的 input 定义 Zod schema（`ExecuteCommandInputSchema`、`ReadFileInputSchema`、`ListFilesInputSchema`），在 `executeToolCall` 的 switch 分支中先 `safeParse`，失败则返回 `Error: Invalid tool input: ${issues}` 给 AI 进行自我修正，不实际执行命令。
**验收标准**: 1) 所有 tool input 经过 Zod 验证后才执行 2) 畸形 input 返回描述性错误字符串而非崩溃 3) 新增 3+ 测试覆盖畸形 input 场景 4) 无 `as` 类型断言用于 tool input
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:27:35

---

### [completed] Agentic 循环不感知客户端断连 — writeSSE 静默吞错导致工具继续执行 ✅

**ID**: chat-034
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `writeSSE()` 在第 662-672 行对所有写入错误静默 catch（`// Stream closed, ignore`）。虽然第 192 行有 `stream.onAbort` 设置 `streamAborted` 标志，但在 `run()` 的主循环中，只在循环开头（约第 219 行 `if (streamAborted) break`）检查此标志。如果断连发生在 `executeToolCall()` 执行中途（如长时间命令），AI 会继续在服务器上执行后续工具调用，浪费资源且无人接收结果。`streamAnthropicCall()` 内部也无断连检查。
**改进方案**: 1) 在 `executeToolCall` 每个 tool 方法开头检查 `streamAborted` 2) 在 `streamAnthropicCall` 中 token 回调时检查 `streamAborted` 并提前 abort Anthropic stream 3) `writeSSE` 检测到写入失败时主动设置 `streamAborted = true`（不依赖 onAbort 回调延迟）。
**验收标准**: 1) 客户端断连后 500ms 内停止所有工具调用 2) Anthropic API stream 也被中断（节省 token） 3) 新增 2+ 测试验证断连后循环终止
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:15:19

---

### [completed] TokenTracker 内存无上限增长 — 长运行服务器必定 OOM ✅

**ID**: chat-035
**优先级**: P0
**模块路径**: packages/server/src/ai/token-tracker.ts
**发现的问题**: `TokenTracker.entries` 数组（第 143 行）只有 `push()` 没有任何淘汰机制。`record()` 方法（第 154 行）每次 AI 调用都追加条目。对于长时间运行的生产服务器，假设每分钟 10 次 AI 调用，每天 14,400 条 × 每条约 200 字节 = 每天 ~3MB，一个月 ~90MB 纯 entries 数组。`reset()` 方法（第 267 行）标注为测试用途。`getStats()` 和 `getStatsBySession()` 每次调用都遍历全量 entries。
**改进方案**: 1) 添加 `maxEntries` 配置（默认 10000） 2) `record()` 时检查长度，超出则移除最旧 entries 3) 可选：按 sessionId 分桶，evict 最旧 session 的所有 entries 4) 添加 `prune(olderThanMs)` 方法供定时清理。
**验收标准**: 1) entries 数组有上限，不再无限增长 2) 超出上限时自动淘汰旧条目 3) getStats 仍返回正确的近期统计 4) 新增 3+ 测试覆盖淘汰行为
**影响范围**: `packages/server/src/ai/token-tracker.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:19:21

---

### [completed] trimMessagesIfNeeded 静默丢弃上下文 — AI 无感知导致幻觉 ✅

**ID**: chat-036
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `trimMessagesIfNeeded()`（第 764-779 行）当消息 token 超过 `MAX_MESSAGES_TOKENS`(150K) 时，从 index 1 开始 splice 删除 assistant/user 消息对。问题：1) 被删除的可能包含关键文件内容（tool_result）或重要执行上下文 2) AI 模型完全不知道部分上下文已丢失，可能基于不完整信息做出错误决策 3) 没有日志记录删除了多少消息/token。
**改进方案**: 1) 在 trim 后注入一条 system message 说明 "Earlier tool results and conversation turns were trimmed to fit context window. {N} messages ({M}K tokens) removed." 2) 添加 debug 级别日志记录 trim 事件 3) 优先保留最近的 tool_result（包含文件内容）而非简单按位置删除。
**验收标准**: 1) trim 后 messages 数组包含一条上下文丢失提示 2) AI 能在后续回复中意识到可能缺失上下文 3) 日志记录 trim 的消息数和 token 数 4) 新增 2+ 测试验证提示注入
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:25:12

---

### [completed] listSessions 加载全部消息仅取 lastMessage — N+1 查询性能问题 ✅

**ID**: chat-037
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `listSessions()`（第 340-358 行）调用 `this.repo.listByServer()` 获取所有 session，然后对每个 session 的 `messages` 做 `map(toChatMessage)` 转换全部消息，仅为了取 `messages[messages.length - 1]?.content.slice(0, 100)` 作为 `lastMessage`。对于有 100 个 session、每个 session 平均 50 条消息的服务器，这意味着加载和转换 5000 条消息对象，仅使用其中 100 条的前 100 字符。
**改进方案**: 1) 在 `SessionRepository` 接口添加 `listSummaries()` 方法，在 SQL 层只查询 session 元数据 + 最后一条消息 2) 使用子查询或 window function 获取 lastMessage 3) DrizzleSessionRepository 实现中用 `SELECT ... (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message`。
**验收标准**: 1) listSessions 不再加载全部消息 2) SQL 查询数量从 N+1 降为 1 3) 返回结果格式不变 4) 新增性能测试验证改进
**影响范围**: `packages/server/src/core/session/manager.ts`, `packages/server/src/core/session/repository.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:35:03

---

### [completed] addMessage 在 cache eviction 后抛异常 — 高并发下用户丢消息 ✅

**ID**: chat-038
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `addMessage()`（第 285-311 行）在第 292 行检查 `this.cache.get(sessionId)`，如果返回 null 则抛出 `Error('Session ${sessionId} not found')`。但在高负载场景下，用户调用 `getOrCreate()` 后 session 进入 cache，若在 `addMessage()` 调用前另一个请求触发了 `evictIfNeeded()`（第 174-204 行），该 session 可能已被 LRU 驱逐。此时用户会收到 500 错误，且消息丢失。`evictIfNeeded` 虽然保护 active session（`plans.size > 0`），但普通聊天 session 无 plan 时不受保护。
**改进方案**: `addMessage()` 在 cache miss 时不抛异常，而是自动从 DB 重新加载 session（调用 `loadSessionFromDb`），然后继续添加消息。添加 `cache_reload` 计数器监控此场景频率。
**验收标准**: 1) cache miss 时自动 reload，用户无感知 2) 消息不再丢失 3) 新增测试：evict session 后 addMessage 仍成功 4) 日志记录 reload 事件
**影响范围**: `packages/server/src/core/session/manager.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:39:26

---

### [completed] waitForStepDecision 超时无 SSE 反馈 — 用户等 5 分钟后无任何提示 ✅

**ID**: chat-039
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `waitForStepDecision()`（第 121-133 行）创建 Promise，5 分钟后 `setTimeout` 自动 resolve('reject')。但超时发生时：1) 没有 SSE 事件通知前端 2) 前端仍显示 step confirm UI，用户以为还在等待 3) `pendingDecisions.delete(key)` 后，如果用户此时点击 approve，`resolveStepDecision()` 返回 false（未找到），前端收到 404 但不知道原因。
**改进方案**: 1) 超时时发送 SSE 事件 `step_decision_timeout`（含 stepId 和原因） 2) 前端收到此事件后自动关闭 confirm UI 并显示 "Step confirmation timed out" 提示 3) 前端 step confirm UI 显示倒计时。
**验收标准**: 1) 超时发送 SSE 事件 2) 前端自动关闭过期的 confirm UI 3) 新增 2+ 测试覆盖超时场景 4) 用户体验无"静默失败"
**影响范围**: `packages/server/src/api/routes/chat-execution.ts`, `packages/dashboard/src/stores/chat-execution.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:49:57

---

### [completed] planner.ts 使用 console.* 而非 pino logger — 生产环境日志不可见 ✅

**ID**: chat-040
**优先级**: P2
**模块路径**: packages/server/src/ai/planner.ts
**发现的问题**: 第 69 行 `console.error(...)`, 第 75 行 `console.error(...)`, 第 95 行 `console.log(...)`, 第 99 行 `console.warn(...)` — 项目全局使用 pino 结构化日志，但 `planner.ts` 仍使用 `console.*`。这导致：1) 生产环境 JSON 日志流中出现非结构化文本 2) 日志级别不受 pino 配置控制 3) 无法通过日志聚合工具（ELK/Loki）过滤这些日志。
**改进方案**: 导入项目 pino logger，将所有 `console.*` 替换为对应的 `logger.error/warn/info`，附带结构化上下文 `{ operation: 'generate_plan', software, error }`。
**验收标准**: 1) planner.ts 零 `console.*` 调用 2) 所有日志使用 pino logger 3) 日志包含结构化上下文字段
**影响范围**: `packages/server/src/ai/planner.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 04:54:46

---

### [completed] quality-checker.ts 重复定义 RiskLevel — 与 shared 模块不同步风险 ✅

**ID**: chat-041
**优先级**: P2
**模块路径**: packages/server/src/ai/quality-checker.ts
**发现的问题**: 第 24-32 行定义了本地 `RiskLevel` 常量 `{ GREEN, YELLOW, RED, CRITICAL, FORBIDDEN }`，而 `@aiinstaller/shared/security` 已有完整的 RiskLevel 定义（5 个级别 + 类型）。两份定义需要手动保持同步。如果 shared 模块新增一个风险级别（如 `ORANGE`），`quality-checker.ts` 不会自动感知。
**改进方案**: 删除 `quality-checker.ts` 中的本地 `RiskLevel` 定义，改为从 `@aiinstaller/shared` 导入。检查值映射是否完全一致（shared 用 `'green'|'yellow'|'red'|'critical'|'forbidden'` 字符串），确保 quality-checker 的 switch/if 逻辑兼容。
**验收标准**: 1) quality-checker.ts 不再有本地 RiskLevel 定义 2) 从 shared 导入并正常工作 3) 类型检查通过 4) 现有测试不变
**影响范围**: `packages/server/src/ai/quality-checker.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:13:59

---

### [completed] token-counting.ts 7 处 `any` 类型 — TypeScript strict 模式下的类型安全漏洞 ✅

**ID**: chat-042
**优先级**: P2
**模块路径**: packages/server/src/ai/token-counting.ts
**发现的问题**: 第 72、110、139、156、192、354、373 行共 7 处使用 `any` 类型参数。例如 `extractClaudeTokens(response: any)` — 调用方可传入任意值（string、null、undefined）且编译器不会报错。`isValidTokenUsage(usage: any)` 和 `safeTokenUsage(usage: any)` 是 type guard 函数但用 `any` 入参，丧失了 TypeScript 的类型收窄优势。
**改进方案**: 1) 将所有 `any` 改为 `unknown` 2) 在函数体内使用类型收窄（`typeof`/`in` 检查）访问属性 3) 对 `isValidTokenUsage` 使用 `is` 类型谓词 `(usage: unknown): usage is TokenUsage` 4) 所有 extract 函数入参改为 `unknown`。
**验收标准**: 1) token-counting.ts 零 `any` 类型 2) 所有函数使用 `unknown` + 运行时类型收窄 3) 现有测试全部通过 4) TypeScript strict 无新增错误
**影响范围**: `packages/server/src/ai/token-counting.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:18:12

---

### [completed] agent.ts (882行) 超出 800 行硬限制 — 需拆分模块 ✅

**ID**: chat-043
**优先级**: P2
**模块路径**: packages/server/src/ai/agent.ts
**发现的问题**: `agent.ts` 共 882 行，超出项目 800 行硬限制。文件包含：`InstallAIAgent` 类（环境分析、计划生成、流式计划生成、错误诊断、修复建议）、多个 Zod schema（`DetectedCapabilitiesSchema`/`EnvironmentAnalysisSchema`/`ErrorDiagnosisSchema`）、JSON 解析工具函数、以及 AI 调用基础设施（`callAI`/`callAIStreaming`）。职责过多。
**改进方案**: 1) 提取 Zod schemas 到 `ai/schemas.ts`（约 80 行） 2) 提取 `callAI`/`callAIStreaming`/`parseJSON` 到 `ai/api-call.ts`（约 200 行） 3) `agent.ts` 保留 `InstallAIAgent` 类的业务方法，降至约 600 行。
**验收标准**: 1) agent.ts < 500 行 2) 拆分后的模块各自职责单一 3) 所有现有测试通过（import path 调整后） 4) 无循环依赖
**影响范围**: `packages/server/src/ai/agent.ts`, 新文件 `ai/schemas.ts`, `ai/api-call.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:28:15

---

### [completed] error-analyzer.ts (914行) 超出 800 行硬限制 — 需拆分模块 ✅

**ID**: chat-044
**优先级**: P2
**模块路径**: packages/server/src/ai/error-analyzer.ts
**发现的问题**: `error-analyzer.ts` 共 914 行，超出项目 800 行硬限制。文件包含大量错误匹配规则、分析函数、修复策略生成。与 `common-errors.ts`（853 行，也超限）共同构成错误分析子系统，但两者分工不够清晰。
**改进方案**: 1) 将 `error-analyzer.ts` 中的错误模式匹配规则（regex patterns + match functions）提取到 `ai/error-patterns.ts` 2) 保留核心 `analyzeError()` 和 `buildFixStrategies()` 在 `error-analyzer.ts` 中 3) 目标：两个文件各 < 500 行。
**验收标准**: 1) error-analyzer.ts < 500 行 2) 新模块职责清晰 3) 所有现有测试通过 4) 导出接口不变
**影响范围**: `packages/server/src/ai/error-analyzer.ts`, 新文件 `ai/error-patterns.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:36:49

---

### [completed] ChatAIAgent.chat() 重试逻辑和 chatWithFallback() 零测试覆盖 ✅

**ID**: chat-045
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-ai.ts
**发现的问题**: `ChatAIAgent.chat()` 的重试循环（第 219-276 行）包含错误分类、退避延迟、`notifyRetry` 回调、`ChatRetryExhaustedError`，但**无任何测试**。`chatWithFallback()`（第 282-323 行）包含 fallback provider 解析、provider 切换、fallback 失败处理，也**无任何测试**。`resolveFallbackProvider()`（第 440-454 行）和 `resolveFallbackConfig()`（第 457-481 行）同样无测试。这是 AI 调用链的核心可靠性机制。
**改进方案**: 新增 `chat-ai.test.ts` 测试文件，覆盖：1) chat() 正常响应 2) chat() 重试（transient error → success） 3) chat() 重试耗尽 → ChatRetryExhaustedError 4) chatWithFallback() 成功切换 5) chatWithFallback() 无可用 fallback 6) extractPlan() 正规化 7) resolveFallbackProvider() 遍历优先级。
**验收标准**: 1) 新增 15+ 测试用例 2) chat-ai.ts 核心路径覆盖率 > 80% 3) 所有 retry/fallback 场景有测试 4) Mock AI provider 不实际调用 API
**影响范围**: 新文件 `packages/server/src/api/routes/chat-ai.test.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:43:01

---

### [completed] Agentic confirm 超时、legacy confirm 成功路径、step-decision 成功路径零测试 ✅

**ID**: chat-046
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat.ts, chat-execution.ts
**发现的问题**: 三个关键用户交互流程缺少测试：1) `chat.ts` 第 141-144 行 — agentic confirm 的 5 分钟超时 auto-reject（`setTimeout` → `resolve(false)`），仅测了 404 路径 2) `chat.ts` POST confirm 路由第 336-351 行的成功路径（找到 pending → clearTimeout → resolve → delete）从未被测试 3) `chat-execution.ts` POST step-decision 第 140-152 行 `resolveStepDecision()` 成功路径未被测试。
**改进方案**: 在 `chat.test.ts` 中补充：1) 设置 pending confirmation → 等待超时 → 验证 resolve(false) 2) 设置 pending confirmation → POST confirm → 验证 resolve(true) + 清理 3) 在 `chat-execution.test.ts` 中补充 waitForStepDecision + resolveStepDecision 集成测试。
**验收标准**: 1) confirm 超时路径有测试 2) confirm 成功路径有测试 3) step-decision 成功路径有测试 4) 新增 6+ 测试用例
**影响范围**: `packages/server/src/api/routes/chat.test.ts`, `chat-execution.test.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:48:25

---

### [completed] executePlanSteps 中 blocked/step-confirm/AI-summary/auto-diagnosis 四个分支零测试 ✅

**ID**: chat-047
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `executePlanSteps()` 内部多个重要分支未测试：1) 第 342-353 行 — `blocked` 命令处理（emit step_start + BLOCKED output + step_complete → break） 2) 第 356-378 行 — step-confirm 模式（reject → break, allow_all → skip 后续确认） 3) 第 477-508 行 — 执行后 AI 摘要生成（summaryPrompt 构建、streaming、错误处理） 4) 第 430-444/455-463 行 — 步骤失败后 auto-diagnosis SSE 事件。
**改进方案**: 在 `chat-execution.test.ts` 新增专门的 `executePlanSteps` 集成测试 describe 块，mock executor 返回不同结果，验证每个分支的 SSE 事件输出序列。
**验收标准**: 1) blocked 路径有测试（验证 SSE 事件序列） 2) step-confirm allow/reject/allow_all 有测试 3) AI summary 生成有测试 4) auto-diagnosis 集成有测试 5) 新增 8+ 测试用例
**影响范围**: `packages/server/src/api/routes/chat-execution.test.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 05:55:49

---

### [completed] fire-and-forget persistMessage 双重失败时用户无感知 — 消息静默丢失 ✅

**ID**: chat-048
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `persistMessage()`（第 502-525 行）在第一次 DB 写入失败后重试一次，如果再次失败仅 `logger.error` 记录，不抛异常也不通知调用方。`addMessage()`（第 307-308 行）以 fire-and-forget 方式调用 `persistMessage`（无 await、无 .catch），意味着消息仅存在于内存 cache。如果此后 session 被 evict 或服务器重启，该消息永久丢失。用户看到消息已发送（因为内存中存在），但刷新页面后消息消失。
**改进方案**: 1) `addMessage()` 返回的 `ChatMessage` 增加 `persisted: boolean` 字段 2) `persistMessage` 失败时将消息标记为 `persisted: false` 3) 定期扫描未持久化消息并重试（write-behind pattern） 4) 前端可选展示 "消息可能未保存" 状态图标。或更简单：对用户消息使用 await persistMessage（只有 AI 流式响应用 fire-and-forget）。
**验收标准**: 1) 用户发送的消息（role=user）同步持久化 2) AI 响应可异步持久化但有重试队列 3) 持久化失败有告警日志 + 前端提示 4) 新增测试验证双重失败后消息仍可通过重试队列恢复
**影响范围**: `packages/server/src/core/session/manager.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:07:32

---

### [completed] TokenUsage 类型不一致 — token-tracker 和 token-counting 使用不同的字段定义 ✅

**ID**: chat-049
**优先级**: P2
**模块路径**: packages/server/src/ai/token-tracker.ts, packages/server/src/ai/token-counting.ts
**发现的问题**: `token-tracker.ts` 第 18-27 行定义的 `TokenUsage` 包含 `cacheCreationInputTokens` 和 `cacheReadInputTokens` 字段，而 `token-counting.ts` 的 extract 函数返回的 `TokenUsage` 只有 `inputTokens` 和 `outputTokens`。使用 `extractClaudeTokens()` 的结果去调用 `tokenTracker.record()` 时，cache 相关字段为 undefined，导致成本估算可能不准确（Claude API 的 cache tokens 按不同价格计费）。
**改进方案**: 1) 统一 TokenUsage 定义到一个文件（如 `token-tracker.ts` 或新的 `ai/types.ts`） 2) 所有 extract 函数返回完整 TokenUsage（含 cache 字段，默认 0） 3) `extractClaudeTokens` 读取 `usage.cache_creation_input_tokens` 和 `usage.cache_read_input_tokens`。
**验收标准**: 1) 全局唯一 TokenUsage 类型定义 2) Claude cache tokens 被正确提取 3) 成本估算包含 cache token 费用 4) 现有测试全部通过
**影响范围**: `packages/server/src/ai/token-tracker.ts`, `packages/server/src/ai/token-counting.ts`
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 06:20:38

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

### [completed] activePlanExecutions 初始值为空字符串 — 取消执行可能失败 ✅

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
**完成时间**: 2026-02-13 02:21:49

---

### [completed] Plan 完成后未从 Session.plans Map 中清除 — 阻止缓存驱逐 ✅

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
**完成时间**: 2026-02-13 02:28:42

---

### [completed] respondToStep/respondToAgenticConfirm 失败时无用户反馈 — 用户操作被静默吞没 ✅

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
**完成时间**: 2026-02-13 02:32:10

---

### [completed] SSE 解析后 currentEvent 在空行处重置 — 多行 data 的事件类型丢失 ✅

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
**完成时间**: 2026-02-13 02:36:03

---

### [completed] onComplete 未清理 agenticConfirm 状态 — 执行成功后仍显示确认栏 ✅

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
**完成时间**: 2026-02-13 02:40:01

---

### [completed] SSE 流关闭后服务端 executePlanSteps 继续执行 — 浪费资源 ✅

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
**完成时间**: 2026-02-13 02:54:03

---

### [completed] sse.ts 文件超 500 行且含 4 套重复 SSE 解析逻辑 — 需提取通用解析器 ✅

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
**完成时间**: 2026-02-13 03:01:54

---

### [completed] SessionSidebar 日期分组使用硬编码英文 — 与项目 i18n 不一致 ✅

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
**完成时间**: 2026-02-13 03:05:54

---

### [completed] StepConfirmBar 类型安全 — PendingConfirm 使用 `as` 断言无运行时验证 ✅

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
**完成时间**: 2026-02-13 03:13:04

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
