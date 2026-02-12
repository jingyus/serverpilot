# Chat/AI 对话系统改进任务队列

> 此队列专注于 Chat 和 AI 对话系统的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: 2026-02-13 00:29:20

## 📊 统计

- **总任务数**: 20
- **待完成** (pending): 6
- **进行中** (in_progress): 0
- **已完成** (completed): 14
- **失败** (failed): 0

## 📋 任务列表

### [completed] 聊天会话持久化到 SQLite — 消除服务器重启丢失对话的致命问题 ✅
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

### [pending] AgenticConfirmBar 组件质量低于其他 Chat 组件 — 缺测试、缺 testid、风格不一致

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
**完成时间**: -

---

### [pending] MarkdownRenderer 复制按钮 Promise 未处理 + setTimeout 泄漏

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
**完成时间**: -

---

### [pending] /confirm 端点缺少 Zod 请求体验证 — 可能接受畸形数据

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
**完成时间**: -

---

### [pending] 会话内存缓存无驱逐机制 — 长期运行服务器内存持续增长

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
**完成时间**: -

---

### [pending] SSE 重连复用原始请求体 — 可能导致服务端重复处理用户消息

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
**完成时间**: -

---

### [pending] server 端 chat.ts 路由文件超 800 行硬限制 — `any` 类型逃逸需修复

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
**完成时间**: -


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
