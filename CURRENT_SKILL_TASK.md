### [pending] SkillRunner — AI 自主执行层 + 安全约束 + 审计集成

**ID**: skill-005
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 依赖 skill-003 (SkillEngine) 完成后接入。参考 `ai/agentic-chat.ts` 中的 tool_use 自主循环模式
**实现方案**:

1. **runner.ts** (~350 行):
   - `SkillRunner` 类 — 单次 Skill 执行的 AI 循环:
     - `run(params: SkillRunParams): Promise<SkillRunResult>` — 核心方法
     - 构建 AI messages: system prompt (Skill 专用) + skill prompt (从 YAML 解析后注入变量) + trigger context
     - Tool 定义 (根据 skill.yaml 的 `tools` 字段动态生成):
       - `shell`: 执行命令 → `getTaskExecutor().execute()` 发送到 Agent
       - `read_file`: 读取服务器文件
       - `write_file`: 写入服务器文件
       - `notify`: 发送通知 → `getWebhookDispatcher().dispatch()` 事件
       - `http`: HTTP 请求 (受限域名)
       - `store`: KV 存储读写
     - Agentic loop (参考 `agentic-chat.ts`):
       - AI 返回 tool_use → 安全检查 → 执行工具 → 返回结果 → 再次调用 AI
       - 终止: AI 返回 end_turn / 达到 max_steps / 超时
     - **安全集成**:
       - `shell` 工具: `classifyCommand()` 风险分级 → 对比 `constraints.risk_level_max` → 超限拒绝
       - `risk_level === 'forbidden'` → 永远拒绝
       - 所有 shell 命令通过 `getAuditLogger().log()` 记录
     - **超时 & 步数**:
       - `parseTimeout(timeout: string): number` — "30s"→30000, "5m"→300000, "1h"→3600000
       - `constraints.max_steps` 计数器 (每个 tool_use +1)
       - `setTimeout` 全局超时保护
2. **runner.test.ts** (~250 行):
   - Mock AIProvider 返回预设 tool_use 响应
   - 测试: 单步 shell 执行 → 成功结果
   - 测试: 多步循环 (read_file → shell → notify)
   - 测试: 安全拒绝 (red 命令 + yellow max → 拒绝)
   - 测试: 超时终止 (1s timeout → timeout 状态)
   - 测试: 步数限制 (max_steps=2 → 第 3 步停止)
   - 测试: 审计日志记录验证
3. **更新 engine.ts** — `execute()` 方法接入 SkillRunner:
   - 替换 Phase 1 的占位逻辑为真实 AI 执行
   - 传递 constraints, tools, resolved prompt 到 runner

**验收标准**:
- AI 自主循环能执行 3+ 步的多步 Skill (mock AI)
- `classifyCommand()` 安全检查正确拦截超限命令
- 超时和步数限制正确终止循环
- 所有 shell 执行记录到 audit_log
- 测试 ≥ 18 个

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 接入 runner)

**创建时间**: 2026-02-12
**完成时间**: -

---

## 🔮 后续任务预告 (当前批次完成后生成)

| ID | 优先级 | 标题 | 依赖 |
|----|--------|------|------|
| skill-006 | P2 | TriggerManager — Cron/Event/Threshold 触发调度 | skill-005 |
| skill-007 | P2 | Skill KV Store — 每个 Skill 的持久化存储 API | skill-001 |
| skill-008 | P3 | Dashboard — 前端类型 + Zustand Store + API 集成 | skill-004 |
| skill-009 | P3 | Dashboard — Skills 管理页面 + UI 组件 | skill-008 |
| skill-010 | P3 | SSE 推送 — Skill 执行实时进度流 | skill-005 |
| skill-011 | P4 | 社区 Skill 安装 — 从 Git URL 安装 | skill-003 |
| skill-012 | P4 | Skill 链式触发 — skill.completed 事件驱动 | skill-006 |

---
