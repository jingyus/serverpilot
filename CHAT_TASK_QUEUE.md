# Chat/AI 对话系统改进任务队列

> 此队列专注于 Chat 和 AI 对话系统的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-12 23:01:07

## 📊 统计

- **总任务数**: 5
- **待完成** (pending): 1
- **进行中** (in_progress): 0
- **已完成** (completed): 4
- **失败** (failed): 0

## 📋 任务列表

### [completed] 聊天会话持久化到 SQLite — 消除服务器重启丢失对话的致命问题 ✅

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

### [pending] Chat 建议点击功能缺失 — EmptyState 建议卡片无法触发发送消息

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
**完成时间**: -

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
