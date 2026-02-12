### [pending] runner-tools.test.ts — 工具定义构建 & 安全工具函数单元测试

**ID**: skill-023
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-tools.ts` (222 行) 包含 `parseTimeout()`、`exceedsRiskLimit()`、`buildToolDefinitions()` 三个关键导出函数，均无任何测试覆盖。`exceedsRiskLimit` 是安全核心函数（决定命令是否被拒绝），按项目标准安全模块需 95%+ 覆盖率
**实现方案**:
创建 `runner-tools.test.ts`，覆盖以下场景:
1. **parseTimeout** (~8 tests):
   - 正常解析: "30s"→30000, "5m"→300000, "1h"→3600000
   - 边界值: "0s"→0, "999h"
   - 错误格式: "5x", "abc", "", "5", "m5" → 抛出 Error
2. **exceedsRiskLimit** (~8 tests):
   - green/yellow/red/critical/forbidden 之间的所有组合比较
   - 边界: 相同级别不超限, forbidden 永远超限
3. **buildToolDefinitions** (~8 tests):
   - 单工具: ['shell'] → 只有 shell 定义
   - 多工具: ['shell', 'read_file', 'store'] → 3 个定义
   - 全工具: 6 种工具全部声明 → 6 个完整定义
   - 验证每个工具定义的 name、input_schema 字段完整性
**验收标准**:
- 测试 ≥ 22 个，覆盖所有导出函数
- `pnpm vitest run packages/server/src/core/skill/runner-tools.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-tools.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: -

---
