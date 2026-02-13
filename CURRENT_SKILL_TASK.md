### [pending] Skill 健康检查 — 定期验证已安装 Skill 完整性

**ID**: skill-096
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 已安装 Skill 的验证仅在执行时触发 (on-demand)。如果 Skill 目录被删除、manifest 损坏或依赖缺失，直到下次执行才会发现。Cron Skill 可能静默失败。
**实现方案**: 
1. 在 engine.ts (拆分后) 添加 `healthCheck(): Promise<HealthCheckResult[]>` 方法:
   - 遍历所有 enabled skills
   - 检查 skillPath 目录是否存在
   - 尝试 loadSkillFromDir() 验证 manifest
   - 对比 DB 中 version 与磁盘 manifest version
   - 返回每个 skill 的健康状态: healthy / degraded / broken
2. 在 engine `start()` 中添加定期健康检查 (每 6 小时)
3. broken skill 自动标记为 `error` 状态 + warn 日志
4. API: `GET /api/v1/skills/health` 返回健康报告
**验收标准**: 
- 健康检查检测目录缺失、manifest 损坏、版本不匹配
- broken skill 自动降级到 error 状态
- 日志记录所有健康状态变化
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/core/skill/engine.ts (拆分后文件), 新建 engine-health.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
