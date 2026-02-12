### [pending] planner.ts 使用 console.* 而非 pino logger — 生产环境日志不可见

**ID**: chat-040
**优先级**: P2
**模块路径**: packages/server/src/ai/planner.ts
**发现的问题**: 第 69 行 `console.error(...)`, 第 75 行 `console.error(...)`, 第 95 行 `console.log(...)`, 第 99 行 `console.warn(...)` — 项目全局使用 pino 结构化日志，但 `planner.ts` 仍使用 `console.*`。这导致：1) 生产环境 JSON 日志流中出现非结构化文本 2) 日志级别不受 pino 配置控制 3) 无法通过日志聚合工具（ELK/Loki）过滤这些日志。
**改进方案**: 导入项目 pino logger，将所有 `console.*` 替换为对应的 `logger.error/warn/info`，附带结构化上下文 `{ operation: 'generate_plan', software, error }`。
**验收标准**: 1) planner.ts 零 `console.*` 调用 2) 所有日志使用 pino logger 3) 日志包含结构化上下文字段
**影响范围**: `packages/server/src/ai/planner.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
