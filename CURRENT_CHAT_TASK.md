### [pending] error-analyzer.ts (914行) 超出 800 行硬限制 — 需拆分模块

**ID**: chat-044
**优先级**: P2
**模块路径**: packages/server/src/ai/error-analyzer.ts
**发现的问题**: `error-analyzer.ts` 共 914 行，超出项目 800 行硬限制。文件包含大量错误匹配规则、分析函数、修复策略生成。与 `common-errors.ts`（853 行，也超限）共同构成错误分析子系统，但两者分工不够清晰。
**改进方案**: 1) 将 `error-analyzer.ts` 中的错误模式匹配规则（regex patterns + match functions）提取到 `ai/error-patterns.ts` 2) 保留核心 `analyzeError()` 和 `buildFixStrategies()` 在 `error-analyzer.ts` 中 3) 目标：两个文件各 < 500 行。
**验收标准**: 1) error-analyzer.ts < 500 行 2) 新模块职责清晰 3) 所有现有测试通过 4) 导出接口不变
**影响范围**: `packages/server/src/ai/error-analyzer.ts`, 新文件 `ai/error-patterns.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
