### [pending] engine-template-vars.ts 单元测试 — 补齐模板变量测试覆盖

**ID**: skill-102
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `engine-template-vars.ts` (88 行) 包含 `buildServerVars()` 和 `buildSkillVars()` 两个函数，但没有对应的测试文件。模板变量构建涉及 server profile 解析和执行历史查询，边界条件较多。
**实现方案**: 
1. 创建 `engine-template-vars.test.ts`
2. 测试用例:
   - `buildServerVars()`: 正常服务器、不存在的服务器、profile 不可用、osInfo 缺失
   - `buildSkillVars()`: 有历史记录、无历史记录、result 为 object vs string
   - 异常处理: 仓库抛错时返回默认值
3. Mock `getServerRepository()` 和 `SkillRepository`
**验收标准**: 
- ≥8 个测试用例覆盖所有分支
- 所有测试通过
- 验证默认值 fallback 逻辑
**影响范围**: 新建 packages/server/src/core/skill/engine-template-vars.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
