### [pending] Skill 执行 E2E 集成测试 — 覆盖完整生命周期

**ID**: skill-018
**优先级**: P2
**模块路径**: tests/ 或 packages/server/src/core/skill/
**当前状态**: 功能缺失 — 现有测试全部为单元测试 (mock AI provider、mock executor)。缺少验证完整 install → configure → enable → manual execute → verify execution result 的集成测试。特别是以下集成点未被测试覆盖:
  - SkillEngine + SkillRunner + TriggerManager 协同
  - RBAC 权限在 skill 路由上的端到端验证
  - SSE 事件流从 SkillRunner → SkillEventBus → SSE endpoint 的完整链路
**实现方案**:

1. **skill-integration.test.ts** (~300 行):
   - 使用 InMemory repositories + Mock AI Provider
   - 测试完整生命周期:
     - 安装 → 验证 DB 持久化
     - 配置 → 验证状态自动转换 (installed → configured)
     - 启用 → 验证 TriggerManager 注册触发器
     - 手动执行 → Mock AI 返回 tool_use → 验证工具调用链
     - 暂停 → 验证 TriggerManager 注销触发器
     - 卸载 → 验证 DB 清理 + 关联执行记录级联删除
   - 测试 SSE 事件流:
     - 启动执行 → 订阅 SkillEventBus → 验证 step/log/completed 事件序列
   - 测试 RBAC 端到端:
     - member 角色只能 view，不能 manage/execute
     - admin 角色可以 manage + execute
   - 测试错误恢复:
     - Skill manifest 损坏 → 执行失败 → status 设为 error
     - 执行超时 → 正确记录 timeout 状态

**验收标准**:
- 完整的 install→configure→enable→execute→result 链路覆盖
- SSE 事件流验证
- RBAC 权限验证
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/skill-integration.test.ts` (新建)

**创建时间**: (自动填充)
**完成时间**: -

---
