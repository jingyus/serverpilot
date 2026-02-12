### [pending] runner-executor.test.ts 拆分 — 847 行超出 800 行硬限制

**ID**: skill-073
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner-executor.test.ts` 847 行，略超 800 行硬限制。包含 8 个 describe 块: executeShell (196 行)、executeReadFile、executeWriteFile、executeNotify、executeHttp (111 行)、executeStore (129 行)、auditShell、executeTool dispatch。
**实现方案**: 
1. 创建 `runner-executor-network.test.ts` — 提取 `executeNotify` (L504-560) + `executeHttp` (L561-671) + `executeStore` (L672-800) ≈ 300 行
2. 原 `runner-executor.test.ts` 保留 `executeShell` + `executeReadFile` + `executeWriteFile` + `auditShell` + `executeTool dispatch` ≈ 550 行
**验收标准**: 
- `runner-executor.test.ts` ≤ 600 行
- `runner-executor-network.test.ts` ≤ 400 行
- 所有执行器测试通过
**影响范围**: packages/server/src/core/skill/runner-executor.test.ts, packages/server/src/core/skill/runner-executor-network.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
