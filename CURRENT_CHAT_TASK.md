### [pending] agent.ts (882行) 超出 800 行硬限制 — 需拆分模块

**ID**: chat-043
**优先级**: P2
**模块路径**: packages/server/src/ai/agent.ts
**发现的问题**: `agent.ts` 共 882 行，超出项目 800 行硬限制。文件包含：`InstallAIAgent` 类（环境分析、计划生成、流式计划生成、错误诊断、修复建议）、多个 Zod schema（`DetectedCapabilitiesSchema`/`EnvironmentAnalysisSchema`/`ErrorDiagnosisSchema`）、JSON 解析工具函数、以及 AI 调用基础设施（`callAI`/`callAIStreaming`）。职责过多。
**改进方案**: 1) 提取 Zod schemas 到 `ai/schemas.ts`（约 80 行） 2) 提取 `callAI`/`callAIStreaming`/`parseJSON` 到 `ai/api-call.ts`（约 200 行） 3) `agent.ts` 保留 `InstallAIAgent` 类的业务方法，降至约 600 行。
**验收标准**: 1) agent.ts < 500 行 2) 拆分后的模块各自职责单一 3) 所有现有测试通过（import path 调整后） 4) 无循环依赖
**影响范围**: `packages/server/src/ai/agent.ts`, 新文件 `ai/schemas.ts`, `ai/api-call.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
